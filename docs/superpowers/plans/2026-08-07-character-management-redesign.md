# 角色管理重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 `docs/superpowers/specs/2026-08-07-character-management-redesign.md` 描述的角色管理重构 — Base + Snapshot 双层存储 + AI 抽取新角色自动入库 + 衣着字段 + ReviewingPanel 纠正 + Characters.vue 三列快照展示。

**Architecture:**
- Schema 加 3 字段(Character.relationships / Character.status / CharacterBranchState.costume),向后兼容(nullable)
- `commitCharacterBranchStateWrites` 扩展支持 isNew 自动建档
- 新增 `resolveAndCommitCharacterWrites` 做 code-level slug+name 双校验
- 新增 `character-display.ts` 服务封装"三字段独立查最新有数据归档章"
- 前端 ReviewingPanel 加纠正 dropdown,Characters.vue 加章节切换 + 来源标注
- 一次性 migration 脚本回填 base 关系/状态

**Tech Stack:** TypeScript / Prisma / Vitest / Fastify / Vue 3 + Naive UI + Axios

---

## File Structure

**新增:**
- `apps/server/src/services/character-display.ts` — 三字段独立查"最新有数据归档章"工具
- `scripts/backfill-character-base.ts` — 一次性 backfill 脚本
- `apps/server/src/__tests__/services/character-display.test.ts` — 单元测试
- `apps/server/src/__tests__/services/character-extractor-resolve.test.ts` — 新增 resolve 函数单元测试

**修改:**
- `prisma/schema.prisma` — 加 3 字段
- 新 migration 文件
- `apps/server/src/routes/characters.ts` — POST 接受 base 关系/状态;新增 GET display 端点
- `apps/server/src/services/stages/character-stage.ts` — prompt 加 costume + 解析
- `apps/server/src/services/character-extractor.ts` — 新增 resolve 函数 + 扩展 commit 函数
- `apps/server/src/routes/chapters-archive.ts` — archive 端点接入新逻辑 + ConflictError 处理
- `apps/web/src/views/Characters.vue` — 三列 + 来源 + 章节切换
- `apps/web/src/views/ReviewingPanel.vue` — 纠正下拉 + 冲突警告
- `apps/web/src/api/characters.ts` — display 端点类型
- `apps/web/src/views/ReviewingPanel.adapter.ts` — toV4 加 costume
- `apps/server/src/__tests__/services/character-extractor.test.ts` — 扩展测试覆盖 auto-create
- `package.json` — 加 db:backfill-character-base script
- `AGENTS.md` — §9 功能速查补一行

**未动:**
- `apps/server/src/routes/chapters-generate.ts`(`getCharactersWithLatestState`)
- `apps/server/src/services/runtime-loader.ts`
- 其他无关注点

---

### Task 1: Schema migration — 3 个新字段

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/2026MMDDHHMMSS_add_character_base_state_and_costume/migration.sql`

- [ ] **Step 1: 编辑 `prisma/schema.prisma` 添加 3 字段**

找到 `model Character` 块,在 `temperament` 后追加:
```prisma
  // base 初始状态;第 1 章或番外无 snapshot 时作为 fallback
  relationships String?  // JSON
  status        String?  // JSON
```

找到 `model CharacterBranchState` 块,在 `relationships` 后追加:
```prisma
  // 衣着快照;解耦实现,后续可整体移除
  costume String?
```

- [ ] **Step 2: 生成 Prisma migration**

Run:
```bash
cd D:\NewCode\ai-novel-runtime
pnpm prisma migrate dev --name add_character_base_state_and_costume --skip-generate
```

Expected: 在 `prisma/migrations/` 下生成新文件夹,含 `migration.sql` 文件,内容是 3 个 `ALTER TABLE ADD COLUMN` 语句。

- [ ] **Step 3: 重新生成 Prisma Client**

Run:
```bash
pnpm db:generate
```

Expected: 不报错;Prisma Client 类型扩展完成。

- [ ] **Step 4: 跑 typecheck 验证**

Run:
```bash
pnpm typecheck
```

Expected: 全绿。新字段在 `Prisma.Character` / `Prisma.CharacterBranchState` 类型上可见。

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(schema): add Character base state + CharacterBranchState costume"
```

---

### Task 2: character-stage prompt + 解析加 costume 字段

**Files:**
- Modify: `apps/server/src/services/stages/character-stage.ts:62-72`(prompt 模板 `【输出】JSON` 块)
- Modify: `apps/server/src/services/stages/character-stage.ts`(导出类型 `CharacterStageResult.characterStates[]`)

- [ ] **Step 1: 更新 prompt 模板加 costume 字段**

在 `apps/server/src/services/stages/character-stage.ts` 的 prompt 字符串(约 line 62)找到 `【输出】JSON` 块,把 characterStates 元素的字段列表替换为:

```
  "characterStates": [
    {
      "characterId": "<已有角色 id,新角色 → null>",
      "name": "<角色名>",
      "key": "<graph key,已有角色复用已有 key,新角色用拼音小写下划线>",
      "status": {"rank":"练气","location":"洞府","realm":"凡人"},
      "relationships": {"<其他角色名>": "<关系>"},
      "costume": "<本章节结束时的衣着/服饰描述;未描写或无变化则留空字符串>",
      "isNew": <true / false>
    }
  ]
```

- [ ] **Step 2: 扩展 `CharacterStageResult.characterStates[]` 类型**

修改 `character-stage.ts` 中 `CharacterStageResult` 接口(约 line 25),把 characterStates 元素类型改为:

```ts
export interface CharacterStateRow {
  characterId: string | null
  name: string
  key: string
  status: string | object
  relationships: string | object
  costume?: string   // 新增,可选
  isNew: boolean
}
```

- [ ] **Step 3: 更新解析段接受 costume 字段**

修改 `runCharacterStage` 中 `parsedRoot` 解析后的 `result` 构造块(约 line 73-82),加入:

```ts
const result: CharacterStageResult = {
  // ... 既有字段 ...
  characterStates: parsedRoot.characterStates.map((s: any) => ({
    characterId: s.characterId ?? null,
    name: s.name,
    key: s.key,
    status: s.status ?? {},
    relationships: s.relationships ?? {},
    costume: typeof s.costume === 'string' ? s.costume : '',
    isNew: s.isNew === true
  }))
}
```

- [ ] **Step 4: 跑 typecheck + 现有测试**

Run:
```bash
pnpm typecheck
pnpm --filter server test character-extractor
```

Expected: typecheck 全绿;`character-extractor.test.ts` 5 个 case 全过(注意:旧测试构造的 `CharacterStateRow` 没有 costume 字段,需要给所有 fixture 加 `costume: ''` 或 `costume: undefined` — 让 commit 函数忽略)。

- [ ] **Step 5: 修复旧测试**

打开 `apps/server/src/__tests__/services/character-extractor.test.ts`,给所有 `CharacterStateRow` 字面量补 `costume: ''`(或 `costume: undefined`,二选一)。

Run:
```bash
pnpm --filter server test character-extractor
```

Expected: 5 个 case 全过。

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/services/stages/character-stage.ts apps/server/src/__tests__/services/character-extractor.test.ts
git commit -m "feat(character-stage): add costume field to AI extraction"
```

---

### Task 3: `resolveAndCommitCharacterWrites` + `ConflictError`

**Files:**
- Modify: `apps/server/src/services/character-extractor.ts`
- Create: `apps/server/src/__tests__/services/character-extractor-resolve.test.ts`

- [ ] **Step 1: 写失败测试 — slug+name 双匹配**

创建 `apps/server/src/__tests__/services/character-extractor-resolve.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { resolveAndCommitCharacterWrites, ConflictError } from '../../services/character-extractor.js'
import type { CharacterStateRow } from '../../services/stages/character-stage.js'

describe('resolveAndCommitCharacterWrites', () => {
  const existing = [
    { id: 'char-linfan', slug: 'linfan', name: '林凡' },
    { id: 'char-zhangsan', slug: 'zhangsan', name: '张三' }
  ]
  const tx: any = {}  // 不需要 mock,该函数不直接写 DB

  it('slug+name 双匹配 → 命中,isNew=false', async () => {
    const writes: CharacterStateRow[] = [
      { characterId: null, name: '林凡', key: 'linfan', status: {}, relationships: {}, isNew: true }
    ]
    const { effectiveWrites, conflicts } = await resolveAndCommitCharacterWrites(tx, 'story-1', 3, writes, existing)
    expect(conflicts).toEqual([])
    expect(effectiveWrites[0].characterId).toBe('char-linfan')
    expect(effectiveWrites[0].isNew).toBe(false)
  })

  it('slug 命中 + name 不匹配 → conflict', async () => {
    const writes: CharacterStateRow[] = [
      { characterId: null, name: '林峰', key: 'linfan', status: {}, relationships: {}, isNew: true }
    ]
    const { effectiveWrites, conflicts } = await resolveAndCommitCharacterWrites(tx, 'story-1', 3, writes, existing)
    expect(effectiveWrites).toEqual([])
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].reason).toBe('slug_name_mismatch')
    expect(conflicts[0].existingCharacter.name).toBe('林凡')
  })

  it('slug 未命中 → isNew=true', async () => {
    const writes: CharacterStateRow[] = [
      { characterId: null, name: '神秘人', key: 'shenmi_ren', status: {}, relationships: {}, isNew: false }  // AI 误报 isNew=false
    ]
    const { effectiveWrites, conflicts } = await resolveAndCommitCharacterWrites(tx, 'story-1', 3, writes, existing)
    expect(conflicts).toEqual([])
    expect(effectiveWrites[0].isNew).toBe(true)
    expect(effectiveWrites[0].characterId).toBe(null)
  })

  it('AI 未给 key → conflict(missing_key)', async () => {
    const writes: CharacterStateRow[] = [
      { characterId: null, name: '无名氏', key: '', status: {}, relationships: {}, isNew: true }
    ]
    const { effectiveWrites, conflicts } = await resolveAndCommitCharacterWrites(tx, 'story-1', 3, writes, existing)
    expect(effectiveWrites).toEqual([])
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].reason).toBe('missing_key')
  })

  it('混合: 1 命中 + 1 新建 + 1 冲突', async () => {
    const writes: CharacterStateRow[] = [
      { characterId: null, name: '林凡', key: 'linfan', status: {}, relationships: {}, isNew: true },
      { characterId: null, name: '神秘人', key: 'shenmi_ren', status: {}, relationships: {}, isNew: true },
      { characterId: null, name: '林峰', key: 'linfan', status: {}, relationships: {}, isNew: true }
    ]
    const { effectiveWrites, conflicts } = await resolveAndCommitCharacterWrites(tx, 'story-1', 3, writes, existing)
    expect(effectiveWrites).toHaveLength(2)
    expect(conflicts).toHaveLength(1)
  })

  it('ConflictError 携带 conflicts 信息', () => {
    const err = new ConflictError([{ writeIndex: 0, reason: 'missing_key' }])
    expect(err.name).toBe('ConflictError')
    expect(err.conflicts).toHaveLength(1)
    expect(err.message).toContain('1 issues')
  })
})
```

- [ ] **Step 2: 跑测试,确认失败**

Run:
```bash
pnpm --filter server test character-extractor-resolve
```

Expected: FAIL — `resolveAndCommitCharacterWrites` / `ConflictError` 未导出。

- [ ] **Step 3: 实现 `ConflictError` 类**

打开 `apps/server/src/services/character-extractor.ts`,在文件顶部 import 后追加:

```ts
export interface ConflictInfo {
  writeIndex: number
  reason: 'missing_key' | 'slug_name_mismatch'
  existingCharacter?: { id: string; slug: string; name: string }
  aiWrite?: CharacterStateRow
}

export class ConflictError extends Error {
  constructor(public conflicts: ConflictInfo[]) {
    super(`character write conflict: ${conflicts.length} issues`)
    this.name = 'ConflictError'
  }
}
```

- [ ] **Step 4: 实现 `resolveAndCommitCharacterWrites`**

在 `apps/server/src/services/character-extractor.ts` 中,`commitCharacterBranchStateWrites` 之前新增:

```ts
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

  for (let i = 0; i < writes.length; i++) {
    const w = writes[i]
    if (!w.key || !w.key.trim()) {
      conflicts.push({ writeIndex: i, reason: 'missing_key', aiWrite: w })
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

- [ ] **Step 5: 跑测试,确认通过**

Run:
```bash
pnpm --filter server test character-extractor-resolve
```

Expected: 6 个 case 全过。

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/services/character-extractor.ts apps/server/src/__tests__/services/character-extractor-resolve.test.ts
git commit -m "feat(character-extractor): add resolveAndCommitCharacterWrites + ConflictError"
```

---

### Task 4: 扩展 `commitCharacterBranchStateWrites` 支持 isNew 自动建档 + costume

**Files:**
- Modify: `apps/server/src/services/character-extractor.ts`
- Modify: `apps/server/src/__tests__/services/character-extractor.test.ts`

- [ ] **Step 1: 写失败测试 — isNew 自动建 Character 行**

打开 `apps/server/src/__tests__/services/character-extractor.test.ts`,在 `describe` 块内末尾追加:

```ts
describe('commitCharacterBranchStateWrites - isNew 自动建档', () => {
  let tx: any
  let log: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    log = { info: vi.fn(), warn: vi.fn() }
    tx = {
      character: { create: vi.fn().mockResolvedValue({ id: 'new-char-id' }) },
      characterBranchState: { create: vi.fn().mockResolvedValue({ id: 'cbs-new' }) }
    }
  })

  it('isNew=true → 先 tx.character.create 再 tx.characterBranchState.create', async () => {
    const writes: CharacterStateRow[] = [
      { characterId: null, name: '神秘人', key: 'shenmi_ren', status: {}, relationships: {}, costume: '黑袍', isNew: true }
    ]

    await commitCharacterBranchStateWrites(tx, 'story-1', 5, writes, log)

    expect(tx.character.create).toHaveBeenCalledTimes(1)
    expect(tx.character.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        storyId: 'story-1',
        slug: 'shenmi_ren',
        name: '神秘人',
        relationships: null,
        status: null
      })
    })
    expect(tx.characterBranchState.create).toHaveBeenCalledTimes(1)
    expect(tx.characterBranchState.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        characterId: 'new-char-id',
        fromChapterNumber: 5,
        costume: '黑袍'
      })
    })
  })

  it('isNew=true + costume 空字符串 → 不写 costume', async () => {
    const writes: CharacterStateRow[] = [
      { characterId: null, name: '路人甲', key: 'passerby', status: {}, relationships: {}, costume: '', isNew: true }
    ]

    await commitCharacterBranchStateWrites(tx, 'story-1', 5, writes, log)

    expect(tx.characterBranchState.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        costume: null
      })
    })
  })

  it('isNew=false → 不调 character.create,沿用 characterId', async () => {
    const writes: CharacterStateRow[] = [
      { characterId: 'existing-id', name: '林凡', key: 'linfan', status: { rank: '筑基' }, relationships: {}, isNew: false }
    ]

    await commitCharacterBranchStateWrites(tx, 'story-1', 5, writes, log)

    expect(tx.character.create).not.toHaveBeenCalled()
    expect(tx.characterBranchState.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ characterId: 'existing-id' })
    })
  })
})
```

- [ ] **Step 2: 跑新测试,确认失败**

Run:
```bash
pnpm --filter server test character-extractor
```

Expected: 旧 5 个 case 通过,新 3 个 case 失败(签名不匹配:`commitCharacterBranchStateWrites` 当前是 `(tx, chapterNumber, writes, log)`,新签名是 `(tx, storyId, chapterNumber, writes, log)`)。

- [ ] **Step 3: 改 `commitCharacterBranchStateWrites` 签名 + 加 isNew 分支 + costume**

打开 `apps/server/src/services/character-extractor.ts`,替换整个 `commitCharacterBranchStateWrites` 函数:

```ts
export async function commitCharacterBranchStateWrites(
  tx: any,
  storyId: string,
  chapterNumber: number,
  writes: CharacterStateRow[],
  log?: { info: (msg: string) => void; warn: (msg: string) => void }
): Promise<void> {
  const safeLog = log ?? { info: () => {}, warn: () => {} }
  for (const w of writes) {
    let characterId = w.characterId
    if (w.isNew || !characterId) {
      // 自动建 Character 行: slug=key, base 关系/状态 留空
      const newChar = await tx.character.create({
        data: {
          storyId,
          slug: w.key,
          name: w.name,
          protagonist: false,
          personality: '[]',
          speechStyle: '[]',
          identity: '[]',
          appearance: '[]',
          temperament: '[]',
          relationships: null,
          status: null
        }
      })
      characterId = newChar.id
    }
    const statusValue = typeof w.status === 'string' ? w.status : JSON.stringify(w.status)
    const relationshipsValue = typeof w.relationships === 'string' ? w.relationships : JSON.stringify(w.relationships)
    const costumeValue = w.costume && w.costume.trim() ? w.costume : null
    await tx.characterBranchState.create({
      data: {
        characterId,
        fromChapterNumber: chapterNumber,
        status: statusValue,
        relationships: relationshipsValue,
        costume: costumeValue
      }
    })
  }
}
```

- [ ] **Step 4: 更新所有现有调用方传 storyId**

搜索 `commitCharacterBranchStateWrites` 的调用,需要 2 处修改:
1. `apps/server/src/routes/chapters-archive.ts` 中 `archive` 端点的 `$transaction` 内
2. `apps/server/src/routes/chapters-archive.ts` 中 `retry-stage` 端点(如有)

调用从 `(tx, chapterNumber, writes, log)` 改为 `(tx, chapter.storyId, chapterNumber, writes, log)`。

- [ ] **Step 5: 跑测试,确认全过**

Run:
```bash
pnpm --filter server test character-extractor
```

Expected: 8 个 case 全过(旧 5 + 新 3)。

- [ ] **Step 6: 跑全量后端测试**

Run:
```bash
pnpm --filter server test
```

Expected: 全绿。如果 archive-confirm-v4.test.ts 等集成测试失败(因为 commit 签名变了),需要同步更新 fixture。

- [ ] **Step 7: typecheck**

Run:
```bash
pnpm typecheck
```

Expected: 全绿。

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/services/character-extractor.ts apps/server/src/routes/chapters-archive.ts apps/server/src/__tests__/services/character-extractor.test.ts
git commit -m "feat(character-extractor): auto-create Character for isNew rows + costume field"
```

---

### Task 5: Archive 端点接入 `resolveAndCommitCharacterWrites` + ConflictError 处理

**Files:**
- Modify: `apps/server/src/routes/chapters-archive.ts`(archive 端点)
- Modify: `apps/server/src/__tests__/routes/archive-confirm-v4.test.ts`(新增测试用例)

- [ ] **Step 1: 写失败集成测试 — archive confirm 调 resolveAndCommitCharacterWrites**

打开 `apps/server/src/__tests__/routes/archive-confirm-v4.test.ts`,在末尾追加新 `describe` 块:

```ts
describe('archive confirm - character resolve + commit',  (() => {
  // 注: 此处需要遵循文件中现有测试的 setup 模式 (Prisma test instance + Fastify app build)
  // 参考文件内已有 describe 块,复制其 beforeEach/afterEach 结构

  it('新角色进入 → Character 表 +1, CharacterBranchState 表 +1, base 关系/状态为 null', async () => {
    // setup: 创建一个 story + chapter(stale reviewing) + pendingArchiveData 含 isNew 角色
    // act: POST /api/chapters/:id/archive
    // assert:
    //   - response.success = true
    //   - character 行数 +1
    //   - characterBranchState 行数 +1, characterId 指向新 character
    //   - 新 character 的 relationships=null, status=null
  })

  it('slug+name 冲突 → 返回 409 + payload.conflicts', async () => {
    // setup: pendingArchiveData 中 AI 返回 slug='linfan', name='林峰', 但 Character 表已有 slug='linfan', name='林凡'
    // act: POST /api/chapters/:id/archive
    // assert:
    //   - response.statusCode = 409
    //   - response.body.conflicts.length === 1
    //   - chapter.status 保持 reviewing (未 archived)
  })

  it('reviewingPanel 已纠正 isNew=true → 命中已有角色, 不新建 Character', async () => {
    // setup: pendingArchiveData 中 characterId 已指向已有角色, isNew=false 但 AI 误标
    // act: archive
    // assert: character 表行数不变, branchState 表 +1
  })
})
```

注: 测试 setup 应复用文件顶部已有的 Prisma test instance 和 helper。如果不确定,参考 `prepare-archive.test.ts` 的模式。

- [ ] **Step 2: 跑测试,确认失败**

Run:
```bash
pnpm --filter server test archive-confirm-v4
```

Expected: 旧 case 通过,新 3 个 case 失败(因为 archive 端点还没接 resolveAndCommitCharacterWrites,isNew=true 角色还会被 silent skip)。

- [ ] **Step 3: 改 archive 端点接入新逻辑**

打开 `apps/server/src/routes/chapters-archive.ts`,找到 archive 端点的 `$transaction` 块,在 `commitCharacterBranchStateWrites` 调用之前,改为:

```ts
// 找: await commitCharacterBranchStateWrites(tx, chapter.number, pending.characterStates)
// 改为:
const allExisting = await tx.character.findMany({
  where: { storyId: chapter.storyId },
  select: { id: true, slug: true, name: true }
})
const { effectiveWrites, conflicts } = await resolveAndCommitCharacterWrites(
  tx, chapter.storyId, chapter.number, pending.characterStates, allExisting
)
if (conflicts.length > 0) {
  throw new ConflictError(conflicts)
}
await commitCharacterBranchStateWrites(tx, chapter.storyId, chapter.number, effectiveWrites)
```

- [ ] **Step 4: 在 archive 端点的 try/catch 中捕获 ConflictError 并返回 409**

找到 archive 端点的 try/catch 块(应该已经在 catch 中处理一般错误),新增 ConflictError 分支:

```ts
try {
  // ... 既有 $transaction ...
} catch (err: any) {
  if (err instanceof ConflictError) {
    return reply.status(409).send({
      success: false,
      error: 'character write conflict',
      conflicts: err.conflicts
    })
  }
  throw err  // 其它错误继续向上
}
```

并在文件顶部 import:
```ts
import { commitCharacterBranchStateWrites, resolveAndCommitCharacterWrites, ConflictError } from '../services/character-extractor.js'
```

- [ ] **Step 5: 跑测试,确认全过**

Run:
```bash
pnpm --filter server test archive-confirm-v4
```

Expected: 所有 case(包括新 3 个)全过。

- [ ] **Step 6: 跑全量后端测试**

Run:
```bash
pnpm --filter server test
```

Expected: 全绿。

- [ ] **Step 7: typecheck**

Run:
```bash
pnpm typecheck
```

Expected: 全绿。

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/routes/chapters-archive.ts apps/server/src/__tests__/routes/archive-confirm-v4.test.ts
git commit -m "feat(archive): resolve isNew via slug+name matching, return 409 on conflict"
```

---

### Task 6: POST `/api/stories/:storyId/characters` 接受 base 关系/状态

**Files:**
- Modify: `apps/server/src/routes/characters.ts`(POST 端点)

- [ ] **Step 1: 修改 POST 端点 — 写 base 字段,不再创建初始 branchState**

打开 `apps/server/src/routes/characters.ts`,找到 POST 端点(约 line 24-44),替换 `app.prisma.character.create` 调用和其后的 `if` 分支:

```ts
// 替换整段
const character = await app.prisma.character.create({
  data: {
    storyId,
    slug: body.slug,
    name: body.name,
    protagonist: body.protagonist ?? false,
    personality: JSON.stringify(body.personality || []),
    speechStyle: JSON.stringify(body.speechStyle || []),
    identity: JSON.stringify(body.identity || []),
    appearance: JSON.stringify(body.appearance || []),
    temperament: JSON.stringify(body.temperament || []),
    // 新增:base 关系/状态;创建即写入,不再创建初始 branchState
    relationships: body.relationships !== undefined ? JSON.stringify(body.relationships) : null,
    status: body.status !== undefined ? JSON.stringify(body.status) : null
  }
})

return { success: true, data: character }
```

**删除**原有的 `if (body.status !== undefined || body.relationships !== undefined)` 整段(从 `if` 开始到 `}` 结束的 branchState.create)。

- [ ] **Step 2: 跑 typecheck**

Run:
```bash
pnpm typecheck
```

Expected: 全绿。

- [ ] **Step 3: 手动 smoke test**

启动 dev server,创建角色测试:
```bash
curl -X POST http://localhost:4000/api/stories/<storyId>/characters \
  -H "Content-Type: application/json" \
  -d '{
    "slug": "test_char",
    "name": "测试角色",
    "relationships": {"林凡": "师兄"},
    "status": {"realm": "筑基"}
  }'
```

Expected: 返回 success:true, data 含 relationships 和 status 字段。

通过 `pnpm db:studio` 检查:
- `Character.relationships` = `{"林凡":"师兄"}`
- `Character.status` = `{"realm":"筑基"}`
- `CharacterBranchState` 表中**没有**该 character 的初始行(确认初始 branchState 已不再创建)

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/routes/characters.ts
git commit -m "feat(characters): POST writes base relationships/status, no initial branchState"
```

---

### Task 7: 新增 `character-display.ts` 服务 — 三字段独立查"最新有数据归档章"

**Files:**
- Create: `apps/server/src/services/character-display.ts`
- Create: `apps/server/src/__tests__/services/character-display.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `apps/server/src/__tests__/services/character-display.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { fetchCharacterDisplay } from '../../services/character-display.js'

describe('fetchCharacterDisplay', () => {
  it('空 story → 返回空数组', async () => {
    const prisma: any = {
      character: { findMany: vi.fn().mockResolvedValue([]) },
      characterBranchState: { findMany: vi.fn().mockResolvedValue([]) }
    }
    const result = await fetchCharacterDisplay(prisma, 'story-empty', null)
    expect(result).toEqual([])
  })

  it('无 snapshot → 三字段都为 null, base 值通过 character 表读', async () => {
    const prisma: any = {
      character: {
        findMany: vi.fn().mockResolvedValue([{
          id: 'c1', storyId: 's1', slug: 'linfan', name: '林凡', protagonist: true,
          identity: '["青云弟子"]', appearance: '[]', temperament: '["冷静"]',
          personality: '["谨慎"]', speechStyle: '[]',
          relationships: '{"张三":"师兄"}', status: '{"realm":"筑基"}'
        }])
      },
      characterBranchState: { findMany: vi.fn().mockResolvedValue([]) }
    }
    const result = await fetchCharacterDisplay(prisma, 's1', null)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('林凡')
    expect(result[0].relationships?.value).toEqual({ '张三': '师兄' })
    expect(result[0].relationships?.sourceChapterNumber).toBe(null)
    expect(result[0].status?.value).toEqual({ realm: '筑基' })
    expect(result[0].costume).toBe(null)
  })

  it('默认模式 (chapter=null): 三字段各自取"最新有数据"快照', async () => {
    const prisma: any = {
      character: { findMany: vi.fn().mockResolvedValue([{
        id: 'c1', storyId: 's1', slug: 'linfan', name: '林凡', protagonist: false,
        identity: '[]', appearance: '[]', temperament: '[]', personality: '[]', speechStyle: '[]',
        relationships: null, status: null
      }]) },
      characterBranchState: { findMany: vi.fn().mockResolvedValue([
        { characterId: 'c1', fromChapterNumber: 3, status: '{"realm":"筑基"}', relationships: '{"李四":"朋友"}', costume: null },
        { characterId: 'c1', fromChapterNumber: 5, status: '{"realm":"金丹"}', relationships: '{"李四":"好友"}', costume: '白袍' },
        { characterId: 'c1', fromChapterNumber: 7, status: null, relationships: null, costume: '黑衣' }
      ]) }
    }
    const result = await fetchCharacterDisplay(prisma, 's1', null)
    const row = result[0]
    // relationships: 第 7 章 null → 退到第 5 章 → '好友'
    expect(row.relationships?.value).toEqual({ '李四': '好友' })
    expect(row.relationships?.sourceChapterNumber).toBe(5)
    // status: 第 7 章 null → 退到第 5 章 → 金丹
    expect(row.status?.value).toEqual({ realm: '金丹' })
    expect(row.status?.sourceChapterNumber).toBe(5)
    // costume: 第 7 章 '黑衣'
    expect(row.costume?.value).toBe('黑衣')
    expect(row.costume?.sourceChapterNumber).toBe(7)
  })

  it('指定 chapter=N: 统一显示该章数据, 无则该字段 null', async () => {
    const prisma: any = {
      character: { findMany: vi.fn().mockResolvedValue([{
        id: 'c1', storyId: 's1', slug: 'linfan', name: '林凡', protagonist: false,
        identity: '[]', appearance: '[]', temperament: '[]', personality: '[]', speechStyle: '[]',
        relationships: null, status: null
      }]) },
      characterBranchState: { findMany: vi.fn().mockResolvedValue([
        { characterId: 'c1', fromChapterNumber: 3, status: '{"realm":"筑基"}', relationships: '{"李四":"朋友"}', costume: null }
      ]) }
    }
    const result = await fetchCharacterDisplay(prisma, 's1', 3)
    const row = result[0]
    expect(row.relationships?.value).toEqual({ '李四': '朋友' })
    expect(row.relationships?.sourceChapterNumber).toBe(3)
    expect(row.status?.value).toEqual({ realm: '筑基' })
    expect(row.status?.sourceChapterNumber).toBe(3)
    expect(row.costume).toBe(null)  // 第 3 章无 costume
  })

  it('指定 chapter=N, 但 character 在该章无 snapshot → 字段均为 null', async () => {
    const prisma: any = {
      character: { findMany: vi.fn().mockResolvedValue([{
        id: 'c1', storyId: 's1', slug: 'linfan', name: '林凡', protagonist: false,
        identity: '[]', appearance: '[]', temperament: '[]', personality: '[]', speechStyle: '[]',
        relationships: null, status: null
      }]) },
      characterBranchState: { findMany: vi.fn().mockResolvedValue([
        { characterId: 'c1', fromChapterNumber: 5, status: '{"a":1}', relationships: null, costume: null }
      ]) }
    }
    const result = await fetchCharacterDisplay(prisma, 's1', 3)
    expect(result[0].relationships).toBe(null)
    expect(result[0].status).toBe(null)
    expect(result[0].costume).toBe(null)
  })

  it('JSON 字符串解析失败 → 该字段 null,不抛错', async () => {
    const prisma: any = {
      character: { findMany: vi.fn().mockResolvedValue([{
        id: 'c1', storyId: 's1', slug: 'linfan', name: '林凡', protagonist: false,
        identity: '[]', appearance: '[]', temperament: '[]', personality: '[]', speechStyle: '[]',
        relationships: null, status: null
      }]) },
      characterBranchState: { findMany: vi.fn().mockResolvedValue([
        { characterId: 'c1', fromChapterNumber: 1, status: 'invalid json{{{', relationships: '{"a":1}', costume: null }
      ]) }
    }
    const result = await fetchCharacterDisplay(prisma, 's1', 1)
    expect(result[0].status).toBe(null)
    expect(result[0].relationships?.value).toEqual({ a: 1 })
  })
})
```

- [ ] **Step 2: 跑测试,确认失败**

Run:
```bash
pnpm --filter server test character-display
```

Expected: FAIL — `fetchCharacterDisplay` 未实现。

- [ ] **Step 3: 实现 `character-display.ts`**

创建 `apps/server/src/services/character-display.ts`:

```ts
import { safeJsonParse } from '@novel-runtime/shared'

export interface FieldDisplay<T> {
  value: T
  sourceChapterNumber: number | null
}

export interface CharacterDisplayRow {
  id: string
  name: string
  slug: string
  protagonist: boolean
  identity: string[]
  appearance: string[]
  temperament: string[]
  personality: string[]
  speechStyle: string[]
  relationships: FieldDisplay<Record<string, any>> | null
  status: FieldDisplay<Record<string, any>> | null
  costume: FieldDisplay<string> | null
}

interface PrismaLike {
  character: { findMany: (args: any) => Promise<any[]> }
  characterBranchState: { findMany: (args: any) => Promise<any[]> }
}

export async function fetchCharacterDisplay(
  prisma: PrismaLike,
  storyId: string,
  viewChapterNumber: number | null
): Promise<CharacterDisplayRow[]> {
  // 1) 拉所有 character
  const characters = await prisma.character.findMany({ where: { storyId } })
  if (characters.length === 0) return []

  // 2) 拉所有相关 branchState(一次 batch,避免 N+1)
  const branchStates = await prisma.characterBranchState.findMany({
    where: { characterId: { in: characters.map(c => c.id) } },
    orderBy: { fromChapterNumber: 'desc' }
  })

  // 3) 按 characterId 分组
  const byChar = new Map<string, any[]>()
  for (const bs of branchStates) {
    if (!byChar.has(bs.characterId)) byChar.set(bs.characterId, [])
    byChar.get(bs.characterId)!.push(bs)
  }

  // 4) 组装每行
  return characters.map((c: any): CharacterDisplayRow => {
    const states = byChar.get(c.id) || []

    // 取一个字段在指定 chapter 或"最新有数据"的快照
    const pickField = <T,>(
      extractor: (bs: any) => T | null,
      parser: (raw: T | null) => any
    ): FieldDisplay<any> | null => {
      let candidate: any = null
      for (const bs of states) {
        // 指定 chapter: 只看该 chapter
        if (viewChapterNumber !== null && bs.fromChapterNumber !== viewChapterNumber) continue
        // 默认模式: 跳过 null 字段
        if (viewChapterNumber === null && bs.fromChapterNumber === null) continue
        const raw = extractor(bs)
        if (raw === null || raw === undefined) continue
        // 默认模式: 找第一条非空
        if (viewChapterNumber === null) {
          const parsed = parser(raw)
          if (parsed !== null && parsed !== undefined) {
            candidate = { value: parsed, sourceChapterNumber: bs.fromChapterNumber }
            break
          }
        } else {
          // 指定 chapter: 即使空也用这条(显示"无")
          candidate = { value: parser(raw), sourceChapterNumber: bs.fromChapterNumber }
          break
        }
      }
      // 默认模式且无 snapshot → 退到 base
      if (!candidate && viewChapterNumber === null) {
        // base 字段由 caller(character 行)提供,这里只标 source=null
        return null  // 由调用方根据 viewChapterNumber===null 决定是否回退 base
      }
      return candidate
    }

    // 关系字段
    const relPick = pickField<Record<string, any>>(
      bs => bs.relationships,
      raw => {
        if (!raw) return null
        try { return typeof raw === 'string' ? JSON.parse(raw) : raw } catch { return null }
      }
    )
    let relationships: FieldDisplay<Record<string, any>> | null = relPick
    if (!relationships && viewChapterNumber === null && c.relationships) {
      // 回退 base
      const parsed = safeJsonParse(c.relationships, null)
      if (parsed) relationships = { value: parsed, sourceChapterNumber: null }
    }

    // 状态字段
    const statusPick = pickField<Record<string, any>>(
      bs => bs.status,
      raw => {
        if (!raw) return null
        try { return typeof raw === 'string' ? JSON.parse(raw) : raw } catch { return null }
      }
    )
    let status: FieldDisplay<Record<string, any>> | null = statusPick
    if (!status && viewChapterNumber === null && c.status) {
      const parsed = safeJsonParse(c.status, null)
      if (parsed) status = { value: parsed, sourceChapterNumber: null }
    }

    // 衣着字段(无 base 兜底,纯 snapshot)
    const costumePick = pickField<string>(
      bs => bs.costume,
      raw => raw
    )
    const costume: FieldDisplay<string> | null = costumePick

    return {
      id: c.id,
      name: c.name,
      slug: c.slug,
      protagonist: c.protagonist ?? false,
      identity: safeJsonParse(c.identity, []),
      appearance: safeJsonParse(c.appearance, []),
      temperament: safeJsonParse(c.temperament, []),
      personality: safeJsonParse(c.personality, []),
      speechStyle: safeJsonParse(c.speechStyle, []),
      relationships,
      status,
      costume
    }
  })
}
```

- [ ] **Step 4: 跑测试,确认通过**

Run:
```bash
pnpm --filter server test character-display
```

Expected: 6 个 case 全过。

- [ ] **Step 5: typecheck**

Run:
```bash
pnpm typecheck
```

Expected: 全绿。

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/services/character-display.ts apps/server/src/__tests__/services/character-display.test.ts
git commit -m "feat(character-display): three fields independent latest-with-data lookup"
```

---

### Task 8: `GET /api/stories/:storyId/characters/display` 端点

**Files:**
- Modify: `apps/server/src/routes/characters.ts`(新增端点)

- [ ] **Step 1: 写失败集成测试**

打开或创建 `apps/server/src/__tests__/routes/characters-display.test.ts`(若文件不存在则创建),遵循项目其他 route 测试的 setup 模式(参考 `apps/server/src/__tests__/routes/cumulative-graph.test.ts`):

```ts
import { describe, it, expect } from 'vitest'
// 复用项目其他 route 测试的 build/cleanup helper

describe('GET /api/stories/:storyId/characters/display', () => {
  it('空 story → 返回 data: []', async () => {
    // setup: 创建空 story
    // act: GET /api/stories/:id/characters/display
    // assert: response.success=true, data=[]
  })

  it('默认 (无 chapter 参数) → 返回每个角色的三字段独立查"最新有数据"', async () => {
    // setup: 创建 character(含 base 关系) + 2 个 branchState(不同 chapter,只有 status 不同)
    // act: GET /api/stories/:id/characters/display
    // assert: data[0].relationships 来自 base(source=null), status 来自最新 snapshot
  })

  it('?chapter=N → 返回该章的统一 snapshot', async () => {
    // setup: 同上
    // act: GET /api/stories/:id/characters/display?chapter=3
    // assert: data[0].relationships.sourceChapterNumber=3
  })
})
```

- [ ] **Step 2: 跑测试,确认失败**

Run:
```bash
pnpm --filter server test characters-display
```

Expected: FAIL — 路由 404。

- [ ] **Step 3: 实现端点**

打开 `apps/server/src/routes/characters.ts`,在 `characterRoutes` 函数内,**在所有现有端点之前**或按一致风格添加:

```ts
// GET /api/stories/:storyId/characters/display
app.get('/api/stories/:storyId/characters/display', async (request, reply) => {
  const { storyId } = request.params as any
  const chapterParam = (request.query as any).chapter
  const viewChapterNumber = chapterParam && chapterParam !== 'null'
    ? Number(chapterParam)
    : null
  if (viewChapterNumber !== null && Number.isNaN(viewChapterNumber)) {
    return reply.status(400).send({ success: false, error: 'invalid chapter number' })
  }
  const data = await fetchCharacterDisplay(app.prisma, storyId, viewChapterNumber)
  return { success: true, data }
})
```

并在文件顶部 import:
```ts
import { fetchCharacterDisplay } from '../services/character-display.js'
```

- [ ] **Step 4: 跑测试,确认通过**

Run:
```bash
pnpm --filter server test characters-display
```

Expected: 所有 case 全过。

- [ ] **Step 5: typecheck**

Run:
```bash
pnpm typecheck
```

Expected: 全绿。

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/routes/characters.ts apps/server/src/__tests__/routes/characters-display.test.ts
git commit -m "feat(characters): GET display endpoint with chapter view param"
```

---

### Task 9: 前端 API 类型 + ReviewingPanel 纠正下拉 + 冲突警告

**Files:**
- Modify: `apps/web/src/api/characters.ts`(加 display API + 类型)
- Modify: `apps/web/src/views/ReviewingPanel.vue`(纠正下拉 + 冲突警告)
- Modify: `apps/web/src/views/ReviewingPanel.adapter.ts`(toV4 加 costume)

- [ ] **Step 1: 扩展 `apps/web/src/api/characters.ts` 类型**

追加:

```ts
export interface FieldDisplay<T> {
  value: T
  sourceChapterNumber: number | null
}

export interface CharacterDisplayRow {
  id: string
  name: string
  slug: string
  protagonist: boolean
  identity: string[]
  appearance: string[]
  temperament: string[]
  personality: string[]
  speechStyle: string[]
  relationships: FieldDisplay<Record<string, any>> | null
  status: FieldDisplay<Record<string, any>> | null
  costume: FieldDisplay<string> | null
}

// 在 charactersApi 对象中加 display:
display: (storyId: string, chapter: number | null) =>
  api.get(`/api/stories/${storyId}/characters/display`, { params: { chapter } }),
```

- [ ] **Step 2: 修改 `ReviewingPanel.adapter.ts` 的 `toV4` 加 costume**

找到 `toV4` 函数,在 `parseJson` 后构造 `characterStates` 映射的位置,把元素改写为:

```ts
stages.character.result = {
  characterStates: memories.characterStates.map((state) => ({
    characterId: state.characterId,
    name: state.name,
    key: state.key,
    status: parseJson(state.status),
    relationships: parseJson(state.relationships),
    costume: state.costume ?? '',
    isNew: state.isNew
  }))
}
```

如果 `LocalCharacterState` 类型未含 costume 字段,补上:

```ts
export interface LocalCharacterState {
  // ... 既有字段 ...
  costume?: string
}
```

- [ ] **Step 3: 修改 `ReviewingPanel.vue` 加纠正下拉**

找到 characterStates 表格(约 `addCharacterState` / `removeCharacterState` 区域)。在每行 UI 加纠正下拉,仅 `state.isNew === true` 时显示:

```vue
<n-form-item v-if="state.isNew" label="纠正为已有角色">
  <n-select
    :value="state.characterId"
    :options="existingCharacterOptions"
    placeholder="如果这是已有角色,请选择"
    clearable
    @update:value="(val: string | null) => onCorrectCharacter(state, val)"
  />
</n-form-item>
```

并在 `<script setup>` 中加:

```ts
import { computed } from 'vue'
import { NSelect } from 'naive-ui'
import { charactersApi } from '../api/characters'

// 已加载的当前 story 全部 character(用 display 端点或现有 list)
const existingCharacterOptions = ref<Array<{ label: string; value: string }>>([])

async function loadExistingCharacters() {
  if (!props.chapterId) return
  // 用现有 charactersApi.list 拉(storyId 从 chapter 推)
  const res = await fetch(`/api/chapters/${props.chapterId}`).then(r => r.json())
  const storyId = res.data?.storyId
  if (!storyId) return
  const list = await charactersApi.list(storyId)
  existingCharacterOptions.value = list.data.data.map((c: any) => ({
    label: `${c.name} (${c.slug})`,
    value: c.id
  }))
}

function onCorrectCharacter(state: any, correctedId: string | null) {
  state.characterId = correctedId
  state.isNew = correctedId === null
}

onMounted(loadExistingCharacters)
```

- [ ] **Step 4: 加冲突警告横幅**

找到 ReviewingPanel 顶部,新增检测逻辑:

```vue
<n-alert
  v-if="conflicts && conflicts.length > 0"
  type="error"
  title="AI 抽取与现有角色冲突"
  style="margin-bottom: 16px"
>
  <p>以下条目需要在归档前处理:</p>
  <ul>
    <li v-for="c in conflicts" :key="c.writeIndex">
      AI 返回 name="{{ c.aiWrite?.name }}", slug="{{ c.aiWrite?.key }}"
      与已有 name="{{ c.existingCharacter?.name }}", slug="{{ c.existingCharacter?.slug }}" 冲突
    </li>
  </ul>
  <p>请在下方表格中纠正(选已有 / 修改 AI 返回的 key),或取消归档。</p>
</n-alert>
```

`conflicts` 通过新 prop 传入或通过 review response 携带(具体由 archive 端点的 409 payload 决定)。

- [ ] **Step 5: typecheck**

Run:
```bash
pnpm --filter web typecheck
```

Expected: 全绿。如果报 missing import,补 `import { ref } from 'vue'` 等。

- [ ] **Step 6: 手动 smoke test**

启动 dev,创建一个 reviewing 状态的 chapter,让 AI 故意返回有 slug 冲突的 characterStates(可在测试时改 character-stage.ts prompt 临时制造),验证:
- ReviewingPanel 显示冲突横幅
- 纠正下拉可选已有角色,选完后 characterId 更新、isNew 转 false
- 点归档后不再冲突

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/api/characters.ts apps/web/src/views/ReviewingPanel.vue apps/web/src/views/ReviewingPanel.adapter.ts
git commit -m "feat(reviewing-panel): character correction dropdown + conflict warning"
```

---

### Task 10: `Characters.vue` 三列快照展示 + 章节切换

**Files:**
- Modify: `apps/web/src/views/Characters.vue`

- [ ] **Step 1: 替换数据源为 display 端点**

打开 `apps/web/src/views/Characters.vue`,找到 `loadCharacters` 函数和 `charactersApi.list` 调用,替换为:

```ts
import { charactersApi, type CharacterDisplayRow } from '../api/characters'

const characters = ref<CharacterDisplayRow[]>([])
const viewChapter = ref<number | null>(null)  // null = 默认(最新有数据)

async function loadCharacters() {
  if (!route.params.storyId) { characters.value = []; return }
  loading.value = true
  try {
    const res = await charactersApi.display(route.params.storyId as string, viewChapter.value)
    characters.value = res.data.data
  } finally {
    loading.value = false
  }
}

watch(viewChapter, () => loadCharacters())
```

- [ ] **Step 2: 在表格顶部加章节选择器**

在 `<n-data-table>` 之前插入:

```vue
<n-space style="margin-bottom: 12px" align="center">
  <n-text>查看章节:</n-text>
  <n-select
    v-model:value="viewChapter"
    :options="chapterOptions"
    placeholder="最新有数据(默认)"
    clearable
    style="width: 280px"
  />
</n-space>
```

并在 `<script setup>` 中加:

```ts
const chapterOptions = ref<Array<{ label: string; value: number }>>([])

async function loadChapterOptions() {
  if (!route.params.storyId) return
  // 拉章节列表(只 archived)
  const res = await fetch(`/api/stories/${route.params.storyId}/chapters?status=archived`)
    .then(r => r.json())
  if (res.success) {
    chapterOptions.value = (res.data as any[])
      .filter((ch: any) => ch.status === 'archived')
      .map((ch: any) => ({ label: `第 ${ch.number} 章: ${ch.title}`, value: ch.number }))
      .sort((a, b) => b.value - a.value)
  }
}

onMounted(async () => {
  await Promise.all([loadCharacters(), loadChapterOptions()])
})
```

- [ ] **Step 3: 修改三列(关系/状态/衣着)渲染**

找到现有 columns 数组里的 `relationships` / `status` 列,替换为新版渲染:

```ts
{
  title: () => h('span', null, [
    '关系',
    h(NTag, { size: 'tiny', type: 'info', style: 'margin-left: 4px' }, { default: '快照' })
  ]),
  key: 'relationships',
  width: 180,
  render: (row: CharacterDisplayRow) => h('div', null, [
    h('div', formatJson(row.relationships?.value ?? {})),
    row.relationships?.sourceChapterNumber
      ? h(NTag, { size: 'tiny', type: 'info', style: 'margin-top: 4px' },
          { default: () => `来源: 第 ${row.relationships.sourceChapterNumber} 章` })
      : null
  ])
},
{
  title: () => h('span', null, [
    '状态',
    h(NTag, { size: 'tiny', type: 'info', style: 'margin-left: 4px' }, { default: '快照' })
  ]),
  key: 'status',
  width: 180,
  render: (row: CharacterDisplayRow) => h('div', null, [
    h('div', formatJson(row.status?.value ?? {})),
    row.status?.sourceChapterNumber
      ? h(NTag, { size: 'tiny', type: 'info', style: 'margin-top: 4px' },
          { default: () => `来源: 第 ${row.status.sourceChapterNumber} 章` })
      : null
  ])
},
{
  title: () => h('span', null, [
    '衣着',
    h(NTag, { size: 'tiny', type: 'info', style: 'margin-left: 4px' }, { default: '快照' })
  ]),
  key: 'costume',
  width: 160,
  render: (row: CharacterDisplayRow) => h('div', null, [
    h('div', row.costume?.value || '(无)'),
    row.costume?.sourceChapterNumber
      ? h(NTag, { size: 'tiny', type: 'info', style: 'margin-top: 4px' },
          { default: () => `来源: 第 ${row.costume.sourceChapterNumber} 章` })
      : null
  ])
}
```

import 处加 `NTag` 和 `formatJson`(项目已有的 shared 工具,或 inline `JSON.stringify` 然后 `.map(([k,v]) => '${k}:${v}').join(', ')`)。

- [ ] **Step 4: 删掉原有的 关系/状态 编辑 textarea(快照不可改)**

原 Characters.vue 模态框里有 `relationships` 和 `status` 的 textarea — 由于 snapshot 不再通过 modal 改(走 PUT append),把这两项的编辑字段从 modal 中删掉,或标记 readonly。

如果用户还能改"基础" 关系/状态,需另加字段(本次 spec 不做 — 列入 Out of scope)。

修改 form.value 初始化和 resetForm,删除 `relationships` 和 `status` 字段:

```ts
const form = ref({
  slug: '', name: '', protagonist: false,
  identity: [], appearance: [], temperament: [],
  personality: [], speechStyle: []
  // 关系/状态 不再在此编辑;走 display 页面查看
})
```

模态框中对应 `<n-form-item label="关系">` 和 `<n-form-item label="状态">` 整块删除。

- [ ] **Step 5: typecheck**

Run:
```bash
pnpm --filter web typecheck
```

Expected: 全绿。

- [ ] **Step 6: 手动 smoke test**

启动 dev:
- 打开 Characters.vue, 默认显示三列,标注"快照" + "来源: 第 N 章"
- 切换章节下拉,所有列切换到该章数据
- 选择 base fallback(无 snapshot 的 character),关系/状态 显示 base 值 + 来源:null
- 编辑角色模态框不再有 关系/状态 字段

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/views/Characters.vue
git commit -m "feat(characters): three-column snapshot display with chapter switcher"
```

---

### Task 11: Migration backfill 脚本

**Files:**
- Create: `scripts/backfill-character-base.ts`
- Modify: `package.json`(加 script)

- [ ] **Step 1: 创建 backfill 脚本**

创建 `scripts/backfill-character-base.ts`:

```ts
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const characters = await prisma.character.findMany({
    select: { id: true, slug: true, name: true }
  })
  let updated = 0
  let skipped = 0

  await prisma.$transaction(async (tx) => {
    for (const c of characters) {
      const latest = await tx.characterBranchState.findFirst({
        where: { characterId: c.id },
        orderBy: { fromChapterNumber: 'desc' }
      })
      if (!latest) {
        skipped++
        continue
      }
      await tx.character.update({
        where: { id: c.id },
        data: {
          relationships: latest.relationships,
          status: latest.status
        }
      })
      updated++
    }
  })

  console.log(`[backfill-character-base] updated=${updated}, skipped=${skipped}, total=${characters.length}`)
}

main()
  .catch((e) => {
    console.error('[backfill-character-base] failed:', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
```

- [ ] **Step 2: 在 `package.json` 加 script**

打开根目录 `package.json`,在 `scripts` 段加:

```json
"db:backfill-character-base": "tsx scripts/backfill-character-base.ts"
```

- [ ] **Step 3: 在空 fixture 库跑一次**

Run:
```bash
pnpm db:backfill-character-base
```

Expected: 输出 `[backfill-character-base] updated=0, skipped=N, total=N`,不报错。

- [ ] **Step 4: 写一个临时 fixture 测试有数据情况**

在 `apps/server/src/__tests__/` 下创建 `scripts/backfill-character-base.test.ts`(可选,只为验证逻辑正确):

```ts
import { describe, it, expect } from 'vitest'
import { execSync } from 'node:child_process'

describe('backfill-character-base', () => {
  it('空库 → 不报错,updated=0', () => {
    // setup: 临时 sqlite db,跑 migrate deploy
    // act: 执行脚本
    // assert: exit code 0,stdout 含 updated=0
  })

  it('有 character + branchState → base 字段被回填', () => {
    // setup: 创建 1 character + 2 branchState
    // act: 执行脚本
    // assert: character.relationships = 最新 branchState.relationships
    // assert: character.status = 最新 branchState.status
  })
})
```

若觉得写集成测试成本高(需要 test DB setup),可省去,改为**手工验证**:
- 在 dev DB 创建 1 个 character + 1 个 branchState(走归档或手动 PUT)
- 跑 `pnpm db:backfill-character-base`
- 用 `pnpm db:studio` 看 Character 表的 relationships / status 字段已被填充

- [ ] **Step 5: 跑 typecheck**

Run:
```bash
pnpm typecheck
```

Expected: 全绿。

- [ ] **Step 6: 跑全量后端测试**

Run:
```bash
pnpm --filter server test
```

Expected: 全绿(脚本不影响既有测试)。

- [ ] **Step 7: Commit**

```bash
git add scripts/backfill-character-base.ts package.json
git commit -m "feat(scripts): add backfill-character-base for historical data migration"
```

---

## Verification Checklist (End-to-End)

按 spec §11 验证清单跑一遍:

- [ ] `pnpm db:migrate` 在 dev (SQLite) 通过
- [ ] `pnpm db:generate` 不报 TS 错误
- [ ] `pnpm typecheck` 全绿(server + web + 所有 packages)
- [ ] `pnpm --filter server test` 全绿(包含新增的 character-display.test.ts / character-extractor-resolve.test.ts / characters-display.test.ts / archive-confirm-v4 新增 case)
- [ ] `pnpm --filter web typecheck` 全绿
- [ ] 手动端到端:
  - [ ] 创建角色(含 base 关系/状态)→ 检查 Character.relationships / status 已写,branchState 无初始行
  - [ ] 归档章节含新角色 → Character 表 +1,branchState 表 +1,新角色 base 关系/状态 = null
  - [ ] 制造 slug+name 冲突 → archive 返回 409 + ReviewingPanel 显示警告
  - [ ] ReviewingPanel 纠正下拉选已有角色 → 重新归档成功,Character 表行数不变
  - [ ] Characters.vue 三列展示"来源",章节切换生效,base fallback 工作
  - [ ] `pnpm db:backfill-character-base` 在有数据环境跑成功,验证 base 字段被填充

## Out-of-Scope Reminder

本次 plan 严格遵循 spec §9 的 YAGNI 清单:

- ❌ 不动 `getCharactersWithLatestState`(生成 prompt 注入)
- ❌ 不把衣着接入 prompt 输入
- ❌ 不做跨章节权重快照
- ❌ 不做 slug 自动改写
- ❌ 不做 Characters.vue 搜索/分页/列宽
- ❌ 不做 base 关系/状态 编辑 UI

如发现需要任何上述项目,另开 spec / plan。

---

## Self-Review Notes

写完后做了以下 self-review(对应 writing-plans skill 的清单):

### Spec coverage
- §1 Schema → Task 1 ✅
- §2 POST base 字段 → Task 6 ✅
- §3 costume prompt + 解析 → Task 2 ✅
- §4 code-level isNew 校验 → Task 3 ✅
- §5 isNew 自动建档 + 冲突检测 → Task 4 + 5 ✅
- §6 ReviewingPanel 纠正 + 冲突警告 → Task 9 ✅
- §7 Characters.vue 三列 + 章节切换 → Task 10 ✅
- §8 migration backfill → Task 11 ✅
- §10.1.2 isNew 角色删除处理 → Task 9 (Step 3 注:前端删除走 pendingArchiveData 不传即可)

### Placeholder scan
- 没有 "TBD" / "TODO" / "implement later"
- 没有 "类似 Task N" 的占位
- 所有 code block 都是完整可粘贴

### Type consistency
- `CharacterStateRow` 类型在 Task 2 加 `costume?: string`,Task 4 扩展测试时使用同一类型
- `commitCharacterBranchStateWrites` 签名变更从 Task 3 开始统一为 `(tx, storyId, chapterNumber, writes, log)`,Task 4 Step 4 同步更新所有调用方
- `CharacterDisplayRow` / `FieldDisplay<T>` 在 Task 7 定义,Task 8/10 前端类型一致使用

### 已知小遗漏
- Task 5 的集成测试 setup 需要复用文件已有的 helper;若不确定,实现时参考 `prepare-archive.test.ts`
- Task 9 的纠正下拉现有 character 加载用了 `fetch(/api/chapters/${id})`,实际项目是否有此端点需要确认;若无,用 `/api/stories/:storyId/characters/display` 替代(它返回所有 character 含 id)
- Task 11 的 Step 4 测试是 optional,实现时若觉得成本高可跳

---

## Commits 预期

完成 11 个 task 后应有 11 个 commit(每个 task 一个),按顺序:

```
feat(schema): add Character base state + CharacterBranchState costume
feat(character-stage): add costume field to AI extraction
feat(character-extractor): add resolveAndCommitCharacterWrites + ConflictError
feat(character-extractor): auto-create Character for isNew rows + costume field
feat(archive): resolve isNew via slug+name matching, return 409 on conflict
feat(characters): POST writes base relationships/status, no initial branchState
feat(character-display): three fields independent latest-with-data lookup
feat(characters): GET display endpoint with chapter view param
feat(reviewing-panel): character correction dropdown + conflict warning
feat(characters): three-column snapshot display with chapter switcher
feat(scripts): add backfill-character-base for historical data migration
```