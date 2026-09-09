# 角色快照编辑（Character Snapshot Editing）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 允许用户在角色编辑弹窗中手动编辑已归档的角色快照（status/relationships/costume），编辑处有 UI 提醒，编辑结果直接作为后续章节生成时的角色参考。

**Architecture:** 后端在 `characters.ts` 新增一个 `PUT /api/stories/:storyId/characters/:charId/snapshot/:chapterNumber` 端点，用 `characterBranchState.updateMany` 幂等更新该章快照行；前端在 `Characters.vue` 编辑弹窗右侧 aside 增加「编辑快照」切换态（JSON textarea + 衣着输入 + warning 提醒），保存走新端点后刷新。

**Tech Stack:** Fastify 路由（bare return 风格）、Prisma、Vue 3 + Naive UI、Vitest（server 端 TDD；web 端无组件测试传统，靠 vue-tsc + 手工验证）。

**设计依据:** `docs/superpowers/specs/2026-08-13-character-snapshot-editing-design.md`

---

### Task 1: 后端快照编辑端点（TDD）

**Files:**
- Create: `apps/server/src/__tests__/routes/characters-snapshot-edit.test.ts`
- Modify: `apps/server/src/routes/characters.ts`（在 `characterRoutes` 内、单角色 GET snapshot 端点之后新增 PUT）

- [ ] **Step 1: 写失败测试**

新建 `apps/server/src/__tests__/routes/characters-snapshot-edit.test.ts`（模仿现有 `characters-snapshot.test.ts` 的 mock 模式）：

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockApp, callHandler } from '../setup.js'

const ROUTE = '/api/stories/:storyId/characters/:charId/snapshot/:chapterNumber'

describe('PUT /api/stories/:storyId/characters/:charId/snapshot/:chapterNumber', () => {
  let mockPrisma: any
  let routes: Record<string, any>

  beforeEach(async () => {
    vi.clearAllMocks()
    mockPrisma = {
      character: { findFirst: vi.fn().mockResolvedValue({ id: 'c1', storyId: 's1' }) },
      characterBranchState: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) }
    }
    const built = createMockApp(mockPrisma)
    const { characterRoutes } = await import('../../routes/characters.js')
    await characterRoutes(built.app)
    routes = built.routes
  })

  it('成功更新: status/relationships JSON.stringify + costume 透传 + chapterNumber 转 Number', async () => {
    const result = await callHandler(routes, 'PUT', ROUTE, {
      status: { realm: '练气' },
      relationships: { 林帆: '师徒' },
      costume: '青衫'
    }, { storyId: 's1', charId: 'c1', chapterNumber: '3' })
    expect(mockPrisma.characterBranchState.updateMany).toHaveBeenCalledWith({
      where: { characterId: 'c1', fromChapterNumber: 3 },
      data: { status: '{"realm":"练气"}', relationships: '{"林帆":"师徒"}', costume: '青衫' }
    })
    expect(result.body).toEqual({ success: true, data: { updated: 1 } })
  })

  it('costume 空白字符串 → 存 null (视同未描写)', async () => {
    await callHandler(routes, 'PUT', ROUTE, {
      status: { realm: '练气' },
      relationships: {},
      costume: '   '
    }, { storyId: 's1', charId: 'c1', chapterNumber: '3' })
    expect(mockPrisma.characterBranchState.updateMany).toHaveBeenCalledWith({
      where: { characterId: 'c1', fromChapterNumber: 3 },
      data: { status: '{"realm":"练气"}', relationships: '{}', costume: null }
    })
  })

  it('status/relationships 缺省或 null → 清空为 {}', async () => {
    await callHandler(routes, 'PUT', ROUTE, {
      status: null,
      relationships: null,
      costume: null
    }, { storyId: 's1', charId: 'c1', chapterNumber: '3' })
    expect(mockPrisma.characterBranchState.updateMany).toHaveBeenCalledWith({
      where: { characterId: 'c1', fromChapterNumber: 3 },
      data: { status: '{}', relationships: '{}', costume: null }
    })
  })

  it('该章无此角色快照 (updateMany count=0) → 404', async () => {
    mockPrisma.characterBranchState.updateMany.mockResolvedValue({ count: 0 })
    const result = await callHandler(routes, 'PUT', ROUTE, {
      status: {}, relationships: {}, costume: null
    }, { storyId: 's1', charId: 'c1', chapterNumber: '99' })
    expect(result.status).toBe(404)
    expect(result.body.success).toBe(false)
  })

  it('charId 不属于该 storyId → 404 Character not found', async () => {
    mockPrisma.character.findFirst.mockResolvedValue(null)
    const result = await callHandler(routes, 'PUT', ROUTE, {
      status: {}, relationships: {}, costume: null
    }, { storyId: 's1', charId: 'other', chapterNumber: '3' })
    expect(result.status).toBe(404)
    expect(result.body.success).toBe(false)
    expect(mockPrisma.characterBranchState.updateMany).not.toHaveBeenCalled()
  })

  it('status 为数组 → 400', async () => {
    const result = await callHandler(routes, 'PUT', ROUTE, {
      status: ['bad'], relationships: {}, costume: null
    }, { storyId: 's1', charId: 'c1', chapterNumber: '3' })
    expect(result.status).toBe(400)
    expect(result.body.success).toBe(false)
  })

  it('relationships 为字符串 → 400', async () => {
    const result = await callHandler(routes, 'PUT', ROUTE, {
      status: {}, relationships: 'bad', costume: null
    }, { storyId: 's1', charId: 'c1', chapterNumber: '3' })
    expect(result.status).toBe(400)
    expect(result.body.success).toBe(false)
  })

  it('chapterNumber 非法 → 400', async () => {
    const result = await callHandler(routes, 'PUT', ROUTE, {
      status: {}, relationships: {}, costume: null
    }, { storyId: 's1', charId: 'c1', chapterNumber: 'abc' })
    expect(result.status).toBe(400)
    expect(mockPrisma.characterBranchState.updateMany).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter server test -- --run characters-snapshot-edit.test.ts`
Expected: FAIL — `No handler registered for PUT /api/stories/:storyId/characters/:charId/snapshot/:chapterNumber`

- [ ] **Step 3: 实现端点**

在 `apps/server/src/routes/characters.ts` 的单角色 GET snapshot 端点（第 33 行 `});` 之后）插入：

```typescript
  // PUT /api/stories/:storyId/characters/:charId/snapshot/:chapterNumber — v4 快照纠错: 用户手动编辑已归档快照
  app.put('/api/stories/:storyId/characters/:charId/snapshot/:chapterNumber', async (request, reply) => {
    const { storyId, charId, chapterNumber } = request.params as any
    const body = request.body as any
    const chapterNum = Number(chapterNumber)
    if (Number.isNaN(chapterNum)) {
      return reply.status(400).send({ success: false, error: 'invalid chapter number' })
    }

    const character = await app.prisma.character.findFirst({ where: { id: charId, storyId } })
    if (!character) {
      return reply.status(404).send({ success: false, error: 'Character not found' })
    }

    const status = body.status ?? {}
    const relationships = body.relationships ?? {}
    if (typeof status !== 'object' || status === null || Array.isArray(status)) {
      return reply.status(400).send({ success: false, error: 'status 必须是 JSON 对象' })
    }
    if (typeof relationships !== 'object' || relationships === null || Array.isArray(relationships)) {
      return reply.status(400).send({ success: false, error: 'relationships 必须是 JSON 对象' })
    }
    // 与归档语义一致: 空白 costume 视同未描写 → null (character-extractor.ts:112)
    const costume = typeof body.costume === 'string' && body.costume.trim() ? body.costume : null

    const result = await app.prisma.characterBranchState.updateMany({
      where: { characterId: charId, fromChapterNumber: chapterNum },
      data: {
        status: JSON.stringify(status),
        relationships: JSON.stringify(relationships),
        costume
      }
    })
    if (result.count === 0) {
      return reply.status(404).send({ success: false, error: '该章节无此角色快照' })
    }
    return { success: true, data: { updated: result.count } }
  })
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter server test -- --run characters-snapshot-edit.test.ts`
Expected: PASS — 9 tests

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/routes/characters.ts apps/server/src/__tests__/routes/characters-snapshot-edit.test.ts
git commit -m "feat(characters): add snapshot editing endpoint

PUT /api/stories/:storyId/characters/:charId/snapshot/:chapterNumber updates
the archived CharacterBranchState row via updateMany; 404 when no snapshot
exists for that chapter.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: 前端 API 层

**Files:**
- Modify: `apps/web/src/api/characters.ts`

- [ ] **Step 1: 添加 updateSnapshot 方法**

在 `apps/web/src/api/characters.ts` 的 `getSnapshot` 之后（第 60 行 `}` 前）加入：

```typescript
  /** 手动编辑已归档快照（快照纠错入口） */
  updateSnapshot: (
    storyId: string,
    charId: string,
    chapter: number,
    data: { status: Record<string, any>; relationships: Record<string, any>; costume: string | null }
  ) => api.put(`/api/stories/${storyId}/characters/${charId}/snapshot/${chapter}`, data)
}
```

- [ ] **Step 2: typecheck 验证**

Run: `pnpm typecheck`
Expected: 全仓 PASS（apps/web vue-tsc 通过）

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/api/characters.ts
git commit -m "feat(characters): add updateSnapshot API for web

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: 前端编辑弹窗 aside 编辑态

**Files:**
- Modify: `apps/web/src/views/Characters.vue`

- [ ] **Step 1: script 增加编辑态状态与保存逻辑**

在 `apps/web/src/views/Characters.vue` 的 `watch(snapshotChapter, ...)` 之前（第 411 行附近）插入：

```typescript
// ========== 快照编辑 (v4 快照纠错) ==========
const snapshotEditing = ref(false)
const snapshotForm = ref({ relationshipsText: '{}', statusText: '{}', costume: '' })

function startSnapshotEdit() {
  if (!snapshotCharacter.value) return
  snapshotForm.value = {
    relationshipsText: JSON.stringify(snapshotCharacter.value.relationships?.value ?? {}, null, 2),
    statusText: JSON.stringify(snapshotCharacter.value.status?.value ?? {}, null, 2),
    costume: snapshotCharacter.value.costume?.value ?? ''
  }
  snapshotEditing.value = true
}

function cancelSnapshotEdit() {
  snapshotEditing.value = false
}

async function saveSnapshot() {
  if (!editingCharacter.value || snapshotChapter.value === null || !route.params.storyId) return
  let status: Record<string, any>
  let relationships: Record<string, any>
  try {
    status = JSON.parse(snapshotForm.value.statusText || '{}')
    relationships = JSON.parse(snapshotForm.value.relationshipsText || '{}')
  } catch (err: any) {
    message.error(`快照 JSON 不合法: ${err.message || err}`)
    return
  }
  try {
    await charactersApi.updateSnapshot(
      route.params.storyId as string,
      editingCharacter.value.id,
      snapshotChapter.value,
      { status, relationships, costume: snapshotForm.value.costume }
    )
  } catch (err: any) {
    message.error(err?.response?.data?.error || '快照更新失败')
    return
  }
  message.success('快照已更新')
  snapshotEditing.value = false
  // 重新拉取该章快照 + 刷新列表
  const res = await charactersApi.getSnapshot(route.params.storyId as string, editingCharacter.value.id, snapshotChapter.value)
  snapshotCharacter.value = res.data.data ?? null
  await loadCharacters()
}
```

- [ ] **Step 2: 模板 aside 改造**

将 `apps/web/src/views/Characters.vue` 中的整个 `<aside v-if="editingHasSnapshot && editingCharacter" ...>...</aside>` 块（第 177-185 行）替换为：

```html
        <aside v-if="editingHasSnapshot && editingCharacter" class="character-edit-snapshot">
          <div class="character-edit-snapshot__bar">
            <span class="character-edit-snapshot__hint">章节快照由归档 AI 分析生成；手动修改由你负责。</span>
            <n-button v-if="!snapshotEditing" size="tiny" @click="startSnapshotEdit">编辑快照</n-button>
            <n-space v-else size="small">
              <n-button size="tiny" type="primary" @click="saveSnapshot">保存快照</n-button>
              <n-button size="tiny" @click="cancelSnapshotEdit">取消编辑</n-button>
            </n-space>
          </div>
          <n-alert v-if="snapshotEditing" type="warning" :show-icon="true">
            手动修改快照由你负责。该快照将直接作为后续章节生成时的角色参考；删除对应章节时此修改随快照一并删除。
          </n-alert>
          <n-select
            v-model:value="snapshotChapter"
            :options="chapterOptions"
            size="small"
            placeholder="Select snapshot chapter"
            :disabled="snapshotEditing"
          />
          <template v-if="snapshotEditing">
            <span class="char-card__label">关系（JSON）</span>
            <n-input v-model:value="snapshotForm.relationshipsText" type="textarea" :rows="4" placeholder='{"林帆": "师徒"}' />
            <span class="char-card__label">状态（JSON）</span>
            <n-input v-model:value="snapshotForm.statusText" type="textarea" :rows="4" placeholder='{"realm": "练气"}' />
            <span class="char-card__label">衣着</span>
            <n-input v-model:value="snapshotForm.costume" placeholder="留空 = 未描写" />
          </template>
          <template v-else>
            <span class="char-card__label">最新章节快照</span>
            <div class="character-edit-snapshot__row"><strong>关系</strong><span>{{ formatObject(snapshotCharacter?.relationships?.value) || '未提取' }}</span></div>
            <div class="character-edit-snapshot__row"><strong>状态</strong><span>{{ formatObject(snapshotCharacter?.status?.value) || '未提取' }}</span></div>
            <div class="character-edit-snapshot__row"><strong>衣着</strong><span>{{ snapshotCharacter?.costume?.value || '未提取' }}</span></div>
            <span class="char-card__source is-snapshot">归档快照</span>
          </template>
        </aside>
```

> 说明：编辑态下禁用章节选择器，避免切换章节时 watch 刷新 `snapshotCharacter` 与编辑中表单不同步。`n-button`/`n-space`/`n-alert`/`n-select`/`n-input` 均已在本文件导入。

- [ ] **Step 3: 样式微调（bar 横排）**

在 `apps/web/src/views/Characters.vue` 的 `<style scoped>` 末尾追加：

```css
.character-edit-snapshot__bar { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
```

- [ ] **Step 4: typecheck 验证**

Run: `pnpm typecheck`
Expected: 全仓 PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/views/Characters.vue
git commit -m "feat(characters): allow editing archived snapshots in modal

Adds an edit toggle to the snapshot panel with JSON textareas for
status/relationships, costume input, and a warning that manual edits
are the user's responsibility.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: 全量验证与收尾

**Files:** 无新增

- [ ] **Step 1: server 全量测试**

Run: `pnpm --filter server test`
Expected: 全部 PASS（含新增 9 个 + 既有 characters-display / characters-snapshot / archive-character-branch-state-write 等）

- [ ] **Step 2: 全仓 typecheck**

Run: `pnpm typecheck`
Expected: 全仓 PASS

- [ ] **Step 3: 手工验证清单（浏览器）**

Run: `pnpm dev`，打开 `http://localhost:5173` 角色页：

1. 选一个有多章快照的角色 → 编辑 → 右侧面板出现「编辑快照」按钮
2. 点编辑：出现 warning 提示、三个输入框、章节选择器禁用；JSON textarea 预填当前章快照
3. 改 status 为 `{"realm": "金丹"}` → 保存 → 提示成功 → 回只读态且显示新值
4. 刷新页面验证持久化；列表卡片「章节快照」区块显示编辑后值
5. 切到无快照的角色 → 编辑弹窗不显示右侧面板（编辑入口不存在）
6. 直接改下一章生成：打开章节页生成预览（prompt 预览中角色状态应为编辑后值）
7. 非法 JSON（如 `{bad`）→ 保存 → 前端报错提示、不发起请求
8. 衣着清空保存 → 快照衣着显示「未提取」，DB 中该行 costume 为 NULL

- [ ] **Step 4: 更新文档**

在 `CLAUDE.md` 的「Knowledge Graph」之后追加角色快照编辑说明（或更新 `Process.md` 相应段落）：

```markdown
### Character Snapshot Editing

已归档的角色快照（`CharacterBranchState`）可在角色页编辑弹窗中手动编辑
（`PUT /api/stories/:storyId/characters/:charId/snapshot/:chapterNumber`）。
手动修改由用户负责，编辑结果直接作为后续章节生成时的角色参考；删除章节时
该章快照连同修改一并删除。详见 `docs/superpowers/specs/2026-08-13-character-snapshot-editing-design.md`。
```

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document character snapshot editing

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- 后端端点（校验/404/400/costume null）→ Task 1 ✅
- 前端 aside 编辑态 + warning + 章节选择即编辑目标 → Task 3 ✅
- 前端 API 层 → Task 2 ✅
- 测试策略（server TDD + web typecheck/手工）→ Task 1、4 ✅
- 边界语义（删章随行删除、generate 立即生效）→ 无代码改动需求，Task 4 手工验证覆盖 ✅

**Placeholder scan:** 无 TBD/TODO；所有代码步骤含完整代码。✅

**Type consistency:** `updateSnapshot(storyId, charId, chapter, data)` 在 Task 2 定义、Task 3 调用，签名一致；`snapshotForm` 字段名 Task 3 定义与模板使用一致；端点路径常量在 Task 1 测试与实现一致。✅
