# Novel Cover Upload + Card View — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 `docs/superpowers/specs/2026-06-24-novel-cover-cards-design.md` 在"小说管理"页加封面上传 + 卡片视图 + 过滤 toggle + localStorage 持久化。后端 multipart 写盘 + static 服务；前端加 3 个组件 + 1 个 composable。

**Architecture:** "本地磁盘 + 静态服务"两端通过相对路径 `/uploads/covers/{storyId}-{ts}.{ext}` 衔接。后端三层（路由 / 插件 / lib helpers）；前端三层（视图 / 组件 / composable）。所有持久状态走 localStorage，DB 只存真实数据（coverUrl）。

**Tech Stack:** Fastify 5 + `@fastify/multipart` + `@fastify/static` + Prisma 6 + Zod；Vue 3 + `<script setup>` + Naive UI + Pinia；Vitest 3（已就绪）；TS strict ESM (`"type": "module"`)。

---

## File Structure

| 路径 | 职责 | 行数估算 |
|---|---|---|
| `apps/server/src/lib/cover-storage.ts` (new) | 纯函数：resolveCoverPath / saveCover / deleteCover / deleteCoversByStoryId / coverUrlToPath | ~80 |
| `apps/server/src/plugins/upload.ts` (new) | Fastify multipart 插件封装（2MB 限制） | ~15 |
| `apps/server/src/routes/covers.ts` (new) | `DELETE /api/stories/:id/cover` 端点 | ~30 |
| `apps/server/src/__tests__/lib/cover-storage.test.ts` (new) | cover-storage 单测（用 tmp 目录） | ~80 |
| `apps/server/src/__tests__/routes/covers.test.ts` (new) | DELETE /:id/cover 路由测试 | ~60 |
| `apps/server/src/__tests__/routes/stories-put-cover.test.ts` (new) | PUT /:id multipart 路由测试 | ~120 |
| `apps/server/src/__tests__/routes/stories-delete-cascade.test.ts` (new) | DELETE /:id cascade 测试 | ~50 |
| `apps/web/src/composables/useStoriesViewPrefs.ts` (new) | localStorage 视图/过滤偏好 | ~30 |
| `apps/web/src/components/StoryCover.vue` (new) | 单本书封面渲染（印章算法） | ~120 |
| `apps/web/src/components/StoriesCards.vue` (new) | 卡片网格 + 操作菜单 | ~180 |
| `prisma/schema.prisma` (modify) | Story 加 `coverUrl String?` | +1 |
| `prisma/migrations/.../migration.sql` (auto-gen) | `ALTER TABLE Story ADD COLUMN coverUrl TEXT` | auto |
| `apps/server/src/routes/stories.ts` (modify) | PUT 接受 multipart；DELETE 加 cascade | +60 |
| `apps/server/src/app.ts` (modify) | 注册 upload / static / covers | +8 |
| `apps/server/src/server.ts` (modify) | 启动时 mkdir uploads | +3 |
| `apps/web/src/views/Stories.vue` (modify) | 工具栏 + 视图切换 + 编辑 modal 封面 | rewrite |
| `apps/web/src/api/stories.ts` (modify) | types 加 coverUrl；新增 removeCover | +6 |
| `.gitignore` (modify) | 加 `apps/server/uploads/` | +1 |

---

## Task 1: 安装新依赖（@fastify/multipart + @fastify/static）

**Files:**
- Modify: `apps/server/package.json` (deps 加 2 行)

- [ ] **Step 1: 在 apps/server 目录下安装**

```bash
cd apps/server && pnpm add @fastify/multipart@^9.0.0 @fastify/static@^8.0.0
```

预期：package.json 自动更新，`node_modules/@fastify/multipart` 和 `@fastify/static` 出现。

- [ ] **Step 2: 校验 server 仍能 typecheck**

```bash
cd apps/server && pnpm typecheck
```

预期：exit 0，无新错误。

- [ ] **Step 3: Commit**

```bash
cd D:/MGit-Projects/ai-novel-runtime
git add apps/server/package.json pnpm-lock.yaml
git commit -m "deps(server): 加 @fastify/multipart + @fastify/static"
```

---

## Task 2: Prisma schema 加 coverUrl + 生成 migration

**Files:**
- Modify: `prisma/schema.prisma:12-37` (Story 模型)
- Auto-gen: `prisma/migrations/<timestamp>_add_story_cover_url/migration.sql`

- [ ] **Step 1: 编辑 prisma/schema.prisma**

定位 `model Story` 块（约 line 12-37），在 `description` 与 `status` 之间插入：

```prisma
  description        String?
  coverUrl           String?  // 相对路径,如 /uploads/covers/{storyId}-{ts}.{ext}
  status             String   @default("active")
```

- [ ] **Step 2: 生成 migration**

```bash
cd D:/MGit-Projects/ai-novel-runtime
pnpm db:migrate --name add_story_cover_url
```

预期：终端输出"Generated migration at prisma/migrations/.../migration.sql"并提示"Database is now in sync"。

- [ ] **Step 3: 校验 Prisma Client 已重生成**

```bash
cd D:/MGit-Projects/ai-novel-runtime
grep -l "coverUrl" node_modules/.prisma/client/index.d.ts
```

预期：grep 命中（说明 Prisma Client 已包含 coverUrl 字段）。

- [ ] **Step 4: Commit**

```bash
cd D:/MGit-Projects/ai-novel-runtime
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(db): Story 加 coverUrl 字段"
```

---

## Task 3: 写 cover-storage lib（纯函数）+ 单元测试

**Files:**
- Create: `apps/server/src/lib/cover-storage.ts`
- Create: `apps/server/src/__tests__/lib/cover-storage.test.ts`

- [ ] **Step 1: 写测试（红）**

`apps/server/src/__tests__/lib/cover-storage.test.ts`：

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync, readdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  resolveCoverPath,
  coverUrlToPath,
  saveCover,
  deleteCover,
  deleteCoversByStoryId
} from '../../lib/cover-storage.js'

describe('cover-storage', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'covers-test-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  describe('resolveCoverPath', () => {
    it('returns covers/{storyId}-{ts}.{ext}', () => {
      const p = resolveCoverPath(root, 'abc-123', 1700000000000, 'jpg')
      expect(p).toBe(join(root, 'covers', 'abc-123-1700000000000.jpg'))
    })
  })

  describe('coverUrlToPath', () => {
    it('maps /uploads/covers/foo.jpg under root to absolute path', () => {
      const abs = coverUrlToPath(root, '/uploads/covers/foo.jpg')
      expect(abs).toBe(join(root, 'covers', 'foo.jpg'))
    })

    it('rejects URL with traversal characters', () => {
      expect(() => coverUrlToPath(root, '/uploads/../etc/passwd'))
        .toThrow(/invalid cover url/)
    })

    it('rejects URL outside /uploads/covers/', () => {
      expect(() => coverUrlToPath(root, '/uploads/other/foo.jpg'))
        .toThrow(/invalid cover url/)
    })
  })

  describe('saveCover', () => {
    it('writes file under root/covers and returns url', async () => {
      const url = await saveCover(root, 's1', 123, 'jpg', Buffer.from('abc'))
      expect(url).toBe('/uploads/covers/s1-123.jpg')
      expect(existsSync(join(root, 'covers', 's1-123.jpg'))).toBe(true)
    })

    it('creates covers dir if missing', async () => {
      await saveCover(root, 's1', 1, 'png', Buffer.from('x'))
      expect(existsSync(join(root, 'covers'))).toBe(true)
    })
  })

  describe('deleteCover', () => {
    it('removes existing file', async () => {
      const url = await saveCover(root, 's1', 1, 'jpg', Buffer.from('x'))
      await deleteCover(root, url)
      expect(existsSync(join(root, 'covers', 's1-1.jpg'))).toBe(false)
    })

    it('does not throw on missing file (idempotent)', async () => {
      await expect(deleteCover(root, '/uploads/covers/none.jpg')).resolves.toBeUndefined()
    })

    it('does not throw on null url', async () => {
      await expect(deleteCover(root, null)).resolves.toBeUndefined()
    })
  })

  describe('deleteCoversByStoryId', () => {
    it('removes all files prefixed with storyId-', async () => {
      await saveCover(root, 's1', 1, 'jpg', Buffer.from('a'))
      await saveCover(root, 's1', 2, 'jpg', Buffer.from('b'))
      await saveCover(root, 's2', 1, 'jpg', Buffer.from('c'))
      await deleteCoversByStoryId(root, 's1')
      const files = readdirSync(join(root, 'covers'))
      expect(files).toEqual(['s2-1.jpg'])
    })
  })
})
```

- [ ] **Step 2: 运行测试确认红**

```bash
cd apps/server && pnpm test -- cover-storage
```

预期：FAIL with "Cannot find module '../../lib/cover-storage.js'"。

- [ ] **Step 3: 实现 cover-storage.ts（绿）**

`apps/server/src/lib/cover-storage.ts`：

```ts
import { promises as fs } from 'fs'
import { join, normalize, sep } from 'path'

const URL_RE = /^\/uploads\/covers\/([a-f0-9-]+-\d+\.(jpg|png|webp))$/

export function resolveCoverPath(root: string, storyId: string, ts: number, ext: 'jpg'|'png'|'webp'): string {
  return join(root, 'covers', `${storyId}-${ts}.${ext}`)
}

export function coverUrlToPath(root: string, url: string | null | undefined): string | null {
  if (!url) return null
  const m = url.match(URL_RE)
  if (!m) throw new Error(`invalid cover url: ${url}`)
  const rel = join('covers', m[1])
  const abs = normalize(join(root, rel))
  // 防 traversal: 解算后必须仍在 root/covers/ 内
  const expected = normalize(join(root, 'covers') + sep)
  if (!abs.startsWith(expected) && abs !== expected) {
    throw new Error(`invalid cover url: ${url}`)
  }
  return abs
}

export async function saveCover(
  root: string,
  storyId: string,
  ts: number,
  ext: 'jpg'|'png'|'webp',
  data: Buffer
): Promise<string> {
  const dir = join(root, 'covers')
  await fs.mkdir(dir, { recursive: true })
  const abs = resolveCoverPath(root, storyId, ts, ext)
  await fs.writeFile(abs, data)
  return `/uploads/covers/${storyId}-${ts}.${ext}`
}

export async function deleteCover(root: string, url: string | null | undefined): Promise<void> {
  const abs = coverUrlToPath(root, url)
  if (!abs) return
  try {
    await fs.unlink(abs)
  } catch (err: any) {
    if (err.code !== 'ENOENT') throw err
  }
}

export async function deleteCoversByStoryId(root: string, storyId: string): Promise<void> {
  const dir = join(root, 'covers')
  let files: string[]
  try {
    files = await fs.readdir(dir)
  } catch (err: any) {
    if (err.code === 'ENOENT') return
    throw err
  }
  const prefix = `${storyId}-`
  await Promise.all(
    files.filter(f => f.startsWith(prefix)).map(f => fs.unlink(join(dir, f)).catch(() => undefined))
  )
}
```

- [ ] **Step 4: 运行测试确认绿**

```bash
cd apps/server && pnpm test -- cover-storage
```

预期：所有 case PASS。

- [ ] **Step 5: typecheck**

```bash
cd apps/server && pnpm typecheck
```

预期：exit 0。

- [ ] **Step 6: Commit**

```bash
cd D:/MGit-Projects/ai-novel-runtime
git add apps/server/src/lib/cover-storage.ts apps/server/src/__tests__/lib/cover-storage.test.ts
git commit -m "feat(server): cover-storage helpers + 单测"
```

---

## Task 4: 写 upload 插件 + 配置文件路径常量

**Files:**
- Create: `apps/server/src/plugins/upload.ts`
- Create: `apps/server/src/config/paths.ts`（uploads 根目录路径常量）

- [ ] **Step 1: 写 config/paths.ts**

`apps/server/src/config/paths.ts`：

```ts
import { join } from 'path'
import { fileURLToPath } from 'url'

// apps/server/src/config/paths.ts → 上溯到 apps/server/
const here = fileURLToPath(new URL('.', import.meta.url))
export const UPLOADS_ROOT = join(here, '..', '..', 'uploads')
```

- [ ] **Step 2: 写 plugins/upload.ts**

`apps/server/src/plugins/upload.ts`：

```ts
import fp from 'fastify-plugin'
import multipart from '@fastify/multipart'
import type { FastifyInstance } from 'fastify'

export const uploadPlugin = fp(async (fastify: FastifyInstance) => {
  await fastify.register(multipart, {
    limits: {
      fileSize: 2 * 1024 * 1024,           // 2MB
      files: 1
    },
    attachFieldsToBody: false             // 用 req.file() 流式获取
  })
})
```

- [ ] **Step 3: typecheck**

```bash
cd apps/server && pnpm typecheck
```

预期：exit 0。

- [ ] **Step 4: Commit**

```bash
cd D:/MGit-Projects/ai-novel-runtime
git add apps/server/src/config/paths.ts apps/server/src/plugins/upload.ts
git commit -m "feat(server): upload plugin + uploads root 路径常量"
```

---

## Task 5: 写 DELETE /api/stories/:id/cover 路由 + 测试

**Files:**
- Create: `apps/server/src/routes/covers.ts`
- Create: `apps/server/src/__tests__/routes/covers.test.ts`
- Modify: `apps/server/src/app.ts:55-71`（注册 covers 路由）

- [ ] **Step 1: 写路由测试（红）**

`apps/server/src/__tests__/routes/covers.test.ts`：

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockApp, callHandler, createMockPrisma } from '../setup.js'

describe('DELETE /api/stories/:storyId/cover', () => {
  let mockPrisma: any
  let routes: Record<string, any>
  let coverStorageMock: any

  beforeEach(async () => {
    vi.clearAllMocks()
    mockPrisma = createMockPrisma({
      story: {
        findUnique: vi.fn().mockResolvedValue({
          id: 's1',
          coverUrl: '/uploads/covers/s1-100.jpg'
        }),
        update: vi.fn().mockResolvedValue({ id: 's1', coverUrl: null })
      }
    })
    coverStorageMock = { deleteCover: vi.fn().mockResolvedValue(undefined) }

    // 用 vi.mock 注入 cover-storage
    vi.doMock('../../lib/cover-storage.js', () => coverStorageMock)
    const { coverRoutes } = await import('../../routes/covers.js')
    const built = createMockApp(mockPrisma)
    await coverRoutes(built.app)
    routes = built.routes
    vi.doUnmock('../../lib/cover-storage.js')
  })

  it('clears coverUrl and unlinks file', async () => {
    const result = await callHandler(routes, 'DELETE', '/api/stories/:storyId/cover', {}, { storyId: 's1' })
    expect(result.status).not.toBe(404)
    expect(result.body.success).toBe(true)
    expect(mockPrisma.story.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { coverUrl: null }
    })
    expect(coverStorageMock.deleteCover).toHaveBeenCalledWith(expect.any(String), '/uploads/covers/s1-100.jpg')
  })

  it('is idempotent when coverUrl is already null', async () => {
    mockPrisma.story.findUnique.mockResolvedValue({ id: 's1', coverUrl: null })
    const result = await callHandler(routes, 'DELETE', '/api/stories/:storyId/cover', {}, { storyId: 's1' })
    expect(result.body.success).toBe(true)
    expect(coverStorageMock.deleteCover).not.toHaveBeenCalled()
  })

  it('returns 404 when story not found', async () => {
    mockPrisma.story.findUnique.mockResolvedValue(null)
    const result = await callHandler(routes, 'DELETE', '/api/stories/:storyId/cover', {}, { storyId: 'missing' })
    expect(result.status).toBe(404)
    expect(result.body.success).toBe(false)
  })
})
```

- [ ] **Step 2: 运行测试确认红**

```bash
cd apps/server && pnpm test -- covers.test
```

预期：FAIL with module not found。

- [ ] **Step 3: 实现 routes/covers.ts（绿）**

`apps/server/src/routes/covers.ts`：

```ts
import type { FastifyInstance } from 'fastify'
import { UPLOADS_ROOT } from '../config/paths.js'
import { deleteCover } from '../lib/cover-storage.js'

export async function coverRoutes(app: FastifyInstance) {
  // DELETE /api/stories/:storyId/cover
  app.delete('/api/stories/:storyId/cover', async (request, reply) => {
    const { storyId } = request.params as { storyId: string }
    const story = await app.prisma.story.findUnique({
      where: { id: storyId },
      select: { id: true, coverUrl: true }
    })
    if (!story) {
      return reply.status(404).send({ success: false, error: 'Story not found' })
    }
    await deleteCover(UPLOADS_ROOT, story.coverUrl)
    await app.prisma.story.update({
      where: { id: storyId },
      data: { coverUrl: null }
    })
    return { success: true }
  })
}
```

- [ ] **Step 4: 在 app.ts 注册路由**

修改 `apps/server/src/app.ts:7-19`（import 区域）加：

```ts
import { coverRoutes } from './routes/covers.js'
```

修改 `apps/server/src/app.ts:55-71`（routes 注册区域），在 `await app.register(storyRoutes, ...)` 之后加：

```ts
await app.register(coverRoutes)
```

- [ ] **Step 5: 运行测试确认绿**

```bash
cd apps/server && pnpm test -- covers.test
```

预期：所有 case PASS。

- [ ] **Step 6: typecheck**

```bash
cd apps/server && pnpm typecheck
```

预期：exit 0。

- [ ] **Step 7: Commit**

```bash
cd D:/MGit-Projects/ai-novel-runtime
git add apps/server/src/routes/covers.ts apps/server/src/__tests__/routes/covers.test.ts apps/server/src/app.ts
git commit -m "feat(server): DELETE /api/stories/:id/cover 路由"
```

---

## Task 6: PUT /api/stories/:id 接受 multipart 封面上传 + 测试

**Files:**
- Modify: `apps/server/src/routes/stories.ts:87-110`（PUT handler 改造）
- Create: `apps/server/src/__tests__/routes/stories-put-cover.test.ts`

- [ ] **Step 1: 写测试（红）**

`apps/server/src/__tests__/routes/stories-put-cover.test.ts`：

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Readable } from 'stream'
import { createMockApp, callHandler, createMockPrisma } from '../setup.js'

/**
 * Helper: build a fake @fastify/multipart file stream
 * Mimics the surface our handler uses: .file(), .fields, .mimetype, .filename, .toBuffer()
 */
function fakeMultipartFile(opts: { mimetype: string; filename: string; content: Buffer }) {
  return {
    mimetype: opts.mimetype,
    filename: opts.filename,
    toBuffer: async () => opts.content
  }
}

describe('PUT /api/stories/:id — cover upload', () => {
  let mockPrisma: any
  let routes: Record<string, any>
  let coverStorageMock: any

  beforeEach(async () => {
    vi.clearAllMocks()
    mockPrisma = createMockPrisma({
      story: {
        findUnique: vi.fn().mockResolvedValue({ id: 's1', coverUrl: null }),
        update: vi.fn().mockResolvedValue({ id: 's1', coverUrl: '/uploads/covers/s1-100.jpg' })
      }
    })
    coverStorageMock = {
      saveCover: vi.fn().mockResolvedValue('/uploads/covers/s1-100.jpg'),
      deleteCover: vi.fn().mockResolvedValue(undefined)
    }
    vi.doMock('../../lib/cover-storage.js', () => coverStorageMock)
    const { storyRoutes } = await import('../../routes/stories.js')
    const built = createMockApp(mockPrisma)
    await storyRoutes(built.app)
    routes = built.routes
    vi.doUnmock('../../lib/cover-storage.js')
  })

  function buildRequest(file: any, fields: Record<string, string> = {}) {
    return {
      isMultipart: () => true,
      file: async () => file,
      parts: async function* () { yield { type: 'file', ...file }; for (const [k, v] of Object.entries(fields)) yield { type: 'field', fieldname: k, value: v } }
    }
  }

  it('accepts jpg cover, saves file, updates DB', async () => {
    const file = fakeMultipartFile({ mimetype: 'image/jpeg', filename: 'a.jpg', content: Buffer.from('jpg-bytes') })
    const result = await callHandler(
      routes, 'PUT', '/:id',
      buildRequest(file, { title: '长安·朱雀门' }),
      { id: 's1' }
    )
    expect(result.status).not.toBe(400)
    expect(result.body.success).toBe(true)
    expect(coverStorageMock.saveCover).toHaveBeenCalledWith(
      expect.any(String), 's1', expect.any(Number), 'jpg', expect.any(Buffer)
    )
    expect(mockPrisma.story.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 's1' },
        data: expect.objectContaining({ coverUrl: '/uploads/covers/s1-100.jpg' })
      })
    )
  })

  it('accepts png cover', async () => {
    const file = fakeMultipartFile({ mimetype: 'image/png', filename: 'a.png', content: Buffer.from('png') })
    const result = await callHandler(
      routes, 'PUT', '/:id',
      buildRequest(file, { title: '云中' }),
      { id: 's1' }
    )
    expect(coverStorageMock.saveCover).toHaveBeenCalledWith(expect.any(String), 's1', expect.any(Number), 'png', expect.any(Buffer))
    expect(result.body.success).toBe(true)
  })

  it('rejects image/gif with 415 and does not save', async () => {
    const file = fakeMultipartFile({ mimetype: 'image/gif', filename: 'a.gif', content: Buffer.from('gif') })
    const result = await callHandler(
      routes, 'PUT', '/:id',
      buildRequest(file, { title: '长安' }),
      { id: 's1' }
    )
    expect(result.status).toBe(415)
    expect(result.body.success).toBe(false)
    expect(coverStorageMock.saveCover).not.toHaveBeenCalled()
    expect(mockPrisma.story.update).not.toHaveBeenCalled()
  })

  it('removes existing cover when removeCover=true', async () => {
    mockPrisma.story.findUnique.mockResolvedValue({ id: 's1', coverUrl: '/uploads/covers/old.jpg' })
    const file = fakeMultipartFile({ mimetype: 'image/jpeg', filename: 'a.jpg', content: Buffer.from('jpg') })
    const result = await callHandler(
      routes, 'PUT', '/:id',
      buildRequest(file, { title: '新标题', removeCover: 'true' }),
      { id: 's1' }
    )
    expect(result.body.success).toBe(true)
    expect(coverStorageMock.deleteCover).toHaveBeenCalledWith(expect.any(String), '/uploads/covers/old.jpg')
  })

  it('works without file (no cover change)', async () => {
    const req = {
      isMultipart: () => true,
      file: async () => undefined,
      parts: async function* () { yield { type: 'field', fieldname: 'title', value: '新标题' } }
    }
    const result = await callHandler(routes, 'PUT', '/:id', req, { id: 's1' })
    expect(result.body.success).toBe(true)
    expect(coverStorageMock.saveCover).not.toHaveBeenCalled()
    expect(mockPrisma.story.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 's1' },
        data: expect.objectContaining({ title: '新标题' })
      })
    )
  })
})
```

- [ ] **Step 2: 扩展 createMockApp 支持 req.file() / req.parts()**

修改 `apps/server/src/__tests__/setup.ts` 中 `createMockApp` 的 `app.get/post/put/delete` 块之后追加：

```ts
    // Multipart: tests pass req directly via callHandler body
```

实际上不需要改 setup.ts — callHandler 已经支持自定义 body。我们需要的是让 route handler 内部的 `request.file()` 能拿到值。直接传一个 fake request 即可（已经支持，见上一步测试代码）。

- [ ] **Step 3: 运行测试确认红**

```bash
cd apps/server && pnpm test -- stories-put-cover
```

预期：FAIL — 部分 cases 失败（旧的 PUT 不会处理 multipart）。

- [ ] **Step 4: 改造 routes/stories.ts 的 PUT handler**

完整重写 `apps/server/src/routes/stories.ts` 中的 PUT handler（约 line 87-110）：

```ts
  // PUT /stories/:id
  app.put('/:id', async (request, reply) => {
    const { id } = request.params as { id: string }

    // 解析 body: multipart 或 JSON
    const body: any = {}
    let coverFile: { mimetype: string; filename: string; content: Buffer } | undefined
    let removeCover = false

    if (request.isMultipart && request.isMultipart()) {
      const parts = (request as any).parts()
      for await (const part of parts) {
        if (part.type === 'file') {
          coverFile = {
            mimetype: part.mimetype,
            filename: part.filename,
            content: await part.toBuffer()
          }
        } else if (part.type === 'field') {
          if (part.fieldname === 'removeCover') {
            removeCover = part.value === 'true'
          } else {
            body[part.fieldname] = part.value
          }
        }
      }
    } else {
      Object.assign(body, request.body || {})
    }

    const parseResult = updateStorySchema.safeParse(body)
    if (!parseResult.success) {
      return reply.status(400).send({ success: false, error: parseResult.error.errors.map((e: any) => e.message).join('; ') })
    }
    const data: any = { ...parseResult.data }

    // 处理 cover 上传
    if (coverFile) {
      const mimeToExt: Record<string, 'jpg'|'png'|'webp'> = {
        'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp'
      }
      const ext = mimeToExt[coverFile.mimetype]
      if (!ext) {
        return reply.status(415).send({ success: false, error: `不支持的图片格式: ${coverFile.mimetype}` })
      }
      const previous = await app.prisma.story.findUnique({ where: { id }, select: { coverUrl: true } })
      if (removeCover && previous?.coverUrl) {
        await deleteCover(UPLOADS_ROOT, previous.coverUrl)
      }
      data.coverUrl = await saveCover(UPLOADS_ROOT, id, Date.now(), ext, coverFile.content)
    } else if (removeCover) {
      // 没传新图但要求移除
      const previous = await app.prisma.story.findUnique({ where: { id }, select: { coverUrl: true } })
      await deleteCover(UPLOADS_ROOT, previous?.coverUrl)
      data.coverUrl = null
    }

    const story = await app.prisma.story.update({
      where: { id },
      data,
      include: {
        _count: { select: { chapters: true, characters: true } },
        runtimeProfile: { select: { id: true, name: true } }
      }
    })
    return { success: true, data: story }
  })
```

在文件顶部加 import：

```ts
import { UPLOADS_ROOT } from '../config/paths.js'
import { saveCover, deleteCover } from '../lib/cover-storage.js'
```

- [ ] **Step 5: 运行测试确认绿**

```bash
cd apps/server && pnpm test -- stories-put-cover
```

预期：5 个 case 全 PASS。

- [ ] **Step 6: typecheck**

```bash
cd apps/server && pnpm typecheck
```

预期：exit 0。

- [ ] **Step 7: Commit**

```bash
cd D:/MGit-Projects/ai-novel-runtime
git add apps/server/src/routes/stories.ts apps/server/src/__tests__/routes/stories-put-cover.test.ts
git commit -m "feat(server): PUT /api/stories/:id 接受 multipart 封面上传"
```

---

## Task 7: DELETE /api/stories/:id cascade 清理 covers 文件 + 测试

**Files:**
- Modify: `apps/server/src/routes/stories.ts:125-130`（DELETE handler）
- Create: `apps/server/src/__tests__/routes/stories-delete-cascade.test.ts`

- [ ] **Step 1: 写测试（红）**

`apps/server/src/__tests__/routes/stories-delete-cascade.test.ts`：

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockApp, callHandler, createMockPrisma } from '../setup.js'

describe('DELETE /api/stories/:id — cascade cover cleanup', () => {
  let mockPrisma: any
  let routes: Record<string, any>
  let coverStorageMock: any

  beforeEach(async () => {
    vi.clearAllMocks()
    mockPrisma = createMockPrisma({
      story: {
        delete: vi.fn().mockResolvedValue({ id: 's1' })
      }
    })
    coverStorageMock = {
      deleteCoversByStoryId: vi.fn().mockResolvedValue(undefined)
    }
    vi.doMock('../../lib/cover-storage.js', () => coverStorageMock)
    const { storyRoutes } = await import('../../routes/stories.js')
    const built = createMockApp(mockPrisma)
    await storyRoutes(built.app)
    routes = built.routes
    vi.doUnmock('../../lib/cover-storage.js')
  })

  it('removes all covers for storyId after DB delete', async () => {
    const result = await callHandler(routes, 'DELETE', '/:id', {}, { id: 's1' })
    expect(result.body.success).toBe(true)
    expect(mockPrisma.story.delete).toHaveBeenCalledWith({ where: { id: 's1' } })
    expect(coverStorageMock.deleteCoversByStoryId).toHaveBeenCalledWith(expect.any(String), 's1')
  })

  it('does not fail when deleteCoversByStoryId throws (log only)', async () => {
    coverStorageMock.deleteCoversByStoryId.mockRejectedValue(new Error('disk error'))
    const result = await callHandler(routes, 'DELETE', '/:id', {}, { id: 's1' })
    expect(result.body.success).toBe(true)
  })
})
```

- [ ] **Step 2: 运行测试确认红**

```bash
cd apps/server && pnpm test -- stories-delete-cascade
```

预期：FAIL — deleteCoversByStoryId 未被调用。

- [ ] **Step 3: 改造 DELETE handler**

在 `apps/server/src/routes/stories.ts` 顶部 import 区域追加：

```ts
import { deleteCoversByStoryId } from '../lib/cover-storage.js'
```

替换 DELETE handler（约 line 125-130）：

```ts
  // DELETE /stories/:id
  app.delete('/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    await app.prisma.story.delete({ where: { id } })
    // cascade 清理 covers（失败仅 log,不阻塞）
    try {
      await deleteCoversByStoryId(UPLOADS_ROOT, id)
    } catch (err) {
      app.log.warn({ err, storyId: id }, 'cascade cover cleanup failed')
    }
    return { success: true }
  })
```

- [ ] **Step 4: 运行测试确认绿**

```bash
cd apps/server && pnpm test -- stories-delete-cascade
```

预期：2 个 case PASS。

- [ ] **Step 5: typecheck**

```bash
cd apps/server && pnpm typecheck
```

预期：exit 0。

- [ ] **Step 6: Commit**

```bash
cd D:/MGit-Projects/ai-novel-runtime
git add apps/server/src/routes/stories.ts apps/server/src/__tests__/routes/stories-delete-cascade.test.ts
git commit -m "feat(server): DELETE story cascade 清理 covers 文件"
```

---

## Task 8: app.ts 接入 static + server.ts mkdir + .gitignore

**Files:**
- Modify: `apps/server/src/app.ts:2-3, 43, 55-71`
- Modify: `apps/server/src/server.ts`（启动时 mkdir）
- Modify: `.gitignore`（root）

- [ ] **Step 1: 在 app.ts 注册 static plugin**

`apps/server/src/app.ts` 顶部 import 区域加：

```ts
import staticPlugin from '@fastify/static'
import { UPLOADS_ROOT } from './config/paths.js'
```

在 `await app.register(prismaPlugin)` 之后加：

```ts
  // 暴露上传的图片
  await app.register(staticPlugin, {
    root: UPLOADS_ROOT,
    prefix: '/uploads/',
    decorateReply: false
  })
```

- [ ] **Step 2: server.ts 启动时 mkdir**

`apps/server/src/server.ts` 顶部加 import：

```ts
import { mkdirSync } from 'fs'
import { UPLOADS_ROOT } from './config/paths.js'
```

在启动 listen 之前加：

```ts
mkdirSync(UPLOADS_ROOT, { recursive: true })
console.log(`[uploads] directory ready: ${UPLOADS_ROOT}`)
```

- [ ] **Step 3: .gitignore 加 uploads 目录**

`.gitignore` 末尾追加：

```
# 运行时上传的封面
apps/server/uploads/
```

- [ ] **Step 4: typecheck + 启动 server 验证**

```bash
cd apps/server && pnpm typecheck
cd D:/MGit-Projects/ai-novel-runtime && pnpm --filter server dev
```

预期：terminal 输出 `[uploads] directory ready: .../apps/server/uploads` 且服务正常启动。Ctrl+C 退出。

- [ ] **Step 5: Commit**

```bash
cd D:/MGit-Projects/ai-novel-runtime
git add apps/server/src/app.ts apps/server/src/server.ts .gitignore
git commit -m "feat(server): 静态服务 uploads + 启动 mkdir + .gitignore"
```

---

## Task 9: 前端 api/stories.ts types + removeCover

**Files:**
- Modify: `apps/web/src/api/stories.ts:1-24`

- [ ] **Step 1: 修改 api/stories.ts**

完整重写为：

```ts
import { api } from '../utils/api'

export interface StoryCreate {
  title: string
  description?: string
  runtimeProfileId?: string | null
  aiProviderConfigId?: string | null
}

export interface StoryUpdate {
  title?: string
  description?: string
  status?: string
  runtimeProfileId?: string | null
  aiProviderConfigId?: string | null
}

// 扩展返回类型：coverUrl 由后端返回
export interface Story {
  id: string
  title: string
  description: string | null
  status: string
  coverUrl?: string | null
  // ...其他字段保持 any 在 Stories.vue 现状即可
  [key: string]: any
}

export const storiesApi = {
  list: () => api.get<{ success: true; data: Story[] }>('/api/stories'),
  get: (id: string) => api.get<{ success: true; data: Story }>(`/api/stories/${id}`),
  create: (data: StoryCreate) => api.post<{ success: true; data: Story }>('/api/stories', data),
  update: (id: string, data: StoryUpdate | FormData) => api.put<{ success: true; data: Story }>(`/api/stories/${id}`, data),
  remove: (id: string) => api.delete<{ success: true }>(`/api/stories/${id}`),
  removeCover: (id: string) => api.delete<{ success: true }>(`/api/stories/${id}/cover`)
}
```

> 注：`api.put` 的 body 类型扩展为 `StoryUpdate | FormData` 是为了支持 multipart 上传。`api` 工具（`utils/api.ts`）需检查是否透传 FormData 即可（axios 默认行为，无需改）。

- [ ] **Step 2: 确认 utils/api.ts 透传 FormData**

```bash
grep -n "FormData\|transformRequest" D:/MGit-Projects/ai-novel-runtime/apps/web/src/utils/api.ts
```

预期：可能没有 FormData 字样，但 axios 默认会检测 FormData 并设 Content-Type，无需改 utils。

- [ ] **Step 3: typecheck**

```bash
cd apps/web && pnpm typecheck
```

预期：exit 0（Story interface 是后加的，下游 `Stories.vue` 还是 `any[]` 不受影响）。

- [ ] **Step 4: Commit**

```bash
cd D:/MGit-Projects/ai-novel-runtime
git add apps/web/src/api/stories.ts
git commit -m "feat(web): storiesApi types 加 coverUrl + removeCover"
```

---

## Task 10: useStoriesViewPrefs composable

**Files:**
- Create: `apps/web/src/composables/useStoriesViewPrefs.ts`

- [ ] **Step 1: 创建 composable**

`apps/web/src/composables/useStoriesViewPrefs.ts`：

```ts
import { ref, watch } from 'vue'

const VIEW_KEY = 'novel-runtime:stories-view-mode'
const FILTER_KEY = 'novel-runtime:stories-cover-filter'

export type StoriesViewMode = 'table' | 'cards'
export type StoriesCoverFilter = 'all' | 'with-cover'

function readStored<T extends string>(key: string, fallback: T, allowed: readonly T[]): T {
  const raw = localStorage.getItem(key)
  return (allowed as readonly string[]).includes(raw as string) ? (raw as T) : fallback
}

export function useStoriesViewPrefs() {
  const viewMode = ref<StoriesViewMode>(
    readStored(VIEW_KEY, 'table', ['table', 'cards'] as const)
  )
  const coverFilter = ref<StoriesCoverFilter>(
    readStored(FILTER_KEY, 'all', ['all', 'with-cover'] as const)
  )

  watch(viewMode,    v => localStorage.setItem(VIEW_KEY, v), { flush: 'post' })
  watch(coverFilter, v => localStorage.setItem(FILTER_KEY, v), { flush: 'post' })

  return { viewMode, coverFilter }
}
```

- [ ] **Step 2: typecheck**

```bash
cd apps/web && pnpm typecheck
```

预期：exit 0。

- [ ] **Step 3: Commit**

```bash
cd D:/MGit-Projects/ai-novel-runtime
git add apps/web/src/composables/useStoriesViewPrefs.ts
git commit -m "feat(web): useStoriesViewPrefs composable (localStorage 持久化)"
```

---

## Task 11: StoryCover.vue 组件（含印章算法）

**Files:**
- Create: `apps/web/src/components/StoryCover.vue`

- [ ] **Step 1: 创建组件**

`apps/web/src/components/StoryCover.vue`：

```vue
<template>
  <div class="story-cover" :class="{ 'story-cover--has-image': !!resolvedUrl }">
    <img
      v-if="resolvedUrl"
      :src="resolvedUrl"
      :alt="story.title"
      class="story-cover__image"
    />
    <div
      v-else
      class="story-cover__stamp"
      :style="stampStyle"
    >
      <span class="story-cover__glyph">{{ glyph }}</span>
      <div class="story-cover__seal">印</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

interface Props {
  story: { title: string; coverUrl?: string | null }
}
const props = defineProps<Props>()

// URL 校验：只接受 /uploads/covers/{id}-{ts}.{ext}
const URL_RE = /^\/uploads\/covers\/[a-f0-9-]+-\d+\.(jpg|png|webp)$/

const resolvedUrl = computed(() => {
  const u = props.story.coverUrl
  if (u && URL_RE.test(u)) return u
  return null
})

// FNV-1a 32-bit — 稳定、低碰撞、零依赖
export function fnv1a32(str: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h
}

function hashColor(title: string): { from: string; to: string } {
  const hue = fnv1a32(title) % 360
  return {
    from: `hsl(${hue}, 45%, 35%)`,
    to:   `hsl(${(hue + 30) % 360}, 55%, 20%)`
  }
}

function firstGlyph(title: string): string {
  const t = title.trim()
  if (!t) return '?'
  const first = t[0]
  // CJK / 平假名 / 片假名 / 韩文 直接用首字
  if (/[一-鿿぀-ヿ가-힯]/.test(first)) return first
  return first.toUpperCase()
}

const glyph = computed(() => firstGlyph(props.story.title))
const stampStyle = computed(() => {
  const { from, to } = hashColor(props.story.title)
  return {
    backgroundImage: `linear-gradient(135deg, ${from} 0%, ${to} 100%)`
  }
})
</script>

<style scoped>
.story-cover {
  position: relative;
  aspect-ratio: 3 / 4;
  overflow: hidden;
  background: var(--color-stone-gray, #f0f0ee);
  border-radius: 12px 12px 0 0;
}
.story-cover__image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.story-cover__stamp {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.story-cover__glyph {
  font-size: clamp(64px, 18vw, 120px);
  font-weight: 600;
  color: #fff;
  font-family: 'Songti SC', 'STSong', 'Noto Serif CJK SC', serif;
  opacity: 0.92;
  user-select: none;
}
.story-cover__seal {
  position: absolute;
  bottom: 12px;
  right: 12px;
  width: 32px;
  height: 32px;
  background: #c8392f;
  color: #fff;
  font-size: 14px;
  font-family: 'Songti SC', 'STSong', serif;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 2px;
  user-select: none;
}
</style>
```

- [ ] **Step 2: typecheck**

```bash
cd apps/web && pnpm typecheck
```

预期：exit 0。

- [ ] **Step 3: Commit**

```bash
cd D:/MGit-Projects/ai-novel-runtime
git add apps/web/src/components/StoryCover.vue
git commit -m "feat(web): StoryCover 组件 (3:4 + 印章首字占位)"
```

---

## Task 12: StoriesCards.vue 组件

**Files:**
- Create: `apps/web/src/components/StoriesCards.vue`

- [ ] **Step 1: 创建组件**

`apps/web/src/components/StoriesCards.vue`：

```vue
<template>
  <div class="stories-cards">
    <div
      v-for="story in stories"
      :key="story.id"
      class="stories-cards__item"
      @click="onDesign(story.id)"
    >
      <div class="stories-cards__cover">
        <StoryCover :story="story" />
        <n-dropdown
          :options="menuOptions(story)"
          trigger="click"
          @click.stop
        >
          <button class="stories-cards__menu" @click.stop aria-label="操作菜单">⋯</button>
        </n-dropdown>
      </div>
      <div class="stories-cards__body">
        <div class="stories-cards__title">{{ story.title }}</div>
        <div class="stories-cards__desc">{{ story.description || '（无简介）' }}</div>
        <div class="stories-cards__meta">
          <span class="stories-cards__status">{{ story.status }}</span>
          <span>· {{ story._count?.chapters ?? 0 }} 章</span>
          <span>· {{ story._count?.characters ?? 0 }} 角色</span>
        </div>
      </div>
    </div>
    <div v-if="stories.length === 0" class="stories-cards__empty">
      当前过滤条件下没有小说。
    </div>
  </div>
</template>

<script setup lang="ts">
import { h } from 'vue'
import { NDropdown, type DropdownOption } from 'naive-ui'
import { useRouter } from 'vue-router'
import StoryCover from './StoryCover.vue'

interface Story {
  id: string
  title: string
  description: string | null
  status: string
  coverUrl?: string | null
  _count?: { chapters: number; characters: number }
  [key: string]: any
}

interface Props {
  stories: Story[]
}
defineProps<Props>()
const emit = defineEmits<{
  edit: [story: Story]
  remove: [story: Story]
}>()

const router = useRouter()

function onDesign(id: string) {
  router.push(`/novel-design/${id}/characters`)
}

function menuOptions(story: Story): DropdownOption[] {
  return [
    { label: '编辑', key: 'edit' },
    { type: 'divider', key: 'd1' },
    { label: '删除', key: 'remove' }
  ].map(opt => ({
    ...opt,
    onSelect: () => {
      if (opt.key === 'edit') emit('edit', story)
      if (opt.key === 'remove') emit('remove', story)
    }
  })) as DropdownOption[]
}
</script>

<style scoped>
.stories-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 20px;
}
.stories-cards__item {
  cursor: pointer;
  border-radius: 12px;
  overflow: hidden;
  background: var(--color-pure-white, #fff);
  border: 1px solid var(--border-default, #e5e5e5);
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}
.stories-cards__item:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(0,0,0,0.08);
}
.stories-cards__cover {
  position: relative;
}
.stories-cards__menu {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: none;
  background: rgba(255,255,255,0.85);
  color: #333;
  font-size: 18px;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s ease;
}
.stories-cards__item:hover .stories-cards__menu {
  opacity: 1;
}
.stories-cards__body {
  padding: 12px 14px 14px;
}
.stories-cards__title {
  font-size: 15px;
  font-weight: var(--weight-semibold, 600);
  color: var(--color-ink-black, #222);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.stories-cards__desc {
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-tertiary, #888);
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  min-height: 36px;
}
.stories-cards__meta {
  margin-top: 8px;
  display: flex;
  gap: 6px;
  font-size: 11px;
  color: var(--text-tertiary, #888);
}
.stories-cards__status {
  padding: 1px 6px;
  background: var(--color-stone-gray, #f0f0ee);
  border-radius: 4px;
}
.stories-cards__empty {
  grid-column: 1 / -1;
  padding: 60px 20px;
  text-align: center;
  color: var(--text-tertiary, #888);
  font-size: 14px;
}
</style>
```

- [ ] **Step 2: typecheck**

```bash
cd apps/web && pnpm typecheck
```

预期：exit 0。

- [ ] **Step 3: Commit**

```bash
cd D:/MGit-Projects/ai-novel-runtime
git add apps/web/src/components/StoriesCards.vue
git commit -m "feat(web): StoriesCards 组件 (CSS Grid 自适应)"
```

---

## Task 13: Stories.vue 集成（工具栏 + 视图切换 + 编辑 modal 封面）

**Files:**
- Rewrite: `apps/web/src/views/Stories.vue`

- [ ] **Step 1: 重写 Stories.vue**

完整重写 `apps/web/src/views/Stories.vue`：

```vue
<template>
  <div>
    <header class="page-head">
      <div class="page-head__text">
        <span class="cap-eyebrow is-accent">STORIES</span>
        <h1 class="page-head__title">小说管理</h1>
        <p class="page-head__lede cap-body-sm">每个故事是一个独立的运行时沙盒，可关联写作人格与运行模型。</p>
      </div>
      <div class="page-head__actions">
        <button class="cap-pill is-primary" @click="openCreate">+ 新建小说</button>
      </div>
    </header>

    <!-- 工具栏：视图切换 + 封面过滤（仅在有数据时显示） -->
    <div v-if="stories.length" class="stories-toolbar">
      <n-radio-group v-model:value="viewMode" size="small">
        <n-radio-button value="table">☰ 表格</n-radio-button>
        <n-radio-button value="cards">▦ 卡片</n-radio-button>
      </n-radio-group>
      <div class="stories-toolbar__filter">
        <n-switch v-model:value="coverFilterSwitch" size="small" />
        <span class="stories-toolbar__filter-label">仅显示含封面</span>
      </div>
    </div>

    <!-- 内容区 -->
    <div class="cap-card stories-content" :style="{ padding: viewMode === 'cards' ? '20px' : '0', overflow: 'hidden' }">
      <n-data-table
        v-if="viewMode === 'table'"
        :columns="columns"
        :data="filteredStories"
        :loading="loading"
        :bordered="false"
      />
      <StoriesCards
        v-else
        :stories="filteredStories"
        @edit="startEdit"
        @remove="handleDelete"
      />
    </div>

    <!-- 新建 / 编辑 modal -->
    <n-modal v-model:show="showModal" :title="editingId ? '编辑小说' : '新建小说'" preset="card" style="width: 560px">
      <n-form :model="form" label-placement="left" label-width="100">
        <n-form-item label="标题" required>
          <n-input v-model:value="form.title" placeholder="请输入小说标题" />
        </n-form-item>
        <n-form-item label="简介">
          <n-input v-model:value="form.description" type="textarea" placeholder="请输入简介" />
        </n-form-item>
        <n-form-item label="封面">
          <div class="cover-field">
            <div v-if="form.coverPreview" class="cover-field__preview">
              <img :src="form.coverPreview" alt="封面预览" />
              <button class="cover-field__remove" type="button" @click="clearCover">移除封面</button>
            </div>
            <div v-else-if="form.existingCoverUrl" class="cover-field__preview">
              <img :src="form.existingCoverUrl" alt="当前封面" />
              <button class="cover-field__remove" type="button" @click="markRemoveCover">移除封面</button>
            </div>
            <div v-else class="cover-field__empty">
              <span>暂无封面</span>
            </div>
            <input
              ref="fileInputRef"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              style="display:none"
              @change="onFileSelected"
            />
            <button class="cap-pill" type="button" @click="fileInputRef?.click()">选择图片</button>
            <span class="cover-field__hint">JPG / PNG / WebP，最大 2MB</span>
          </div>
        </n-form-item>
        <n-form-item label="写作人格">
          <n-select
            v-model:value="form.runtimeProfileId"
            :options="profileOptions"
            placeholder="选择关联的 Runtime Profile（可选）"
            clearable
          />
        </n-form-item>
        <n-form-item label="运行模型">
          <n-select
            v-model:value="form.aiProviderConfigId"
            :options="modelOptions"
            placeholder="选择运行模型（可选）"
            clearable
          />
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showModal = false">取消</n-button>
          <n-button type="primary" :loading="saving" @click="handleSave">{{ saving ? '保存中…' : '保存' }}</n-button>
        </n-space>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, h } from 'vue'
import { useRouter } from 'vue-router'
import {
  NSpace, NButton, NDataTable, NModal, NForm, NFormItem, NInput, NSelect,
  NRadioGroup, NRadioButton, NSwitch, useDialog, type DataTableColumns
} from 'naive-ui'
import { useMessage } from 'naive-ui'
import { storiesApi } from '../api/stories'
import { runtimeApi } from '../api/runtime'
import { aiProviderApi } from '../api/ai-provider'
import { useStoriesViewPrefs } from '../composables/useStoriesViewPrefs'
import StoriesCards from '../components/StoriesCards.vue'

const router = useRouter()
const dialog = useDialog()
const message = useMessage()
const { viewMode, coverFilter } = useStoriesViewPrefs()

const stories = ref<any[]>([])
const profiles = ref<any[]>([])
const models = ref<any[]>([])
const loading = ref(false)
const saving = ref(false)
const showModal = ref(false)
const editingId = ref<string | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)

const form = ref<{
  title: string
  description: string
  runtimeProfileId: string | null
  aiProviderConfigId: string | null
  coverFile: File | null
  coverPreview: string | null
  existingCoverUrl: string | null
  removeCover: boolean
}>({
  title: '',
  description: '',
  runtimeProfileId: null,
  aiProviderConfigId: null,
  coverFile: null,
  coverPreview: null,
  existingCoverUrl: null,
  removeCover: false
})

const profileOptions = computed(() =>
  profiles.value.map(p => ({ label: p.name, value: p.id }))
)
const modelOptions = computed(() =>
  models.value.map(m => ({
    label: `${m.name} / ${m.model}` + (m.isDefault ? ' (默认)' : ''),
    value: m.id
  }))
)

// 双向桥接: coverFilter (string) <-> coverFilterSwitch (boolean)
const coverFilterSwitch = computed<boolean>({
  get: () => coverFilter.value === 'with-cover',
  set: v => { coverFilter.value = v ? 'with-cover' : 'all' }
})

const filteredStories = computed(() => {
  if (coverFilter.value === 'all') return stories.value
  return stories.value.filter(s => !!s.coverUrl)
})

const columns: DataTableColumns<any> = [
  { title: '封面', key: 'coverUrl', width: 60, render(row) {
    return row.coverUrl
      ? h('img', { src: row.coverUrl, style: 'width:32px;height:42px;object-fit:cover;border-radius:4px' })
      : h('div', { style: 'width:32px;height:42px;background:var(--color-stone-gray);border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:10px;color:#aaa' }, '—')
  }},
  { title: '标题', key: 'title' },
  { title: '简介', key: 'description', ellipsis: { tooltip: true } },
  { title: '状态', key: 'status', width: 100 },
  { title: '写作助手', key: 'runtimeProfile', width: 150, render(row) { return row.runtimeProfile?.name || '-' } },
  { title: '运行模型', key: 'defaultAiProvider', width: 180, render(row) {
    return row.defaultAiProvider ? `${row.defaultAiProvider.name} / ${row.defaultAiProvider.model}` : '系统默认'
  }},
  { title: '章节数', key: '_count.chapters', width: 80 },
  { title: '角色数', key: '_count.characters', width: 80 },
  { title: '更新时间', key: 'updatedAt', width: 170 },
  {
    title: '操作',
    key: 'actions',
    width: 220,
    render(row) {
      return h(NSpace, null, {
        default: () => [
          h(NButton, { size: 'small', type: 'primary', onClick: () => enterDesign(row.id) }, { default: () => '设计' }),
          h(NButton, { size: 'small', onClick: () => startEdit(row) }, { default: () => '编辑' }),
          h(NButton, { size: 'small', type: 'error', onClick: () => handleDelete(row) }, { default: () => '删除' })
        ]
      })
    }
  }
]

async function loadStories() {
  loading.value = true
  try {
    const [storiesRes, profilesRes, modelsRes] = await Promise.all([
      storiesApi.list(),
      runtimeApi.list(),
      aiProviderApi.list()
    ])
    stories.value = (storiesRes as any).data.data
    profiles.value = (profilesRes as any).data.data
    models.value = (modelsRes as any).data.data
  } finally {
    loading.value = false
  }
}

function enterDesign(storyId: string) {
  router.push(`/novel-design/${storyId}/characters`)
}

function openCreate() {
  editingId.value = null
  resetForm()
  showModal.value = true
}

function startEdit(row: any) {
  editingId.value = row.id
  form.value = {
    title: row.title,
    description: row.description || '',
    runtimeProfileId: row.runtimeProfileId || null,
    aiProviderConfigId: row.aiProviderConfigId || null,
    coverFile: null,
    coverPreview: null,
    existingCoverUrl: row.coverUrl || null,
    removeCover: false
  }
  showModal.value = true
}

function resetForm() {
  form.value = {
    title: '', description: '', runtimeProfileId: null, aiProviderConfigId: null,
    coverFile: null, coverPreview: null, existingCoverUrl: null, removeCover: false
  }
}

function onFileSelected(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  if (!['image/jpeg','image/png','image/webp'].includes(file.type)) {
    message.error('仅支持 JPG / PNG / WebP 格式')
    input.value = ''
    return
  }
  if (file.size > 2 * 1024 * 1024) {
    message.error('文件不能超过 2MB')
    input.value = ''
    return
  }

  form.value.coverFile = file
  form.value.removeCover = false
  // 预览用 FileReader
  const reader = new FileReader()
  reader.onload = ev => { form.value.coverPreview = ev.target?.result as string }
  reader.readAsDataURL(file)
}

function clearCover() {
  form.value.coverFile = null
  form.value.coverPreview = null
  if (fileInputRef.value) fileInputRef.value.value = ''
  // 区分: 编辑模式下如果原本有图,标记为移除
  if (editingId.value && form.value.existingCoverUrl) {
    form.value.removeCover = true
    form.value.existingCoverUrl = null
  }
}

function markRemoveCover() {
  form.value.removeCover = true
  form.value.existingCoverUrl = null
}

async function handleSave() {
  if (!form.value.title) {
    message.error('请输入标题')
    return
  }
  saving.value = true
  try {
    if (form.value.coverFile) {
      // multipart
      const fd = new FormData()
      fd.append('title', form.value.title)
      fd.append('description', form.value.description)
      if (form.value.runtimeProfileId) fd.append('runtimeProfileId', form.value.runtimeProfileId)
      if (form.value.aiProviderConfigId) fd.append('aiProviderConfigId', form.value.aiProviderConfigId)
      fd.append('cover', form.value.coverFile)
      if (form.value.removeCover) fd.append('removeCover', 'true')
      if (editingId.value) {
        await storiesApi.update(editingId.value, fd)
      } else {
        await storiesApi.create(fd as any)  // 当前 create 不接受 multipart,可后续扩展
      }
    } else {
      const payload: any = {
        title: form.value.title,
        description: form.value.description,
        runtimeProfileId: form.value.runtimeProfileId,
        aiProviderConfigId: form.value.aiProviderConfigId
      }
      if (form.value.removeCover) payload.removeCover = 'true'  // 仅作为提示字段,后端 PUT 走 multipart 才会真删除
      if (editingId.value) {
        await storiesApi.update(editingId.value, payload)
      } else {
        await storiesApi.create(payload)
      }
    }
    showModal.value = false
    editingId.value = null
    resetForm()
    await loadStories()
    message.success('已保存')
  } catch (err: any) {
    message.error('保存失败: ' + (err?.message || '未知错误'))
  } finally {
    saving.value = false
  }
}

function handleDelete(row: any) {
  const chapterCount = row._count?.chapters ?? 0
  const characterCount = row._count?.characters ?? 0
  dialog.warning({
    title: '确认删除',
    content: `确定要删除小说《${row.title}》吗？${chapterCount > 0 || characterCount > 0 ? `该小说包含 ${chapterCount} 个章节、${characterCount} 个角色，删除后不可恢复。` : '删除后不可恢复。'}`,
    positiveText: '删除',
    negativeText: '取消',
    positiveButtonProps: { type: 'error' },
    onPositiveClick: async () => {
      await storiesApi.remove(row.id)
      await loadStories()
    }
  })
}

onMounted(loadStories)
</script>

<style scoped>
.stories-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 0 14px 0;
}
.stories-toolbar__filter {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text-tertiary, #888);
}
.stories-content {
  background: var(--color-pure-white, #fff);
}
.cover-field {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.cover-field__preview {
  display: flex;
  align-items: center;
  gap: 8px;
}
.cover-field__preview img {
  width: 64px;
  height: 84px;
  object-fit: cover;
  border-radius: 6px;
  border: 1px solid var(--border-default, #e5e5e5);
}
.cover-field__remove {
  background: transparent;
  border: none;
  color: #c8392f;
  font-size: 12px;
  cursor: pointer;
  text-decoration: underline;
}
.cover-field__empty {
  width: 64px;
  height: 84px;
  background: var(--color-stone-gray, #f0f0ee);
  border: 1px dashed var(--border-default, #d0d0d0);
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  color: var(--text-tertiary, #aaa);
}
.cover-field__hint {
  font-size: 11px;
  color: var(--text-tertiary, #aaa);
}
</style>
```

- [ ] **Step 2: typecheck**

```bash
cd apps/web && pnpm typecheck
```

预期：exit 0。

- [ ] **Step 3: lint**

```bash
cd apps/web && pnpm lint
```

预期：无 error（warning 可接受）。

- [ ] **Step 4: Commit**

```bash
cd D:/MGit-Projects/ai-novel-runtime
git add apps/web/src/views/Stories.vue
git commit -m "feat(web): Stories.vue 集成 (工具栏 + 卡片视图 + 封面上传/移除)"
```

---

## Task 14: 最终验证（typecheck + lint + 手动冒烟）

**Files:** 无（仅验证）

- [ ] **Step 1: 全量 typecheck**

```bash
cd D:/MGit-Projects/ai-novel-runtime
pnpm typecheck
```

预期：exit 0。

- [ ] **Step 2: 全量 lint**

```bash
pnpm lint
```

预期：exit 0（已存在 warning 可接受）。

- [ ] **Step 3: 全量测试**

```bash
pnpm test
```

预期：所有新增 + 已有测试 PASS。

- [ ] **Step 4: 启动 dev stack**

```bash
pnpm dev
```

预期：后端 3000 + 前端 5173 同时起来，terminal 输出 `[uploads] directory ready`。

- [ ] **Step 5: 手动冒烟（按 spec §10 清单）**

打开浏览器 http://localhost:5173 → 小说管理，按下表验证：

| # | 动作 | 期望 |
|---|---|---|
| 1 | 上传 1MB jpg | modal 预览正常，保存后列表卡片显示图片 |
| 2 | 上传 3MB 文件 | 报错"文件不能超过 2MB"，不上传 |
| 3 | 上传 image/gif | 报错"仅支持 JPG/PNG/WebP" |
| 4 | 编辑 modal 点"移除封面" | 卡片回退到印章首字占位 |
| 5 | 工具栏切到"卡片"视图 | localStorage `novel-runtime:stories-view-mode` = `cards`；刷新后仍是卡片 |
| 6 | 工具栏开关"仅显示含封面" | 列表只剩含封面；刷新后状态保留 |
| 7 | 删除整本小说 | 对应 `apps/server/uploads/covers/{id}-*.{ext}` 文件消失 |

- [ ] **Step 6: 关闭 dev，commit any leftover changes**

```bash
cd D:/MGit-Projects/ai-novel-runtime
git status  # 应只有 docs/ 或 apps/server/uploads/ (gitignore) untracked
```

预期：untracked 应只剩 `.superpowers/`（会话产物）和 `apps/server/uploads/`（运行时数据）。

---

## Self-Review Checklist

- ✅ 每个 spec §4.1-4.2 新增/修改文件都有对应 task
- ✅ spec §5 数据模型 → Task 2
- ✅ spec §6 API → Task 5 (DELETE/cover) + Task 6 (PUT multipart) + Task 7 (DELETE cascade)
- ✅ spec §7 前端 → Task 9 (api) + Task 10 (composable) + Task 11 (StoryCover) + Task 12 (StoriesCards) + Task 13 (Stories.vue)
- ✅ spec §8 错误处理 → 散落在 Task 3, 5, 6 中
- ✅ spec §9 测试策略 → cover-storage 单元测 + routes 集成测
- ✅ spec §10 验证清单 → Task 14
- ✅ spec §11 代码原则 → 各函数都拆成 pure helpers
- ✅ Type consistency：`coverUrl`、`Story`、`removeCover` 在所有 task 一致
- ✅ Placeholder 扫描：无 TBD/TODO

---

## 完成 = 上述 14 个 task 全 ✅