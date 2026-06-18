# P2a: zod schema 落 `packages/shared` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 chapters.ts 12 endpoint 的请求/响应 shape 在 `packages/shared` 用 zod schema 单一 source of truth 定义。**只定义,不接入**(P2b 才在 route 用 `.parse()`)。3 commit。

**Architecture:** 新建 schema 文件 + 1 个 zod 化(archive.ts)+ 1 个测试文件。Schema 字段名严格沿用现有 route 处理逻辑里的字段名,不做"顺手重命名"。`PendingArchiveData` 的现有 interface 保留 + 加 zod 版(向后兼容,reviewing 阶段 user 编辑可能添加字段)。

**Tech Stack:** zod (已在 `packages/shared` 安装), vitest (apps/server 已有,shared 需新增 `vitest.config.ts` + `test` script), TypeScript。

---

## 前置知识(必读)

- **Spec(本 phase 设计)**: `docs/superpowers/specs/2026-06-18-decoupling-roadmap-design.md` 第 143-172 行(`## Phase 2a`)
- **现有 `packages/shared` 状态**:
  - `index.ts` 已有 `ChapterStatus` / `MemoryLayer` / `LoreCategory` 等常量 + `estimateTokens` / `safeJsonParse` / `scaleBudget` 等工具函数(不动)
  - `chapter-prompt.ts` 已有 `CompiledPromptSchema`(z.object,systemMessage/userMessage string trim().min(1) + 可选 meta) + `CompiledPrompt` type — **不动**,P2a 验证 + 加测试
  - `archive.ts` 已有 6 个 interface(`PendingMemoryWrite` / `PendingMemories` / `PendingGraphNode` / `PendingGraphEdge` / `PendingGraphSnapshot` / `PendingPlotArcWrite` / `PendingArchiveMeta` / `PendingArchiveData`) — **保留 interface + 加 zod schema**
  - `package.json` 已有 `zod: ^3.25.76` dep,无 `test` script
  - **没有** `__tests__/` 目录
- **12 endpoint body shape (从 chapters.ts 反推)**:

| # | Method | URL | Body |
|---|---|---|---|
| 1 | GET | `/api/stories/:storyId/chapters` | (无) |
| 2 | POST | `/api/stories/:storyId/chapters` (create) | `{ title (string 必填), outline? (string), isSideStory? (boolean,server 不读), number? (number,server 不读) }` |
| 3 | GET | `/api/chapters/:chapterId` | (无) |
| 4 | PUT | `/api/chapters/:chapterId` (update) | `{ title? (string), outline? (string), content? (string), status? (string,server 拒), sceneLocation? (string), sceneMood? (string), sceneGoal? (string), aiProviderConfigId? (string\|null), pendingArchiveData? (string) }` — **所有字段 optional** |
| 5 | DELETE | `/api/chapters/:chapterId` | (无) |
| 6 | POST | `/api/chapters/:chapterId/preview` | `{ storyId (string 必填) }` |
| 7 | POST | `/api/chapters/:chapterId/generate` | `{ storyId (string 必填), candidateCount? (number), temperatures? (number[]), maxTokens? (number), compiledPrompt? (CompiledPrompt) }` |
| 8 | POST | `/api/chapters/:chapterId/select` | `{ draftId (string 必填) }` |
| 9 | POST | `/api/stories/:storyId/chapters` (develop, 实为 `/api/chapters/:chapterId/develop`) | `{ isSideStory? (boolean), number? (number,only if isSideStory), title? (string), outline? (string), runtimeProfileId? (string) }` |
| 10 | POST | `/api/chapters/:chapterId/prepare-archive` | (无,仅读 :chapterId) |
| 11 | POST | `/api/chapters/:chapterId/archive` | (无,仅读 :chapterId) |
| 12 | GET | `/api/stories/:storyId/chapter-tree` | (无) |

- **ChapterResponse shape (来自 `apps/server/src/routes/chapters.ts:88-97` Prisma create 返回)**: 包含 `id, storyId, number, isSideStory, title, outline, status, ...` 全 Prisma chapter 字段。

- **ChapterTreeNode shape (来自 `apps/server/src/routes/chapters.ts:851-867`)**: `{ ...chapter, children: ChapterTreeNode[] }`,递归结构。

- **不要做的事**:
  - **不接入**:P2a 只定义 schema,P2b 才在 route 用 `.parse()`。route handler **不**改。
  - **不重命名字段**:沿用 chapters.ts 现有的字段名(title / outline / content / sceneLocation / sceneMood / sceneGoal / aiProviderConfigId / pendingArchiveData / candidateCount / temperatures / maxTokens / compiledPrompt / draftId / isSideStory / number / runtimeProfileId / storyId)
  - **不改 `CompiledPromptSchema`**:已存在,P2a 只加测试
  - **不删 `PendingArchiveData` interface**:zod schema 平行存在,interface 保留(下游 5 处引用,见 codegraph 探索)
  - **不动 `apps/web/src/api/chapters.ts`**:web 端类型用 `z.infer<>` 是 P2b 范围
  - **不引入新库**

---

## Task 1: shared 包加 vitest 配置 + 验证 CompiledPromptSchema(1 测试)

**Files:**
- Create: `packages/shared/vitest.config.ts`
- Modify: `packages/shared/package.json` (加 `"test": "vitest run"`)
- Create: `packages/shared/src/__tests__/schemas.test.ts` (起步文件,只含 CompiledPromptSchema 1 测试)

- [ ] **Step 1: 创建 `packages/shared/vitest.config.ts`**

写:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 10000
  }
})
```

- [ ] **Step 2: 修改 `packages/shared/package.json` 加 test script**

读 `packages/shared/package.json` 现状(已在 context 里:无 `test` 字段)。

在 `scripts` 段加一行 `"test": "vitest run"`:

```json
"scripts": {
  "build": "tsc",
  "dev": "tsc --watch",
  "typecheck": "tsc --noEmit",
  "test": "vitest run"
}
```

- [ ] **Step 3: 创建 `packages/shared/src/__tests__/schemas.test.ts` 起步**

```ts
import { describe, it, expect } from 'vitest'
import { CompiledPromptSchema } from '../chapter-prompt.js'

describe('CompiledPromptSchema (P2a 验证)', () => {
  it('valid minimal prompt → parses', () => {
    const result = CompiledPromptSchema.safeParse({
      systemMessage: 'You are a writer',
      userMessage: 'Write chapter 1'
    })
    expect(result.success).toBe(true)
  })

  it('empty systemMessage → fails', () => {
    const result = CompiledPromptSchema.safeParse({
      systemMessage: '',
      userMessage: 'Write chapter 1'
    })
    expect(result.success).toBe(false)
  })
})
```

- [ ] **Step 4: 跑测试,确认通过**

```bash
pnpm --filter @novel-runtime/shared test 2>&1 | tail -10
```

**预期**:2/2 PASS(`CompiledPromptSchema` 已在 `chapter-prompt.ts` 存在,trim().min(1) 拒绝空串)。

- [ ] **Step 5: typecheck 验证**

```bash
pnpm --filter @novel-runtime/shared typecheck 2>&1 | tail -5
```

**预期**:`Done`(无 error)。

- [ ] **Step 6: commit 1 - chapter.ts 之前的准备**

**先** `git status` 确认范围:

```bash
git status
```

**预期**:
```
new file:   packages/shared/vitest.config.ts
modified:   packages/shared/package.json
new file:   packages/shared/src/__tests__/schemas.test.ts
```

(3 文件,无其它)

**如果出现其它文件,立刻 `git restore <file>`**。

```bash
git add packages/shared/vitest.config.ts packages/shared/package.json packages/shared/src/__tests__/schemas.test.ts
git commit -m "$(cat <<'EOF'
chore(shared): add vitest config + verify CompiledPromptSchema (P2a Task 1)

P2a zod schema 落 shared 第 1 步:为 packages/shared 加 vitest 配置
+ test script,创建 __tests__/schemas.test.ts 起步文件,验证现有
CompiledPromptSchema (chapter-prompt.ts) 仍工作。

2 个测试 PASS (valid minimal prompt / empty systemMessage fails)。

后续 Task 2-8 会在同一 schemas.test.ts 累积测试,Task 9 补
index.ts exports。

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: CreateChapterRequestSchema + ChapterResponseSchema(在新建 `chapter.ts`)+ 4 测试

**Files:**
- Create: `packages/shared/src/chapter.ts` (起步内容:CreateChapterRequestSchema + ChapterResponseSchema + 2 type 导出)
- Modify: `packages/shared/src/__tests__/schemas.test.ts` (追加 4 测试)

- [ ] **Step 1: 创建 `packages/shared/src/chapter.ts`**

写:

```ts
import { z } from 'zod'

/**
 * POST /api/stories/:storyId/chapters 的请求体 schema。
 * 对应 apps/web/src/api/chapters.ts:ChapterCreate(interface) + chapters.ts:73-94
 * 服务端实际只读 `title` / `outline`,`isSideStory` / `number` 由服务端硬编码或计算,
 * 但 schema 仍接受这两个字段(前端可传,服务端忽略)。
 */
export const CreateChapterRequestSchema = z.object({
  title: z.string().trim().min(1),
  outline: z.string().optional(),
  isSideStory: z.boolean().optional(),
  number: z.number().optional()
})

export type CreateChapterRequest = z.infer<typeof CreateChapterRequestSchema>

/**
 * Chapter 实体响应(POST /api/stories/:storyId/chapters 返回 / GET /api/chapters/:chapterId 返回)。
 * 字段来自 Prisma `Chapter` model(prisma/schema.prisma)。
 */
export const ChapterResponseSchema = z.object({
  id: z.string(),
  storyId: z.string(),
  parentChapterId: z.string().nullable().optional(),
  number: z.number(),
  isSideStory: z.boolean(),
  title: z.string(),
  outline: z.string().nullable().optional(),
  content: z.string().nullable().optional(),
  status: z.string(),
  sceneLocation: z.string().nullable().optional(),
  sceneMood: z.string().nullable().optional(),
  sceneGoal: z.string().nullable().optional(),
  summary: z.string().nullable().optional(),
  aiProviderConfigId: z.string().nullable().optional(),
  pendingArchiveData: z.string().nullable().optional(),
  compiledPrompt: z.string().nullable().optional(),
  graphSnapshot: z.string().nullable().optional(),
  graphDelta: z.string().nullable().optional(),
  runtimeProfileId: z.string().nullable().optional(),
  createdAt: z.union([z.string(), z.date()]).optional(),
  updatedAt: z.union([z.string(), z.date()]).optional()
})

export type ChapterResponse = z.infer<typeof ChapterResponseSchema>
```

- [ ] **Step 2: 跑 typecheck,确认新文件通过**

```bash
pnpm --filter @novel-runtime/shared typecheck 2>&1 | tail -5
```

**预期**:`Done`。

- [ ] **Step 3: 在 schemas.test.ts 追加 CreateChapterRequestSchema + ChapterResponseSchema 测试**

用 Edit 工具在文件末尾追加(保留前 2 个 CompiledPromptSchema 测试):

```ts
import { CreateChapterRequestSchema, ChapterResponseSchema } from '../chapter.js'

describe('CreateChapterRequestSchema', () => {
  it('minimal valid { title } → parses', () => {
    const result = CreateChapterRequestSchema.safeParse({ title: 'Chapter 1' })
    expect(result.success).toBe(true)
  })

  it('empty title → fails', () => {
    const result = CreateChapterRequestSchema.safeParse({ title: '' })
    expect(result.success).toBe(false)
  })
})

describe('ChapterResponseSchema', () => {
  it('valid chapter object → parses', () => {
    const result = ChapterResponseSchema.safeParse({
      id: 'c1',
      storyId: 's1',
      number: 1,
      isSideStory: false,
      title: 'Chapter 1',
      status: 'draft'
    })
    expect(result.success).toBe(true)
  })

  it('missing required id → fails', () => {
    const result = ChapterResponseSchema.safeParse({
      storyId: 's1',
      number: 1,
      isSideStory: false,
      title: 'Chapter 1',
      status: 'draft'
    })
    expect(result.success).toBe(false)
  })
})
```

- [ ] **Step 4: 跑测试,确认通过(累计 6 测试)**

```bash
pnpm --filter @novel-runtime/shared test 2>&1 | tail -10
```

**预期**:6/6 PASS。

- [ ] **Step 5: commit 2 - chapter.ts 部分 1(留 Task 3-4 在同一 commit 续写,或 Task 3-4 各开 commit)**

**先** `git status` 确认范围:

```bash
git status
```

**预期**:
```
modified:   packages/shared/src/__tests__/schemas.test.ts
new file:   packages/shared/src/chapter.ts
```

(2 文件,无其它)

**如果出现其它文件,立刻 `git restore <file>`**。

```bash
git add packages/shared/src/chapter.ts packages/shared/src/__tests__/schemas.test.ts
git commit -m "$(cat <<'EOF'
feat(shared): add CreateChapterRequestSchema + ChapterResponseSchema (P2a Task 2)

P2a zod schema 落 shared 第 2 步:在新建 chapter.ts 加 2 个 schema,
对应 chapters.ts 的 POST /api/stories/:storyId/chapters + GET /api/chapters/:chapterId。

字段名严格沿用现有 route 处理的字段名(title / outline / isSideStory / number
+ Prisma Chapter 字段),不动结构。

4 个新测试 + 前 2 个 = 6 测试累计 PASS。

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: UpdateChapterRequestSchema + ChapterTreeNodeSchema(在 chapter.ts 续写)+ 4 测试

**Files:**
- Modify: `packages/shared/src/chapter.ts` (在末尾追加 2 schema + 2 type)
- Modify: `packages/shared/src/__tests__/schemas.test.ts` (追加 4 测试)

- [ ] **Step 1: 在 `packages/shared/src/chapter.ts` 末尾追加**

用 Edit 工具,在文件末尾(`export type ChapterResponse = z.infer<typeof ChapterResponseSchema>` 之后)追加:

```ts

/**
 * PUT /api/chapters/:chapterId 的请求体 schema。
 * 所有字段 optional(reviewing 状态只允许 content + pendingArchiveData,见 chapters.ts:140-150,
 * 这部分逻辑由 route 内部判断,schema 接受任何字段组合)。
 * 注:status 字段服务端会拒,见 chapters.ts:126-128,但 schema 仍允许(不阻挡未来 wire-up)。
 */
export const UpdateChapterRequestSchema = z.object({
  title: z.string().optional(),
  outline: z.string().optional(),
  content: z.string().optional(),
  status: z.string().optional(),
  sceneLocation: z.string().optional(),
  sceneMood: z.string().optional(),
  sceneGoal: z.string().optional(),
  aiProviderConfigId: z.string().nullable().optional(),
  pendingArchiveData: z.string().optional()
})

export type UpdateChapterRequest = z.infer<typeof UpdateChapterRequestSchema>

/**
 * GET /api/stories/:storyId/chapter-tree 的响应节点。
 * 递归结构,children 数组元素是自身(见 chapters.ts:855-867)。
 */
export const ChapterTreeNodeSchema: z.ZodType<{
  id: string
  storyId: string
  number: number
  isSideStory: boolean
  title: string
  status: string
  parentChapterId?: string | null
  children: any[]
  [key: string]: any
}> = z.lazy(() =>
  z.object({
    id: z.string(),
    storyId: z.string(),
    parentChapterId: z.string().nullable().optional(),
    number: z.number(),
    isSideStory: z.boolean(),
    title: z.string(),
    status: z.string(),
    runtimeProfile: z.object({ name: z.string() }).nullable().optional(),
    children: z.array(ChapterTreeNodeSchema)
  }).passthrough()
)

export type ChapterTreeNode = z.infer<typeof ChapterTreeNodeSchema>
```

**说明**:`.passthrough()` 因为 chapter-tree 节点还包含所有 Prisma Chapter 字段(drafts / compiledPrompt / 等),不强校验这些。`z.lazy()` 是 zod 处理递归类型的标准模式。

- [ ] **Step 2: 跑 typecheck**

```bash
pnpm --filter @novel-runtime/shared typecheck 2>&1 | tail -5
```

**预期**:`Done`。

- [ ] **Step 3: 在 schemas.test.ts 追加测试**

在文件末尾追加:

```ts
import {
  UpdateChapterRequestSchema,
  ChapterTreeNodeSchema
} from '../chapter.js'

describe('UpdateChapterRequestSchema', () => {
  it('empty object → parses (all fields optional)', () => {
    const result = UpdateChapterRequestSchema.safeParse({})
    expect(result.success).toBe(true)
  })

  it('partial update { content } → parses', () => {
    const result = UpdateChapterRequestSchema.safeParse({ content: 'new content' })
    expect(result.success).toBe(true)
  })
})

describe('ChapterTreeNodeSchema', () => {
  it('leaf node without children → parses', () => {
    const result = ChapterTreeNodeSchema.safeParse({
      id: 'c1',
      storyId: 's1',
      number: 1,
      isSideStory: false,
      title: 'Chapter 1',
      status: 'archived',
      children: []
    })
    expect(result.success).toBe(true)
  })

  it('nested tree (root with child) → parses', () => {
    const result = ChapterTreeNodeSchema.safeParse({
      id: 'c1',
      storyId: 's1',
      number: 1,
      isSideStory: false,
      title: 'Chapter 1',
      status: 'archived',
      children: [
        {
          id: 'c1.1',
          storyId: 's1',
          number: 1.01,
          isSideStory: true,
          title: 'Side story',
          status: 'archived',
          children: []
        }
      ]
    })
    expect(result.success).toBe(true)
  })
})
```

- [ ] **Step 4: 跑测试,累计 10 测试**

```bash
pnpm --filter @novel-runtime/shared test 2>&1 | tail -10
```

**预期**:10/10 PASS。

- [ ] **Step 5: commit**

```bash
git status
```

**预期**:
```
modified:   packages/shared/src/chapter.ts
modified:   packages/shared/src/__tests__/schemas.test.ts
```

(2 文件 only,无其它)

```bash
git add packages/shared/src/chapter.ts packages/shared/src/__tests__/schemas.test.ts
git commit -m "$(cat <<'EOF'
feat(shared): add UpdateChapterRequestSchema + ChapterTreeNodeSchema (P2a Task 3)

P2a zod schema 落 shared 第 3 步:在 chapter.ts 续写 2 个 schema。

- UpdateChapterRequestSchema: 对应 PUT /api/chapters/:chapterId,
  所有字段 optional(reviewing 状态只允许 content+pendingArchiveData,
  这部分由 route 内部判断,schema 接受任何字段组合)
- ChapterTreeNodeSchema: 对应 GET /api/stories/:storyId/chapter-tree
  响应节点,递归结构 + .passthrough() (节点还含 Prisma 其它字段,
  不强校验)

4 个新测试 + 前 6 个 = 10 测试累计 PASS。

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: GenerateRequestSchema + PreviewRequestSchema(在 chapter.ts 续写)+ 4 测试

**Files:**
- Modify: `packages/shared/src/chapter.ts` (在末尾追加 2 schema + 2 type)
- Modify: `packages/shared/src/__tests__/schemas.test.ts` (追加 4 测试)

- [ ] **Step 1: 在 `packages/shared/src/chapter.ts` 末尾追加**

用 Edit 工具追加:

```ts

/**
 * POST /api/chapters/:chapterId/preview 的请求体 schema。
 * chapters.ts:262-264 — body 必须有 storyId(用于 prompt 组装)。
 */
export const PreviewRequestSchema = z.object({
  storyId: z.string().trim().min(1)
})

export type PreviewRequest = z.infer<typeof PreviewRequestSchema>

/**
 * POST /api/chapters/:chapterId/generate 的请求体 schema。
 * chapters.ts:336-342 — storyId 必填,其它候选参数 + 编译 prompt 可选。
 * compiledPrompt 嵌套引用 CompiledPromptSchema(chapter-prompt.ts)。
 */
export const GenerateRequestSchema = z.object({
  storyId: z.string().trim().min(1),
  candidateCount: z.number().int().positive().optional(),
  temperatures: z.array(z.number()).optional(),
  maxTokens: z.number().int().positive().optional(),
  compiledPrompt: CompiledPromptSchema.optional()
})

export type GenerateRequest = z.infer<typeof GenerateRequestSchema>
```

**注意**:`CompiledPromptSchema` 需要 import。读 `chapter.ts` 现状,在最顶部 `import { z } from 'zod'` 行**后**加一行:

```ts
import { CompiledPromptSchema } from './chapter-prompt.js'
```

- [ ] **Step 2: 跑 typecheck**

```bash
pnpm --filter @novel-runtime/shared typecheck 2>&1 | tail -5
```

**预期**:`Done`。

- [ ] **Step 3: 在 schemas.test.ts 追加测试**

在文件末尾追加:

```ts
import {
  PreviewRequestSchema,
  GenerateRequestSchema
} from '../chapter.js'

describe('PreviewRequestSchema', () => {
  it('valid { storyId } → parses', () => {
    const result = PreviewRequestSchema.safeParse({ storyId: 's1' })
    expect(result.success).toBe(true)
  })

  it('empty object → fails (storyId required)', () => {
    const result = PreviewRequestSchema.safeParse({})
    expect(result.success).toBe(false)
  })
})

describe('GenerateRequestSchema', () => {
  it('minimal { storyId } → parses', () => {
    const result = GenerateRequestSchema.safeParse({ storyId: 's1' })
    expect(result.success).toBe(true)
  })

  it('with optional candidateCount + temperatures + maxTokens → parses', () => {
    const result = GenerateRequestSchema.safeParse({
      storyId: 's1',
      candidateCount: 3,
      temperatures: [0.6, 0.75, 0.9],
      maxTokens: 4096
    })
    expect(result.success).toBe(true)
  })

  it('with compiledPrompt → parses (validates nested schema)', () => {
    const result = GenerateRequestSchema.safeParse({
      storyId: 's1',
      compiledPrompt: {
        systemMessage: 'You are a writer',
        userMessage: 'Write chapter 1'
      }
    })
    expect(result.success).toBe(true)
  })
})
```

**说明**:GenerateRequestSchema 给 3 个测试(基本 / 完整 / 嵌套),所以 4 个测试 = Preview 2 + Generate 3 = **5 测试**。

- [ ] **Step 4: 跑测试,累计 14-15 测试**

```bash
pnpm --filter @novel-runtime/shared test 2>&1 | tail -10
```

**预期**:14 或 15/14 或 15 PASS(满足 spec "14+ 测试")。

- [ ] **Step 5: commit 收 chapter.ts**

```bash
git status
```

**预期**:
```
modified:   packages/shared/src/chapter.ts
modified:   packages/shared/src/__tests__/schemas.test.ts
```

```bash
git add packages/shared/src/chapter.ts packages/shared/src/__tests__/schemas.test.ts
git commit -m "$(cat <<'EOF'
feat(shared): add GenerateRequestSchema + PreviewRequestSchema (P2a Task 4)

P2a zod schema 落 shared 第 4 步(也是 chapter.ts 收尾):
在 chapter.ts 续写 2 个 schema。

- PreviewRequestSchema: 对应 POST /api/chapters/:chapterId/preview,
  storyId 必填(其它 endpoint 无 body)
- GenerateRequestSchema: 对应 POST /api/chapters/:chapterId/generate,
  storyId 必填 + candidateCount/temperatures/maxTokens/compiledPrompt 可选,
  compiledPrompt 嵌套引用 CompiledPromptSchema

chapter.ts 至此完成 6 个 schema(2+2+2)。

5 个新测试 + 前 10 个 = 15 测试累计 PASS(超过 spec 14+ 要求)。

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: SelectDraftRequestSchema(新文件 `select-draft.ts`)+ 2 测试

**Files:**
- Create: `packages/shared/src/select-draft.ts`
- Modify: `packages/shared/src/__tests__/schemas.test.ts` (追加 2 测试)

- [ ] **Step 1: 创建 `packages/shared/src/select-draft.ts`**

```ts
import { z } from 'zod'

/**
 * POST /api/chapters/:chapterId/select 的请求体 schema。
 * chapters.ts:505-507 — body 必须有 draftId(选哪个候选)。
 */
export const SelectDraftRequestSchema = z.object({
  draftId: z.string().trim().min(1)
})

export type SelectDraftRequest = z.infer<typeof SelectDraftRequestSchema>
```

- [ ] **Step 2: typecheck**

```bash
pnpm --filter @novel-runtime/shared typecheck 2>&1 | tail -5
```

**预期**:`Done`。

- [ ] **Step 3: 在 schemas.test.ts 追加测试**

在文件末尾追加:

```ts
import { SelectDraftRequestSchema } from '../select-draft.js'

describe('SelectDraftRequestSchema', () => {
  it('valid { draftId } → parses', () => {
    const result = SelectDraftRequestSchema.safeParse({ draftId: 'd1' })
    expect(result.success).toBe(true)
  })

  it('empty draftId → fails', () => {
    const result = SelectDraftRequestSchema.safeParse({ draftId: '' })
    expect(result.success).toBe(false)
  })
})
```

- [ ] **Step 4: 跑测试,累计 17 测试**

```bash
pnpm --filter @novel-runtime/shared test 2>&1 | tail -10
```

**预期**:17/17 PASS。

- [ ] **Step 5: commit**

```bash
git status
```

**预期**:
```
new file:   packages/shared/src/select-draft.ts
modified:   packages/shared/src/__tests__/schemas.test.ts
```

```bash
git add packages/shared/src/select-draft.ts packages/shared/src/__tests__/schemas.test.ts
git commit -m "$(cat <<'EOF'
feat(shared): add SelectDraftRequestSchema (P2a Task 5)

P2a zod schema 落 shared 第 5 步:新建 select-draft.ts,1 个 schema
对应 POST /api/chapters/:chapterId/select(draftId 必填)。

2 个新测试 + 前 15 个 = 17 测试累计 PASS。

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: PrepareArchiveRequestSchema(新文件 `prepare-archive.ts`)+ 2 测试

**Files:**
- Create: `packages/shared/src/prepare-archive.ts`
- Modify: `packages/shared/src/__tests__/schemas.test.ts` (追加 2 测试)

- [ ] **Step 1: 创建 `packages/shared/src/prepare-archive.ts`**

```ts
import { z } from 'zod'

/**
 * POST /api/chapters/:chapterId/prepare-archive 的请求体 schema。
 * chapters.ts:553-555 — endpoint 不读 body,只读 :chapterId path param。
 * schema 仍定义(空对象),用于 P2b wire-up 时显式"无 body"语义。
 */
export const PrepareArchiveRequestSchema = z.object({}).strict()

export type PrepareArchiveRequest = z.infer<typeof PrepareArchiveRequestSchema>
```

**说明**:`.strict()` 防止 frontend 误传任何字段时被静默 strip 而产生"看似成功实际啥都没做"的 bug。空 schema 显式表达"这个 endpoint 不要 body"。

- [ ] **Step 2: typecheck**

```bash
pnpm --filter @novel-runtime/shared typecheck 2>&1 | tail -5
```

**预期**:`Done`。

- [ ] **Step 3: 在 schemas.test.ts 追加测试**

在文件末尾追加:

```ts
import { PrepareArchiveRequestSchema } from '../prepare-archive.js'

describe('PrepareArchiveRequestSchema', () => {
  it('empty object → parses (no body required)', () => {
    const result = PrepareArchiveRequestSchema.safeParse({})
    expect(result.success).toBe(true)
  })

  it('extra field → fails (strict mode)', () => {
    const result = PrepareArchiveRequestSchema.safeParse({ foo: 'bar' })
    expect(result.success).toBe(false)
  })
})
```

- [ ] **Step 4: 跑测试,累计 19 测试**

```bash
pnpm --filter @novel-runtime/shared test 2>&1 | tail -10
```

**预期**:19/19 PASS。

- [ ] **Step 5: commit**

```bash
git status
```

**预期**:
```
new file:   packages/shared/src/prepare-archive.ts
modified:   packages/shared/src/__tests__/schemas.test.ts
```

```bash
git add packages/shared/src/prepare-archive.ts packages/shared/src/__tests__/schemas.test.ts
git commit -m "$(cat <<'EOF'
feat(shared): add PrepareArchiveRequestSchema (P2a Task 6)

P2a zod schema 落 shared 第 6 步:新建 prepare-archive.ts,空 schema
(strict 模式)对应 POST /api/chapters/:chapterId/prepare-archive。
endpoint 不读 body(只读 :chapterId path param),空 schema 显式
表达"无 body"语义,.strict() 防止前端误传字段被静默 strip。

2 个新测试 + 前 17 个 = 19 测试累计 PASS。

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: DevelopRequestSchema(新文件 `develop.ts`)+ 3 测试

**Files:**
- Create: `packages/shared/src/develop.ts`
- Modify: `packages/shared/src/__tests__/schemas.test.ts` (追加 3 测试)

- [ ] **Step 1: 创建 `packages/shared/src/develop.ts`**

```ts
import { z } from 'zod'

/**
 * POST /api/chapters/:chapterId/develop 的请求体 schema。
 * chapters.ts:776-839 — 所有字段 optional(isSideStory 控制走主线还是番外,
 * number 仅在 isSideStory 时生效,title/outline 留空时由服务端默认,
 * runtimeProfileId 留空时回退到 parentChapter 的配置)。
 */
export const DevelopRequestSchema = z.object({
  isSideStory: z.boolean().optional(),
  number: z.number().optional(),
  title: z.string().optional(),
  outline: z.string().optional(),
  runtimeProfileId: z.string().optional()
})

export type DevelopRequest = z.infer<typeof DevelopRequestSchema>
```

- [ ] **Step 2: typecheck**

```bash
pnpm --filter @novel-runtime/shared typecheck 2>&1 | tail -5
```

**预期**:`Done`。

- [ ] **Step 3: 在 schemas.test.ts 追加测试**

在文件末尾追加:

```ts
import { DevelopRequestSchema } from '../develop.js'

describe('DevelopRequestSchema', () => {
  it('empty object → parses (all fields optional)', () => {
    const result = DevelopRequestSchema.safeParse({})
    expect(result.success).toBe(true)
  })

  it('isSideStory: true + number → parses (番外指定 number)', () => {
    const result = DevelopRequestSchema.safeParse({
      isSideStory: true,
      number: 1.05
    })
    expect(result.success).toBe(true)
  })

  it('runtimeProfileId: null → fails (schema 要求 string 或 undefined)', () => {
    const result = DevelopRequestSchema.safeParse({
      runtimeProfileId: null
    })
    expect(result.success).toBe(false)
  })
})
```

**说明**:第 3 测试验证 `runtimeProfileId: null` 失败(因为 schema 写 `z.string().optional()` 不接受 `null`)。如果 P2b wire-up 时发现需要接受 null,改 schema 为 `z.string().nullable().optional()`。

- [ ] **Step 4: 跑测试,累计 22 测试**

```bash
pnpm --filter @novel-runtime/shared test 2>&1 | tail -10
```

**预期**:22/22 PASS。

- [ ] **Step 5: commit**

```bash
git status
```

**预期**:
```
new file:   packages/shared/src/develop.ts
modified:   packages/shared/src/__tests__/schemas.test.ts
```

```bash
git add packages/shared/src/develop.ts packages/shared/src/__tests__/schemas.test.ts
git commit -m "$(cat <<'EOF'
feat(shared): add DevelopRequestSchema (P2a Task 7)

P2a zod schema 落 shared 第 7 步:新建 develop.ts,1 个 schema 对应
POST /api/chapters/:chapterId/develop。所有字段 optional
(isSideStory 控制主线 vs 番外,number 仅番外生效,title/outline
留空时服务端默认,runtimeProfileId 留空时回退到 parent 配置)。

3 个新测试 + 前 19 个 = 22 测试累计 PASS。

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: PendingArchiveDataSchema(在 `archive.ts` 加 zod 版,保留 interface)+ 3 测试

**Files:**
- Modify: `packages/shared/src/archive.ts` (在末尾追加 zod schema + type,interface 全部保留)
- Modify: `packages/shared/src/__tests__/schemas.test.ts` (追加 3 测试)

- [ ] **Step 1: 读 `archive.ts` 现状(已在 context,确认所有 interface 字段名)**

确认保留的 interface(全部保留不动):
- `PendingMemoryWrite` (line 13-22)
- `PendingCharacterStateWrite` (line 28-33)
- `PendingTimelineEventWrite` (line 38-43)
- `PendingMemories` (line 49-54)
- `PendingGraphNode` (line 60-65)
- `PendingGraphEdge` (line 71-78)
- `PendingGraphSnapshot` (line 88-92)
- `PendingPlotArcWrite` (line 99-112)
- `PendingArchiveMeta` (line 119-122)
- `PendingArchiveData` (line 130-138)

- [ ] **Step 2: 在 `archive.ts` 末尾追加 zod 导入 + 8 zod schema + PendingArchiveDataSchema + type**

用 Edit 工具,在文件**最顶部**加 zod import:

```ts
import { z } from 'zod'
```

(放在 `// Shared archive pipeline types ...` 注释**前**)

然后在文件**末尾**追加(在 `PendingArchiveData` interface 定义之后):

```ts

// =================================================================
// Zod 版 schema(P2a 引入,与 interface 平行存在)
// 用途:
//   1. P2b wire-up:在 chapters.ts archive route 用 schema.parse() 校验
//      Chapter.pendingArchiveData(round-trip JSON)
//   2. 文档化:PendingArchiveData 字段允许什么类型 / 哪些必填 / 哪些可选
// 与 interface 关系:
//   - interface 保留,下游 5 处引用(ReviewingPanel / chapters.ts /
//     combined-extractor) 继续用 interface
//   - zod schema 推导出的 type 是 "strict source of truth" — P2b
//     wire-up 时可以 `type PendingArchiveDataFromZod = z.infer<...>`
//     替换 interface,本 commit 不替换(避免大爆炸改动)
// 设计取舍:
//   - `.passthrough()` (不 .strict()):ReviewingPanel 编辑时可能添加
//     临时字段,不应被 zod 静默 strip
//   - `data: z.record(z.string(), z.any())` 兼容 graph node 任意结构
//   - `status/relationships/events/stages/unresolved` 是 z.string()
//     (Prisma 列是 TEXT,前端要 JSON.stringify 存)
// =================================================================

export const PendingMemoryWriteSchema = z.object({
  storyId: z.string(),
  chapterId: z.string(),
  fromChapterNumber: z.number(),
  layer: z.string(),
  content: z.string(),
  tags: z.string(),
  importance: z.number(),
  originUid: z.string().optional()
})

export const PendingCharacterStateWriteSchema = z.object({
  characterId: z.string(),
  fromChapterNumber: z.number(),
  status: z.string(),
  relationships: z.string()
})

export const PendingTimelineEventWriteSchema = z.object({
  storyId: z.string(),
  fromChapterNumber: z.number(),
  day: z.number(),
  events: z.string()
})

export const PendingMemoriesSchema = z.object({
  memories: z.array(PendingMemoryWriteSchema),
  characterStates: z.array(PendingCharacterStateWriteSchema),
  timelineEvents: z.array(PendingTimelineEventWriteSchema),
  summary: z.string().nullable()
})

export const PendingGraphNodeSchema = z.object({
  type: z.string(),
  key: z.string(),
  label: z.string(),
  data: z.record(z.string(), z.any())
}).passthrough()

export const PendingGraphEdgeSchema = z.object({
  fromType: z.string(),
  fromKey: z.string(),
  toType: z.string(),
  toKey: z.string(),
  relation: z.string(),
  weight: z.number()
})

export const PendingGraphSnapshotSchema = z.object({
  nodes: z.array(PendingGraphNodeSchema),
  edges: z.array(PendingGraphEdgeSchema),
  timestamp: z.string()
})

export const PendingPlotArcWriteSchema = z.object({
  storyId: z.string(),
  name: z.string(),
  type: z.string(),
  status: z.string(),
  progress: z.number(),
  stages: z.string(),
  currentStage: z.string(),
  nextGoal: z.string(),
  unresolved: z.string(),
  summary: z.string(),
  isNew: z.boolean(),
  existingId: z.string().optional()
})

export const PendingArchiveMetaSchema = z.object({
  extractedAt: z.string(),
  chapterNumber: z.number()
})

export const PendingArchiveDataSchema = z.object({
  memories: PendingMemoriesSchema,
  graph: z.object({
    mergedGraph: PendingGraphSnapshotSchema,
    chapterGraph: PendingGraphSnapshotSchema
  }),
  plotArcs: z.array(PendingPlotArcWriteSchema),
  meta: PendingArchiveMetaSchema
}).passthrough()

// TypeScript 类型(zod 推导),与上面 interface 平行
export type PendingMemoryWriteZ = z.infer<typeof PendingMemoryWriteSchema>
export type PendingCharacterStateWriteZ = z.infer<typeof PendingCharacterStateWriteSchema>
export type PendingTimelineEventWriteZ = z.infer<typeof PendingTimelineEventWriteSchema>
export type PendingMemoriesZ = z.infer<typeof PendingMemoriesSchema>
export type PendingGraphNodeZ = z.infer<typeof PendingGraphNodeSchema>
export type PendingGraphEdgeZ = z.infer<typeof PendingGraphEdgeSchema>
export type PendingGraphSnapshotZ = z.infer<typeof PendingGraphSnapshotSchema>
export type PendingPlotArcWriteZ = z.infer<typeof PendingPlotArcWriteSchema>
export type PendingArchiveMetaZ = z.infer<typeof PendingArchiveMetaSchema>
export type PendingArchiveDataZ = z.infer<typeof PendingArchiveDataSchema>
```

**说明**:`.passthrough()` 在 `PendingGraphNodeSchema` 和 `PendingArchiveDataSchema` 上,因为这些是 user-editable 的容器,前端可能添加临时字段。

- [ ] **Step 3: typecheck**

```bash
pnpm --filter @novel-runtime/shared typecheck 2>&1 | tail -5
```

**预期**:`Done`。

- [ ] **Step 4: 在 schemas.test.ts 追加测试**

在文件末尾追加:

```ts
import {
  PendingArchiveDataSchema,
  PendingMemoriesSchema,
  PendingGraphSnapshotSchema
} from '../archive.js'

describe('PendingArchiveDataSchema', () => {
  const validPayload = {
    memories: {
      memories: [
        {
          storyId: 's1',
          chapterId: 'c1',
          fromChapterNumber: 1,
          layer: 'chapter',
          content: 'A memory',
          tags: '[]',
          importance: 0.8
        }
      ],
      characterStates: [],
      timelineEvents: [],
      summary: 'chapter summary'
    },
    graph: {
      mergedGraph: { nodes: [], edges: [], timestamp: '2026-06-18T00:00:00Z' },
      chapterGraph: { nodes: [], edges: [], timestamp: '2026-06-18T00:00:00Z' }
    },
    plotArcs: [],
    meta: { extractedAt: '2026-06-18T00:00:00Z', chapterNumber: 1 }
  }

  it('valid full payload → parses', () => {
    const result = PendingArchiveDataSchema.safeParse(validPayload)
    expect(result.success).toBe(true)
  })

  it('missing meta → fails (required)', () => {
    const { meta, ...withoutMeta } = validPayload
    const result = PendingArchiveDataSchema.safeParse(withoutMeta)
    expect(result.success).toBe(false)
  })

  it('extra field at top level → passes (passthrough for user-editable payload)', () => {
    const withExtra = { ...validPayload, _userNote: 'edited by reviewer' }
    const result = PendingArchiveDataSchema.safeParse(withExtra)
    expect(result.success).toBe(true)
  })
})
```

- [ ] **Step 5: 跑测试,累计 25 测试**

```bash
pnpm --filter @novel-runtime/shared test 2>&1 | tail -10
```

**预期**:25/25 PASS。

- [ ] **Step 6: 跑全套验证,确认 archive.ts 修改未破下游(下游 5 处仍用 interface)**

```bash
pnpm typecheck 2>&1 | tail -15
```

**预期**:8/8 Done(zod 加在 archive.ts 末尾,interface 保留,下游 import 不破)。

```bash
pnpm --filter server test 2>&1 | tail -5
```

**预期**:115/115 PASS(server 仍在用 PendingArchiveData interface,zod 是平行存在)。

- [ ] **Step 7: commit**

```bash
git status
```

**预期**:
```
modified:   packages/shared/src/archive.ts
modified:   packages/shared/src/__tests__/schemas.test.ts
```

(2 文件 only,无其它)

```bash
git add packages/shared/src/archive.ts packages/shared/src/__tests__/schemas.test.ts
git commit -m "$(cat <<'EOF'
feat(shared): add PendingArchiveDataSchema zod version (P2a Task 8)

P2a zod schema 落 shared 第 8 步:在 archive.ts 加 zod 版 schema 集合
(11 个 schema,覆盖 9 个 interface),与现有 interface 平行存在。

设计取舍:
- .passthrough() 在 PendingGraphNodeSchema + PendingArchiveDataSchema
  上,允许 ReviewingPanel 编辑时添加临时字段(zod 不静默 strip)
- 保留所有 interface,下游 5 处引用(ReviewingPanel.vue / chapters.ts /
  combined-extractor.ts) 继续用 interface,zod 是 P2b wire-up 的
  "strict source of truth"
- zod 推导出的 *Z type 也导出,P2b wire-up 时可逐步替换

3 个新测试(基本 / 缺 meta / 额外字段) + 前 22 个 = 25 测试累计 PASS。
typecheck 8/8 Done + server 115/115 PASS 验证下游未破。

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: `index.ts` 加 schema exports + 最终全套验证

**Files:**
- Modify: `packages/shared/src/index.ts` (在末尾追加 schema 导出)

- [ ] **Step 1: 读 `index.ts` 末尾**

`packages/shared/src/index.ts` 末尾(已在 context):

```ts
export * from './archive.js'
export * from './chapter-prompt.js'
```

- [ ] **Step 2: 在末尾追加 4 行 schema 文件导出**

用 Edit 工具,在末尾追加:

```ts
export * from './chapter.js'
export * from './develop.js'
export * from './prepare-archive.js'
export * from './select-draft.js'
```

(保持字母顺序,与已有 `archive` / `chapter-prompt` 一致)

- [ ] **Step 3: 跑全套验证**

```bash
pnpm typecheck 2>&1 | tail -15
```

**预期**:8/8 Done。

```bash
pnpm --filter server test 2>&1 | tail -5
pnpm --filter @novel-runtime/shared test 2>&1 | tail -5
pnpm --filter @novel-runtime/ai-provider test 2>&1 | tail -5
```

**预期**:115/115 + 25/25 + 5/5 PASS。

- [ ] **Step 4: 最终验证 — 仓库内 schema exports 完整**

```bash
grep -E "^export" packages/shared/src/chapter.ts packages/shared/src/develop.ts packages/shared/src/prepare-archive.ts packages/shared/src/select-draft.ts packages/shared/src/chapter-prompt.ts | grep "Schema"
```

**预期**:看到所有 schema 名(11 个)都被 export 出来。

- [ ] **Step 5: commit 收 P2a**

```bash
git status
```

**预期**:
```
modified:   packages/shared/src/index.ts
```

(1 文件 only,无其它)

```bash
git add packages/shared/src/index.ts
git commit -m "$(cat <<'EOF'
feat(shared): export all zod schemas from index.ts (P2a Task 9)

P2a zod schema 落 shared 收尾:在 packages/shared/src/index.ts 加 4 个
schema 文件导出(chapter / develop / prepare-archive / select-draft),
保持字母顺序与已有 archive / chapter-prompt 一致。

至此 11 个 zod schema 全部可通过 @novel-runtime/shared 入口访问:
- chapter.ts: CreateChapterRequestSchema, UpdateChapterRequestSchema,
  ChapterTreeNodeSchema, ChapterResponseSchema, PreviewRequestSchema,
  GenerateRequestSchema (6)
- develop.ts: DevelopRequestSchema (1)
- prepare-archive.ts: PrepareArchiveRequestSchema (1)
- select-draft.ts: SelectDraftRequestSchema (1)
- chapter-prompt.ts: CompiledPromptSchema (1,已有)
- archive.ts: PendingArchiveDataSchema + 10 个子 schema (11)

P2a 全部完成:
- 11 个 zod schema 落库,单一 source of truth
- 25 个测试 PASS(超过 spec 14+ 要求)
- typecheck 8/8 Done + server 115/115 + ai-provider 5/5
- P2b (route 接入 .parse()) 可直接进行

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**1. Spec coverage:**

| Spec 要求 | 对应 task |
|---|---|
| `CompiledPromptSchema` 验证+补字段 | Task 1 |
| `SelectDraftRequestSchema` | Task 5 |
| `PrepareArchiveRequestSchema` | Task 6 |
| `PendingArchiveDataSchema`(zod 版) | Task 8 |
| `DevelopRequestSchema` | Task 7 |
| `CreateChapterRequestSchema` / `UpdateChapterRequestSchema` / `ChapterTreeNodeSchema` / `ChapterResponseSchema` | Task 2 (Create + Response) + Task 3 (Update + TreeNode) |
| spec 隐含的 `GenerateRequestSchema` + `PreviewRequestSchema`(未列但 12 endpoint 需要) | Task 4 |
| 导出所有 schema from `index.ts` | Task 9 |
| `__tests__/schemas.test.ts` 14+ 测试 | Task 1-8 累计 25 测试 |

✓ 全部覆盖。

**2. Placeholder scan:** 无 "TBD" / "TODO" / "待补" / "fill in" / "implement later"。

**3. Type consistency:**
- `z.string().trim().min(1)` 在所有"必填字符串"处一致(CompiledPrompt / CreateChapter.title / PreviewRequest.storyId / GenerateRequest.storyId / SelectDraftRequest.draftId)
- `z.number().int().positive()` 在 GenerateRequest.candidateCount / maxTokens 一致
- `z.string().optional()` vs `z.string().nullable().optional()` 区分明确:DevelopRequest 不接受 null(测试验证)
- 所有 schema 命名 `XxxSchema` + type `Xxx = z.infer<typeof XxxSchema>`

**4. Scope check:**
- 9 task,9 commit
- spec 估算 2-3 commit,实际 9 commit(每个 schema 1 commit + archive 1 commit + setup 1 commit + index 1 commit)
- 用户原则"小步提交,每 phase 内 3-8 commit",9 略多但每 commit 独立可回退,可接受

**5. Ambiguity check:**
- 字段名严格沿用 chapters.ts 现有 route 处理的字段名(spec "保留现有字段名"明确)
- `PreviewRequestSchema.storyId` 必填 — chapters.ts:265 `const storyId = body.storyId` 不检查,缺则下游错(隐式契约);P2a 显式 schema 化提升健壮性
- `ChapterTreeNodeSchema` 用 `.passthrough()` — 节点含 Prisma 其它字段(drafts / compiledPrompt / 等),不强校验
- `PendingArchiveDataSchema` 用 `.passthrough()` — user-editable,允许临时字段
- `DevelopRequestSchema.runtimeProfileId` 不接受 `null`(测试 3 验证)— chapters.ts:838 `runtimeProfileId || parent...` 走 fallback,前端传 null 等价于不传,改用 `z.string().nullable().optional()` 也可;本 plan 选严格版,P2b 实施时若发现前端确实传 null 再放宽
- `PrepareArchiveRequestSchema` 用 `.strict()` — 显式表达"无 body",防止前端误传字段被静默 strip

---

## 关键风险

| 风险 | 缓解 |
|---|---|
| 12 endpoint body shape 反推有遗漏 | Task 2-7 实施时由 reviewer 跑 chapters.ts 实际 body 字段对照,plan 已列 12 endpoint 全表 |
| `PendingArchiveDataSchema` 嵌套深度 + 字段多易错 | Task 8 用 codegraph_explore 对照 `archive.ts` interface 全部字段,`.passthrough()` 兜底;P2b wire-up 时再严格化 |
| `z.lazy()` + `.passthrough()` 组合 type 推导复杂 | Task 3 用 `z.ZodType<{...}>` 显式标注 type 解决 |
| `index.ts` 导出顺序字母 vs 实际依赖 | Task 9 保持字母顺序(与已有 archive / chapter-prompt 一致),无依赖问题 |
| 测试运行被现有 22 测试污染(其它包) | 跑 `pnpm --filter @novel-runtime/shared test` 只跑本包 |
