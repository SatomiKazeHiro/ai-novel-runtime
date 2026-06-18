# Phase 3: chapters.ts 按职责拆 route

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `apps/server/src/routes/chapters.ts`(932 行 / 12 endpoint)按职责拆为 4 个新文件 + 1 个 barrel + 1 个 `_helpers.ts`,各文件 < 330 行,API contract 不变,9 个测试文件 0 改动。

**Architecture:** 用"barrel + helper 抽取 + 单文件按职责拆"三层结构。barrel `chapters.ts` 暴露与现状完全一致的 `chapterRoutes(app)` 入口,内部 `app.register` 4 个子 route 文件。3 个最明显重复的模式(parseBody / getOrThrowChapter / getLastChapter)抽到 `apps/server/src/routes/_helpers.ts`。单 commit 原子迁移,1 次 typecheck + 1 次 test 验证。

**Tech Stack:** Fastify 路由注册 / zod (已装) / Vitest (已装)。0 新库。

---

## 1. 目标

承袭 `docs/superpowers/specs/2026-06-18-decoupling-roadmap-design.md` Phase 3(2026-06-18 路 线图)第 200-232 行。本次实施细化为:

- **行数**:chapters.ts 932 行 → 4 个新文件(各 < 330 行) + 1 个 barrel(~15 行)
- **文件数**:净增 5 个(4 子 route + 1 helpers),1 个改写(chapters.ts 变 barrel)
- **endpoint**:12 个 URL / method / req body / resp body 全部不变
- **测试**:9 个测试文件 17 处 `import chapterRoutes` 全部不动,129 个 server 测试保持 PASS

## 2. 文件改动清单

| 文件 | 状态 | 职责 | 预计行数 |
|---|---|---|---|
| `apps/server/src/routes/_helpers.ts` | 新建 | 3 个内部 helper(parseBody / getOrThrowChapter / getLastChapter) | ~80 |
| `apps/server/src/routes/chapters-crud.ts` | 新建 | 6 endpoint:GET list / GET one / POST create / PUT update / DELETE / POST develop | ~330 |
| `apps/server/src/routes/chapters-generate.ts` | 新建 | 3 endpoint:POST preview / POST generate / POST select | ~280 |
| `apps/server/src/routes/chapters-archive.ts` | 新建 | 2 endpoint:POST prepare-archive / POST archive | ~280 |
| `apps/server/src/routes/chapters-tree.ts` | 新建 | 1 endpoint:GET chapter-tree | ~80 |
| `apps/server/src/routes/chapters.ts` | 改写 | barrel:`chapterRoutes(app)` 入口 + 4 次 `app.register` | ~15 |
| `apps/server/src/app.ts` | **不动** | 已用 `await app.register(chapterRoutes)`,barrel 兼容 | 0 |

注:`POST /api/chapters/:chapterId/develop` 在路线图 spec 第 211-216 行未明确分配(4 文件 11 endpoint 缺 1)。本次决策:**归 chapters-crud.ts**(本质是 `prisma.chapter.create` + side story 派生,与 POST create 共享 `allocateSideStoryNumber` / runtime profile fallback 逻辑)。

## 3. `_helpers.ts` API

### 3.1 `parseBody<T>(schema, request, reply)`

替代 7 处 inline safeParse 块(chapters.ts:86 / 135 / 291 / 372 / 546 / 602 / 831,P2b 加的)。

**签名:**
```ts
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { ZodSchema } from 'zod'

export function parseBody<T>(
  schema: ZodSchema<T>,
  request: FastifyRequest,
  reply: FastifyReply
): T | null
```

**契约:**
- `safeParse` 成功 → 返回 `parseResult.data`,调用方 `if (body === null) return` 后直接用 `body.x`
- `safeParse` 失败 → 调用 `reply.status(400).send({ success: false, error: ... })`,返回 `null`
- **错误格式 byte-identical 到 P2b 已落地的格式**(path-prefixed):

```ts
error: parseResult.error.errors
  .map(e => `${e.path.join('.') || '<root>'}: ${e.message}`)
  .join('; ')
```

**Before (P2b inline, 11 行 × 7 处 = 77 行):**
```ts
const parseResult = CreateChapterRequestSchema.safeParse(request.body)
if (!parseResult.success) {
  return reply.status(400).send({
    success: false,
    error: parseResult.error.errors.map(e => `${e.path.join('.') || '<root>'}: ${e.message}`).join('; ')
  })
}
const body = parseResult.data
```

**After (helper 调用方, 3 行 × 7 处 = 21 行):**
```ts
const body = parseBody(CreateChapterRequestSchema, request, reply)
if (body === null) return
```

净减 56 行。

### 3.2 `getOrThrowChapter(prisma, chapterId, reply)`

替代 9 处 `findUnique + 404 + return` 模式(chapters.ts:128 / 145 / 192 / 306 / 392 / 555 / 615 / 724 / 845)。

**签名:**
```ts
import type { FastifyReply } from 'fastify'

export async function getOrThrowChapter(
  prisma: any,
  chapterId: string,
  reply: FastifyReply
): Promise<any | null>
```

**契约:**
- `findUnique({ where: { id: chapterId } })` 成功 → 返回 chapter
- 不存在 → 调用 `reply.status(404).send({ success: false, error: 'Chapter not found' })`,返回 `null`
- 调用方模式:`const chapter = await getOrThrowChapter(prisma, chapterId, reply); if (chapter === null) return`

净减约 27 行(9 处 × 3 行减为 1 行 + 1 行 helper 调用)。

### 3.3 `getLastChapter(prisma, storyId)`

当前在 chapters.ts 闭包内(line 64-69),跨 3 文件调用(chapters-crud.ts 1x,chapters-generate.ts 1x,chapters-archive.ts 1x)。

**签名:**
```ts
export async function getLastChapter(
  prisma: any,
  storyId: string
): Promise<any | null>
```

**行为不变:**`findFirst({ where: { storyId }, orderBy: { number: 'desc' } })`。

净减 0 行,但打破"helper 在闭包内不可跨文件"的限制。

## 4. barrel `chapters.ts` 形态

```ts
import type { FastifyInstance } from 'fastify'
import { chapterCrudRoutes } from './chapters-crud.js'
import { chapterGenerateRoutes } from './chapters-generate.js'
import { chapterArchiveRoutes } from './chapters-archive.js'
import { chapterTreeRoutes } from './chapters-tree.js'

/**
 * Barrel — register all chapter route groups in one call.
 * App.ts and tests both use `chapterRoutes(app)` for compatibility.
 * Do not add endpoint logic here.
 */
export async function chapterRoutes(app: FastifyInstance) {
  await app.register(chapterCrudRoutes)
  await app.register(chapterGenerateRoutes)
  await app.register(chapterArchiveRoutes)
  await app.register(chapterTreeRoutes)
}
```

## 5. 子 route 文件结构(以 chapters-crud.ts 为例)

```ts
import type { FastifyInstance } from 'fastify'
import { CreateChapterRequestSchema, UpdateChapterRequestSchema, DevelopRequestSchema } from '@novel-runtime/shared'
import { parseBody, getOrThrowChapter, getLastChapter } from './_helpers.js'
// ... 其他 service imports

export async function chapterCrudRoutes(app: FastifyInstance) {
  // GET /api/stories/:storyId/chapters (lines 36-83 in old chapters.ts)
  app.get('/api/stories/:storyId/chapters', async (request, reply) => { /* ... */ })

  // POST /api/stories/:storyId/chapters (lines 84-121)
  app.post('/api/stories/:storyId/chapters', async (request, reply) => { /* ... */ })

  // GET /api/chapters/:chapterId (lines 122-132)
  app.get('/api/chapters/:chapterId', async (request, reply) => { /* ... */ })

  // PUT /api/chapters/:chapterId (lines 133-183)
  app.put('/api/chapters/:chapterId', async (request, reply) => { /* ... */ })

  // DELETE /api/chapters/:chapterId (lines 184-288)
  app.delete('/api/chapters/:chapterId', async (request, reply) => { /* ... */ })

  // POST /api/chapters/:chapterId/develop (lines 829-905)
  app.post('/api/chapters/:chapterId/develop', async (request, reply) => { /* ... */ })
}
```

每个子文件顶部 1 个 `export async function xxxRoutes(app: FastifyInstance)`,内部直接 `app.get/post/...` 注册。

## 6. 路径映射表(原文件 → 新文件)

| 旧章节(chapters.ts 旧行号) | 新归属 |
|---|---|
| 36-83 (GET list) | chapters-crud.ts |
| 84-121 (POST create) | chapters-crud.ts |
| 122-132 (GET one) | chapters-crud.ts |
| 133-183 (PUT update) | chapters-crud.ts |
| 184-288 (DELETE) | chapters-crud.ts |
| 289-369 (POST preview) | chapters-generate.ts |
| 370-543 (POST generate) | chapters-generate.ts |
| 544-599 (POST select) | chapters-generate.ts |
| 600-715 (POST prepare-archive) | chapters-archive.ts |
| 716-828 (POST archive) | chapters-archive.ts |
| 829-905 (POST develop) | chapters-crud.ts |
| 908-932 (GET chapter-tree) | chapters-tree.ts |

## 7. app.ts / 测试不变性

### 7.1 app.ts

```ts
// 不动
await app.register(chapterRoutes)
```

barrel 内部 4 次 register 对 Fastify 行为等价于原来 1 个文件 register 12 个 endpoint(register 是 async,await 保证顺序)。

### 7.2 测试

9 个测试文件 17 处 `await import('../../routes/chapters.js')` 全部不动,barrel 暴露同名的 `chapterRoutes` 默认导出。

```
apps/server/src/__tests__/routes/chapters-concurrency.test.ts       (3 imports)
apps/server/src/__tests__/routes/chapters-regenerate.test.ts       (2 imports)
apps/server/src/__tests__/routes/chapters-select.test.ts            (1 import)
apps/server/src/__tests__/routes/chapters-zod-validation.test.ts    (7 imports)
apps/server/src/__tests__/routes/generate-compiledPrompt.test.ts    (1 import)
apps/server/src/__tests__/routes/generate-concurrency.test.ts       (1 import)
apps/server/src/__tests__/routes/prepare-archive.test.ts            (2 imports)
```

13 个非 chapter route 测试文件无 `chapterRoutes` import,0 影响。

### 7.3 行为不变

- 12 个 endpoint URL / method / req body / resp body 完全不变
- 错误格式完全不变(P2b 已落地的 path-prefixed format 由 helper `parseBody` 内置)
- 业务逻辑(prisma 查询、status 检查、queue 投递)按代码逐行迁移,行为不变

## 8. commit 步骤

单 commit 原子迁移(避免中间状态导致 barrel 未生效时 import 失败)。

```bash
# 1. 新增 5 个文件 + 改写 1 个文件
git add apps/server/src/routes/_helpers.ts \
        apps/server/src/routes/chapters-crud.ts \
        apps/server/src/routes/chapters-generate.ts \
        apps/server/src/routes/chapters-archive.ts \
        apps/server/src/routes/chapters-tree.ts \
        apps/server/src/routes/chapters.ts

# 2. verification gate
pnpm typecheck
pnpm --filter server test
pnpm --filter shared test
pnpm --filter ai-provider test
grep -c "request.body as any" apps/server/src/routes/chapters*.ts   # 期望 0

# 3. 单 commit(commit message 见 commit 模板)
git commit -m "refactor(server): split chapters.ts into 4 route files + extract 3 helpers (P3)

..."
```

## 9. 验收标准

| 项 | 期望 |
|---|---|
| `pnpm typecheck` | 8/8 Done |
| `pnpm --filter server test` | 129/129 PASS(0 新测试) |
| `pnpm --filter shared test` | 27/27 PASS |
| `pnpm --filter ai-provider test` | 5/5 PASS |
| `wc -l apps/server/src/routes/chapters*.ts` | 每个新文件 < 330,barrel < 30 |
| `grep -c "request.body as any" apps/server/src/routes/chapters*.ts` | 0 |
| `grep -c "safeParse" apps/server/src/routes/chapters*.ts` | 0(P2b inline 全部移到 parseBody helper) |
| `git log --oneline -1` | 1 个新 commit |
| `git status` | 干净 |

## 10. 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| barrel 4 次 register 顺序与原单文件 register 12 endpoint 顺序不一致 | 低 | Fastify 无 URL 冲突,12 URL 各异 | 测试 129/129 + code quality review 抽看 |
| 子文件之间共享 `_helpers.ts` 引入跨文件耦合 | 低 | helper 是纯函数,可单测 | helper 单测可选(P3 不强制,已有 129 route 测试间接覆盖) |
| `chapters.ts` barrel 与 `chapters-*.ts` 子文件命名混淆 | 中 | 新人易找错文件 | JSDoc "Barrel — use `chapterRoutes` for app.ts and tests" 标注 |
| 单 commit diff 800+ 行,code review 负担高 | 中 | review 一次性大 | 用 `git diff --stat` 看概览,再按 file 分块看 |
| helper `parseBody` 返回 null 模式漏写 `if (body === null) return` | 中 | TS 类型已 narrow,漏写则 runtime crash on `body.x` | code quality review 抽看 + 已有 14 个 zod validation 测试覆盖 |
| 旧 chapters.ts 里的内部 helper(如 `allocateSideStoryNumber`)是否一并移走 | 低 | 只在 develop 用 1 次 | **不抽**(单调用点 helper 是 over-engineering),保留在 chapters-crud.ts 内部 |

## 11. 不动的事(承袭 spec 守门)

- ✅ 0 新库(沿用 fastify + zod + vitest + @novel-runtime/shared)
- ✅ API contract 不变(URL / method / body / resp shape 12 endpoint 全部不变)
- ✅ prisma schema / data schema 不动
- ✅ web/composables 不动
- ✅ 9 个测试文件 0 改动
- ✅ P2b 7 个 safeParse 行为不变(error format / status code 一致)

## 12. 与既有 spec 关系

- 路线图 spec `docs/superpowers/specs/2026-06-18-decoupling-roadmap-design.md` 第 200-232 行已定 Phase 3 目标,本次 spec 是其实施细化
- 不冲突路线图守门(0 新库 / 不动 API / 不动 data schema / 7 phase 顺序)
- 不破 ISSUES.md 库选型守门
- 不破 AGENTS.md / CLAUDE.md 既有约定(中文回复 / commit 前 status / 不动 prisma / 不 amend)

---

## Self-Review

### 1. Placeholder scan

全文 grep "TBD / TODO / 待定 / 暂时 / 之后再说 / 待讨论":
- ✅ 无 hit(具体行号 / 具体函数名 / 具体错误格式都已落)

### 2. Internal consistency

- 第 3 节 `parseBody` 错误格式字符串 ↔ 第 7.3 节"行为不变":byte-identical ✓
- 第 4 节 barrel 4 次 register ↔ 第 2 节文件清单(4 子文件):数量一致 ✓
- 第 6 节路径映射 ↔ 第 2 节文件清单:12 endpoint 全部归属明确,无孤儿 ✓
- 第 9 节验收 grep `safeParse` 期望 0 ↔ 第 3.1 节 parseBody 替代 7 处:数量一致 ✓

### 3. Scope check

单 phase 范围:1 commit / 5 新文件 + 1 改写 / 0 测试改动 / 0 API 改动。范围聚焦,可被单个 writing-plans 任务拆解。

### 4. Ambiguity check

- "约 / 大约 / 预计"等模糊词扫一遍:
  - 第 2 节"预计行数"已加 ~前缀,review 时按 ±20% 浮动合理
  - "净减 56 行"是计算结果(P2b inline 11 行 × 7 = 77,after 3 行 × 7 = 21),非估计
- "至少 1 个" / "不少于 N 个":无,所有数字都是确切值
- 可能二义解读:
  - "POST develop 归 chapters-crud.ts"——已在第 2 节注明确解释(本质是 prisma create + 共享 side story 派生)
  - "barrel 暴露同名 chapterRoutes"——已在第 7.2 节明确
  - "helper parseBody 返回 null"——已在第 3.1 节契约明确

无歧义。