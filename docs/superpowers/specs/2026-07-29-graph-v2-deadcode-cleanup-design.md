# 知识图谱 v2 死代码清理 Design Spec

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 彻底删除 v2 时代的图谱孤儿代码（4 后端端点 + 4 前端 API 方法 + 2 测试 + 1 兜底清理），确立"v3 唯一性"——GraphView 与 EditableGraph 只通过 cumulativeGraphApi 读写 `Chapter.cumulativeGraph` JSON。

**Architecture:**
- v3 唯一数据源：`Chapter.cumulativeGraph` JSON（`apps/server/src/routes/chapters-archive.ts` 的 3 个端点）
- v3 唯一前端 API：`cumulativeGraphApi`（`apps/web/src/api/cumulative-graph.ts`）
- v3 唯一编辑器：`EditableGraph` 自管本地草稿（被 ReviewingPanel 复用，本组件不直连后端）
- v3 唯一只读视图：`GraphView`（读 `cumulativeGraphApi.get(chapterId)`）
- 删除 v2 GraphNode/GraphEdge 表的所有写入路径（包括 POST 端点 + chapters-crud 兜底）
- 保留 Prisma schema 的 GraphNode/GraphEdge 两张表（v3 稳定后单独迁移，不在本次范围）

**Tech Stack:** TypeScript (NodeNext 后端 / ESNext 前端)、Fastify、Prisma、Vitest。

---

## 范围

### 必须删除

| 路径 | 说明 |
|------|------|
| `apps/server/src/routes/graph.ts` | 4 端点（GET story/graph, GET chapter/graph-snapshot, POST story/graph/nodes, POST story/graph/edges） |
| `apps/server/src/__tests__/routes/graph.test.ts` | 2 case 覆盖被删的 GET story/graph 端点 |
| `apps/web/src/api/graph.ts` | 4 方法（get/createNode/createEdge/getSnapshot） |

### 必须修改

| 路径 | 改动 |
|------|------|
| `apps/server/src/app.ts` | L18 删 `import { graphRoutes }`；L78 删 `await app.register(graphRoutes)` |
| `apps/server/src/routes/chapters-crud.ts` | L223-229 删"最后一章"时的 `deleteMany(graphNode/graphEdge)` 兜底；相应调整 L230 log 信息（移除 `graphNode=… graphEdge=…` 字段） |
| `prisma/schema.prisma` | GraphNode/GraphEdge `/// @deprecated` 注释加一句："前端无对应 API；v3 唯一读写路径是 `Chapter.cumulativeGraph`（见 `apps/server/src/routes/chapters-archive.ts`）" |

### 不在范围

- Prisma schema 的 GraphNode/GraphEdge 两表（保留，v3 稳定后单独迁移）
- `apps/server/src/services/graph-snapshot.ts`（仍被 graph-organizer 等使用，只删了 v2 死函数 `saveGraphSnapshotAndDelta/rebuildGraphFromSnapshot`，已在 v3 重构时完成）
- `EditableGraph.vue`（仍被 ReviewingPanel 复用，其 CRUD 弹窗仅操作本地草稿 state，不调后端）
- GraphView.vue 本身（仅做查看，行为不变）

## 设计决策记录

| 决策 | 理由 |
|------|------|
| 不保留兼容层 | 调研：v2 端点 0 调用方、v2 前端 API 0 调用方；保留 = 死代码留存 |
| 不删 Prisma 两表 | dev.db 中可能仍存历史数据；v3 数据迁移策略未定；本 spec 只删业务路径，不动 schema |
| 不拆多 commit | 主题单一（"删 v2 图谱死代码"）；1 commit 审查对应最清晰；改动跨 5 文件但内容类型一致（删除 + 注释） |
| 不新增测试 | 删除的 2 个 case 覆盖被删端点，删端点即删测试；没有新逻辑可测 |

## 验证

按以下顺序执行：

1. **grep 验证 0 命中**
   ```bash
   grep -rn "graphApi\b\|graphRoutes\b\|graphNode\.create\|graphEdge\.create" apps/
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
   期望：36 文件 / 294 用例（38 文件 - 删 2 / 296 用例 - 删 2 case）。

4. **构建**
   ```bash
   pnpm build
   ```
   期望：server + web + packages/* 全过。

## commit 信息

```
refactor: drop v2 graph dead code

- Remove apps/server/src/routes/graph.ts (4 endpoints, all orphan)
- Remove apps/server/src/__tests__/routes/graph.test.ts (covers removed endpoints)
- Remove apps/web/src/api/graph.ts (4 methods, zero callers)
- Unregister graphRoutes in app.ts
- Drop deleteMany(graphNode/graphEdge) fallback in chapters-crud.ts
  (no code writes these tables in v3)
- Clarify GraphNode/GraphEdge deprecation in prisma/schema.prisma

GraphView now exclusively reads cumulativeGraphApi.
EditableGraph only manipulates local draft state (no backend writes).
```

---

## 实施注意事项

- 删 `routes/graph.ts` 前先确认 `app.ts` 的 import/register 一并删
- `chapters-crud.ts` 的 log 信息要从 `Cleaned plotArc=${arcCount}, promptLog=${logCount}, graphNode=${nodeCount}, graphEdge=${edgeCount}` 改成 `Cleaned plotArc=${arcCount}, promptLog=${logCount}`
- schema 注释增强保留原始"@deprecated v3 不写不读"措辞，仅追加一句指针
- 不动 `EditableGraph.vue`、`GraphView.vue`、`graph-snapshot.ts`、`graph-extract-stage.ts` 等任何当前在用文件