# Q12 — routes-v2/chapters.ts 按职责拆分 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `apps/server/src/routes-v2/chapters.ts` 650 行单文件拆成 5 个按职责命名的兄弟文件，让 `chapters.ts` 回归纯 CRUD 骨架（~140 行），跟现有 `chapters-archive.ts` / `chapters-analysis.ts` 框架完全对齐。

**Architecture:** 纯物理搬迁 — 代码块从 `chapters.ts` 整段搬到新文件，路由路径 / 请求体 schema / 响应 shape 零改动。`index.ts` `register` 风格不变。新文件命名按现有兄弟文件惯例 `v2XxxRoutes` 函数。

**Tech Stack:** Fastify + Prisma + Zod + 模块导出（无新增依赖）。

**Spec:** `docs/superpowers/specs/2026-07-04-q12-routes-chapters-split-design.md`

---

## File Structure

**新建**（4 个）:
- `apps/server/src/routes-v2/provider-configs.ts` — `v2ProviderConfigsRoutes(app)` — GET `/provider-configs`
- `apps/server/src/routes-v2/chapters-drafts.ts` — `v2ChapterDraftsRoutes(app)` — GET drafts + DELETE draft
- `apps/server/src/routes-v2/chapters-config.ts` — `v2ChapterConfigRoutes(app)` — POST config + POST memory-search + POST preview
- `apps/server/src/routes-v2/chapters-generate.ts` — `v2ChapterGenerateRoutes(app)` — **重写**为 POST generate (SSE)，替换现有 stub

**修改**（2 个）:
- `apps/server/src/routes-v2/chapters.ts` — 650 → ~140 行，删 8 个端点 + 5 个 import
- `apps/server/src/routes-v2/index.ts` — 加 3 个 import + 3 个 register（generate 已注册，只需 import 新名）

**不改**:
- 任何 service 层代码
- 任何前端代码
- 任何 API 路径 / 请求体 / 响应 shape
- 任何现有兄弟文件（archive / analysis / generate stub register 不变）

---

## 任务 1：move provider-configs 端点

**Files:**
- Create: `apps/server/src/routes-v2/provider-configs.ts`
- Modify: `apps/server/src/routes-v2/chapters.ts` (删 L34-53 端点 + L36 import 检查)
- Modify: `apps/server/src/routes-v2/index.ts` (加 import + register)

- [ ] **Step 1: 写 `provider-configs.ts`**

写入以下完整内容到 `apps/server/src/routes-v2/provider-configs.ts`：

```typescript
import type { FastifyInstance } from 'fastify'

/**
 * GET /api/v2/provider-configs — 可用 AI 模型列表（不含 apiKey）
 * 原本挂在 chapters.ts 第 34-53 行，Q12 拆出独立文件。
 */
export async function v2ProviderConfigsRoutes(app: FastifyInstance) {
  app.get('/provider-configs', async () => {
    const configs = await app.prisma.aiProviderConfig.findMany({
      where: { apiKey: { not: null } },
      select: {
        id: true,
        name: true,
        model: true,
        contextLength: true,
        maxTokens: true,
        temperature: true,
        isDefault: true,
        type: true,
        remarks: true
      },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }]
    })
    return { success: true, data: configs }
  })
}
```

- [ ] **Step 2: 从 `chapters.ts` 删 provider-configs 端点**

打开 `apps/server/src/routes-v2/chapters.ts`，删除 **L34-53** 整个端点块（包含上方注释 "// GET /api/v2/provider-configs ..."）。

具体操作：在 `export async function v2ChapterRoutes(app: FastifyInstance) {` 之后，紧跟的第一个 `// GET /api/v2/provider-configs` 注释 + 后续 `app.get('/provider-configs', ...)` 整段删除。下一行应是 `// GET /api/v2/chapters?storyId=xxx` 注释。

- [ ] **Step 3: 在 `index.ts` 注册**

打开 `apps/server/src/routes-v2/index.ts`，加 import：

```typescript
import { v2ProviderConfigsRoutes } from './provider-configs.js'
```

在 `await app.register(v2ChapterRoutes)` **之前**（任意位置）加 register：

```typescript
await app.register(v2ProviderConfigsRoutes)
```

- [ ] **Step 4: typecheck 验证**

```bash
cd "D:/MGit-Projects/ai-novel-runtime" && pnpm typecheck 2>&1 | tail -10
```

期望：所有项目 Done，无 error。

- [ ] **Step 5: 端点 smoke test**

```bash
curl -s http://localhost:3000/api/v2/provider-configs | head -c 200
```

（dev server 起在 :3000 时跑；否则跳过。）

期望：`{"success":true,"data":[{...}]}`

- [ ] **Step 6: commit**

```bash
cd "D:/MGit-Projects/ai-novel-runtime" && git add apps/server/src/routes-v2/provider-configs.ts apps/server/src/routes-v2/chapters.ts apps/server/src/routes-v2/index.ts && git commit -m "$(cat <<'EOF'
refactor(v2): Q12-1 — move provider-configs to standalone file

chapters.ts: 删 L34-53 GET /provider-configs 端点
新增 provider-configs.ts (25 行) 含 v2ProviderConfigsRoutes
routes-v2/index.ts: import + register

API 路径不变，前端零改动。

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## 任务 2：move drafts 端点

**Files:**
- Create: `apps/server/src/routes-v2/chapters-drafts.ts`
- Modify: `apps/server/src/routes-v2/chapters.ts` (删 L199-224 两个端点)
- Modify: `apps/server/src/routes-v2/index.ts`

- [ ] **Step 1: 写 `chapters-drafts.ts`**

写入以下完整内容到 `apps/server/src/routes-v2/chapters-drafts.ts`：

```typescript
import type { FastifyInstance } from 'fastify'

/**
 * 候选文章路由：
 * - GET /api/v2/chapters/:chapterId/drafts — 列表
 * - DELETE /api/v2/drafts/:draftId — 删除
 * 原本挂在 chapters.ts 第 199-224 行，Q12 拆出。
 */
export async function v2ChapterDraftsRoutes(app: FastifyInstance) {
  // GET /api/v2/chapters/:chapterId/drafts — 候选文章列表
  app.get('/chapters/:chapterId/drafts', async (request) => {
    const { chapterId } = request.params as { chapterId: string }
    const drafts = await app.prisma.v2Draft.findMany({
      where: { chapterId },
      orderBy: { createdAt: 'desc' }
    })
    return { success: true, data: drafts }
  })

  // DELETE /api/v2/drafts/:draftId — 删除候选文章
  app.delete('/drafts/:draftId', async (request) => {
    const { draftId } = request.params as { draftId: string }
    const draft = await app.prisma.v2Draft.findUnique({
      where: { id: draftId },
      include: { chapter: { select: { status: true } } }
    })
    if (!draft) {
      return { success: false, error: '候选文章不存在' }
    }
    if (draft.chapter.status === 'archived') {
      return { success: false, error: '已归档章节的候选文章不可删除' }
    }
    await app.prisma.v2Draft.delete({ where: { id: draftId } })
    return { success: true }
  })
}
```

- [ ] **Step 2: 从 `chapters.ts` 删 drafts 端点**

打开 `apps/server/src/routes-v2/chapters.ts`，删除 **L199-224**（注释 "// GET /api/v2/chapters/:chapterId/drafts" 起，到  `await app.prisma.v2Draft.delete({ where: { id: draftId } })` 行结束 + `return { success: true }` + `})`）。

下一行应是 `// POST /api/v2/chapters/:chapterId/preview` 注释。

- [ ] **Step 3: 在 `index.ts` 注册**

加 import：

```typescript
import { v2ChapterDraftsRoutes } from './chapters-drafts.js'
```

加 register（任意位置）：

```typescript
await app.register(v2ChapterDraftsRoutes)
```

- [ ] **Step 4: typecheck**

```bash
cd "D:/MGit-Projects/ai-novel-runtime" && pnpm typecheck 2>&1 | tail -10
```

期望：Done 无 error。

- [ ] **Step 5: 端点 smoke test**

```bash
# 假设 dev server 跑在 :3000；找一个 draft-less chapterId 测试 list 返 []
curl -s 'http://localhost:3000/api/v2/chapters/<chapterId>/drafts'
```

期望：`{"success":true,"data":[]}`

- [ ] **Step 6: commit**

```bash
cd "D:/MGit-Projects/ai-novel-runtime" && git add apps/server/src/routes-v2/chapters-drafts.ts apps/server/src/routes-v2/chapters.ts apps/server/src/routes-v2/index.ts && git commit -m "$(cat <<'EOF'
refactor(v2): Q12-2 — move drafts endpoints to chapters-drafts.ts

chapters.ts: 删 L199-224 (GET /chapters/:id/drafts + DELETE /drafts/:id)
新增 chapters-drafts.ts (30 行) 含 v2ChapterDraftsRoutes
routes-v2/index.ts: import + register

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## 任务 3：move config + memory-search + preview 端点

**Files:**
- Create: `apps/server/src/routes-v2/chapters-config.ts`
- Modify: `apps/server/src/routes-v2/chapters.ts` (删 L165-197 两端点 + L226-293 preview 段)
- Modify: `apps/server/src/routes-v2/index.ts`

- [ ] **Step 1: 写 `chapters-config.ts`**

写入以下完整内容到 `apps/server/src/routes-v2/chapters-config.ts`：

```typescript
import type { FastifyInstance } from 'fastify'
import { getDefaultConfig, searchRelevantMemories } from '../services-v2/config-defaults.js'
import { assemblePrompt } from '../services-v2/prompt-assembler.js'

/**
 * 章节配置与 prompt 组装路由：
 * - POST /api/v2/chapters/:chapterId/config — 生成并保存默认配置
 * - POST /api/v2/chapters/:chapterId/memory-search — 语义搜索记忆（"系统分配"按钮）
 * - POST /api/v2/chapters/:chapterId/preview — 仅组装 prompt 不调用 AI
 * 原本挂在 chapters.ts 第 165-197 + 226-293 行，Q12 拆出。
 */
function getConfigOrThrow(raw: string | null, ctx: string): any {
  if (raw == null || raw === '') return {}
  try { return JSON.parse(raw) } catch {
    throw new Error(`${ctx} JSON 解析失败: ${raw.slice(0, 80)}`)
  }
}

export async function v2ChapterConfigRoutes(app: FastifyInstance) {
  // POST /api/v2/chapters/:chapterId/config — 生成并保存默认配置
  app.post('/chapters/:chapterId/config', async (request) => {
    const { chapterId } = request.params as { chapterId: string }
    const existing = await app.prisma.v2Chapter.findUnique({ where: { id: chapterId } })
    if (!existing) {
      return { success: false, error: '章节不存在' }
    }
    if (existing.status === 'archived') {
      return { success: false, error: '已归档章节不可修改配置' }
    }
    const config = await getDefaultConfig(app.prisma, existing.storyId)
    await app.prisma.v2Chapter.update({
      where: { id: chapterId },
      data: { config: JSON.stringify(config) }
    })
    return { success: true, data: config }
  })

  // POST /api/v2/chapters/:chapterId/memory-search — 语义搜索记忆（"系统分配"按钮）
  app.post('/chapters/:chapterId/memory-search', async (request) => {
    const { chapterId } = request.params as { chapterId: string }
    const { query } = (request.body || {}) as { query?: string }
    if (!query?.trim()) {
      return { success: false, error: '缺少 query（请提供大纲文本作为搜索查询）' }
    }
    const chapter = await app.prisma.v2Chapter.findUnique({
      where: { id: chapterId },
      select: { storyId: true, number: true }
    })
    if (!chapter) return { success: false, error: '章节不存在' }
    const result = await searchRelevantMemories(app.prisma, chapter.storyId, query, chapter.number)
    return { success: true, data: result }
  })

  // POST /api/v2/chapters/:chapterId/preview — 仅组装 prompt 不调用 AI
  app.post('/chapters/:chapterId/preview', async (request, reply) => {
    const { chapterId } = request.params as { chapterId: string }
    const body = (request.body || {}) as any

    const existing = await app.prisma.v2Chapter.findUnique({ where: { id: chapterId } })
    if (!existing) return { success: false, error: '章节不存在' }

    const config: any = {
      characterIds: body.characterIds || [],
      memoryTypeIds: body.memoryTypeIds || [],
      plotArcIds: body.plotArcIds || [],
      loreIds: body.loreIds || [],
      outline: existing.outline || undefined,
      styleNotes: body.styleNotes || undefined,
      scene: body.scene || undefined
    }
    // body 未传数据源时，从 chapter.config 回退
    if (!body._useBodyConfig) {
      let saved: any
      try {
        saved = getConfigOrThrow(existing.config, '章节配置')
      } catch (err: any) {
        return reply.status(422).send({ success: false, error: `数据完整性错误: ${err.message}，请重新保存配置` })
      }
      if (!config.characterIds.length) config.characterIds = saved.characterIds || []
      if (!config.memoryTypeIds.length) config.memoryTypeIds = saved.memoryTypeIds || []
      if (!config.plotArcIds.length) config.plotArcIds = saved.plotArcIds || []
      if (!config.loreIds.length) config.loreIds = saved.loreIds || []
      if (!config.outline) config.outline = saved.outline || undefined
    }

    let contextLength = 64000
    const pcId = body.providerConfigId
    if (pcId) {
      const pc = await app.prisma.aiProviderConfig.findUnique({ where: { id: pcId }, select: { contextLength: true } })
      contextLength = pc?.contextLength || contextLength
    } else {
      const def = await app.prisma.aiProviderConfig.findFirst({ where: { isDefault: true }, select: { contextLength: true } })
      contextLength = def?.contextLength || contextLength
    }

    let systemMessage: string
    let userMessage: string
    let runtimeDegraded = false
    try {
      const assembled = await assemblePrompt(app.prisma, existing.storyId, config, contextLength)
      systemMessage = assembled.systemMessage
      userMessage = assembled.userMessage
      runtimeDegraded = assembled.runtimeDegraded === true
    } catch (err: any) {
      return reply.status(422).send({ success: false, error: `数据完整性错误: ${err.message}` })
    }
    const estSystem = Math.ceil(systemMessage.length / 2)
    const estUser = Math.ceil(userMessage.length / 2)
    return {
      success: true,
      data: {
        systemMessage,
        userMessage,
        estimatedSystemTokens: estSystem,
        estimatedUserTokens: estUser,
        estimatedTotalTokens: estSystem + estUser,
        contextBudget: contextLength,
        runtimeDegraded
      }
    }
  })
}
```

- [ ] **Step 2: 从 `chapters.ts` 删 3 个端点**

打开 `apps/server/src/routes-v2/chapters.ts`，依次删除：

**块 A**（L165-181，POST config + 注释）：从 `// POST /api/v2/chapters/:chapterId/config` 起到 `return { success: true, data: config }` + `})` 闭包结束。

**块 B**（L183-197，POST memory-search + 注释）：从 `// POST /api/v2/chapters/:chapterId/memory-search` 起到 `return { success: true, data: result }` + `})` 闭包结束。

**块 C**（L226-293，POST preview + 注释）：从 `// POST /api/v2/chapters/:chapterId/preview` 起到最外层 `})` 闭包结束 — 包括所有空行。

- [ ] **Step 3: chapters.ts 清理 import**

打开 `apps/server/src/routes-v2/chapters.ts`，L3-L7 imports 区域，删除已不再使用的 4 个 import：

```diff
 import type { FastifyInstance } from 'fastify'
-import { z } from 'zod'
 import { sha256 } from '../services-v2/hash.js'
-import { getDefaultConfig, searchRelevantMemories } from '../services-v2/config-defaults.js'
-import { assemblePrompt } from '../services-v2/prompt-assembler.js'
-import { resolveProvider, getProviderById } from '../services/ai-provider-init.js'
-import { logAiCall } from '../services-v2/ai-call-logger.js'
```

最终 imports 只剩：

```typescript
import type { FastifyInstance } from 'fastify'
import { sha256 } from '../services-v2/hash.js'
```

（GenerateBodySchema zod schema 也走 — 在任务 4 处理）

验证 `chapters.ts` 内无 `sha256` / `FastifyInstance` / `z` / `getDefaultConfig` / `searchRelevantMemories` / `assemblePrompt` / `resolveProvider` / `getProviderById` / `logAiCall` 未使用错误（typecheck 会查）。

- [ ] **Step 4: 在 `index.ts` 注册**

加 import：

```typescript
import { v2ChapterConfigRoutes } from './chapters-config.js'
```

加 register：

```typescript
await app.register(v2ChapterConfigRoutes)
```

- [ ] **Step 5: typecheck**

```bash
cd "D:/MGit-Projects/ai-novel-runtime" && pnpm typecheck 2>&1 | tail -15
```

期望：Done 无 error。如有 "unused import" 或 "variable unused" — 检查 chapters.ts 残留。

- [ ] **Step 6: 端点 smoke test**

```bash
# POST config
curl -s -X POST 'http://localhost:3000/api/v2/chapters/<chapterId>/config' | head -c 200
```

期望：`{"success":true,"data":{...}}`

- [ ] **Step 7: commit**

```bash
cd "D:/MGit-Projects/ai-novel-runtime" && git add apps/server/src/routes-v2/chapters-config.ts apps/server/src/routes-v2/chapters.ts apps/server/src/routes-v2/index.ts && git commit -m "$(cat <<'EOF'
refactor(v2): Q12-3 — move config + memory-search + preview to chapters-config.ts

chapters.ts: 删 L165-197 (POST config/memory-search) + L226-293 (POST preview)
新增 chapters-config.ts (105 行) 含 v2ChapterConfigRoutes
chapters.ts imports 清理: 4 个不再使用的 import 删除
routes-v2/index.ts: import + register

getConfigOrThrow 5 行函数复制而非抽 utils，跟 archive/analysis 现有惯例对齐。

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## 任务 4：替换 chapters-generate.ts stub 为真实 SSE

**Files:**
- Modify: `apps/server/src/routes-v2/chapters-generate.ts` (整文件重写)
- Modify: `apps/server/src/routes-v2/chapters.ts` (删 L295-570 SSE 段 + L16-32 GenerateBodySchema)

- [ ] **Step 1: 重写 `chapters-generate.ts`**

完整覆盖 `apps/server/src/routes-v2/chapters-generate.ts` 为以下内容：

```typescript
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { assemblePrompt } from '../services-v2/prompt-assembler.js'
import { resolveProvider, getProviderById } from '../services/ai-provider-init.js'
import { logAiCall } from '../services-v2/ai-call-logger.js'

/**
 * POST /api/v2/chapters/:chapterId/generate — SSE 流式生成候选文章
 * 原本挂在 chapters.ts 第 295-570 行（275 行），Q12 拆出到独立文件。
 * 替换之前 generate-stream stub 的占位（grep 验证 0 调用方）。
 */
function getConfigOrThrow(raw: string | null, ctx: string): any {
  if (raw == null || raw === '') return {}
  try { return JSON.parse(raw) } catch {
    throw new Error(`${ctx} JSON 解析失败: ${raw.slice(0, 80)}`)
  }
}

const GenerateBodySchema = z.object({
  providerConfigId: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(256).max(64000).optional(),
  characterIds: z.array(z.string()).optional(),
  memoryTypeIds: z.array(z.object({
    type: z.string(),
    category: z.string(),
    id: z.string()
  })).optional(),
  plotArcIds: z.array(z.string()).optional(),
  loreIds: z.array(z.string()).optional(),
  outline: z.string().optional(),
  styleNotes: z.string().optional(),
  scene: z.string().optional(),
  _useBodyConfig: z.boolean().optional()
})

export async function v2ChapterGenerateRoutes(app: FastifyInstance) {
  // POST /api/v2/chapters/:chapterId/generate — SSE 流式生成候选文章
  app.post('/chapters/:chapterId/generate', async (request, reply) => {
    const { chapterId } = request.params as { chapterId: string }
    const parsed = GenerateBodySchema.safeParse(request.body || {})
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: parsed.error.errors.map(e => `${e.path.join('.') || '<root>'}: ${e.message}`).join('; ')
      })
    }
    const body = parsed.data

    const existing = await app.prisma.v2Chapter.findUnique({ where: { id: chapterId } })
    if (!existing) {
      return reply.status(404).send({ success: false, error: '章节不存在' })
    }
    if (existing.status === 'archived') {
      return reply.status(400).send({ success: false, error: '已归档章节不可生成' })
    }

    // 限制同时生成中的候选数 ≤ 3
    const generatingCount = await app.prisma.v2Draft.count({
      where: { chapterId, status: 'generating' }
    })
    if (generatingCount >= 3) {
      return reply.status(400).send({ success: false, error: '已有 3 个候选正在生成中，请等待或删除后再试' })
    }

    // 组装 prompt — 优先用 body 中的配置，否则回退到 chapter.config
    const config: any = {
      characterIds: body.characterIds || [],
      memoryTypeIds: body.memoryTypeIds || [],
      plotArcIds: body.plotArcIds || [],
      loreIds: body.loreIds || [],
      outline: existing.outline || undefined
    }
    // body 未传数据源时，从 chapter.config 回退
    if (!body._useBodyConfig) {
      let saved: any
      try {
        saved = getConfigOrThrow(existing.config, '章节配置')
      } catch (err: any) {
        return reply.status(422).send({ success: false, error: `数据完整性错误: ${err.message}，请重新保存配置` })
      }
      if (!config.characterIds.length) config.characterIds = saved.characterIds || []
      if (!config.memoryTypeIds.length) config.memoryTypeIds = saved.memoryTypeIds || []
      if (!config.plotArcIds.length) config.plotArcIds = saved.plotArcIds || []
      if (!config.loreIds.length) config.loreIds = saved.loreIds || []
      if (!config.outline) config.outline = saved.outline || undefined
    }

    // 生成即保存：把当前配置写入 chapter.config，下次打开自动恢复
    {
      const configToSave: any = {
        characterIds: config.characterIds,
        memoryTypeIds: config.memoryTypeIds,
        plotArcIds: config.plotArcIds,
        loreIds: config.loreIds,
        providerConfigId: body.providerConfigId || undefined,
        temperature: body.temperature,
        maxTokens: body.maxTokens
      }
      try {
        await app.prisma.v2Chapter.update({
          where: { id: chapterId },
          data: { config: JSON.stringify(configToSave) }
        })
      } catch (err: any) {
        app.log.error(`[V2-Config] 保存配置失败: ${err.message}`)
        return reply.status(500).send({ success: false, error: '保存配置失败，请重试' })
      }
    }

    if (!config.outline?.trim()) {
      return reply.status(400).send({ success: false, error: '大纲不能为空，请先填写本章大纲' })
    }

    // 查 provider contextLength 用于 token 预算
    let contextLength = 64000
    const providerCfgId = body.providerConfigId
    if (providerCfgId) {
      const pc = await app.prisma.aiProviderConfig.findUnique({
        where: { id: providerCfgId },
        select: { contextLength: true }
      })
      contextLength = pc?.contextLength || contextLength
    } else {
      const defaultPc = await app.prisma.aiProviderConfig.findFirst({
        where: { isDefault: true },
        select: { contextLength: true }
      })
      contextLength = defaultPc?.contextLength || contextLength
    }

    let systemMessage: string
    let userMessage: string
    let runtimeDegraded = false
    try {
      const assembled = await assemblePrompt(app.prisma, existing.storyId, config, contextLength)
      systemMessage = assembled.systemMessage
      userMessage = assembled.userMessage
      runtimeDegraded = assembled.runtimeDegraded === true
    } catch (err: any) {
      return reply.status(422).send({ success: false, error: `数据完整性错误: ${err.message}` })
    }

    // 创建 draft，附上本次生成使用的配置快照
    const draftConfigMeta = await (async () => {
      let model: string | null = null
      let providerName: string | null = null
      const lookupId = providerCfgId || null
      if (lookupId) {
        const pc = await app.prisma.aiProviderConfig.findUnique({
          where: { id: lookupId },
          select: { name: true, model: true }
        }).catch((err: any) => { app.log.warn(`[V2-Provider] 查询 provider ${lookupId} 失败: ${err.message}`); return null })
        if (pc) { providerName = pc.name; model = pc.model }
      } else {
        const def = await app.prisma.aiProviderConfig.findFirst({
          where: { isDefault: true },
          select: { name: true, model: true }
        }).catch((err: any) => { app.log.warn(`[V2-Provider] 查询默认 provider 失败: ${err.message}`); return null })
        if (def) { providerName = def.name; model = def.model }
      }
      return JSON.stringify({
        outline: config.outline || '',
        characterIds: config.characterIds,
        memoryTypeIds: config.memoryTypeIds,
        plotArcIds: config.plotArcIds,
        loreIds: config.loreIds,
        providerConfigId: lookupId,
        temperature: body.temperature,
        maxTokens: body.maxTokens,
        model,
        providerName
      })
    })()
    const draft = await app.prisma.v2Draft.create({
      data: {
        chapterId,
        content: '',
        status: 'generating',
        config: draftConfigMeta
      }
    })

    // 设置 SSE 响应头
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    })

    const send = (event: string, data: any) => {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    }

    send('draft-start', { draftId: draft.id })

    // 运行时降级提示：assemblePrompt fallback 到 FALLBACK_SYSTEM 时告知前端
    if (runtimeDegraded) {
      send('runtime-warning', {
        draftId: draft.id,
        message: 'AI 写作人格加载失败，已使用通用 fallback。生成质量可能下降。'
      })
    }

    let resolved: any = null
    let logId: string | null = null
    try {
      // 解析 provider：支持 body 指定 providerConfigId，或走默认 fallback 链
      if (body.providerConfigId) {
        resolved = await getProviderById(app.prisma, body.providerConfigId)
      }
      if (!resolved) {
        resolved = await resolveProvider(app.prisma, existing.storyId, chapterId)
      }
      if (!resolved?.provider?.streamGenerate) {
        send('draft-error', { draftId: draft.id, error: '无可用 AI Provider' })
        reply.raw.end()
        return
      }

      const streamOptions: any = { system: systemMessage }
      if (body.temperature !== undefined) streamOptions.temperature = Number(body.temperature)
      if (body.maxTokens !== undefined) streamOptions.maxTokens = Number(body.maxTokens)

      const estimatedTokens = Math.ceil((systemMessage.length + userMessage.length) / 2)

      // 流式开始前先写日志，确保中断/断开也能留记录
      logId = await logAiCall(app.prisma, {
        storyId: existing.storyId,
        chapterId,
        callType: 'generation',
        aiProviderConfigId: resolved.config.id,
        providerName: resolved.config.name,
        model: resolved.config.model,
        systemMessage,
        userMessage,
        responseContent: '',
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        estimatedTokens,
        temperature: body.temperature,
        maxTokens: body.maxTokens,
        durationMs: 0,
        status: 'success'
      }).catch((err: any) => { app.log.warn(`[V2-PromptLog] 写入日志失败: ${err.message}`); return null })

      const genStartTime = Date.now()
      let fullContent = ''
      for await (const delta of resolved.provider.streamGenerate(userMessage, streamOptions)) {
        fullContent += delta
        send('draft-chunk', { draftId: draft.id, delta })
      }

      await app.prisma.v2Draft.update({
        where: { id: draft.id },
        data: { content: fullContent, status: 'completed' }
      })
      send('draft-done', { draftId: draft.id })

      // 回填日志：补充实际响应内容和耗时
      if (logId) {
        app.prisma.promptLog.update({
          where: { id: logId },
          data: { responseContent: fullContent, durationMs: Date.now() - genStartTime }
        }).catch((err: any) => app.log.warn(`[V2-PromptLog] 回填日志失败: ${err.message}`))
      }
    } catch (err: any) {
      // 错误处理路径：v2Draft.status='failed' 必须写入成功，否则 draft 卡在 generating
      // 重试一次（应对短暂 DB 抖动）；仍失败则 log error（不 throw，避免破坏 SSE 响应）
      let draftUpdateOk = false
      try {
        await app.prisma.v2Draft.update({
          where: { id: draft.id },
          data: { status: 'failed' }
        })
        draftUpdateOk = true
      } catch (firstErr: any) {
        app.log.warn(`[V2-Draft] draft 状态更新首次失败，准备重试: ${firstErr.message}`)
        try {
          await app.prisma.v2Draft.update({
            where: { id: draft.id },
            data: { status: 'failed' }
          })
          draftUpdateOk = true
        } catch (secondErr: any) {
          app.log.error(`[V2-Draft] draft 状态更新重试仍失败，draft 将卡在 generating 状态: ${secondErr.message}`)
        }
      }

      // 更新预设日志为错误状态
      if (logId) {
        app.prisma.promptLog.update({
          where: { id: logId },
          data: {
            status: 'error',
            errorMessage: err.message,
            responseContent: `[ERROR] ${(err.message || 'unknown').slice(0, 2000)}`,
            durationMs: 0
          }
        }).catch((logErr: any) => app.log.warn(`[V2-PromptLog] 错误日志更新失败: ${logErr.message}`))
      }

      try {
        send('draft-error', { draftId: draft.id, error: err.message })
      } catch (sendErr: any) {
        app.log.warn(`[V2-SSE] 发送 draft-error 失败（连接已断开）: ${sendErr.message}`)
      }
    }

    reply.raw.end()
  })
}
```

- [ ] **Step 2: 从 `chapters.ts` 删 SSE 端点 + GenerateBodySchema**

打开 `apps/server/src/routes-v2/chapters.ts`，删除：

**块 D**（L16-32，GenerateBodySchema 定义）：从 `const GenerateBodySchema = z.object({` 开始，整段到 `})` 结束（位于 export 函数之前）。

**块 E**（L295-570，SSE 端点）：从 `// POST /api/v2/chapters/:chapterId/generate` 注释起到最外层 `})` 闭包结束 — 包括所有空行。

- [ ] **Step 3: chapters.ts 终态验证**

打开 `apps/server/src/routes-v2/chapters.ts`，确认：

1. imports 只剩 2 行：FastifyInstance + sha256
2. export 函数内只剩 5 个端点：GET /chapters / POST /chapters / GET /:id / PUT /:id / DELETE /:id
3. 无 `z.` / `getDefaultConfig` / `assemblePrompt` / `resolveProvider` / `logAiCall` 引用
4. 无 GenerateBodySchema 定义
5. 函数闭合正确（最后 `})` 配对）

- [ ] **Step 4: typecheck + build**

```bash
cd "D:/MGit-Projects/ai-novel-runtime" && pnpm typecheck 2>&1 | tail -10 && pnpm build 2>&1 | tail -15
```

期望：两个都 Done 无 error。

- [ ] **Step 5: 端点 SSE smoke test（如果 dev server 跑）**

```bash
# 在 dev server 跑着的前提下：
# 找一个 draft-less chapterId，已保存大纲
curl -N -X POST 'http://localhost:3000/api/v2/chapters/<chapterId>/generate' \
  -H 'Content-Type: application/json' \
  -d '{}' --max-time 90 2>&1 | head -20
```

期望：SSE 事件流 `draft-start` → `draft-chunk` * n → `draft-done` 或 `draft-error`。

- [ ] **Step 6: commit**

```bash
cd "D:/MGit-Projects/ai-novel-runtime" && git add apps/server/src/routes-v2/chapters-generate.ts apps/server/src/routes-v2/chapters.ts && git commit -m "$(cat <<'EOF'
refactor(v2): Q12-4 — move SSE generate to chapters-generate.ts (replace stub)

chapters-generate.ts: 从 stub 替换为真实 SSE 实现（275 行）
chapters.ts: 删 L295-570 SSE 端点 + L16-32 GenerateBodySchema
chapters.ts imports: 清理后仅剩 FastifyInstance + sha256 2 行
chapters.ts 终态: 650 → ~140 行纯 CRUD 骨架

Q12 拆分完成 — chapters/archives/analysis/config/drafts/generate 五兄弟格局 + provider-configs 独立。
generate-stream stub 路径已 grep 验证 0 调用方，安全删除。

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## 任务 5：交叉验证 — typecheck + build + 4 兄弟文件统一性

- [ ] **Step 1: 全 typecheck**

```bash
cd "D:/MGit-Projects/ai-novel-runtime" && pnpm typecheck 2>&1 | tail -15
```

期望：所有项目 Done，无 error。

- [ ] **Step 2: 全 build**

```bash
cd "D:/MGit-Projects/ai-novel-runtime" && pnpm build 2>&1 | tail -15
```

期望：所有项目 Done，无 error。

- [ ] **Step 3: 文件结构盘点**

```bash
cd "D:/MGit-Projects/ai-novel-runtime" && wc -l apps/server/src/routes-v2/chapters*.ts apps/server/src/routes-v2/provider-configs.ts
```

期望输出（行数相近即可）：

```
   ~140 apps/server/src/routes-v2/chapters.ts
   ~275 apps/server/src/routes-v2/chapters-generate.ts
   ~105 apps/server/src/routes-v2/chapters-config.ts
    ~30 apps/server/src/routes-v2/chapters-drafts.ts
    ~25 apps/server/src/routes-v2/provider-configs.ts
```

- [ ] **Step 4: grep 残留验证**

```bash
cd "D:/MGit-Projects/ai-novel-runtime" && grep -nE "GenerateBodySchema|getDefaultConfig|searchRelevantMemories|assemblePrompt|resolveProvider|getProviderById|logAiCall|app\.get\('/provider-configs'|app\.get\('/chapters/:chapterId/drafts'|app\.post\('/chapters/:chapterId/config'|app\.post\('/chapters/:chapterId/memory-search'|app\.post\('/chapters/:chapterId/preview'" apps/server/src/routes-v2/chapters.ts
```

期望：无输出（chapters.ts 已彻底清理）。

- [ ] **Step 5: generate-stream stub 是否真删**

```bash
cd "D:/MGit-Projects/ai-novel-runtime" && grep -rn "generate-stream" apps/ 2>&1
```

期望：无输出（除本计划文档外已全清）。

---

## 任务 6：同步 docs/v2-architecture.md

**Files:**
- Modify: `docs/v2-architecture.md`

- [ ] **Step 1: §6.6 行数更新**

找到 `apps/server/src/routes-v2/chapters.ts` 这一段（CLAUDE.md/§6.6 列出 569 行；当前实际 650，CLAUDE.md 写的是过期数字）。改成：

```markdown
- `apps/server/src/routes-v2/chapters.ts` (~140 行) — CRUD 骨架（list/create/detail/update/delete + 级联事务）
- `apps/server/src/routes-v2/chapters-archive.ts` (~? 行) — archive/preArchive/savePending
- `apps/server/src/routes-v2/chapters-analysis.ts` (~? 行) — 5 路并行 AI analyze
- `apps/server/src/routes-v2/chapters-config.ts` (~105 行) — config + memory-search + preview
- `apps/server/src/routes-v2/chapters-drafts.ts` (~30 行) — 候选 list/delete
- `apps/server/src/routes-v2/chapters-generate.ts` (~275 行) — SSE 流式生成
- `apps/server/src/routes-v2/provider-configs.ts` (~25 行) — AI 模型列表
```

（实际行数从 `wc -l` 结果填入）

- [ ] **Step 2: §7.5 Q12 [ ] → [x]**

把 Q12 那行 `[ ]` 改成 `[x] (2026-07-04)` 并加决策文字（参考 §7.5 Q11 已有的格式）：

```markdown
- [x] **Q12** (2026-07-04): routes-v2/chapters.ts 650 → ~140 行（纯 CRUD 骨架）; 新增 4 个按职责命名的兄弟文件 (provider-configs / chapters-config / chapters-drafts / chapters-generate), 跟现有 chapters-archive / chapters-analysis 完全对齐 (5 兄弟 + provider-configs 独立 = 6 文件格局)。**决策**: 路由风格保持现状 (hardcode /chapters/... 路径) — 不借机改 prefix (KNOWN-ISSUES #7 留单独 PR); `getConfigOrThrow` 5 行函数复制而非抽 utils, 跟 archive/analysis 现有惯例对齐; `chapters-generate.ts` 当前 stub 替换为真实 SSE 实现, stub 路径 grep 验证 0 调用方安全删除。详见 `2026-07-04-q12-routes-chapters-split-design.md` + 4 个 commit。
```

- [ ] **Step 3: §8 batch 加 Q12**

在 §8 适当位置（建议 §8 batch 2 中风险块，已完成了的格式）加：

```markdown
- ✅ chapters.ts 拆 5 兄弟文件（Q12，commits 见 §7.5）— CRUD 瘦到 ~140 行，SSE generate 273 行独立
```

- [ ] **Step 4: §10 已落实列表加 Q12**

找到 §10 一句话总结那段，在 Q11 引用后加 Q12：

```markdown
Q11（V2ChapterDesign 拆 Step3+Step4 子组件到 `views-v2/_components/`，1193 → 626 行；详见 [§7.5](#75-大文件拆分结构性)）、Q12（routes-v2/chapters.ts 拆 5 兄弟文件 + provider-configs 独立，650 → ~140 行纯 CRUD 骨架；stub SSE generate 替换为真实实现；详见 [§7.5](#75-大文件拆分结构性)）。**仍待决策**：Q9（暂缓, 触发条件见 §7.4）、Q13。
```

- [ ] **Step 5: 验证文档 diff**

```bash
cd "D:/MGit-Projects/ai-novel-runtime" && git diff docs/v2-architecture.md | head -60
```

期望：4 处小改 (§6.6 行数 / §7.5 [x] / §8 batch ✓ / §10 已落实)。

- [ ] **Step 6: 提交文档同步**

```bash
cd "D:/MGit-Projects/ai-novel-runtime" && git add docs/v2-architecture.md && git commit -m "$(cat <<'EOF'
docs(v2): Q12 — v2-architecture §6.6/§7.5/§8/§10 同步

§6.6 行数 (650 → ~140 CRUD + 4 兄弟 + provider-configs 独立)
§7.5 Q12 [x] + 决策理由
§8 batch Q12 ✓
§10 已落实列表加 Q12
仍待决策: Q9 / Q13

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review Checklist

**Spec coverage:**
- ✅ "彻底拆分 4 个新文件 + provider-configs 独立" — Task 1-4
- ✅ "路由风格保持现状" — 每个任务的 import / register 步骤都按 hardcode 风格
- ✅ "getConfigOrThrow 复制而非抽 utils" — Task 3/4 各自复制一份
- ✅ "chapters-generate.ts stub 替换为真实 SSE" — Task 4
- ✅ "API 路径不变前端零改动" — 整份计划零前端改动
- ✅ 文档同步 — Task 6

**Placeholder scan:**
- 无 TBD / TODO / "fill in details"
- 每个端点都有完整代码块（来自原 chapters.ts 原文，未截断）
- 每个 commit message 完整可执行

**Type consistency:**
- 函数命名统一：`v2ProviderConfigsRoutes` / `v2ChapterDraftsRoutes` / `v2ChapterConfigRoutes` / `v2ChapterGenerateRoutes` — 全部 `v2XxxRoutes` 风格跟 archive/analysis 一致
- import 路径 `../services-v2/...` 跟 archive/analysis 兄弟文件一致
- `routes-v2/index.ts` register 顺序 = import 顺序（约定）

**Code-block completeness:**
- Task 1: provider-configs.ts 全 25 行复制
- Task 2: chapters-drafts.ts 全 30 行复制
- Task 3: chapters-config.ts 全 105 行复制（含 3 个端点 + getConfigOrThrow）
- Task 4: chapters-generate.ts 全 275 行复制（含 SSE 完整错误处理）
