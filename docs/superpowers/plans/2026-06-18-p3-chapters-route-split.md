# P3 chapters.ts 拆 route 实施 Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `apps/server/src/routes/chapters.ts`(932 行 / 12 endpoint)按职责拆为 4 个新子 route 文件 + 1 个 `_helpers.ts` + 1 个 barrel,API contract 不变,9 个测试文件 0 改动,1 个 commit 完成迁移。

**Architecture:** 5 个 subagent task(Task 1 创建 helpers / Task 2-5 各拆 1 个子 route / Task 6 把 chapters.ts 改成 barrel + 单 commit)。每 subagent 完成后 `git add` 但**不 commit**,Task 6 是唯一 commit 任务,保证原子迁移(避免中间状态破坏 barrel)。

**Tech Stack:** Fastify 路由注册 + zod (已装) + Vitest (已装)。0 新库。

---

## 重要约定

### 引用源

- Spec: `docs/superpowers/specs/2026-06-18-p3-chapters-route-split.md`(已 commit 在 `3275494`)
- 当前 chapters.ts 932 行,以本次任务启动时的 `git HEAD` 为准
- 9 个测试文件 17 处 `import chapterRoutes` 全部不动

### 单 commit 约束

- Task 1-5 subagent 只跑 typecheck + tests,**不 commit**(用 `git add` 暂存)
- Task 6 是唯一 commit 任务,把暂存 + 新文件 + barrel 一次性提交

### helper 替换规则(贯穿 Task 2-5)

每次移动 endpoint 代码时,做 3 类替换:

**(a) safeParse 替换为 parseBody**

Before(11 行):
```ts
const parseResult = XxxRequestSchema.safeParse(request.body)
if (!parseResult.success) {
  return reply.status(400).send({
    success: false,
    error: parseResult.error.errors.map(e => `${e.path.join('.') || '<root>'}: ${e.message}`).join('; ')
  })
}
const body = parseResult.data
```

After(3 行):
```ts
const body = parseBody(XxxRequestSchema, request, reply)
if (body === null) return
```

**(b) `findUnique + 404` 替换为 getOrThrowChapter**

Before(4 行):
```ts
const chapter = await prisma.chapter.findUnique({ where: { id: chapterId } })
if (!chapter) return reply.status(404).send({ success: false, error: 'Chapter not found' })
```

After(2 行):
```ts
const chapter = await getOrThrowChapter(prisma, chapterId, reply)
if (chapter === null) return
```

注意:`findUnique` 带 `include` 时,直接把 include 透传给 getOrThrowChapter 调用方。

**(c) getLastChapter 调用**

Before(在 chapters.ts 闭包内,直接调用):
```ts
const lastChapter = await getLastChapter(prisma, chapter.storyId)
```

After(import 后调用,签名不变):
```ts
import { getLastChapter } from './_helpers.js'
// ...
const lastChapter = await getLastChapter(prisma, chapter.storyId)
```

### `app.prisma` vs `prisma`

子 route 文件内统一使用 `const prisma = app.prisma`(模仿 archive 端点风格),不直接散落 `app.prisma.xxx`。这是 chapters.ts 既有的局部变量约定,迁移时保持。

---

### Task 1: 创建 `_helpers.ts`(3 helper + 类型签名)

**Files:**
- Create: `apps/server/src/routes/_helpers.ts`

- [ ] **Step 1: 写入 _helpers.ts 全部内容**

```ts
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { ZodSchema } from 'zod'

/**
 * 安全解析 request.body。
 * - 成功:返回 parseResult.data
 * - 失败:reply.status(400).send({ success: false, error: ... }) 后返回 null
 *
 * 调用方模式:
 *   const body = parseBody(XxxRequestSchema, request, reply)
 *   if (body === null) return
 *
 * 错误格式 byte-identical 到 P2b inline 格式(path-prefixed, '; ' join)。
 */
export function parseBody<T>(
  schema: ZodSchema<T>,
  request: FastifyRequest,
  reply: FastifyReply
): T | null {
  const result = schema.safeParse(request.body)
  if (!result.success) {
    reply.status(400).send({
      success: false,
      error: result.error.errors
        .map(e => `${e.path.join('.') || '<root>'}: ${e.message}`)
        .join('; ')
    })
    return null
  }
  return result.data
}

/**
 * 用 chapterId 取 chapter,不存在则 404 + 返回 null。
 *
 * 调用方模式:
 *   const chapter = await getOrThrowChapter(prisma, chapterId, reply)
 *   if (chapter === null) return
 */
export async function getOrThrowChapter(
  prisma: any,
  chapterId: string,
  reply: FastifyReply
): Promise<any | null> {
  const chapter = await prisma.chapter.findUnique({ where: { id: chapterId } })
  if (!chapter) {
    reply.status(404).send({ success: false, error: 'Chapter not found' })
    return null
  }
  return chapter
}

/**
 * 故事下 number 最大的章节(主+番外)。
 * 跨 3 子 route 文件复用:chapters-crud.ts (DELETE + develop) / chapters-generate.ts (preview)。
 */
export async function getLastChapter(prisma: any, storyId: string): Promise<any | null> {
  return prisma.chapter.findFirst({
    where: { storyId },
    orderBy: { number: 'desc' }
  })
}
```

- [ ] **Step 2: 验证 typecheck 通过**

Run:
```bash
pnpm --filter server typecheck
```

Expected:`apps/server typecheck: Done`(exit 0)。_helpers.ts 还没被任何文件 import,纯签名验证。

- [ ] **Step 3: git add(staged,不 commit)**

```bash
git add apps/server/src/routes/_helpers.ts
git status --short
```

Expected:看到 `A  apps/server/src/routes/_helpers.ts`。其他文件不出现。

---

### Task 2: 拆 `chapters-tree.ts`(1 endpoint,无 helper)

**Files:**
- Create: `apps/server/src/routes/chapters-tree.ts`
- Modify: `apps/server/src/routes/chapters.ts`(line 1-30 imports 不动 / line 30-932 中,删除 chapter-tree endpoint 的代码块,加 import + register)

- [ ] **Step 1: 创建 chapters-tree.ts**

```ts
import type { FastifyInstance } from 'fastify'

/**
 * GET /api/stories/:storyId/chapter-tree — 树形章节列表。
 * 数据来源:Prisma Chapter.findMany({ include: runtimeProfile }) + 内存 build。
 */
export async function chapterTreeRoutes(app: FastifyInstance) {
  app.get('/api/stories/:storyId/chapter-tree', async (request, reply) => {
    const { storyId } = request.params as any
    const prisma = app.prisma

    const allChapters = await prisma.chapter.findMany({
      where: { storyId },
      orderBy: { createdAt: 'asc' },
      include: { runtimeProfile: { select: { name: true } } }
    })

    const chapterMap = new Map(allChapters.map(c => [c.id, { ...c, children: [] as any[] }]))
    const roots: any[] = []

    for (const ch of allChapters) {
      const node = chapterMap.get(ch.id)!
      if (ch.parentChapterId && chapterMap.has(ch.parentChapterId)) {
        chapterMap.get(ch.parentChapterId)!.children.push(node)
      } else {
        roots.push(node)
      }
    }

    return { success: true, data: roots }
  })
}
```

注意:从 chapters.ts line 908-931 **逐字复制**(保留所有中文注释外的逻辑)。

- [ ] **Step 2: 修改 chapters.ts:加 import + register,删除 inline endpoint**

在 chapters.ts line 30 `export async function chapterRoutes(app: FastifyInstance) {` 之后立即插入:

```ts
  await app.register(chapterTreeRoutes)
```

并在文件顶部(在 line 1 `import type { FastifyInstance } from 'fastify'` 之后或附近分组)添加:

```ts
import { chapterTreeRoutes } from './chapters-tree.js'
```

然后删除 chapters.ts line 907-931(`// GET /api/stories/:storyId/chapter-tree` 注释 + 整个 endpoint handler + 它前面的空行)。

- [ ] **Step 3: 验证 typecheck + 所有测试通过**

Run:
```bash
pnpm typecheck
pnpm --filter server test
```

Expected:
- `apps/server typecheck: Done`
- `Test Files 22 passed` + `Tests 129 passed`

特别检查:`__tests__/routes/chapters-zod-validation.test.ts` 14 个测试 + 所有 chapter route 测试仍 PASS(barrel 已 register chapters-tree.ts)。

- [ ] **Step 4: git add(staged,不 commit)**

```bash
git add apps/server/src/routes/chapters-tree.ts apps/server/src/routes/chapters.ts
git status --short
```

Expected:`A  apps/server/src/routes/chapters.ts` + `A  apps/server/src/routes/chapters-tree.ts`。

---

### Task 3: 拆 `chapters-archive.ts`(2 endpoint,1 parseBody + 2 getOrThrowChapter)

**Files:**
- Create: `apps/server/src/routes/chapters-archive.ts`
- Modify: `apps/server/src/routes/chapters.ts`(加 import + register,删除 2 endpoint)

- [ ] **Step 1: 创建 chapters-archive.ts**

```ts
import type { FastifyInstance } from 'fastify'
import { extractAll, prepareArchiveData, type PendingArchiveData } from '../services/combined-extractor.js'
import { optimizeMemories } from '../services/memory-optimizer.js'
import { getActivePlotArcs, preparePlotArcWrites, commitPlotArcWrites } from '../services/plot-extractor.js'
import { saveGraphSnapshotAndDelta, type GraphSnapshot } from '../services/graph-snapshot.js'
import { organizeGraph } from '../services/graph-organizer.js'
import { prepareMemoryWrites, commitMemoryWrites } from '../services/memory-extractor.js'
import { PrepareArchiveRequestSchema } from '@novel-runtime/shared'
import { parseBody, getOrThrowChapter } from './_helpers.js'

/**
 * Archive 流:Phase 1-2 (prepare-archive) + Phase 3-4 (archive confirm)。
 * 详见 routes/chapters.ts 注释或 docs/Process.md「Archive Pipeline」。
 */
export async function chapterArchiveRoutes(app: FastifyInstance) {
  // POST /api/chapters/:chapterId/prepare-archive
  app.post('/api/chapters/:chapterId/prepare-archive', async (request, reply) => {
    const { chapterId } = request.params as any
    const body = parseBody(PrepareArchiveRequestSchema, request, reply)
    if (body === null) return

    const prisma = app.prisma

    const chapter = await getOrThrowChapter(prisma, chapterId, reply)
    if (chapter === null) return

    // 检查章节状态必须是 selected / reviewing / archived 才能准备归档
    // [完整逻辑从 chapters.ts:616-714 复制]
    // ...(省略与 generate-flow 无关的中间 AI 调用代码,逐字复制)
    // 此处复用既有 generateFallbackContent / DEFAULT_PIPELINE_BUDGET / scaleBudget / safeJsonParse
    // import 在子文件内已有,不需要从 chapters.ts 继承

    return reply.send({ success: true, data: { /* ... */ } })
  })

  // POST /api/chapters/:chapterId/archive
  app.post('/api/chapters/:chapterId/archive', async (request, reply) => {
    const { chapterId } = request.params as any
    const prisma = app.prisma

    const chapter = await getOrThrowChapter(prisma, chapterId, reply)
    if (chapter === null) return

    // [完整逻辑从 chapters.ts:725-828 复制,包括 prisma.$transaction + optimizeMemories 调用]
    // ...(省略中间步骤)
    return reply.send({ success: true, data: { /* ... */ } })
  })
}
```

注:上面是骨架,**实际写入前必须从 `apps/server/src/routes/chapters.ts` line 600-715 和 716-828 完整复制两段 endpoint 代码**,逐字保留。复制后做以下替换:
- 把两处 inline safeParse(PrepareArchiveRequestSchema)替换为 parseBody
- 把 2 处 `findUnique + 404` 替换为 getOrThrowChapter
- 保持其它逻辑(prisma.transaction / optimizeMemories / organizeGraph 等)不变

**完整代码填充指引:**
- 在 chapters-archive.ts 中,逐字复制 chapters.ts line 600-715 的 prepare-archive handler body(替换 schema.parse 与 findUnique 404 部分)
- 同样复制 chapters.ts line 716-828 的 archive handler body(替换 findUnique 404 部分)

- [ ] **Step 2: 修改 chapters.ts:加 import + register,删除 inline endpoints**

在 chapters.ts:
- 文件顶部 import block 加 `import { chapterArchiveRoutes } from './chapters-archive.js'`
- 在 `chapterRoutes(app)` 函数顶部加 `await app.register(chapterArchiveRoutes)`
- 删除 chapters.ts line 599-828(`// POST /api/chapters/:chapterId/prepare-archive` 注释起,到 archive endpoint 的 `})` 结束 + 后面的空行)

- [ ] **Step 3: 验证 typecheck + tests**

Run:
```bash
pnpm typecheck
pnpm --filter server test
```

Expected:同上,22 files / 129 tests PASS。特别检查 `prepare-archive.test.ts` 与 `chapters-zod-validation.test.ts` 中 prepare-archive 描述块。

- [ ] **Step 4: git add**

```bash
git add apps/server/src/routes/chapters-archive.ts apps/server/src/routes/chapters.ts
```

---

### Task 4: 拆 `chapters-generate.ts`(3 endpoint,3 parseBody + 3 getOrThrowChapter + 1 getLastChapter + 1 inner helper)

**Files:**
- Create: `apps/server/src/routes/chapters-generate.ts`
- Modify: `apps/server/src/routes/chapters.ts`(加 import + register,删除 3 endpoint)

- [ ] **Step 1: 创建 chapters-generate.ts**

```ts
import type { FastifyInstance } from 'fastify'
import { generateQueue } from '../queue/index.js'
import { PromptPipeline } from '@novel-runtime/prompt-runtime'
import { MemoryManager } from '@novel-runtime/memory-engine'
import { RuntimePromptCompiler, countTokens } from '@novel-runtime/ai-provider'
import { callAIWithLog } from '../services/ai-call-logger.js'
import { loadRuntimeBase, loadWorkerTask } from '../services/runtime-loader.js'
import { getActivePlotArcs } from '../services/plot-extractor.js'
import {
  formatCharacterSnapshot,
  generateFallbackContent,
  DEFAULT_PIPELINE_BUDGET,
  scaleBudget,
  safeJsonParse,
  PreviewRequestSchema,
  GenerateRequestSchema,
  SelectDraftRequestSchema
} from '@novel-runtime/shared'
import { parseBody, getOrThrowChapter, getLastChapter } from './_helpers.js'

/**
 * Generate 流:prompt preview / 多候选 generate / 选 candidate。
 * 内部 helper:getCharactersWithLatestState(仅 preview 用,保留在文件内)。
 */
export async function chapterGenerateRoutes(app: FastifyInstance) {
  // 内部 helper:仅 preview 使用,文件内闭包
  async function getCharactersWithLatestState(prisma: any, storyId: string) {
    const characters = await prisma.character.findMany({ where: { storyId } })
    return Promise.all(characters.map(async (c: any) => {
      const latestState = await prisma.characterBranchState.findFirst({
        where: { characterId: c.id },
        orderBy: { fromChapterNumber: 'desc' }
      })
      return { ...c, status: latestState?.status || '{}', relationships: latestState?.relationships || '{}' }
    }))
  }

  // POST /api/chapters/:chapterId/preview
  app.post('/api/chapters/:chapterId/preview', async (request, reply) => {
    const { chapterId } = request.params as any
    const body = parseBody(PreviewRequestSchema, request, reply)
    if (body === null) return

    const prisma = app.prisma
    const chapter = await getOrThrowChapter(prisma, chapterId, reply)
    if (chapter === null) return

    // 限制:只能在最新章节上生成
    const lastChapter = await getLastChapter(prisma, chapter.storyId)
    if (lastChapter && lastChapter.id !== chapterId) {
      return reply.status(400).send({ success: false, error: '只能在最新章节上生成内容' })
    }

    // [完整逻辑从 chapters.ts:290-369 逐字复制]
    // ...省略中间 PromptPipeline 装配 / RuntimePromptCompiler 调用
    return reply.send({ success: true, data: { /* ... */ } })
  })

  // POST /api/chapters/:chapterId/generate
  app.post('/api/chapters/:chapterId/generate', async (request, reply) => {
    const { chapterId } = request.params as any
    const body = parseBody(GenerateRequestSchema, request, reply)
    if (body === null) return

    const prisma = app.prisma
    const chapter = await getOrThrowChapter(prisma, chapterId, reply)
    if (chapter === null) return

    // [完整逻辑从 chapters.ts:370-543 逐字复制,包括 preLockStatus 检查 + generateQueue.add]
    // ...省略中间 steps
    return reply.send({ success: true, data: { /* ... */ } })
  })

  // POST /api/chapters/:chapterId/select
  app.post('/api/chapters/:chapterId/select', async (request, reply) => {
    const { chapterId } = request.params as any
    const body = parseBody(SelectDraftRequestSchema, request, reply)
    if (body === null) return

    const prisma = app.prisma
    const chapter = await getOrThrowChapter(prisma, chapterId, reply)
    if (chapter === null) return

    // [完整逻辑从 chapters.ts:544-599 逐字复制]
    // ...省略中间 draft 选取 + chapter content 更新
    return reply.send({ success: true, data: { /* ... */ } })
  })
}
```

**完整代码填充指引:**
- 逐字复制 chapters.ts line 289-369 (preview),line 370-543 (generate),line 544-599 (select)
- 把每处的 inline safeParse 替换为 parseBody
- 把 3 处 `findUnique + 404` 替换为 getOrThrowChapter
- 把 1 处 inline `getLastChapter` 调用保留(签名不变,只是从 _helpers import)
- inner helper `getCharactersWithLatestState` 留在文件内闭包(只 preview 用)

- [ ] **Step 2: 修改 chapters.ts:加 import + register,删除 inline endpoints**

- 文件顶部 import block 加 `import { chapterGenerateRoutes } from './chapters-generate.js'`
- `chapterRoutes(app)` 顶部加 `await app.register(chapterGenerateRoutes)`
- 删除 chapters.ts line 289-599(preview 起,select 结束 + 空行)

- [ ] **Step 3: 验证 typecheck + tests**

Run:
```bash
pnpm typecheck
pnpm --filter server test
```

Expected:129/129 PASS。特别检查 `chapters-regenerate.test.ts` (12 tests) + `generate-compiledPrompt.test.ts` + `generate-concurrency.test.ts` + `chapters-zod-validation.test.ts` 中 preview/generate/select 描述块。

- [ ] **Step 4: git add**

```bash
git add apps/server/src/routes/chapters-generate.ts apps/server/src/routes/chapters.ts
```

---

### Task 5: 拆 `chapters-crud.ts`(6 endpoint,3 parseBody + 4 getOrThrowChapter + 2 getLastChapter + 1 inner helper)

**Files:**
- Create: `apps/server/src/routes/chapters-crud.ts`
- Modify: `apps/server/src/routes/chapters.ts`(加 import + register,删除 6 endpoint + 内嵌的 allocateSideStoryNumber 与 getLastChapter)

- [ ] **Step 1: 创建 chapters-crud.ts**

```ts
import type { FastifyInstance } from 'fastify'
import {
  CreateChapterRequestSchema,
  UpdateChapterRequestSchema,
  DevelopRequestSchema,
  safeJsonParse
} from '@novel-runtime/shared'
import { parseBody, getOrThrowChapter, getLastChapter } from './_helpers.js'

/**
 * CRUD 流:list / one / create / update / delete / develop(side story)。
 * 内部 helper:allocateSideStoryNumber(仅 develop 用,保留在文件内)。
 */
export async function chapterCrudRoutes(app: FastifyInstance) {
  // 内部 helper:仅 develop 用,文件内闭包
  async function allocateSideStoryNumber(prisma: any, storyId: string, baseNumber: number): Promise<number> {
    const existing = await prisma.chapter.findMany({
      where: { storyId },
      select: { number: true }
    })
    const existingNumbers = existing.map((c: any) => c.number)
    let seq = 1
    while (true) {
      const candidate = Math.round((baseNumber + seq * 0.01) * 100) / 100
      if (!existingNumbers.some((n: number) => Math.abs(n - candidate) < 0.0001)) {
        return candidate
      }
      seq++
      if (seq > 99) return -1
    }
  }

  // GET /api/stories/:storyId/chapters
  app.get('/api/stories/:storyId/chapters', async (request, reply) => {
    const { storyId } = request.params as any
    const chapters = await app.prisma.chapter.findMany({
      where: { storyId },
      orderBy: { number: 'asc' }
    })
    return { success: true, data: chapters }
  })

  // POST /api/stories/:storyId/chapters
  app.post('/api/stories/:storyId/chapters', async (request, reply) => {
    const { storyId } = request.params as any
    const body = parseBody(CreateChapterRequestSchema, request, reply)
    if (body === null) return

    const existingCount = await app.prisma.chapter.count({ where: { storyId } })
    if (existingCount > 0) {
      return reply.status(400).send({ success: false, error: '已有章节，无法新建根章节' })
    }

    // 无章节时强制非番外
    const isSideStory = false
    const lastChapter = await app.prisma.chapter.findFirst({
      where: { storyId, isSideStory: false },
      orderBy: { number: 'desc' }
    })
    const number = (lastChapter?.number || 0) + 1

    const chapter = await app.prisma.chapter.create({
      data: {
        storyId,
        number,
        isSideStory,
        title: body.title,
        outline: body.outline || '',
        status: 'draft'
      }
    })
    return { success: true, data: chapter }
  })

  // GET /api/chapters/:chapterId
  app.get('/api/chapters/:chapterId', async (request, reply) => {
    const { chapterId } = request.params as any
    const chapter = await getOrThrowChapter(app.prisma, chapterId, reply)
    if (chapter === null) return
    return { success: true, data: chapter }
  })

  // PUT /api/chapters/:chapterId
  app.put('/api/chapters/:chapterId', async (request, reply) => {
    const { chapterId } = request.params as any
    const body = parseBody(UpdateChapterRequestSchema, request, reply)
    if (body === null) return

    const prisma = app.prisma
    const chapter = await getOrThrowChapter(prisma, chapterId, reply)
    if (chapter === null) return

    // [完整逻辑从 chapters.ts:133-183 逐字复制,包括 reviewing 状态限制]
    // ...省略中间 chapter.update 调用
    return reply.send({ success: true, data: { /* ... */ } })
  })

  // DELETE /api/chapters/:chapterId
  app.delete('/api/chapters/:chapterId', async (request, reply) => {
    const { chapterId } = request.params as any
    const prisma = app.prisma

    const chapter = await prisma.chapter.findUnique({
      where: { id: chapterId },
      include: { childChapters: true }
    })
    if (!chapter) return reply.status(404).send({ success: false, error: 'Chapter not found' })

    // [完整逻辑从 chapters.ts:194-288 逐字复制,包括 childChapters 检查 + getLastChapter 调用]
    // ...省略中间 cascade delete + graph 重建
    return reply.send({ success: true })
  })

  // POST /api/chapters/:chapterId/develop
  app.post('/api/chapters/:chapterId/develop', async (request, reply) => {
    const { chapterId } = request.params as any
    const body = parseBody(DevelopRequestSchema, request, reply)
    if (body === null) return

    const prisma = app.prisma

    const parentChapter = await prisma.chapter.findUnique({
      where: { id: chapterId },
      include: { story: true }
    })
    if (!parentChapter) return reply.status(404).send({ success: false, error: 'Chapter not found' })

    // [完整逻辑从 chapters.ts:847-905 逐字复制]
    // ...省略中间 isSideStory / hasChildren / getLastChapter / allocateSideStoryNumber 校验
    return reply.send({ success: true, data: { /* ... */ } })
  })
}
```

**完整代码填充指引:**
- 逐字复制 chapters.ts line 36-43 (GET list),line 84-119 (POST create),line 122-132 (GET one),line 133-181 (PUT update),line 184-288 (DELETE),line 829-905 (POST develop)
- 把 3 处 inline safeParse(Create / Update / Develop)替换为 parseBody
- 4 处 `findUnique + 404` 替换为 getOrThrowChapter:
  - GET one (line 122) → 直接替换
  - PUT update (line 128) → 直接替换(后续可能还有第二个 findUnique 带 include,保持原样)
  - DELETE (line 188,带 `include: { childChapters: true }`)→ **不替换**(必须保留 include),保留 inline `findUnique + 404`
  - POST develop (line 841,带 `include: { story: true }`)→ **不替换**(必须保留 include),保留 inline `findUnique + 404`
- 把 PUT update 中第二个 `findUnique`(line 145)替换为 getOrThrowChapter(此时不带 include,可直接替换)
- 把 DELETE + develop 中的 `getLastChapter(prisma, ...)` 调用从闭包改为从 `_helpers.js` import(签名一致)
- inner helper `allocateSideStoryNumber` 保留在文件内闭包(只 develop 用 1 次)

- [ ] **Step 2: 修改 chapters.ts:删除剩余 inline code**

- 文件顶部 import block 加 `import { chapterCrudRoutes } from './chapters-crud.js'`
- `chapterRoutes(app)` 顶部加 `await app.register(chapterCrudRoutes)`
- 删除 chapters.ts line 35-288(GET list 起,DELETE 结束)
- 删除 chapters.ts line 829-905(POST develop)
- 删除 chapters.ts line 45-69(allocateSideStoryNumber + getLastChapter 的本地闭包定义 —— 现在 allocate 在 chapters-crud.ts,getLastChapter 在 _helpers.ts)
- 注意:**保留 line 71-81 getCharactersWithLatestState** 不动(它属于 generate 流,Task 4 已经复制到 chapters-generate.ts,这里要删除它)

- [ ] **Step 3: 验证 typecheck + tests**

Run:
```bash
pnpm typecheck
pnpm --filter server test
```

Expected:129/129 PASS。特别检查 `chapters-concurrency.test.ts`(DELETE + 并发删除)+ `chapters-zod-validation.test.ts` 的 create/update/develop 描述块。

- [ ] **Step 4: git add**

```bash
git add apps/server/src/routes/chapters-crud.ts apps/server/src/routes/chapters.ts
```

---

### Task 6: chapters.ts 改 barrel + 单 commit

**Files:**
- Modify: `apps/server/src/routes/chapters.ts`(全部重写为 ~15 行 barrel)

- [ ] **Step 1: 替换 chapters.ts 为 barrel**

覆盖整个文件为以下内容:

```ts
import type { FastifyInstance } from 'fastify'
import { chapterCrudRoutes } from './chapters-crud.js'
import { chapterGenerateRoutes } from './chapters-generate.js'
import { chapterArchiveRoutes } from './chapters-archive.js'
import { chapterTreeRoutes } from './chapters-tree.js'

/**
 * Barrel — register all chapter route groups in one call.
 * App.ts and tests both use `chapterRoutes(app)` for compatibility.
 * Do not add endpoint logic here; each group lives in its own chapters-*.ts file.
 */
export async function chapterRoutes(app: FastifyInstance) {
  await app.register(chapterCrudRoutes)
  await app.register(chapterGenerateRoutes)
  await app.register(chapterArchiveRoutes)
  await app.register(chapterTreeRoutes)
}
```

注意:不再 import 服务相关(generateQueue / PromptPipeline / services/*),barrel 只引 4 个 route 模块。

- [ ] **Step 2: 验证 typecheck + tests + grep**

Run:
```bash
pnpm typecheck
pnpm --filter server test
pnpm --filter shared test
pnpm --filter ai-provider test
grep -c "request.body as any" apps/server/src/routes/chapters*.ts
grep -c "safeParse" apps/server/src/routes/chapters*.ts
wc -l apps/server/src/routes/chapters*.ts
```

Expected:
- `apps/server typecheck: Done`
- `pnpm --filter server test`:22 files / 129 tests PASS
- `pnpm --filter shared test`:27/27 PASS
- `pnpm --filter ai-provider test`:5/5 PASS
- `grep "request.body as any"`:0(helper parseBody 完全替代)
- `grep "safeParse"`:0(7 处 inline safeParse 全部移到 helper 内)
- `wc -l`:chapters.ts ≤ 30 行 / chapters-crud.ts ≤ 350 行 / chapters-generate.ts ≤ 300 行 / chapters-archive.ts ≤ 300 行 / chapters-tree.ts ≤ 100 行 / _helpers.ts ≤ 100 行

- [ ] **Step 3: git status 确认 staged 文件**

```bash
git status --short
```

Expected:仅 6 个新/改文件 staged:
```
A  apps/server/src/routes/_helpers.ts
A  apps/server/src/routes/chapters-archive.ts
A  apps/server/src/routes/chapters-crud.ts
A  apps/server/src/routes/chapters-generate.ts
A  apps/server/src/routes/chapters-tree.ts
M  apps/server/src/routes/chapters.ts
```

**关键检查:**如果出现 `M apps/server/src/app.ts` 或其他无关文件,**停止,不要 commit**,先回滚误操作。

- [ ] **Step 4: 单 commit**

```bash
git commit -m "$(cat <<'EOF'
refactor(server): split chapters.ts into 4 route files + extract 3 helpers (P3)

- Extract 3 internal helpers to apps/server/src/routes/_helpers.ts:
  parseBody (replaces 7 inline safeParse blocks, byte-identical P2b error format)
  getOrThrowChapter (replaces 'findUnique + 404' pattern, 4 of 9 occurrences)
  getLastChapter (moved from chapters.ts closure, used 3x across 2 files)
- Split chapters.ts (932 lines) into:
  chapters-crud.ts (~330) — GET list/one, POST create, PUT update, DELETE, POST develop
  chapters-generate.ts (~280) — POST preview/generate/select
  chapters-archive.ts (~280) — POST prepare-archive/archive
  chapters-tree.ts (~80) — GET chapter-tree
- chapters.ts becomes a ~15-line barrel re-exporting chapterRoutes.
- chapters.ts internally registers 4 sub-routes via app.register.
- 9 test files + app.ts unchanged (barrel preserves import surface).
- 0 new libs, API contract unchanged, 12 endpoint URLs/req/resp identical.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5: 最终 verification**

```bash
git log --oneline -1
git status
```

Expected:
- `git log` 显示一个新 commit(包含 6 个文件改动)
- `git status` 显示 working tree 干净(可能有未跟踪的 plan 文件,与本 commit 无关)

---

## Self-Review

### 1. Spec coverage(逐 section 检查)

| Spec section | Plan task | OK? |
|---|---|---|
| §1 目标:932 → 4 文件 + barrel + helpers | Task 1-6 | ✓ |
| §2 文件清单:6 个文件 + 1 个 helpers | Task 1-6 | ✓ |
| §3 _helpers API(parseBody / getOrThrowChapter / getLastChapter) | Task 1 | ✓ |
| §4 barrel 形态(~15 行) | Task 6 Step 1 | ✓ |
| §5 子 route 文件结构(export 入口 + 内嵌 endpoint) | Task 2-5 | ✓ |
| §6 路径映射表(12 endpoint 归属) | Task 2-5 已分配 | ✓ |
| §7 app.ts / 测试不变 | 全文未改 app.ts / 测试 | ✓ |
| §8 单 commit 步骤 | Task 6 Step 4 | ✓ |
| §9 验收标准(typecheck + 3 测试 + grep 0 + wc) | Task 6 Step 2 | ✓ |
| §10 风险(register 顺序 / helper null / diff 大) | 全文未覆盖到,需 code review 抽看 | ⚠ 接受(spec 已注明"code quality review 抽看") |
| §11 不动的事(0 新库 / API 不变 / 不动 prisma) | 全文未引入新库 / 未改 API | ✓ |
| §12 与既有 spec 关系 | 不冲突 roadmap | ✓ |

### 2. Placeholder scan

- ✓ 无 "TBD / TODO / 待定 / 之后"
- ✓ 无 "add appropriate error handling" 类抽象指令
- ✓ 无 "Similar to Task N" 类偷懒引用(Tasks 3-5 各自给了完整骨架 + 逐字复制指引)
- ✓ Tasks 3-5 的"// ...省略中间..."有明确指向("[完整逻辑从 chapters.ts:X-Y 逐字复制]"),不是空泛"之后填"

### 3. Type consistency

- `parseBody` 签名:Task 1 定义 `(schema, request, reply) => T | null`,Tasks 2-5 一致使用 `parseBody(XxxSchema, request, reply)` 后接 `if (body === null) return`
- `getOrThrowChapter` 签名:Task 1 定义 `(prisma, chapterId, reply) => Promise<any | null>`,Tasks 2-5 一致使用 `await getOrThrowChapter(prisma, chapterId, reply)` 后接 `if (chapter === null) return`
- `getLastChapter` 签名:Task 1 定义 `(prisma, storyId) => Promise<any | null>`,Tasks 4-5 一致使用
- 子文件 export 名:`chapterTreeRoutes` / `chapterArchiveRoutes` / `chapterGenerateRoutes` / `chapterCrudRoutes`,Task 6 barrel 一致引用

### 4. 已知 gap(由 code review 兜底,plan 内不强制)

- Tasks 3-5 的 endpoint 代码骨架用了 `// ...省略中间...` + "完整逻辑从 chapters.ts:X-Y 复制" 指引——这是有意的,实际完整代码 ~800 行,放在 plan 内会让 plan 不可读。code reviewer 需逐字检查复制内容与原文件 byte-equivalent。

---

## 实施完毕后总结(给用户)

完成后应为 1 个 commit(`refactor(server): split chapters.ts into 4 route files + extract 3 helpers (P3)`):

```
git log --oneline -1
3275494 (or HEAD)  refactor(server): split chapters.ts into 4 route files + extract 3 helpers (P3)
                   6 files changed: 5 new (_helpers.ts + 4 chapters-*.ts) + 1 modified (chapters.ts)
```

验证清单:
- `pnpm typecheck` 8/8 Done
- `pnpm --filter server test` 129/129 PASS
- `pnpm --filter shared test` 27/27 PASS
- `pnpm --filter ai-provider test` 5/5 PASS
- `wc -l apps/server/src/routes/chapters*.ts` 每个新文件 < 350,barrel < 30
- `grep -c "request.body as any" apps/server/src/routes/chapters*.ts` = 0
- `grep -c "safeParse" apps/server/src/routes/chapters*.ts` = 0
- `git status` 干净

下一步 → P4(Chapters.vue 1169 行拆 view + 4 子组件)。

---

## 准备执行前的最后核对清单

- [ ] spec 在 `docs/superpowers/specs/2026-06-18-p3-chapters-route-split.md` 已 commit
- [ ] 6 个 Task 都给出了 step-by-step 操作
- [ ] 每个 Task 都包含 typecheck + test 验证
- [ ] Task 6 是唯一 commit 任务
- [ ] git status 在每个 Task 验证 staged 范围正确