# 知识图谱 v2 死代码清理 + v3 active path 迁移 Design Spec

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 彻底删除 v2 时代的图谱代码（4 后端端点 + 4 前端 API 方法 + 2 测试 + 1 兜底清理 + 2 孤儿函数），把 `combined-extractor.ts` v3 active path 从 GraphNode 表迁移到 cumulativeGraph JSON，删除 Prisma GraphNode/GraphEdge 两表，实现 v3 唯一性。

**Architecture:**
- v3 唯一数据源：`Chapter.cumulativeGraph` JSON（`apps/server/src/routes/chapters-archive.ts` 的 3 个端点）
- v3 唯一前端 API：`cumulativeGraphApi`（`apps/web/src/api/cumulative-graph.ts`）
- v3 唯一编辑器：`EditableGraph` 自管本地草稿（被 ReviewingPanel 复用，本组件不直连后端）
- v3 唯一只读视图：`GraphView`（读 `cumulativeGraphApi.get(chapterId)`）
- v3 archive phase 1 (`combined-extractor`) 从 latest archived chapter 的 `cumulativeGraph` JSON 读 N-1 entity inventory，喂给 AI 复用 type:key
- 删除 GraphNode/GraphEdge 两张表 + Prisma migration（dev.db 验证：两表 0 行，零数据风险）

**Tech Stack:** TypeScript (NodeNext 后端 / ESNext 前端)、Fastify、Prisma + SQLite、Vitest。

---

## 调研发现（plan 阶段新发现，扩 spec 触发点）

| 位置 | 调用 | 状态 |
|------|------|------|
| `apps/server/src/routes/graph.ts` | 4 端点（v2 API） | 0 调用方，删 |
| `apps/server/src/__tests__/routes/graph.test.ts` | 2 case | 覆盖被删端点，删 |
| `apps/web/src/api/graph.ts` | 4 方法 | 0 调用方，删 |
| `apps/server/src/services/graph-extractor.ts` line 28 `extractGraphFromChapter` | 读 GraphNode | 0 调用方，**删** |
| `apps/server/src/services/graph-extractor.ts` line 98 `saveExtractedGraph` | 读/写 GraphNode + GraphEdge | 0 调用方，**删** |
| `apps/server/src/services/graph-extractor.ts` line 7/15/23 | 3 个 type export | 被 v3 active import，**留** |
| `apps/server/src/services/combined-extractor.ts:131-138` | 读 GraphNode 喂 AI | **v3 active path** — 改读 cumulativeGraph JSON |
| `apps/server/src/__tests__/setup.ts:113-114` | mock graphNode/graphEdge | 跟随 schema 删 |
| `prisma/schema.prisma` GraphNode/GraphEdge model | DB 模型 | 删 + migration |
| `prisma/dev.db` | dev DB | GraphNode/GraphEdge 各 0 行，零数据风险 |

---

## 范围

### 必须删除

| 路径 | 说明 |
|------|------|
| `apps/server/src/routes/graph.ts` | 4 端点（v2 API） |
| `apps/server/src/__tests__/routes/graph.test.ts` | 2 case 覆盖被删端点 |
| `apps/web/src/api/graph.ts` | 4 方法，0 调用方 |
| `apps/server/src/services/graph-extractor.ts` 内 `extractGraphFromChapter` (L28-?) + `saveExtractedGraph` (L98-?) | 2 孤儿函数，保留 3 个 type export |
| `prisma/schema.prisma` GraphNode/GraphEdge model 块（L176-211） | 删除 model 定义 |
| `prisma/migrations/20260729000000_drop_graph_node_edge/migration.sql` | 新增 migration：`DROP TABLE GraphNode` + `DROP TABLE GraphEdge` |

### 必须修改

| 路径 | 改动 |
|------|------|
| `apps/server/src/app.ts` | L18 删 `import { graphRoutes }`；L78 删 `await app.register(graphRoutes)` |
| `apps/server/src/routes/chapters-crud.ts` | L223-229 删 `deleteMany(graphNode/graphEdge)` 兜底；L230 log 删 `graphNode=… graphEdge=…` 字段 |
| `apps/server/src/services/combined-extractor.ts` | L131-138 把 `prisma.graphNode.findMany(...)` 改成读 latest archived chapter 的 `cumulativeGraph` JSON；保留"character 全部 + 其他取最近 100 个"语义（按 cumulativeGraph 全量节点按 type 分组即可） |
| `apps/server/src/services/graph-extractor.ts` | 保留 3 个 type export（`ExtractedNode`, `ExtractedEdge`, `GraphExtractionResult`）+ 文件顶部 import + 删 2 孤儿函数（line 28-96 `extractGraphFromChapter` 函数体；line 98-167 `saveExtractedGraph` 函数体） |
| `apps/server/src/__tests__/setup.ts` | L113-114 移除 `graphNode: { findUnique, create }` + `graphEdge: { create }` mock |

### 不在范围

- `EditableGraph.vue`（仍被 ReviewingPanel 复用，其 CRUD 弹窗仅操作本地草稿 state，不调后端）
- `GraphView.vue` 本身（仅做查看，行为不变）
- `graph-snapshot.ts`（仍被 graph-organizer 等使用）
- `graph-extract-stage.ts`（v3 active path，已在 v3 重构完成）
- `graph-organizer.ts` / `cumulative-graph.ts` / `cumulative-graph-build-service.ts`（v3 active path）

## 设计决策记录

| 决策 | 理由 |
|------|------|
| 不保留兼容层 | v2 端点/API 0 调用方；保留 = 死代码 |
| 删 Prisma 两表 | dev.db 验证 GraphNode/Edge 各 0 行；零数据风险 |
| combined-extractor 读 latest archived chapter 的 cumulativeGraph | v3 真正的 source-of-truth；行为比"读空表"更准确（existingKeys 现在能反映真实存在的 type:key） |
| 保留 `extractGraphFromChapter` + `saveExtractedGraph` 函数签名 type 但删函数体 | 不行——这俩是函数不是 type。改：删除整个函数体，保留 3 个 type export + import + 文件结构 |
| 拆 2 commit | 主题分两层：(a) v3 active path 修复 + 孤儿函数清理（functional fix）；(b) Prisma schema 删除 + 兜底清理（schema cleanup）。拆分利于审查、降低 commit 间耦合风险 |

## 验证

按以下顺序执行：

1. **grep 验证 0 命中**（最终态）
   ```bash
   grep -rn "graphApi\b\|graphRoutes\b\|prisma\.graphNode\|prisma\.graphEdge\|graphNode\.create\|graphEdge\.create" apps/ prisma/schema.prisma 2>&1 | grep -v "apps/server/dist/"
   ```
   期望：无输出。

2. **typecheck**
   ```bash
   pnpm typecheck
   ```
   期望：8 个 workspace 全绿。

3. **测试**
   ```bash
   cd apps/server && pnpm vitest run
   ```
   期望：37 文件 / 294 用例（38 - 1 = 37 文件；296 - 删 2 case = 294 用例）。

4. **Prisma migration 验证**
   ```bash
   pnpm db:migrate
   ```
   期望：migration 应用成功；GraphNode/GraphEdge 表不存在。
   ```bash
   /d/Environment/Android\ SDK/platform-tools/sqlite3 prisma/dev.db ".tables" | grep -i graph
   ```
   期望：无输出。

5. **构建**
   ```bash
   pnpm build
   ```
   期望：server + web + packages/* 全过。

## commit 计划（2 commit）

### commit 1: v3 active path 修复 + 孤儿函数清理
```
refactor(v3): combined-extractor reads cumulativeGraph; drop orphan graph-extractor fns

- combined-extractor.ts: existingKeys now read from latest archived
  chapter's cumulativeGraph JSON instead of GraphNode table (which is
  empty in v3 and slated for deletion)
- graph-extractor.ts: drop orphan extractGraphFromChapter + saveExtractedGraph
  (both 0 callers in v3); retain 3 type exports consumed by v3 active path
- Remove apps/server/src/routes/graph.ts (4 v2 endpoints, all orphan)
- Remove apps/server/src/__tests__/routes/graph.test.ts (covers removed)
- Remove apps/web/src/api/graph.ts (4 methods, zero callers)
- Unregister graphRoutes in app.ts

This commit is the functional fix; the Prisma schema drop follows
in the next commit so any rollback can revert behavior without
needing a DB migration.
```

### commit 2: 删 Prisma 两表 + 兜底清理
```
refactor: drop GraphNode/GraphEdge Prisma tables

- prisma/schema.prisma: remove GraphNode + GraphEdge models
- prisma/migrations/20260729000000_drop_graph_node_edge/migration.sql:
  DROP TABLE GraphNode; DROP TABLE GraphEdge;
- chapters-crud.ts: drop deleteMany(graphNode/graphEdge) fallback in
  "last chapter" cleanup (no code writes these tables)
- __tests__/setup.ts: drop graphNode/graphEdge prisma mocks

Verified dev.db had 0 rows in both tables before migration; zero
data risk.
```

---

## 实施注意事项

- combined-extractor 改读 cumulativeGraph 时，按现有"character 全部 + 其他取最近 100 个"语义保留——从 cumulativeGraph JSON 的 nodes 数组里分两组即可（不需要 createdAt 排序，因为 cumulativeGraph 不存 createdAt；按"累计顺序"即数组顺序截断）
- graph-extractor.ts 删函数体时，保留：
  - `import type { FastifyInstance } from 'fastify'`（type-only，可保留或删——这两个函数都不用了）
  - `import { RuntimePromptCompiler, countTokens } from '@novel-runtime/ai-provider'`（type-only）
  - `import { cleanJsonBlock, safeJsonParse } from '@novel-runtime/shared'`（type-only）
  - 这些 import 实际只被 `extractGraphFromChapter` 用——如果函数体都删，import 也得删
  - 最终文件结构：3 个 `export interface` + 必要的 import（如果需要 `FastifyInstance` 给将来新函数用，留着无害；但 YAGNI，建议连 import 也清掉）
- 实际推荐：`graph-extractor.ts` 简化成只剩 3 个 type 定义（10-20 行）。如果 import 都无用，整文件只剩 type
- chapters-crud.ts log 信息：原 `Cleaned plotArc=${arcCount}, promptLog=${logCount}, graphNode=${nodeCount}, graphEdge=${edgeCount}` → `Cleaned plotArc=${arcCount}, promptLog=${logCount}`
- Prisma migration 用 `prisma migrate dev --create-only --name drop_graph_node_edge` 创建空 migration，再手填 `migration.sql`
- `__tests__/setup.ts` L113-114 删 2 行；其他行不动