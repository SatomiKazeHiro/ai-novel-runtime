# Q12 — routes-v2/chapters.ts 按职责拆分设计

**日期**：2026-07-04
**状态**：已批准
**关联**：docs/v2-architecture.md §6.6 / §7.5 / §8 / §10

---

## Context

`apps/server/src/routes-v2/chapters.ts` 单文件 650 行容纳 7 类端点。伴生文件已有
`chapters-archive.ts` / `chapters-analysis.ts`（命名上已分裂），但 `chapters.ts`
本应只剩 CRUD 骨架却把 config / memory-search / drafts / preview / generate
全包进去 — 跟"按职责命名兄弟文件"约定不一致。

CLAUDE.md §6.6 标为"待拆分"，§7.5 列 Q12 为开放问题。

调研发现现有 `chapters-generate.ts` 是个空 stub（"V2 开发中"），是当初预留
位但没搬到，明确了"SSE generate 该去那里"的自然落点。

**目标**：按职责拆 4 个新文件，让 `chapters.ts` 回归 CRUD 骨架，跟
archive / analysis / config / generate 四兄弟完全对齐。前端零改动（API 路径
不变）。

---

## 决策

1. **拆分粒度**："彻底" — 4 个新文件全部拆出，连 provider-configs 独立化
2. **路由风格**：保持现状（hardcode `/chapters/...` 路径）— KNOWN-ISSUES #7
   的 prefix 迁移留给单独 PR，Q12 不连带做
3. **共享辅助函数（getConfigOrThrow）**：复制而非抽 utils — 跟 archive /
   analysis 现有惯例对齐，5 行函数复制比抽 utils 更易读

---

## 设计

### 拆分前后

| 文件 | 拆前 | 拆后 | 端点 |
|---|---|---|---|
| `chapters.ts` | 650 | ~140 | CRUD 骨架（list/create/detail/update/delete） |
| `chapters-config.ts` | — | ~105 | config / memory-search / preview |
| `chapters-drafts.ts` | — | ~30 | drafts list / drafts delete |
| `chapters-generate.ts` | stub | ~275 | SSE generate（替换 stub） |
| `provider-configs.ts` | — | ~25 | AI 模型列表 |
| 总计 | 650 | ~575 | — |

总行数小幅下降（去掉 4 个文件头部 import / 函数闭包开销的重复）。每个新文件
单一职责清晰。

### `chapters.ts` 拆分后内容（~140 行）

| 端点 | 行数 |
|---|---|
| GET `/chapters?storyId=` | ~20 |
| POST `/chapters` | ~36 |
| GET `/chapters/:id` | ~12 |
| PUT `/chapters/:id` | ~38 |
| DELETE `/chapters/:id` | ~78（含级联事务最重的一段） |

DELETE 留在 CRUD 文件里 — 级联清理逻辑跟章节删除是同一事务不可分割。

### 新文件依赖

```
chapters-config.ts      → config-defaults (searchRelevantMemories, getDefaultConfig)
                         → prompt-assembler (assemblePrompt)
                         → zod (内联 schema)
                         → hash (sha256)

chapters-drafts.ts      → prisma 直接查询

chapters-generate.ts    → config-defaults (无)
                         → prompt-assembler (assemblePrompt)
                         → services/ai-provider-init (resolveProvider, getProviderById)
                         → services-v2/ai-call-logger (logAiCall)
                         → zod (GenerateBodySchema)

provider-configs.ts     → prisma 直接查询
```

无横向依赖。新文件不互相 import 兄弟路由。

### 共享辅助函数

`getConfigOrThrow(raw, ctx)` 5 行函数 — **复制 2 份**（chapters-config.ts 和
chapters-generate.ts）。archive / analysis 现有文件也各自复制了同样模式，不再
在这里抽 utils。预期副本数：4 份（chapters.ts 不需要 + 1 份现有 archive +
1 份现有 analysis + 2 份新增）。

### 路由注册

`apps/server/src/routes-v2/index.ts` 现有 14 个 register。新增 4 个：

```typescript
import { v2ProviderConfigsRoutes } from './provider-configs.js'
import { v2ChapterConfigRoutes } from './chapters-config.js'
import { v2ChapterDraftsRoutes } from './chapters-drafts.js'

// chapters-generate.ts 现有 stub 改名并替换实现
import { v2ChapterGenerateRoutes } from './chapters-generate.js'

export async function v2Routes(app: FastifyInstance) {
  await app.register(v2ChapterRoutes)
  await app.register(v2ChapterGenerateRoutes)        // 已注册，stub 替换
  await app.register(v2ChapterAnalysisRoutes)
  await app.register(v2ChapterArchiveRoutes)
  await app.register(v2ProviderConfigsRoutes)        // 新
  await app.register(v2ChapterConfigRoutes)          // 新
  await app.register(v2ChapterDraftsRoutes)          // 新
  // ...
}
```

### 删除 stub 路径

`chapters-generate.ts` 现有 `app.get('/chapters/:chapterId/generate-stream', ...)`
是占位 stub，无前端调用（grep `generate-stream` 应为 0 命中，包括前端代码）。
直接删掉，写真实 SSE `/chapters/:id/generate` 实现。

---

## 数据流

每个端点保持现有请求/响应形态不变。前端零改动：

| 端点 | 前端调用 |
|---|---|
| GET / POST / PUT / DELETE `/chapters...` | `v2ChaptersApi.list/detail/create/update/remove` |
| GET `/provider-configs` | `v2ChaptersApi.providerConfigs` |
| POST `/chapters/:id/config` | `v2ChaptersApi.generateConfig` |
| POST `/chapters/:id/memory-search` | `v2ChaptersApi.memorySearch` |
| GET `/chapters/:id/drafts` | `v2ChaptersApi.listDrafts` |
| DELETE `/drafts/:draftId` | `v2ChaptersApi.deleteDraft` |
| POST `/chapters/:id/preview` | `v2ChaptersApi.preview` |
| POST `/chapters/:id/generate` (SSE) | `v2ChaptersApi.generateStream`（裸 fetch） |

---

## 边界规则

1. **不动** `chapters-archive.ts` / `chapters-analysis.ts` — 它们已经是兄弟文件现状
2. **不动** `routes-v2/index.ts` 的 register 风格 — 只加新条目
3. **不改**任何 API 路径、请求体 schema、响应 shape
4. **不抽**任何 service 层代码 — 仅路由文件物理搬迁
5. **不删**任何 service / composable / 前端代码

---

## 风险与对策

| 风险 | 概率 | 对策 |
|---|---|---|
| 删 stub `generate-stream` 路径时漏了某个调用方 | 中 | grep 全代码（含前端）确认 0 命中再删 |
| SSE 路由拆出去后 controller 中断路径回归 | 低 | 209-570 行端点整段搬，逻辑零改动 |
| `index.ts` register 顺序影响中间件 | 低 | 新路由都是独立路径前缀，无互依赖 |
| `getConfigOrThrow` 复制版与原版漂移 | 低 | 直接复制粘贴原文本，不"顺手优化" |

---

## 验证

```bash
pnpm typecheck    # 应全绿
pnpm build        # 应全绿
```

手动验证清单：
1. `curl http://localhost:3000/api/v2/provider-configs` → 200 + 模型列表
2. 启动 dev server 打开章节设计页，走完 5 步骤无 console error
3. `curl -X POST /api/v2/chapters/<id>/preview` 组装 prompt 正常
4. 触发 SSE 生成 → 收到 draft-start / draft-chunk / draft-done 事件流

---

## 实施顺序

1. 新建 `provider-configs.ts`（最小、无依赖，先验证 register 工作）
2. 新建 `chapters-drafts.ts`（最小、无 service 依赖）
3. 新建 `chapters-config.ts`（含 3 端点，依赖 service）
4. 重写 `chapters-generate.ts`（最大段，整段搬）
5. 删除 `chapters.ts` 已迁出的端点，保留纯 CRUD
6. `routes-v2/index.ts` 注册 4 个新路由
7. typecheck + build 验证
8. 单 commit + 文档同步

---

## 提交策略

单 commit：
```
refactor(v2): Q12 — routes-v2/chapters.ts 拆 provider-configs + chapters-{config,drafts,generate}

chapters.ts 650 → ~140 行（纯 CRUD 骨架）。新增 4 个按职责命名的兄弟文件，
跟现有 chapters-archive / chapters-analysis 完全对齐（5 兄弟）。

- provider-configs.ts (25): GET /provider-configs
- chapters-config.ts (105): POST /chapters/:id/{config, memory-search, preview}
- chapters-drafts.ts (30): GET /chapters/:id/drafts + DELETE /drafts/:draftId
- chapters-generate.ts (275): POST /chapters/:id/generate (SSE) — 替换现有 stub

边界:
- 路由风格保持现状 (hardcode /chapters/...)，不借机改 prefix (KNOWN-ISSUES #7 留单独 PR)
- getConfigOrThrow 5 行函数复制而非抽 utils，跟 archive/analysis 现有惯例对齐
- 前端零改动 (API 路径全部不变)

验证: pnpm typecheck ✓ · pnpm build ✓

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

后续：docs/v2-architecture.md §6.6 行数 / §7.5 Q12 [x] / §10 已落实列表。
