# 归档角色批内重复 key 去重 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 归档 resolve 阶段检测批内重复角色 key，显式标 conflict → 409，避免问题 A（新角色重复撞 unique rollback）与问题 B（已有角色重复写脏数据）。

**Architecture:** 在 `resolveAndCommitCharacterWrites` 加 `seenKeys` 批内去重；扩展 `ConflictInfo.reason` 与 `duplicateOfWriteIndex` 字段；前端 `ReviewingPanel` 冲突横幅按 `reason` 分支渲染。

**Tech Stack:** TypeScript、Fastify、Prisma、Vitest（server）、Vue 3 + Naive UI（web）

**Spec:** `docs/superpowers/specs/2026-08-14-character-batch-duplicate-key-design.md`

---

## Task 1: 后端 resolve 批内去重（TDD）

**Files:**
- Modify: `apps/server/src/services/character-extractor.ts`（`ConflictInfo` 接口 + `resolveAndCommitCharacterWrites`）
- Test: `apps/server/src/__tests__/services/character-extractor-resolve.test.ts`（增补 4 个用例）

### Step 1: 写失败测试

在 `character-extractor-resolve.test.ts` 的 `describe('resolveAndCommitCharacterWrites', ...)` 块内、最后一个现有 `it`（`ConflictError 携带 conflicts 信息`）之后，追加以下 4 个用例：

```typescript
  it('批内两个新角色同 slug → 第二条标 batch_duplicate_key（问题 A）', async () => {
    const writes: CharacterStateRow[] = [
      { characterId: null, name: '神秘人', key: 'shenmi_ren', status: {}, relationships: {}, isNew: true },
      { characterId: null, name: '神秘人', key: 'shenmi_ren', status: {}, relationships: {}, isNew: true }
    ]
    const { effectiveWrites, conflicts } = await resolveAndCommitCharacterWrites(tx, 'story-1', 3, writes, existing)
    expect(effectiveWrites).toHaveLength(1)
    expect(effectiveWrites[0].isNew).toBe(true)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].reason).toBe('batch_duplicate_key')
    expect(conflicts[0].writeIndex).toBe(1)
    expect(conflicts[0].duplicateOfWriteIndex).toBe(0)
  })

  it('批内两条同 key 命中现有角色 → 第二条标 batch_duplicate_key（问题 B）', async () => {
    const writes: CharacterStateRow[] = [
      { characterId: null, name: '林凡', key: 'linfan', status: {}, relationships: {}, isNew: true },
      { characterId: null, name: '林凡', key: 'linfan', status: {}, relationships: {}, isNew: true }
    ]
    const { effectiveWrites, conflicts } = await resolveAndCommitCharacterWrites(tx, 'story-1', 3, writes, existing)
    expect(effectiveWrites).toHaveLength(1)
    expect(effectiveWrites[0].characterId).toBe('char-linfan')
    expect(effectiveWrites[0].isNew).toBe(false)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].reason).toBe('batch_duplicate_key')
    expect(conflicts[0].duplicateOfWriteIndex).toBe(0)
  })

  it('三条同 key → 第 2、3 条都标 batch_duplicate_key，均指向第 1 条', async () => {
    const writes: CharacterStateRow[] = [
      { characterId: null, name: '神秘人', key: 'shenmi_ren', status: {}, relationships: {}, isNew: true },
      { characterId: null, name: '神秘人', key: 'shenmi_ren', status: {}, relationships: {}, isNew: true },
      { characterId: null, name: '神秘人', key: 'shenmi_ren', status: {}, relationships: {}, isNew: true }
    ]
    const { effectiveWrites, conflicts } = await resolveAndCommitCharacterWrites(tx, 'story-1', 3, writes, existing)
    expect(effectiveWrites).toHaveLength(1)
    expect(conflicts).toHaveLength(2)
    expect(conflicts[0].writeIndex).toBe(1)
    expect(conflicts[0].duplicateOfWriteIndex).toBe(0)
    expect(conflicts[1].writeIndex).toBe(2)
    expect(conflicts[1].duplicateOfWriteIndex).toBe(0)
  })

  it('空 key 与重复 key 混合 → missing_key 与 batch_duplicate_key 各自正确', async () => {
    const writes: CharacterStateRow[] = [
      { characterId: null, name: '无名氏', key: '', status: {}, relationships: {}, isNew: true },
      { characterId: null, name: '神秘人', key: 'shenmi_ren', status: {}, relationships: {}, isNew: true },
      { characterId: null, name: '神秘人', key: 'shenmi_ren', status: {}, relationships: {}, isNew: true }
    ]
    const { effectiveWrites, conflicts } = await resolveAndCommitCharacterWrites(tx, 'story-1', 3, writes, existing)
    expect(effectiveWrites).toHaveLength(1)
    expect(conflicts).toHaveLength(2)
    expect(conflicts[0].reason).toBe('missing_key')
    expect(conflicts[0].writeIndex).toBe(0)
    expect(conflicts[1].reason).toBe('batch_duplicate_key')
    expect(conflicts[1].writeIndex).toBe(2)
    expect(conflicts[1].duplicateOfWriteIndex).toBe(1)
  })
```

### Step 2: 运行测试确认失败

Run: `pnpm --filter server exec vitest run src/__tests__/services/character-extractor-resolve.test.ts`

Expected: 新增的 4 个用例 FAIL（当前 resolve 不标 `batch_duplicate_key`，重复条都进 `effectiveWrites`）；现有用例仍 PASS。

### Step 3: 实现最小代码

修改 `apps/server/src/services/character-extractor.ts`。

(1) 扩展 `ConflictInfo`（第 3-8 行）：

```typescript
export interface ConflictInfo {
  writeIndex: number
  reason: 'missing_key' | 'slug_name_mismatch' | 'batch_duplicate_key'
  existingCharacter?: { id: string; slug: string; name: string }
  aiWrite?: CharacterStateRow
  /** 仅 reason='batch_duplicate_key'：指向批内首次出现同 key 的 writeIndex */
  duplicateOfWriteIndex?: number
}
```

(2) 替换 `resolveAndCommitCharacterWrites` 函数体（第 24-68 行），插入 `seenKeys` 批内去重：

```typescript
export async function resolveAndCommitCharacterWrites(
  tx: any,
  storyId: string,
  chapterNumber: number,
  writes: CharacterStateRow[],
  allExistingCharacters: Array<{ id: string; slug: string; name: string }>,
  log?: { info: (msg: string) => void; warn: (msg: string) => void }
): Promise<{ effectiveWrites: CharacterStateRow[]; conflicts: ConflictInfo[] }> {
  const safeLog = log ?? { info: () => {}, warn: () => {} }
  const effectiveWrites: CharacterStateRow[] = []
  const conflicts: ConflictInfo[] = []
  // 批内 key 去重：key 是角色身份标识，重复 key 即「AI 重复输出同一角色」。
  // 放在所有分支之前（含短路分支），无论该条是否已被 ReviewingPanel 纠正。
  const seenKeys = new Map<string, number>()

  for (let i = 0; i < writes.length; i++) {
    const w = writes[i]
    if (!w.key || !w.key.trim()) {
      conflicts.push({ writeIndex: i, reason: 'missing_key', aiWrite: w })
      continue
    }
    if (seenKeys.has(w.key)) {
      conflicts.push({
        writeIndex: i,
        reason: 'batch_duplicate_key',
        duplicateOfWriteIndex: seenKeys.get(w.key),
        aiWrite: w
      })
      continue
    }
    seenKeys.set(w.key, i)
    // 短路: ReviewingPanel 已纠正(characterId 非空 + isNew=false),信任前端选的 characterId,跳过 slug 校验
    if (w.characterId && !w.isNew) {
      effectiveWrites.push(w)
      continue
    }
    const existing = allExistingCharacters.find(c => c.slug === w.key)
    if (existing) {
      if (existing.name === w.name) {
        effectiveWrites.push({ ...w, characterId: existing.id, isNew: false })
      } else {
        conflicts.push({
          writeIndex: i,
          reason: 'slug_name_mismatch',
          existingCharacter: existing,
          aiWrite: w
        })
        safeLog.warn(
          `[CharacterResolve] slug conflict: AI returned name="${w.name}" for slug="${w.key}", but existing character has name="${existing.name}"`
        )
      }
    } else {
      effectiveWrites.push({ ...w, characterId: null, isNew: true })
    }
  }

  return { effectiveWrites, conflicts }
}
```

### Step 4: 运行测试确认通过

Run: `pnpm --filter server exec vitest run src/__tests__/services/character-extractor-resolve.test.ts`

Expected: 全部 PASS（新增 4 个 + 现有 6 个均通过）。

再跑一次全量 server 测试确认无回归：

Run: `pnpm --filter server test`

Expected: 全部 PASS。

### Step 5: Commit

```bash
git add apps/server/src/services/character-extractor.ts apps/server/src/__tests__/services/character-extractor-resolve.test.ts
git commit -m "fix(characters): detect batch duplicate key in archive resolve"
```

---

## Task 2: 前端 ReviewingPanel 冲突横幅按 reason 分支

**Files:**
- Modify: `apps/web/src/views/ReviewingPanel.vue`（props 类型 + 横幅 `<li>` 渲染分支）

### Step 1: 改 props 类型与横幅渲染

(1) `conflicts` props 类型（约第 516-521 行），加 `duplicateOfWriteIndex`：

```typescript
  conflicts?: Array<{
    writeIndex: number
    reason: string
    existingCharacter?: { id: string; slug: string; name: string }
    aiWrite?: { name: string; key: string }
    duplicateOfWriteIndex?: number
  }>
```

(2) 横幅列表项（约第 56-59 行），按 `c.reason` 分支：

```html
              <li v-for="c in conflicts" :key="c.writeIndex" style="margin-bottom: 4px">
                <template v-if="c.reason === 'batch_duplicate_key'">
                  AI 重复返回了 slug="{{ c.aiWrite?.key }}"（name="{{ c.aiWrite?.name }}"），
                  与第 {{ (c.duplicateOfWriteIndex ?? 0) + 1 }} 条重复，请删除重复项或改 key
                </template>
                <template v-else>
                  AI 返回 name="{{ c.aiWrite?.name }}", slug="{{ c.aiWrite?.key }}"
                  与已有 name="{{ c.existingCharacter?.name }}", slug="{{ c.existingCharacter?.slug }}" 冲突
                </template>
              </li>
```

### Step 2: typecheck 验证

Run: `pnpm --filter web typecheck`

Expected: PASS（无类型错误）。

### Step 3: Commit

```bash
git add apps/web/src/views/ReviewingPanel.vue
git commit -m "fix(characters): render batch duplicate key conflict in reviewing panel"
```

---

## 完成验证

两个 Task 完成后：

1. `pnpm --filter server test` 全量通过。
2. `pnpm --filter web typecheck` 通过。
3. `pnpm typecheck`（全仓）通过。
