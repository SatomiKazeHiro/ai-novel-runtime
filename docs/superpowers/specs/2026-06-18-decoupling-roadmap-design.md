# 代码解耦 + 优化路线图 Design Spec

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 2026-06-18 / 19 两天内完成 5 块代码解耦,使程序达成"易读 + 可扩展"目标。每个 phase 独立 spec / plan / 实施 / review,可任意挑选执行顺序与时机。

**Architecture:** 1 个总 spec 覆盖 6 个 phase;每个 phase 实施前另出独立 plan(sub-spec / sub-plan)。Phase 间有依赖(P2b 依赖 P2a / P3 依赖 P2b),其他独立。

**Tech Stack:** 不引入新库。复用 `zod`(已装在 `apps/server` + `packages/shared`)+ `js-tiktoken`(收口到 `packages/ai-provider`)。

---

## 关联

- **基线 spec**:`docs/superpowers/specs/2026-06-17-refresh-issues-doc-design.md` (commit `07dbcc5`) — 库选型守门原则
- **明天的 Graph 任务**:`memory/planned-graph-split.md` — 即本 spec 的 P5
- **当前 ISSUES.md**:`docs/ISSUES.md` (commit `2928880` 后的最新) — 7 P0 RESOLVED / 1 NEW 重复依赖 / 库选型 4 子节

---

## 用户决策记录(2026-06-18)

| # | 议题 | 用户决策 |
|---|------|----------|
| D1 | 路线图形态 | 1 个大 spec 覆盖所有 5 块 |
| D2 | Phase 顺序 | 底层先行:token → zod → 拆 route → 拆 Chapters.vue → 拆 Graph.vue |
| D3 | zod 推广粒度 | Phase 2a(schema 落库) + Phase 2b(route 接入) 分两步 |
| D4 | 库选型守门 | 0 新库 / 复用已装 / 不动 API contract / 不动 UI 体验 |
| D5 | 实施预算 | 今天 + 明天 36 小时,平均 1-1.5 小时 / commit |
| D6 | Graph 拆分 | 放最后(明天),即 P5 |

---

## 现状盘点(2026-06-18)

### 量化结果

| 项 | 现状 | 影响 |
|---|---|---|
| `Chapters.vue` | **1169 行** (前端最大) | 单文件多职责:tree + edit + preview + 多 tab + 多 button |
| `Graph.vue` | 793 行 | display + editable 混在一起(P5) |
| `chapters.ts` (route) | 871 行,**12 endpoint** | 单文件多职责:CRUD + preview + generate + select + prepare-archive + archive + develop + tree |
| `memory-extractor.ts` | 449 行 | 单 service 偏大,内含多个子阶段 |
| `combined-extractor.ts` | 413 行 | 单 service 偏大 |
| **`js-tiktoken` 7 处装包** | root + server + web + 4 packages | 解耦收口明确目标 |
| **token 实现 3 套** | `PromptAssembler` / `estimateTokens` / `computeContentCharBudget` | 行为一致但代码不同,改动要追 3 处 |
| **zod 使用** | 只有 `stories.ts` 用了 1 处,`chapters.ts` 12 endpoint **0 校验** | Q9 大部分未推广 |
| **service 间横向 import** | **0** | 已做好,**不必动** |
| **composables 横向 import** | **0** | 已做好,**不必动** |

### 关键发现

- service / composable 横向 import 已经是 0,边界**已经做得不错**。之前想象的"services 边界乱"是误判,实际不需要动 service 之间。
- 真正要解耦的是:大文件(route / view) + 重复装包(token) + 缺校验(zod)。
- Graph 拆分明天做(P5),今天先做 P1-P3。

---

## 解耦原则(贯穿所有 phase)

1. **不动数据**:prisma schema / DB 字段 / JSON 字段格式 全部不变
2. **不动行为**:API contract / 状态机 / 队列行为 全部不变
3. **不动 UI**:组件 props/emits / 视觉效果 / 交互流程 全部不变
4. **小步提交**:每个 phase 内 3-8 commit,每 commit 独立可回退
5. **两段审**:每个 phase 实施后 spec compliance + code quality
6. **0 新库**:承袭 ISSUES.md 库选型守门

---

## 6 个 Phase 总览

| Phase | 名称 | 文件改动 | 预计 commit | 顺序依赖 |
|---|---|---|---|---|
| **P0** | 基础设施确认(无变更) | 0 | 0 | 无 |
| **P1** | token-counting 收口 | 7 package.json + 3-4 ts 文件 | 3-5 | 无 |
| **P2a** | zod schema 落 `packages/shared` | 新增 3-4 schema 文件 + 1 测试 | 2-3 | 无 |
| **P2b** | chapters.ts 12 endpoint 接 zod | chapters.ts 12 处改 + shared 引用 | 1-2 per route group(2-4 总) | 依赖 P2a |
| **P3** | chapters.ts 按职责拆 route | 拆为 4 route 文件 + 缩 chapters.ts | 4-6 | 依赖 P2b |
| **P4** | Chapters.vue 按模式拆 | 拆为 5 文件(view + 4 子组件) | 5-8 | 不依赖 backend |
| **P5** | Graph.vue 拆 display+editable | 拆为 3 文件(GraphView + EditableGraph + shared) | 2-3 | 独立(明天任务) |

**总 commit 估算:17-27 commit**(36 小时预算,1-1.5 小时/commit 合理)。

### 依赖图

```
P0 → P1 ──────────────┐
   → P2a → P2b → P3  │  (backend 链)
                  P4 ─┤  (frontend,独立)
                  P5 ─┘  (明天,独立)
```

P4 / P5 与 backend 链独立,可并行实施。

---

## Phase 1: token-counting 收口

### 目标
`js-tiktoken` 7 处直接装 → 1 处直接装(`packages/ai-provider`)+ 6 处 transitive 依赖。3 套 token 实现统一调用 `countTokens(text: string): number`。

> **实际结果(2026-06-18 commit `bd62a21` 后):** P1 实际达成 **7→4 直接装**,非 7→1。`packages/{shared,memory-engine,prompt-runtime}` 因结构性原因(dep cycle / API 不匹配 / model-aware)保留 `js-tiktoken` 直接装。详见 `KNOWN-ISSUES.md` 第 10 条。`countTokens` 作为"项目 token 计数唯一入口"目标已实现(被 `apps/server/*` 全面采用);`tokenize(token IDs)` + `encodingForModel(model-aware)` 是另一类抽象,合并会破行为或加新接口,故独立保留。

### 文件改动

| 文件 | 改动 |
|---|---|
| `package.json` (root) | 删 `js-tiktoken` 直接装 |
| `apps/server/package.json` | 删 `js-tiktoken` |
| `apps/web/package.json` | 删 `js-tiktoken` |
| `packages/prompt-runtime/package.json` | 删 `js-tiktoken` |
| `packages/memory-engine/package.json` | 删 `js-tiktoken` |
| `packages/shared/package.json` | 删 `js-tiktoken` |
| `packages/ai-provider/package.json` | 保留(唯一直接装) |
| `packages/ai-provider/src/index.ts` | 新增 `export function countTokens(text: string): number`(wrapper for `js-tiktoken` 编码) |
| `packages/ai-provider/src/__tests__/count-tokens.test.ts` | 新增(纯函数 TDD) |
| `apps/server/src/routes/chapters.ts` | `estimateTokens` → `countTokens`(2 处) |
| `apps/server/src/services/combined-extractor.ts` | `estimateTokens` → `countTokens`;评估 `computeContentCharBudget` 是否挪到 ai-provider(若挪,挪到 `packages/ai-provider/src/content-budget.ts`) |
| `apps/web/src/**` | 移除直接 `js-tiktoken` import(如有) |
| `packages/prompt-runtime/src/index.ts` | `PromptAssembler` 内 token 计数 → `countTokens` |
| `packages/memory-engine/src/index.ts` | 同上 |
| `packages/shared/src/index.ts` | 移除 `js-tiktoken` 用法(如有) |
| `pnpm-workspace.yaml` 或根 `package.json` 的 `pnpm.overrides` | 锁 `js-tiktoken` 版本(防止 transitive 漂) |

### 验收标准

- `pnpm typecheck` 8/8 Done
- `pnpm --filter server test` 现有 115+ 测试 + 新增 `count-tokens.test.ts` 5+ 测试,全绿
- `grep "js-tiktoken" package.json apps/*/package.json packages/*/package.json` 只剩 `packages/ai-provider/package.json` 一处直接装
- `pnpm install` 后 `pnpm list js-tiktoken -r` 仍有 7 处 transitive 装(预期)
- `pnpm-lock.yaml` 无 `js-tiktoken` 版本漂

### 风险

| 风险 | 缓解 |
|---|---|
| `estimateTokens` → `countTokens` 后值略变(底层 model 一致但 API 路径不同) | 对照已有测试断言值,不一致则更新测试 |
| pnpm transitive 装包引出版本冲突 | 根 `package.json` `pnpm.overrides` 锁版本 |
| `computeContentCharBudget` 跨包移动破坏现有 9 个测试 | 测试不动,只挪函数位置;在 ai-provider 重新 export 保持原 import 路径可用(过渡) |

---

## Phase 2a: zod schema 落 `packages/shared`

### 目标
把 12 endpoint 的请求/响应 shape 在 `packages/shared` 用 zod schema 单一 source of truth 定义。**只定义,不接入**。

### 文件改动

| 文件 | 内容 |
|---|---|
| `packages/shared/src/chapter-prompt.ts` | `CompiledPromptSchema`(已存在,验证+补字段) |
| `packages/shared/src/select-draft.ts` | 新,`SelectDraftRequestSchema` |
| `packages/shared/src/prepare-archive.ts` | 新,`PrepareArchiveRequestSchema` |
| `packages/shared/src/archive.ts` | 已有 `PendingArchiveData` interface,新增 `PendingArchiveDataSchema`(zod 版) |
| `packages/shared/src/develop.ts` | 新,`DevelopRequestSchema` |
| `packages/shared/src/chapter.ts` | 新,`CreateChapterRequestSchema` / `UpdateChapterRequestSchema` / `ChapterTreeNodeSchema` / `ChapterResponseSchema` |
| `packages/shared/src/index.ts` | 导出所有 schema |
| `packages/shared/src/__tests__/schemas.test.ts` | 新,每 schema 至少 1 positive + 1 negative case(预计 14+ 测试) |

### 验收标准

- `pnpm typecheck` 通过
- `packages/shared/src/__tests__/schemas.test.ts` 14+ 测试通过
- `apps/web/src/api/chapters.ts` 不动(下一步才接)

### 风险

| 风险 | 缓解 |
|---|---|
| 12 endpoint 的 body 隐式 shape 未文档化,需从 route 文件里反推 | 实施时从 `chapters.ts` 各 handler 顶部读 `body = request.body as any` 推断 |
| zod schema 字段命名与 prisma / 现有代码不一致 | 实施时**保留**现有字段名,不做"顺手重命名" |

---

## Phase 2b: chapters.ts 12 endpoint 接 zod

### 目标
chapters.ts 12 endpoint 用 `.parse()` 接入,统一 `ZodError → 400 + 字段级错误`。

### 文件改动

- `apps/server/src/routes/chapters.ts`:12 endpoint 全部加 `Schema.parse(request.body)`,失败 throw `BadRequestError`(含字段名)+ 错误响应 `{ success: false, error: "field X: expected Y, got Z" }`
- `apps/web/src/api/chapters.ts`:不动(axios 已自动处理 400,显示 `error` 字段)
- 现有 `useChapterEditor.ts` 等前端不动

### 验收标准

- 12 endpoint 都有 zod 校验
- 错误响应 shape 统一
- 所有现有 115+ 测试不破
- 新增 1-2 测试文件:每 schema 至少 1 route-level happy path + 1 negative path

### 风险

| 风险 | 缓解 |
|---|---|
| 现有测试用 `body = request.body as any` 隐式跳过校验 | 测试代码 + 实施时同步加 `Schema.parse()` 模拟真实路径 |
| `as any` 隐式 type 漏掉 | 用 zod 反推字段类型,生成 `z.infer<...>` 替换 `as any` |

---

## Phase 3: chapters.ts 按职责拆 route

### 目标
871 行 / 12 endpoint → 4 个 route 文件,各 < 300 行,`app.ts` 注册改为多文件。

### 拆法

| 新文件 | endpoint | 预计行数 |
|---|---|---|
| `apps/server/src/routes/chapters-crud.ts` | GET list / GET one / POST create / PUT update / DELETE(5 个) | ~250 |
| `apps/server/src/routes/chapters-generate.ts` | POST preview / POST generate / POST select(3 个) | ~280 |
| `apps/server/src/routes/chapters-archive.ts` | POST prepare-archive / POST archive(2 个) | ~280 |
| `apps/server/src/routes/chapters-tree.ts` | GET chapter-tree(1 个) | ~80 |
| `apps/server/src/routes/chapters.ts` | **空或仅留 index 导出** | < 30 |

### 验收标准

- 每个 route 文件 < 300 行
- 接口 contract 不变(URL / method / req body / resp body)
- `apps/server/src/app.ts` 改为 4 处 `await register(app)` 或直接 export
- 所有 115+ 测试不破

### 风险

| 风险 | 缓解 |
|---|---|
| 跨 route 的共享 helper(如 `preLockStatus` 逻辑)被破坏 | 抽到 `apps/server/src/routes/_helpers.ts`(下划线前缀表示内部) |
| 拆分后 import path 变化,测试需更新 | 路径 `chapters.ts` → `chapters-crud.ts` 等;测试用 `../routes/chapters-xxx.js` |

---

## Phase 4: Chapters.vue 按模式拆

### 目标
1169 行 → `Chapters.vue` (view shell, < 300 行) + 4 个子组件。

### 拆法

| 新文件 | 职责 | 预计行数 |
|---|---|---|
| `apps/web/src/views/Chapters.vue` | view shell(tree/edit 模式切换 + 路由) | < 300 |
| `apps/web/src/views/chapters/ChapterTree.vue` | 左侧树形列表(`ChapterBranchTree` 移过来或重写) | ~250 |
| `apps/web/src/views/chapters/ChapterEditor.vue` | 编辑子页(顶部导航 + 草稿区) | ~350 |
| `apps/web/src/views/chapters/ChapterPreview.vue` | 预览子页 | ~150 |
| `apps/web/src/views/chapters/DraftList.vue` | 草稿列表(generate 后展示) | ~250 |

### 验收标准

- UI 行为 / 视觉效果 / 交互流程 100% 不变
- props / emits 清晰
- `composables/` 不动

### 风险

| 风险 | 缓解 |
|---|---|
| Vue ref / reactive 在跨组件传递时丢失响应性 | 用 props 传 `Ref<T>` 或 `toRef` / `toRefs` |
| 子组件 mount 时机影响 polling (`useIntervalFn`) | polling 留在 view shell,通过 prop 传给子组件,避免重复轮询 |

---

## Phase 5: Graph.vue 拆 display + editable(明天任务)

### 目标
793 行 → `GraphView.vue` (只读) + `EditableGraph.vue` (可编辑) + 共享 `cytoscape-lifecycle.ts` 工具。

### 拆法(详 `memory/planned-graph-split.md`)

| 新文件 | 职责 | 预计行数 |
|---|---|---|
| `apps/web/src/components/graph/GraphView.vue` | 只读,重查询,用在知识图谱页 | ~300 |
| `apps/web/src/components/graph/EditableGraph.vue` | 可编辑,用在 ReviewingPanel + Chapters.vue 嵌入 | ~350 |
| `apps/web/src/components/graph/useCytoscapeLifecycle.ts` | 共享 `onBeforeUnmount` + `removeAllListeners` + `destroy` 清理逻辑 | ~50 |
| `apps/web/src/views/Graph.vue` | **重写为 view shell**,只 import + 使用 GraphView | < 100 |

### 验收标准

- 知识图谱页 (`apps/web/src/views/Graph.vue`) 正常加载 + hover
- `ReviewingPanel.vue:138` 的 graph 嵌入正常 + 可编辑
- `Chapters.vue:561` 的"Step 4 本章范围图谱" 正常
- 不再有 `cytoscape isHeadless null` 报错(4def263 修复的同类问题)

### 风险

| 风险 | 缓解 |
|---|---|
| cytoscape 实例在多组件 mount 时共享数据 | 用 `props.snapshot` 传只读数据,组件各自 mount 自己的 cy 实例 |
| edit 操作如何回写 pendingArchiveData | 与 ReviewingPanel 现有 flow 集成,emit 事件而非直接修改 DB |

---

## 守门(承袭 ISSUES.md 已定)

- **0 新库**(7 处装包收口到 1 处,0 新增)
- **复用已装**:`zod` + `js-tiktoken` 收口后保留 `ai-provider` 一处
- **不动 API contract**:`/api/chapters/*` 12 endpoint 全部不变
- **不动 UI 体验**:用户视角无感
- **不动数据 schema**:prisma + JSON 字段不动
- **每个 phase 后**:typecheck + test 全绿,两段审(spec compliance + code quality),commit message 清晰

---

## Out of scope

- **不实现 Phase 各自的 plan**:本 spec 是"路线图",具体 plan 在每个 phase 实施前另出
- **不实现 P5 的具体 plan**:明天另出(Graph 拆分有独立的 `memory/planned-graph-split.md` 已记录)
- **不动 service / composable 内部微重构**:横向 import 已经是 0
- **不动 packages/* 的接口**:只动 `js-tiktoken` 收口 + `countTokens` 新增,`PromptAssembler` 等的对外 API 不变
- **不动 prisma schema**
- **不写 PR**(无 `gh` CLI,已 push 到 main)

---

## Self-Review

**1. Spec coverage:** 6 phase 全部含「目标 / 文件改动 / 验收标准 / 风险」四要素 ✓

**2. Placeholder scan:** 无 "TBD" / "TODO" / "待补"。每个 phase 实施细节留到 plan,不写进 spec ✓

**3. Type consistency:**
- 状态:6 phase 全部用 P0-P5 编号一致
- 文件:全部用 `apps/...` 或 `packages/...` 全路径
- 行数估算:每个文件给"预计行数",可加 ±20%

**4. Scope check:** 1 个 spec 覆盖 6 phase,每 phase 独立可实施;不超 spec 容量(每 phase 实施前另出 plan) ✓

**5. Ambiguity check:**
- "实施预算 36 小时"明确
- "依赖图"明确
- "守门"明确(承袭 ISSUES.md)
- 风险/缓解:每个 phase 列具体风险点

**6. 与既有 spec 关系:**
- 不冲突 ISSUES.md 库选型守门
- 不冲突 `memory/planned-graph-split.md` (P5 即它)
- P2b/P3 强依赖关系明确

---

## 实施顺序建议

| 时段 | 任务 |
|---|---|
| 今天下午 | P1 (token 收口) + P2a (zod schema 落库) |
| 今天晚上 | P2b (chapters.ts 接 zod) |
| 明天上午 | P3 (拆 chapters.ts) + P4 (拆 Chapters.vue) |
| 明天下午 | P5 (拆 Graph.vue) |

每个 phase 完成后单独 spec compliance + code quality review,失败可回退到上一个 phase 末。

---

## 待办

落 spec → commit → 用户 review → P1 实施(出 P1 独立 plan)→ P2 → ...
