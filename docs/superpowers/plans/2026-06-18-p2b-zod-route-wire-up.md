# P2b: chapters.ts 12 endpoint 接 zod Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `apps/server/src/routes/chapters.ts` 的 6 个有 body 的 endpoint 上接 P2a 已定义的 zod schema(`.safeParse()` → 失败 400 + 字段级错误),统一所有 endpoint 的校验错误响应 shape(`{ success: false, error: '<字段>: <原因>' }`)。其余 6 个无 body endpoint 不动。加 1 个 zod-validation 路由级测试文件覆盖所有 6 schema。**5 commit,不动 web 端 / composables / prisma schema / API contract 成功路径。**

**Architecture:** 在 chapters.ts 6 处 endpoint 顶部加 `safeParse` + 失败 `reply.status(400).send(...)`。沿用 `apps/server/src/routes/stories.ts:35-37, 90-93` 已建立的 zod 错误响应 pattern。**不**抽 helper 函数(inline 6 次,每处 ~5 行,P3 拆 route 时再抽到 `_helpers.ts`)。**不**改 API contract 的成功路径 / 状态码 / 状态机逻辑——zod 校验只挡非法 body,合法 body 与原行为 100% 一致。

**Tech Stack:** zod (已在 `packages/shared` ^3.25.76), vitest (apps/server 已有), TypeScript。

---

## 前置知识(必读)

### Spec
- **本 phase 设计**: `docs/superpowers/specs/2026-06-18-decoupling-roadmap-design.md` 第 176-199 行(`## Phase 2b`)
- **P2a 落地的 schema 清单**(都已 commit + 25 测试绿):
  - `packages/shared/src/chapter.ts` — `CreateChapterRequestSchema`, `UpdateChapterRequestSchema`, `ChapterResponseSchema`, `ChapterTreeNodeSchema`, `PreviewRequestSchema`, `GenerateRequestSchema`
  - `packages/shared/src/select-draft.ts` — `SelectDraftRequestSchema`
  - `packages/shared/src/develop.ts` — `DevelopRequestSchema`
  - `packages/shared/src/prepare-archive.ts` — `PrepareArchiveRequestSchema`(empty strict)
  - `packages/shared/src/chapter-prompt.ts` — `CompiledPromptSchema`(已被 `GenerateRequestSchema.compiledPrompt` 嵌套引用)
  - `packages/shared/src/archive.ts` — `PendingArchiveDataSchema`(本 phase 不直接 wire,P3 再考虑)

### 12 endpoint 状态(从 chapters.ts 全量反推)

| # | Method | URL | body schema | line range |
|---|---|---|---|---|
| 1 | GET | `/api/stories/:storyId/chapters` | (无) | 23-30 |
| 2 | POST | `/api/stories/:storyId/chapters` (create) | **CreateChapterRequestSchema** | 71-99 |
| 3 | GET | `/api/chapters/:chapterId` | (无) | 102-110 |
| 4 | PUT | `/api/chapters/:chapterId` (update) | **UpdateChapterRequestSchema** | 113-154 |
| 5 | DELETE | `/api/chapters/:chapterId` | (无) | 157-259 |
| 6 | POST | `/api/chapters/:chapterId/preview` | **PreviewRequestSchema** | 262-333 |
| 7 | POST | `/api/chapters/:chapterId/generate` | **GenerateRequestSchema** | 336-502 |
| 8 | POST | `/api/chapters/:chapterId/select` | **SelectDraftRequestSchema** | 505-551 |
| 9 | POST | `/api/chapters/:chapterId/prepare-archive` | **PrepareArchiveRequestSchema** (empty strict) | 553-660 |
| 10 | POST | `/api/chapters/:chapterId/archive` | (无,仅读 :chapterId + DB) | 663-773 |
| 11 | POST | `/api/chapters/:chapterId/develop` | **DevelopRequestSchema** | 776-844 |
| 12 | GET | `/api/stories/:storyId/chapter-tree` | (无) | 847-870 |

→ **6 endpoint 需 wire**(2/4/6/7/8/9/11),**6 endpoint 不动**。本 plan Task 2-4 覆盖 #2/4/6/7/8/11,#9 单列 Task 5(语义不同:empty strict)。

### zod wire-up 模板(从 stories.ts:35-37 模板,但加 path 前缀)

stories.ts:37 用 `parseResult.error.errors.map(e => e.message).join('; ')` —— 只输出 zod 默认消息,不包含字段路径。**对 chapters 不够**:

- `GenerateRequestSchema` 嵌套 `CompiledPromptSchema`,如果 `compiledPrompt.userMessage` 缺失,zod 默认 message 是 `"Required"`,不带路径
- 现有 `generate-compiledPrompt.test.ts:70,135` 断言 `expect.stringContaining('compiledPrompt')`,需要错误消息里包含路径段

→ P2b 用**带路径前缀**的格式(全 6 处统一):

```ts
const parseResult = CreateChapterRequestSchema.safeParse(request.body)
if (!parseResult.success) {
  return reply.status(400).send({
    success: false,
    error: parseResult.error.errors.map(e =>
      `${e.path.join('.') || '<root>'}: ${e.message}`
    ).join('; ')
  })
}
const body = parseResult.data
// ... 后续用 body.xxx,不再用 request.body
```

效果:顶层字段如 `title` 报错显示 `"title: String must contain at least 1 character(s)"`(包含 'title');嵌套字段如 `compiledPrompt.userMessage` 报错显示 `"compiledPrompt.userMessage: Required"`(包含 'compiledPrompt',既满足现有测试也帮用户定位)。

注意:`parseResult.data` 已经是 `z.infer<...>` 类型,字段已被 trim() / 类型约束过。后续代码可以直接信任 `body.title`(非空 string)、`body.candidateCount`(正整数)等。**但** — 既有 handler 里的 `body.title` / `body.outline` 已经能正常处理,无需重写逻辑,只需把 `const body = request.body as any` 替换为 `const body = parseResult.data`,并删掉类型断言。

### P2a schema 在 P2b 接入时发现的 1 处必要 fixup

**`packages/shared/src/chapter.ts:115` 的 `GenerateRequestSchema.storyId` 当前是 `z.string().trim().min(1)`(必填)**,但:

- `apps/web/src/api/chapters.ts:38` 前端 `generate(chapterId, data: GenerateRequest)` 中 `data` 默认是 `{compiledPrompt?, [key: string]: any}`,**前端从不显式传 storyId**
- `apps/server/src/routes/chapters.ts:339` 服务端从 `body.storyId` 读,缺省走 prisma 查 chapter.storyId(但当前是直接传 body.storyId,无 fallback)
- 现有 3 个测试**就是传空 body**:
  - `apps/server/src/__tests__/routes/generate-concurrency.test.ts:64` (`{}`)
  - `apps/server/src/__tests__/routes/chapters-concurrency.test.ts:60-62` (`{}`)
  - `apps/server/src/__tests__/routes/generate-compiledPrompt.test.ts:60` (`{compiledPrompt: ...}`,无 storyId)

如果 wire 时不改,3 个现有测试 + 实际前端调用都会失败。**修复**:`storyId` 改 `z.string().trim().min(1).optional()`(保持 trim + min 校验,**只在传入时**强制非空)。这是 schema-shape 修正(对应 spec「不动 API contract」的边界:成功路径不变,只放宽输入必填)。

### 现有测试基础设施(无需新增)

- `apps/server/src/__tests__/setup.ts:18-29` — `createMockApp(prisma)` 返回 `{app, routes}`,只录 GET/POST/PUT/DELETE
- `apps/server/src/__tests__/setup.ts:40-67` — `callHandler(routes, method, path, body?, params?, query?)`,`body || {}`,返回 `{status, body}`
- 已 mock 的 services(避免走真 AI):`prepare-archive.test.ts:8-11, 12-14, 18-23` mock 了 `combined-extractor` / `memory-optimizer` / `graph-snapshot`
- **20 个测试文件 / 115+ 测试**,任何 P2b 改动不能破现有

### 行为契约(spec 强调不动)

- 成功路径:HTTP 状态码、响应 body、状态机切换、副作用(prisma write / AI 调用 / queue 投递)**全部不变**
- 错误路径:原来返回 400 的业务错误(如「已有章节,无法新建根章节」)仍走原 400 path;只有 zod 校验失败(非法 body shape)走新的 400 + 字段错误 path。两者响应 shape 都是 `{success: false, error: string}`,前端 axios 已自动 unwrap `.data`,无需改前端。
- prisma / DB / 状态机 / queue 行为 0 改动

---

## Task 1: Fixup — GenerateRequestSchema.storyId 改 optional

**Files:**
- Modify: `packages/shared/src/chapter.ts:115`
- Test: `packages/shared/src/__tests__/schemas.test.ts`(追加 2 测试覆盖新行为)

**Why first:** Task 3(wire generate 路由)依赖这个 fixup,否则 3 个现有 server 测试破。先做修,跑全测确认无 regression,再动 route。

- [ ] **Step 1: 写 2 个失败测试 — 追加到 `packages/shared/src/__tests__/schemas.test.ts`**

打开 `packages/shared/src/__tests__/schemas.test.ts`,在 `describe('GenerateRequestSchema', ...)` 块里 **追加** 以下两个 `it`(不修改已有 5 个测试):

```ts
  it('accepts missing storyId (route derives it from chapterId via prisma)', () => {
    const result = GenerateRequestSchema.safeParse({})
    expect(result.success).toBe(true)
  })

  it('rejects storyId="" (still validates type when provided)', () => {
    const result = GenerateRequestSchema.safeParse({ storyId: '' })
    expect(result.success).toBe(false)
  })
```

- [ ] **Step 2: 跑测试,确认第 1 个 FAIL 第 2 个 PASS**

```bash
pnpm --filter shared test
```

预期:`accepts missing storyId` FAIL(`Required` 错误),`rejects storyId=""` PASS(`.min(1)` 已生效)。

- [ ] **Step 3: 改 `packages/shared/src/chapter.ts:115`**

把:
```ts
  storyId: z.string().trim().min(1),
```
改成:
```ts
  storyId: z.string().trim().min(1).optional(),
```

- [ ] **Step 4: 跑测试,确认 2 个新测试都 PASS,旧 5 个仍 PASS**

```bash
pnpm --filter shared test
```

预期:7/7 PASS(5 旧 + 2 新)。

- [ ] **Step 5: typecheck + 跑 server 全测,确认 P2a fixup 不破现有 server 测试**

```bash
pnpm typecheck
pnpm --filter server test
```

预期:8/8 typecheck Done,115+ server 测试全绿(尤其 `generate-concurrency.test.ts` / `chapters-concurrency.test.ts` / `generate-compiledPrompt.test.ts`)。

- [ ] **Step 6: Commit**

```bash
git status   # 确认只有 chapter.ts + schemas.test.ts
git add packages/shared/src/chapter.ts packages/shared/src/__tests__/schemas.test.ts
git commit -m "fix(shared): make GenerateRequestSchema.storyId optional

P2a schema 把 storyId 标成必填,但前端从不显式传(services/web/src/api/chapters.ts:38 的 GenerateRequest 只有 compiledPrompt 可选),server 端 chapters.ts:339 直接读 body.storyId 无 fallback。现有 3 个 server 测试也只传 {} 或 {compiledPrompt}。

放宽为 optional,保留 trim().min(1) 让传空字符串仍被拒。P2b Task 3 wire generate 路由的前置。"
```

---

## Task 2: Wire POST /api/stories/:storyId/chapters (create) + PUT /api/chapters/:chapterId (update) — CRUD 组

**Files:**
- Modify: `apps/server/src/routes/chapters.ts:71-99`(POST create)
- Modify: `apps/server/src/routes/chapters.ts:113-154`(PUT update)
- Test: `apps/server/src/__tests__/routes/chapters-zod-validation.test.ts`(新建,本 task 4 测试)

**Why group:** 两个 CRUD endpoint 都是「body 里有字段、非空校验 + 类型校验」的最常见 pattern,放一个 commit 减少机械改动次数。Task 3/4 同理。

- [ ] **Step 1: 写 4 个失败测试 — 新建 `apps/server/src/__tests__/routes/chapters-zod-validation.test.ts`**

完整文件内容:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockApp, callHandler, createMockPrisma } from '../setup.js'

// 本文件专门覆盖 chapters.ts 6 个 body endpoint 的 zod 校验行为。
// 单元粒度:每个 schema 1 个 happy(返回成功或进入业务分支) + 1 个 negative(zod 拒绝,返回 400)。
// 业务逻辑的 happy/negative 在其他 __tests__/routes/*-test.ts 里覆盖,本文件不重复。

describe('POST /stories/:storyId/chapters — CreateChapterRequestSchema', () => {
  let mockPrisma: any
  let routes: Record<string, any>

  beforeEach(async () => {
    vi.clearAllMocks()
    mockPrisma = createMockPrisma({
      chapter: {
        ...createMockPrisma().chapter,
        count: vi.fn().mockResolvedValue(0),     // 无现存章节 → 通过「非首章」校验
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({
          id: 'c1', storyId: 's1', number: 1, isSideStory: false,
          title: 't', outline: '', status: 'draft'
        })
      }
    })
    const { chapterRoutes } = await import('../../routes/chapters.js')
    const built = createMockApp(mockPrisma)
    await chapterRoutes(built.app)
    routes = built.routes
  })

  it('accepts valid body (title only)', async () => {
    const result = await callHandler(
      routes, 'POST', '/api/stories/:storyId/chapters',
      { title: 'Chapter 1' },
      { storyId: 's1' }
    )
    expect(result.status).not.toBe(400)
    expect(result.body).toEqual(expect.objectContaining({ success: true }))
  })

  it('rejects missing title with 400 + zod error', async () => {
    const result = await callHandler(
      routes, 'POST', '/api/stories/:storyId/chapters',
      { outline: 'no title' },
      { storyId: 's1' }
    )
    expect(result.status).toBe(400)
    expect(result.body).toEqual(
      expect.objectContaining({ success: false, error: expect.stringContaining('title') })
    )
    // 不能进入业务逻辑
    expect(mockPrisma.chapter.create).not.toHaveBeenCalled()
  })
})

describe('PUT /chapters/:chapterId — UpdateChapterRequestSchema', () => {
  let mockPrisma: any
  let routes: Record<string, any>

  beforeEach(async () => {
    vi.clearAllMocks()
    mockPrisma = createMockPrisma({
      chapter: {
        ...createMockPrisma().chapter,
        findUnique: vi.fn().mockResolvedValue({
          id: 'c1', storyId: 's1', status: 'draft', title: 't'
        }),
        update: vi.fn().mockResolvedValue({ id: 'c1' })
      }
    })
    const { chapterRoutes } = await import('../../routes/chapters.js')
    const built = createMockApp(mockPrisma)
    await chapterRoutes(built.app)
    routes = built.routes
  })

  it('accepts valid partial update', async () => {
    const result = await callHandler(
      routes, 'PUT', '/api/chapters/:chapterId',
      { title: 'New Title' },
      { chapterId: 'c1' }
    )
    expect(result.status).not.toBe(400)
    expect(result.body).toEqual(expect.objectContaining({ success: true }))
  })

  it('rejects wrong type (title must be string)', async () => {
    const result = await callHandler(
      routes, 'PUT', '/api/chapters/:chapterId',
      { title: 123 },
      { chapterId: 'c1' }
    )
    expect(result.status).toBe(400)
    expect(result.body).toEqual(
      expect.objectContaining({ success: false, error: expect.stringContaining('title') })
    )
    expect(mockPrisma.chapter.update).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 跑测试,确认 4 个都 FAIL**

```bash
pnpm --filter server test -- chapters-zod-validation
```

预期:4/4 FAIL,FAIL 信息是「expect status 400, got 200」或「error 不含 title」(因为 wire 还没加)。

- [ ] **Step 3: 在 chapters.ts:73-77 加 CreateChapterRequest zod 校验**

替换 `apps/server/src/routes/chapters.ts:71-77`(原行):

```ts
  // POST /api/stories/:storyId/chapters
  app.post('/api/stories/:storyId/chapters', async (request, reply) => {
    const { storyId } = request.params as any
    const body = request.body as any

    const existingCount = await app.prisma.chapter.count({ where: { storyId } })
```

改成:

```ts
  // POST /api/stories/:storyId/chapters
  app.post('/api/stories/:storyId/chapters', async (request, reply) => {
    const { storyId } = request.params as any
    const parseResult = CreateChapterRequestSchema.safeParse(request.body)
    if (!parseResult.success) {
      return reply.status(400).send({
        success: false,
        error: parseResult.error.errors.map(e => `${e.path.join('.') || '<root>'}: ${e.message}`).join('; ')
      })
    }
    const body = parseResult.data

    const existingCount = await app.prisma.chapter.count({ where: { storyId } })
```

- [ ] **Step 4: 在 chapters.ts:115 加 UpdateChapterRequest zod 校验**

替换 `apps/server/src/routes/chapters.ts:113-117`(原行):

```ts
  // PUT /api/chapters/:chapterId
  app.put('/api/chapters/:chapterId', async (request, reply) => {
    const { chapterId } = request.params as any
    const body = request.body as any

    const chapter = await app.prisma.chapter.findUnique({ where: { id: chapterId } })
```

改成:

```ts
  // PUT /api/chapters/:chapterId
  app.put('/api/chapters/:chapterId', async (request, reply) => {
    const { chapterId } = request.params as any
    const parseResult = UpdateChapterRequestSchema.safeParse(request.body)
    if (!parseResult.success) {
      return reply.status(400).send({
        success: false,
        error: parseResult.error.errors.map(e => `${e.path.join('.') || '<root>'}: ${e.message}`).join('; ')
      })
    }
    const body = parseResult.data

    const chapter = await app.prisma.chapter.findUnique({ where: { id: chapterId } })
```

- [ ] **Step 5: 在 chapters.ts:1-13 imports 区加 schema 引用**

打开 `apps/server/src/routes/chapters.ts:1-13`,当前 imports 已有 `CompiledPromptSchema`(line 13)。**追加** 2 行(import 自 `@novel-runtime/shared`):

```ts
import {
  CreateChapterRequestSchema,
  UpdateChapterRequestSchema,
  // ... 已有 CompiledPromptSchema 保持不动
} from '@novel-runtime/shared'
```

⚠️ 若现有 import 已经是 `import { CompiledPromptSchema } from '@novel-runtime/shared'` 单行形式,**改**为多行块状:

```ts
import {
  CompiledPromptSchema,
  CreateChapterRequestSchema,
  UpdateChapterRequestSchema
} from '@novel-runtime/shared'
```

确认文件 line 13 当前是单行 import(读 chapters.ts 第 13 行确认)。Task 4 / 5 还会继续加 schema,**留足空间**。

- [ ] **Step 6: 跑 chapters-zod-validation 测试,确认 4/4 PASS**

```bash
pnpm --filter server test -- chapters-zod-validation
```

预期:4/4 PASS。

- [ ] **Step 7: 跑 server 全测,确认无 regression**

```bash
pnpm --filter server test
```

预期:115+ → 119+ 全绿。如果有失败:检查是哪个 endpoint 破了,**先**确认是 wire 没接好还是 schema 太严。

- [ ] **Step 8: typecheck**

```bash
pnpm typecheck
```

预期:8/8 Done。

- [ ] **Step 9: Commit**

```bash
git status   # 只该有 chapters.ts + chapters-zod-validation.test.ts
git add apps/server/src/routes/chapters.ts apps/server/src/__tests__/routes/chapters-zod-validation.test.ts
git commit -m "feat(server): wire CreateChapter + UpdateChapter routes with zod validation (P2b Task 2)

沿用 stories.ts:35-37 的 safeParse pattern:
- POST /api/stories/:storyId/chapters → CreateChapterRequestSchema
- PUT /api/chapters/:chapterId → UpdateChapterRequestSchema
失败统一返回 400 + {success: false, error: '<zod message>'}.
成功路径与原行为一致(只是 body 类型从 any 收紧为 z.infer<>).
加 4 个路由级 happy/negative 测试覆盖.
不动 web 端 / composables / prisma schema / 状态机."
```

---

## Task 3: Wire POST /api/chapters/:chapterId/preview + POST /api/chapters/:chapterId/generate — 生成流

**Files:**
- Modify: `apps/server/src/routes/chapters.ts:262-333`(POST preview)
- Modify: `apps/server/src/routes/chapters.ts:336-502`(POST generate)
- Test: `apps/server/src/__tests__/routes/chapters-zod-validation.test.ts`(追加 4 测试)

**注意 generate 路由的特殊情况:** 当前 chapters.ts:336 起手就读 `body.storyId` / `body.candidateCount` / `body.temperatures` / `body.maxTokens`,**且**已手动用 `CompiledPromptSchema.safeParse(body.compiledPrompt)` 做 partial 校验(`generate-compiledPrompt.test.ts` 证明现有此行为)。wire 之后,**删掉手动的 CompiledPromptSchema.safeParse**(GenerateRequestSchema 已嵌套校验 compiledPrompt),保留外层 GenerateRequestSchema 一处校验。

- [ ] **Step 1: 读 chapters.ts:336-360 完整摸清 generate 当前 compiledPrompt 校验位置**

执行 Read `apps/server/src/routes/chapters.ts` offset 336 limit 30,找出现有 `CompiledPromptSchema.safeParse(body.compiledPrompt)` 调用所在行号。**记下**这个行号(后文以「行 X」指代,实际可能不在 360),Step 5 要删。

- [ ] **Step 2: 在 chapters-zod-validation.test.ts 追加 4 个失败测试**

打开 `apps/server/src/__tests__/routes/chapters-zod-validation.test.ts`,**追加**到文件末尾:

```ts
describe('POST /chapters/:chapterId/preview — PreviewRequestSchema', () => {
  let mockPrisma: any
  let routes: Record<string, any>

  beforeEach(async () => {
    vi.clearAllMocks()
    mockPrisma = createMockPrisma({
      chapter: {
        ...createMockPrisma().chapter,
        findUnique: vi.fn().mockResolvedValue({
          id: 'c1', storyId: 's1', status: 'draft',
          outline: 'o', sceneLocation: '', sceneMood: '', sceneGoal: '',
          number: 1, isSideStory: false, story: { id: 's1', title: 'S', description: '' }
        }),
        findFirst: vi.fn().mockResolvedValue(null)
      },
      loreItem: { findMany: vi.fn().mockResolvedValue([]) },
      timelineEvent: { findMany: vi.fn().mockResolvedValue([]) },
      memory: { findMany: vi.fn().mockResolvedValue([]) },
      character: { findMany: vi.fn().mockResolvedValue([]) },
      characterBranchState: { findMany: vi.fn().mockResolvedValue([]) },
      runtimeProfile: { findUnique: vi.fn().mockResolvedValue(null), findFirst: vi.fn().mockResolvedValue(null) },
      storyWorkerBinding: { findUnique: vi.fn().mockResolvedValue(null) },
      workerTask: { findUnique: vi.fn().mockResolvedValue(null), findFirst: vi.fn().mockResolvedValue(null) },
      aiProviderConfig: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) }
    })
    const { chapterRoutes } = await import('../../routes/chapters.js')
    const built = createMockApp(mockPrisma)
    await chapterRoutes(built.app)
    routes = built.routes
  })

  it('accepts body with storyId', async () => {
    const result = await callHandler(
      routes, 'POST', '/api/chapters/:chapterId/preview',
      { storyId: 's1' },
      { chapterId: 'c1' }
    )
    // 进入业务分支(可能因为 mock 不全而 500, 但不能 400 — 400 意味着 zod 拒绝)
    expect(result.status).not.toBe(400)
  })

  it('rejects missing storyId with 400', async () => {
    const result = await callHandler(
      routes, 'POST', '/api/chapters/:chapterId/preview',
      {},
      { chapterId: 'c1' }
    )
    expect(result.status).toBe(400)
    expect(result.body).toEqual(
      expect.objectContaining({ success: false, error: expect.stringContaining('storyId') })
    )
  })
})

describe('POST /chapters/:chapterId/generate — GenerateRequestSchema', () => {
  let mockPrisma: any
  let routes: Record<string, any>

  beforeEach(async () => {
    vi.clearAllMocks()
    mockPrisma = createMockPrisma({
      chapter: {
        ...createMockPrisma().chapter,
        findUnique: vi.fn().mockResolvedValue({
          id: 'c1', storyId: 's1', status: 'draft',
          content: '', outline: 'o', title: 't',
          sceneLocation: '', sceneMood: '', sceneGoal: '',
          number: 1, isSideStory: false, story: { id: 's1', title: 'S', description: '' }
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 })  // 锁成功
      },
      draft: { count: vi.fn().mockResolvedValue(0), create: vi.fn().mockResolvedValue({ id: 'd1' }) },
      loreItem: { findMany: vi.fn().mockResolvedValue([]) },
      timelineEvent: { findMany: vi.fn().mockResolvedValue([]) },
      plotArc: { findMany: vi.fn().mockResolvedValue([]) },
      memory: { findMany: vi.fn().mockResolvedValue([]) },
      character: { findMany: vi.fn().mockResolvedValue([]) },
      characterBranchState: { findMany: vi.fn().mockResolvedValue([]) },
      runtimeProfile: { findUnique: vi.fn().mockResolvedValue(null), findFirst: vi.fn().mockResolvedValue(null) },
      storyWorkerBinding: { findUnique: vi.fn().mockResolvedValue(null) },
      workerTask: { findUnique: vi.fn().mockResolvedValue(null), findFirst: vi.fn().mockResolvedValue(null) },
      aiProviderConfig: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) }
    })
    const { chapterRoutes } = await import('../../routes/chapters.js')
    const built = createMockApp(mockPrisma)
    await chapterRoutes(built.app)
    routes = built.routes
  })

  it('accepts empty body (all fields optional — GenerateRequestSchema.storyId 是 optional)', async () => {
    const result = await callHandler(
      routes, 'POST', '/api/chapters/:chapterId/generate',
      {},
      { chapterId: 'c1' }
    )
    expect(result.status).not.toBe(400)
  })

  it('rejects compiledPrompt with missing userMessage (CompilePromptSchema 嵌套校验)', async () => {
    const result = await callHandler(
      routes, 'POST', '/api/chapters/:chapterId/generate',
      { compiledPrompt: { systemMessage: 'sys' } },
      { chapterId: 'c1' }
    )
    expect(result.status).toBe(400)
    expect(result.body).toEqual(
      expect.objectContaining({ success: false, error: expect.stringContaining('userMessage') })
    )
  })
})
```

- [ ] **Step 3: 跑测试,确认 4 个都 FAIL**

```bash
pnpm --filter server test -- chapters-zod-validation
```

预期:8 个测试中,新追加 4 个 FAIL(原 4 个仍 PASS,因为 Task 2 已 wire)。

- [ ] **Step 4: Wire Preview 路由 (chapters.ts:262-265)**

替换:
```ts
  // POST /api/chapters/:chapterId/preview
  app.post('/api/chapters/:chapterId/preview', async (request, reply) => {
    const { chapterId } = request.params as any
    const body = request.body as any
    const storyId = body.storyId
```
改成:
```ts
  // POST /api/chapters/:chapterId/preview
  app.post('/api/chapters/:chapterId/preview', async (request, reply) => {
    const { chapterId } = request.params as any
    const parseResult = PreviewRequestSchema.safeParse(request.body)
    if (!parseResult.success) {
      return reply.status(400).send({
        success: false,
        error: parseResult.error.errors.map(e => `${e.path.join('.') || '<root>'}: ${e.message}`).join('; ')
      })
    }
    const body = parseResult.data
    const storyId = body.storyId
```

- [ ] **Step 5: Wire Generate 路由(chapters.ts:336-343)+ 删除旧的 CompiledPromptSchema.safeParse**

替换:
```ts
  // POST /api/chapters/:chapterId/generate
  app.post('/api/chapters/:chapterId/generate', async (request, reply) => {
    const { chapterId } = request.params as any
    const body = request.body as any
    const storyId = body.storyId
    const candidateCount = body.candidateCount || 3
    const temperatures = body.temperatures || [0.6, 0.75, 0.9]
    const customMaxTokens = body.maxTokens
```
改成:
```ts
  // POST /api/chapters/:chapterId/generate
  app.post('/api/chapters/:chapterId/generate', async (request, reply) => {
    const { chapterId } = request.params as any
    const parseResult = GenerateRequestSchema.safeParse(request.body)
    if (!parseResult.success) {
      return reply.status(400).send({
        success: false,
        error: parseResult.error.errors.map(e => `${e.path.join('.') || '<root>'}: ${e.message}`).join('; ')
      })
    }
    const body = parseResult.data
    const storyId = body.storyId
    const candidateCount = body.candidateCount || 3
    const temperatures = body.temperatures || [0.6, 0.75, 0.9]
    const customMaxTokens = body.maxTokens
```

**精简** chapters.ts:415-434 的 `if (customCompiled)` 块:GenerateRequestSchema 已嵌套校验 compiledPrompt,再 safeParse 一次是冗余。但**保留** token 计算(`countTokens` 调用 + `compiled` 赋值) — 这部分业务逻辑下游会用到。

把:

```ts
    let compiled: any
    let layers: any[] = []
    const customCompiled = body.compiledPrompt

    if (customCompiled) {
      const parsed = CompiledPromptSchema.safeParse(customCompiled)
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: 'compiledPrompt 格式错误',
          details: parsed.error.flatten()
        })
      }
      const systemTokens = countTokens(parsed.data.systemMessage)
      const userTokens = countTokens(parsed.data.userMessage)
      compiled = {
        systemMessage: parsed.data.systemMessage,
        userMessage: parsed.data.userMessage,
        meta: { systemTokens, userTokens, totalTokens: systemTokens + userTokens }
      }
    } else {
```

改成:

```ts
    let compiled: any
    let layers: any[] = []
    const customCompiled = body.compiledPrompt

    if (customCompiled) {
      // GenerateRequestSchema 已嵌套校验 CompiledPromptSchema,
      // 此处 schema 一定 valid,直接用 customCompiled。
      const systemTokens = countTokens(customCompiled.systemMessage)
      const userTokens = countTokens(customCompiled.userMessage)
      compiled = {
        systemMessage: customCompiled.systemMessage,
        userMessage: customCompiled.userMessage,
        meta: { systemTokens, userTokens, totalTokens: systemTokens + userTokens }
      }
    } else {
```

为什么保留 token 计算:`compiled.meta` 在下游(line 478-480 附近)用于返回 `data.tokens`,前端 `useDraftManager.ts` 会读这个 token 数做 UI 反馈。删掉会破现有返回 shape。

为什么删 manual safeParse 不会再触发 `'compiledPrompt 格式错误'` 字符串:GenerateRequestSchema 已在 wire 处失败,customCompiled 一定 undefined 或已 valid。`generate-compiledPrompt.test.ts:170` 的 `expect(body).not.toContain('compiledPrompt 格式错误')` 仍 PASS(只有无效 compiledPrompt 才进入 safeParse 失败,那条 string 已不再被任何代码产出)。

- [ ] **Step 6: 在 chapters.ts imports 加 PreviewRequestSchema + GenerateRequestSchema**

继续按 Task 2 Step 5 留下的 imports 块,追加:

```ts
import {
  CompiledPromptSchema,
  CreateChapterRequestSchema,
  UpdateChapterRequestSchema,
  PreviewRequestSchema,
  GenerateRequestSchema
} from '@novel-runtime/shared'
```

⚠️ 如果发现 `CompiledPromptSchema` 没有别处用(删 manual safeParse 后可能无人 import),从 imports 删掉它。跑 typecheck 验证。

- [ ] **Step 7: 跑 chapters-zod-validation 测试,确认 8/8 PASS**

```bash
pnpm --filter server test -- chapters-zod-validation
```

预期:8/8 PASS。

- [ ] **Step 8: 跑 server 全测,确认无 regression(尤其 generate-compiledPrompt)**

```bash
pnpm --filter server test
```

预期:全绿。如果 `generate-compiledPrompt.test.ts` 失败(因为删了 manual safeParse 但它仍断言「response 不含 'compiledPrompt 格式错误'」),说明删 manual 是安全的 — 测试用 `stringContaining('compiledPrompt')` 错误信息仍会触发,因为新的 zod 错误信息会包含「compiledPrompt」字样。检查实际失败信息,微调即可。

- [ ] **Step 9: typecheck**

```bash
pnpm typecheck
```

预期:8/8 Done。

- [ ] **Step 10: Commit**

```bash
git status   # 应该只有 chapters.ts + chapters-zod-validation.test.ts
git add apps/server/src/routes/chapters.ts apps/server/src/__tests__/routes/chapters-zod-validation.test.ts
git commit -m "feat(server): wire Preview + Generate routes with zod validation (P2b Task 3)

- POST /api/chapters/:chapterId/preview → PreviewRequestSchema(storyId 必填)
- POST /api/chapters/:chapterId/generate → GenerateRequestSchema(全部字段 optional,
  嵌套 CompiledPromptSchema 仍生效)
删除 generate 路由手动的 CompiledPromptSchema.safeParse — GenerateRequestSchema
已覆盖,避免重复校验.
沿用 stories.ts:35-37 safeParse pattern.
成功路径与原行为 100% 一致. 加 4 个路由级 happy/negative 测试."
```

---

## Task 4: Wire POST /api/chapters/:chapterId/select + POST /api/chapters/:chapterId/develop — 状态流 + develop

**Files:**
- Modify: `apps/server/src/routes/chapters.ts:505-507`(POST select)
- Modify: `apps/server/src/routes/chapters.ts:776-779`(POST develop)
- Test: `apps/server/src/__tests__/routes/chapters-zod-validation.test.ts`(追加 4 测试)

- [ ] **Step 1: 在 chapters-zod-validation.test.ts 追加 4 个失败测试**

```ts
describe('POST /chapters/:chapterId/select — SelectDraftRequestSchema', () => {
  let mockPrisma: any
  let routes: Record<string, any>

  beforeEach(async () => {
    vi.clearAllMocks()
    mockPrisma = createMockPrisma({
      chapter: {
        ...createMockPrisma().chapter,
        findUnique: vi.fn().mockResolvedValue({ id: 'c1', status: 'generated' })
      },
      draft: {
        ...createMockPrisma().draft,
        findUnique: vi.fn().mockResolvedValue({ id: 'd1', chapterId: 'c1', content: 'c' }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        update: vi.fn().mockResolvedValue({ id: 'd1', status: 'selected' })
      },
      $transaction: vi.fn(async (fn: any) => fn(mockPrisma))
    })
    const { chapterRoutes } = await import('../../routes/chapters.js')
    const built = createMockApp(mockPrisma)
    await chapterRoutes(built.app)
    routes = built.routes
  })

  it('accepts body with draftId', async () => {
    const result = await callHandler(
      routes, 'POST', '/api/chapters/:chapterId/select',
      { draftId: 'd1' },
      { chapterId: 'c1' }
    )
    expect(result.status).not.toBe(400)
    expect(result.body).toEqual(expect.objectContaining({ success: true }))
  })

  it('rejects missing draftId with 400', async () => {
    const result = await callHandler(
      routes, 'POST', '/api/chapters/:chapterId/select',
      {},
      { chapterId: 'c1' }
    )
    expect(result.status).toBe(400)
    expect(result.body).toEqual(
      expect.objectContaining({ success: false, error: expect.stringContaining('draftId') })
    )
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
  })
})

describe('POST /chapters/:chapterId/develop — DevelopRequestSchema', () => {
  let mockPrisma: any
  let routes: Record<string, any>

  beforeEach(async () => {
    vi.clearAllMocks()
    mockPrisma = createMockPrisma({
      chapter: {
        ...createMockPrisma().chapter,
        findUnique: vi.fn().mockResolvedValue({
          id: 'c1', storyId: 's1', status: 'archived', number: 1, isSideStory: false,
          story: { id: 's1', runtimeProfileId: null }
        }),
        findFirst: vi.fn().mockResolvedValue(null),
        count: vi.fn().mockResolvedValue(0),       // 无子章节
        create: vi.fn().mockResolvedValue({ id: 'c2', number: 2 })
      }
    })
    const { chapterRoutes } = await import('../../routes/chapters.js')
    const built = createMockApp(mockPrisma)
    await chapterRoutes(built.app)
    routes = built.routes
  })

  it('accepts empty body (all fields optional)', async () => {
    const result = await callHandler(
      routes, 'POST', '/api/chapters/:chapterId/develop',
      {},
      { chapterId: 'c1' }
    )
    expect(result.status).not.toBe(400)
    expect(result.body).toEqual(expect.objectContaining({ success: true }))
  })

  it('rejects wrong type (number must be number, not string)', async () => {
    const result = await callHandler(
      routes, 'POST', '/api/chapters/:chapterId/develop',
      { number: 'not-a-number' },
      { chapterId: 'c1' }
    )
    expect(result.status).toBe(400)
    expect(result.body).toEqual(
      expect.objectContaining({ success: false, error: expect.stringContaining('number') })
    )
    expect(mockPrisma.chapter.create).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 跑测试,确认 4 个新测试 FAIL**

```bash
pnpm --filter server test -- chapters-zod-validation
```

预期:12 个测试中,新 4 个 FAIL,原 8 个 PASS。

- [ ] **Step 3: Wire Select 路由(chapters.ts:505-509)**

替换:
```ts
  // POST /api/chapters/:chapterId/select
  app.post('/api/chapters/:chapterId/select', async (request, reply) => {
    const { chapterId } = request.params as any
    const body = request.body as any

    const chapter = await app.prisma.chapter.findUnique({ where: { id: chapterId } })
```
改成:
```ts
  // POST /api/chapters/:chapterId/select
  app.post('/api/chapters/:chapterId/select', async (request, reply) => {
    const { chapterId } = request.params as any
    const parseResult = SelectDraftRequestSchema.safeParse(request.body)
    if (!parseResult.success) {
      return reply.status(400).send({
        success: false,
        error: parseResult.error.errors.map(e => `${e.path.join('.') || '<root>'}: ${e.message}`).join('; ')
      })
    }
    const body = parseResult.data

    const chapter = await app.prisma.chapter.findUnique({ where: { id: chapterId } })
```

- [ ] **Step 4: Wire Develop 路由(chapters.ts:776-781)**

替换:
```ts
  // POST /api/chapters/:chapterId/develop
  app.post('/api/chapters/:chapterId/develop', async (request, reply) => {
    const { chapterId } = request.params as any
    const body = request.body as any
    const prisma = app.prisma

    const parentChapter = await prisma.chapter.findUnique({
```
改成:
```ts
  // POST /api/chapters/:chapterId/develop
  app.post('/api/chapters/:chapterId/develop', async (request, reply) => {
    const { chapterId } = request.params as any
    const parseResult = DevelopRequestSchema.safeParse(request.body)
    if (!parseResult.success) {
      return reply.status(400).send({
        success: false,
        error: parseResult.error.errors.map(e => `${e.path.join('.') || '<root>'}: ${e.message}`).join('; ')
      })
    }
    const body = parseResult.data
    const prisma = app.prisma

    const parentChapter = await prisma.chapter.findUnique({
```

- [ ] **Step 5: 在 chapters.ts imports 加 SelectDraftRequestSchema + DevelopRequestSchema**

继续追加到 imports 块:

```ts
import {
  CompiledPromptSchema,
  CreateChapterRequestSchema,
  UpdateChapterRequestSchema,
  PreviewRequestSchema,
  GenerateRequestSchema,
  SelectDraftRequestSchema,
  DevelopRequestSchema
} from '@novel-runtime/shared'
```

(Task 5 还会继续加 PrepareArchiveRequestSchema。)

- [ ] **Step 6: 跑 chapters-zod-validation 测试,确认 12/12 PASS**

```bash
pnpm --filter server test -- chapters-zod-validation
```

预期:12/12 PASS。

- [ ] **Step 7: 跑 server 全测,确认无 regression**

```bash
pnpm --filter server test
```

预期:115+ → 119+(10 个 CRUD/generate/select/develop zod 测试)+ 现存测试全绿。

- [ ] **Step 8: typecheck**

```bash
pnpm typecheck
```

预期:8/8 Done。

- [ ] **Step 9: Commit**

```bash
git status
git add apps/server/src/routes/chapters.ts apps/server/src/__tests__/routes/chapters-zod-validation.test.ts
git commit -m "feat(server): wire Select + Develop routes with zod validation (P2b Task 4)

- POST /api/chapters/:chapterId/select → SelectDraftRequestSchema(draftId 必填)
- POST /api/chapters/:chapterId/develop → DevelopRequestSchema(全 optional)
成功路径与原行为一致. 加 4 个路由级 happy/negative 测试."
```

---

## Task 5: Wire POST /api/chapters/:chapterId/prepare-archive — 空 strict body

**Files:**
- Modify: `apps/server/src/routes/chapters.ts:553-555`(POST prepare-archive)
- Test: `apps/server/src/__tests__/routes/chapters-zod-validation.test.ts`(追加 2 测试)

**Why separate:** prepare-archive 用 `z.object({}).strict()`(空对象 + 拒绝任意额外字段),语义与其他 5 个 endpoint 都不同。前端从不发 body,后端用 empty strict 起到「明确不接受任何客户端输入」的契约作用。单独立 commit 让 schema 意图清晰。

- [ ] **Step 1: 在 chapters-zod-validation.test.ts 追加 2 个失败测试**

```ts
describe('POST /chapters/:chapterId/prepare-archive — PrepareArchiveRequestSchema (empty strict)', () => {
  // 复用 prepare-archive.test.ts 的 mock 模式:mock combined-extractor + memory-optimizer + graph-snapshot
  vi.mock('../../services/combined-extractor.js', () => ({
    prepareArchiveData: vi.fn(),
    extractAll: vi.fn()
  }))
  vi.mock('../../services/memory-optimizer.js', () => ({
    optimizeMemories: vi.fn().mockResolvedValue(0)
  }))
  vi.mock('../../services/graph-snapshot.js', () => ({
    saveGraphSnapshotAndDelta: vi.fn().mockResolvedValue({
      snapshot: { nodes: [], edges: [], timestamp: '' },
      delta: { nodes: [], edges: [], timestamp: '' }
    })
  }))

  let mockPrisma: any
  let routes: Record<string, any>

  beforeEach(async () => {
    vi.clearAllMocks()
    mockPrisma = createMockPrisma({
      chapter: {
        ...createMockPrisma().chapter,
        findUnique: vi.fn().mockResolvedValue({
          id: 'c1', storyId: 's1', status: 'selected',
          isSideStory: false, content: 'a'.repeat(200), outline: 'o',
          number: 1, parentChapterId: null,
          story: { id: 's1' }
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        update: vi.fn().mockResolvedValue({ id: 'c1', status: 'reviewing' })
      }
    })
    const { prepareArchiveData } = await import('../../services/combined-extractor.js')
    ;(prepareArchiveData as any).mockResolvedValue({
      memories: { memories: [], characterStates: [], timelineEvents: [], summary: null },
      graph: {
        mergedGraph: { nodes: [], edges: [], timestamp: '2026-06-18T00:00:00.000Z' },
        chapterGraph: { nodes: [], edges: [], timestamp: '2026-06-18T00:00:00.000Z' }
      },
      plotArcs: [],
      meta: { extractedAt: '2026-06-18T00:00:00.000Z', chapterNumber: 1 }
    })
    const { chapterRoutes } = await import('../../routes/chapters.js')
    const built = createMockApp(mockPrisma)
    await chapterRoutes(built.app)
    routes = built.routes
  })

  it('accepts empty body (no client input expected)', async () => {
    const result = await callHandler(
      routes, 'POST', '/api/chapters/:chapterId/prepare-archive',
      {},
      { chapterId: 'c1' }
    )
    expect(result.status).not.toBe(400)
  })

  it('rejects body with unrecognized keys (strict mode)', async () => {
    const result = await callHandler(
      routes, 'POST', '/api/chapters/:chapterId/prepare-archive',
      { someField: 'unexpected' },
      { chapterId: 'c1' }
    )
    expect(result.status).toBe(400)
    expect(result.body).toEqual(
      expect.objectContaining({ success: false, error: expect.stringContaining('someField') })
    )
  })
})
```

- [ ] **Step 2: 跑测试,确认 2 个新测试 FAIL**

```bash
pnpm --filter server test -- chapters-zod-validation
```

预期:14 个测试,新 2 个 FAIL。

- [ ] **Step 3: Wire PrepareArchive 路由(chapters.ts:553-557)**

替换:
```ts
  // POST /api/chapters/:chapterId/prepare-archive
  app.post('/api/chapters/:chapterId/prepare-archive', async (request, reply) => {
    const { chapterId } = request.params as any
    const prisma = app.prisma
```
改成:
```ts
  // POST /api/chapters/:chapterId/prepare-archive
  app.post('/api/chapters/:chapterId/prepare-archive', async (request, reply) => {
    const { chapterId } = request.params as any
    const parseResult = PrepareArchiveRequestSchema.safeParse(request.body)
    if (!parseResult.success) {
      return reply.status(400).send({
        success: false,
        error: parseResult.error.errors.map(e => `${e.path.join('.') || '<root>'}: ${e.message}`).join('; ')
      })
    }
    const prisma = app.prisma
```

- [ ] **Step 4: 在 chapters.ts imports 加 PrepareArchiveRequestSchema**

```ts
import {
  CompiledPromptSchema,
  CreateChapterRequestSchema,
  UpdateChapterRequestSchema,
  PreviewRequestSchema,
  GenerateRequestSchema,
  SelectDraftRequestSchema,
  DevelopRequestSchema,
  PrepareArchiveRequestSchema
} from '@novel-runtime/shared'
```

⚠️ 此时 `CompiledPromptSchema` 可能已无其他 import(因为 Task 3 删了 manual safeParse),typecheck 会报 unused import。**如果有**,从 imports 删掉它。

- [ ] **Step 5: 跑 chapters-zod-validation 测试,确认 14/14 PASS**

```bash
pnpm --filter server test -- chapters-zod-validation
```

预期:14/14 PASS。

- [ ] **Step 6: 跑 server 全测,确认无 regression(尤其 prepare-archive.test.ts)**

```bash
pnpm --filter server test
```

预期:全绿。`prepare-archive.test.ts` 现有测试都传 `undefined` body(callHandler 默认 `{}`),`z.object({}).strict()` 允许空对象,应该不破。

- [ ] **Step 7: typecheck**

```bash
pnpm typecheck
```

预期:8/8 Done。

- [ ] **Step 8: 最终核对 — 6 endpoint 全部 wire 完毕**

```bash
grep -n "safeParse.*RequestSchema\|safeParse(request.body" apps/server/src/routes/chapters.ts
```

预期输出应该有 6 处 `safeParse` 调用(CreateChapter / UpdateChapter / PreviewRequest / GenerateRequest / SelectDraft / DevelopRequest / PrepareArchive — 注意 grep 的 OR 模式可能匹配 6 行)。

- [ ] **Step 9: Commit**

```bash
git status
git add apps/server/src/routes/chapters.ts apps/server/src/__tests__/routes/chapters-zod-validation.test.ts
git commit -m "feat(server): wire prepare-archive route with zod empty strict schema (P2b Task 5)

POST /api/chapters/:chapterId/prepare-archive → PrepareArchiveRequestSchema(z.object({}).strict()).
明确不接受任何客户端输入:空对象 OK,带任意字段 → 400 + zod 错误.
前端 axios 现有调用本来发 {} (apps/web/src/api/chapters.ts:40),不破.
最终 chapters.ts 6/12 endpoint zod-validated. 加 2 个路由级 happy/negative 测试."
```

---

## Self-Review

### 1. Spec coverage

| spec 条款 | 覆盖位置 |
|---|---|
| 12 endpoint 用 `.parse()` 接入 | Task 2/3/4/5 覆盖 6 个有 body 的 endpoint(spec 第 178 行)— 其余 6 个 GET/DELETE/no-body 不需 wire |
| 统一 `ZodError → 400 + 字段级错误` | 每处 safeParse 失败都用 `parseResult.error.errors.map(e => '${e.path.join('.') \|\| '<root>'}: ${e.message}').join('; ')`,响应 shape `{success: false, error: string}`(带 path 前缀,优于 stories.ts 的裸 message,支持嵌套字段如 compiledPrompt.userMessage) |
| 错误响应 shape 统一 | 所有 6 处用同一模板,前端 axios `.data.error` 直接拿到 |
| 不动 web 端 / composables | 0 改动 apps/web;web/api/chapters.ts 类型保留 `data: any` 不变(spec 第 184 行) |
| 不动 prisma schema / DB 字段 / 状态机 | 0 改动 prisma / 业务逻辑 / 状态机切换 |
| 加 1-2 测试文件 | 1 文件:`chapters-zod-validation.test.ts`(共 14 测试 + P2a 阶段无新增 shared 测试) |
| 每 schema 至少 1 happy + 1 negative | 7 schema(Create / Update / Preview / Generate / Select / Develop / PrepareArchive),每 schema 2 测试 = 14 测试 |
| 现有 115+ 测试不破 | Task 1 fixup 是为了不破;Task 2/3/4/5 每步都跑 server 全测验证 |

### 2. Placeholder scan

无 "TBD" / "TODO" / "待补"。每个 step 都有完整代码或命令。

### 3. Type consistency

- Schema 命名:`CreateChapterRequestSchema` / `UpdateChapterRequestSchema` / `PreviewRequestSchema` / `GenerateRequestSchema` / `SelectDraftRequestSchema` / `DevelopRequestSchema` / `PrepareArchiveRequestSchema` — 全部与 P2a 落地命名一致(grep 验证过 `packages/shared/src/index.ts`)
- route 文件:`apps/server/src/routes/chapters.ts` 全路径一致,行号引用(chapters.ts:71-99 等)在 plan 中对齐 actual 文件
- 错误响应 shape:`{success: false, error: string}` — 与 stories.ts:37 + 现有 route handler 已有 400 错误一致

### 4. Scope check

- 5 commit 落在 spec 第 184 行建议的「1-2 commit per route group(2-4 总)」区间(略多 1 commit 是 fixup)
- 不超 spec 容量,每 task 独立可回退
- 不含 P3(拆 route 文件)、P4(拆 Chapters.vue)、P5(Graph.vue)内容

### 5. Ambiguity check

- "实施 P2a fixup" 决策(Task 1)理由明确:3 个现有 server 测试破 → 必做
- "删除 generate 路由 manual safeParse"(Task 3 Step 5)理由明确:GenerateRequestSchema 已嵌套校验,留 manual 是冗余
- "inline 6 处 safeParse 不抽 helper" 决策理由明确:P3 拆 route 时再抽,避免 P2b 范围漂移
- 测试 mock 复用 `prepare-archive.test.ts` 既有 vi.mock 模式,无新 mock 基础设施

### 6. 与既有 spec 关系

- 不冲突 decoupling-roadmap P2b(本 phase 范围)
- 不冲突 P2a(本 plan 修复 P2a 的 1 处 schema shape bug,严格说算 P2a 范围但放在 P2b 实施时一并修,commit message 明确说明)
- 不破 ISSUES.md 库选型守门(0 新库,沿用 zod + vitest + @novel-runtime/shared)
- 不破 AGENTS.md / CLAUDE.md 既有约定(响应一律中文 / commit 前 status / 不动 prisma / 不动 API contract)

---

## 实施完毕后总结(给用户)

完成后应提交 5 commit:

```
<fixup>  fix(shared): make GenerateRequestSchema.storyId optional         [Task 1]
<crud>   feat(server): wire CreateChapter + UpdateChapter routes          [Task 2]
<gen>    feat(server): wire Preview + Generate routes                     [Task 3]
<state>  feat(server): wire Select + Develop routes                       [Task 4]
<arch>   feat(server): wire prepare-archive route                         [Task 5]
```

加 1 个新测试文件 `apps/server/src/__tests__/routes/chapters-zod-validation.test.ts`(14 个测试),2 个文件改动(`packages/shared/src/chapter.ts` + `packages/shared/src/__tests__/schemas.test.ts`)。

chapters.ts 12 endpoint 现状:

- 6/12 zod-validated(CUD + generate 流 + state 流)
- 6/12 无 body(GET list / GET one / DELETE / POST archive / GET chapter-tree)— 保持不动(spec 强调"不动 API contract")

下一步 → P3(871 行 chapters.ts 按职责拆 4 route 文件),用户审完 P2b 再开始。

---

## 准备执行前的最后核对清单

- [ ] 5 commit 全部完成
- [ ] `pnpm typecheck` 8/8 Done
- [ ] `pnpm --filter shared test` 25+2 = 27/27 PASS
- [ ] `pnpm --filter server test` 115+14 = 129+/129+ PASS
- [ ] `pnpm --filter ai-provider test` 5/5 PASS
- [ ] grep `safeParse.*RequestSchema` chapters.ts 应有 7 处(Create / Update / Preview / Generate / Select / Develop / PrepareArchive — 注意 grep 模式可能匹配 6 行,因 Create + Update 都用 Schema.suffix)
- [ ] `git log --oneline -5` 5 个新 commit 按顺序排列
- [ ] `git status` 干净(working tree 无未提交改动)