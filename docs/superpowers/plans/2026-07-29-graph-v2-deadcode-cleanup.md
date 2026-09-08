# 图谱 v2 死代码清理 + v3 active path 迁移 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 彻底删除 v2 图谱代码（4 后端端点 + 4 前端 API 方法 + 2 测试 + 1 兜底清理 + 2 孤儿函数），把 `combined-extractor.ts` v3 active path 从 GraphNode 表迁移到 cumulativeGraph JSON，删除 Prisma GraphNode/GraphEdge 两表，实现 v3 唯一性。

**Architecture:**
- v3 唯一数据源：`Chapter.cumulativeGraph` JSON
- v3 archive phase 1 (`combined-extractor`) 从 latest archived chapter 的 `cumulativeGraph` JSON 读 N-1 entity inventory
- 删 GraphNode/GraphEdge 两张 Prisma 表（migration）；dev.db 验证零数据
- 2 commit：(a) functional fix + 孤儿清理；(b) schema 删除 + 兜底清理

**Tech Stack:** TypeScript (NodeNext 后端 / ESNext 前端)、Fastify、Prisma + SQLite、Vitest。

**注意：本次无 TDD 阶段**——纯删除死代码 + 路径迁移，迁移逻辑简单（30 行内），不强写测试。验证以 grep/typecheck/vitest/build/migrate 为主。

---

## Task 1: 删除后端孤儿 route + 测试 + 取消注册 ✅ 已完成

**Files:**
- Delete: `apps/server/src/routes/graph.ts`
- Delete: `apps/server/src/__tests__/routes/graph.test.ts`
- Modify: `apps/server/src/app.ts:18,78`

- [x] **Step 1: 删除 `apps/server/src/routes/graph.ts`**

```bash
rm apps/server/src/routes/graph.ts
```

- [x] **Step 2: 删除 `apps/server/src/__tests__/routes/graph.test.ts`**

```bash
rm apps/server/src/__tests__/routes/graph.test.ts
```

- [x] **Step 3: 修改 `apps/server/src/app.ts` 取消 graphRoutes**

```ts
// L18 — 删除
import { graphRoutes } from './routes/graph.js'
// L78 — 删除
await app.register(graphRoutes)
```

- [x] **Step 4: 验证 server typecheck 通过** ✅ Done

---

## Task 2: 删除前端孤儿 API + 调整 chapters-crud 兜底清理 ✅ 已完成

**Files:**
- Delete: `apps/web/src/api/graph.ts`
- Modify: `apps/server/src/routes/chapters-crud.ts:223-230`

- [x] **Step 1: 删除 `apps/web/src/api/graph.ts`** ✅

- [x] **Step 2: 修改 `apps/server/src/routes/chapters-crud.ts`** ✅

```ts
// L223-L230 替换为:
        app.log.info(`[Delete] Last chapter removed. Cleaned plotArc=${arcCount}, promptLog=${logCount}`)
```

- [x] **Step 3: 验证全 workspace typecheck 通过** ✅ Done

---

## Task 3: 强化 prisma GraphNode/GraphEdge deprecation 注释 ✅ 已完成（后续会被删除覆盖）

**Files:**
- Modify: `prisma/schema.prisma:177-179,196-198`

- [x] **Step 1: 修改 GraphNode 注释（L177-L179）** ✅

- [x] **Step 2: 修改 GraphEdge 注释（L196-L198）** ✅

> 注：T3 会被 T6 (删 Prisma 模型) 覆盖，所以 T3 的改动最终会被替换。T3 的执行本身无副作用（注释删了不影响），保留作为中间状态以验证 typecheck 不破。

---

## Task 4: 迁移 combined-extractor 到 cumulativeGraph JSON

**Files:**
- Modify: `apps/server/src/services/combined-extractor.ts:131-141`

- [ ] **Step 1: 修改 `combined-extractor.ts` 的 existingKeys 读取**

完整新代码（替换 L130-L144）：

```ts
  // 加载已有节点（用于去重提示）：从 latest archived chapter 的 cumulativeGraph
  // 读 — v3 唯一 source-of-truth。GraphNode 表已弃用。
  // 按原"character 全部 + 其他取最近 100 个"语义切两组。
  const latestArchived = await prisma.chapter.findFirst({
    where: { storyId, status: 'archived', id: { not: chapterId } },
    orderBy: { number: 'desc' },
    select: { cumulativeGraph: true }
  })
  const prevSnapshotNodes = latestArchived?.cumulativeGraph
    ? (safeJsonParse<GraphSnapshot | null>(latestArchived.cumulativeGraph, null)?.nodes || [])
    : []
  const characterNodes = prevSnapshotNodes.filter((n: any) => n.type === 'character')
  const recentOtherNodes = prevSnapshotNodes
    .filter((n: any) => n.type !== 'character')
    .slice(-100) // cumulativeGraph 数组顺序 = 累计顺序；取末尾 100
  const combinedNodes = [...characterNodes, ...recentOtherNodes]
  const existingKeys = new Set(combinedNodes.map((n: any) => `${n.type}:${n.key}`))

  app.log.info(
    `[CombinedExtractor] Context injection: ${characterNodes.length} characters, ${recentOtherNodes.length} recent nodes`
  )
```

操作：用 `Edit` 工具，old_string 是当前 L130-L144（含 import GraphExtractionResult 之前），new_string 是新代码。

注意：`GraphSnapshot` 已从 `./graph-snapshot.js` import (L17)，可直接用 `GraphSnapshot | null`。`safeJsonParse` 已从 `@novel-runtime/shared` import (L7)。

- [ ] **Step 2: 验证 server typecheck 通过**

```bash
pnpm --filter server typecheck 2>&1 | tail -10
```

预期：Done，无错误。

- [ ] **Step 3: 跑 server vitest（确保 graph-organizer 测试不破）**

```bash
cd apps/server && pnpm vitest run 2>&1 | tail -10
```

预期：38 文件 / 296 用例 全过（无 case 删除）。如果有测试 mock `prisma.chapter.findFirst` 但 mock 行为跟新代码不一致，需要相应调 mock——但 combined-extractor 不在 __tests__/ 下，不应该 mock；如果有失败，看具体错误。

---

## Task 5: 删除 graph-extractor.ts 孤儿函数

**Files:**
- Modify: `apps/server/src/services/graph-extractor.ts`

- [ ] **Step 1: 重写 `graph-extractor.ts`，只保留 3 个 type export**

完整新代码（替换整个文件）：

```ts
/**
 * GraphExtractionResult — v3 active path 用的纯数据结构。
 * 由 `combined-extractor.ts` 从 AI 响应解析得到，外部写入由调用方决定。
 */

export interface ExtractedNode {
  type: 'character' | 'faction' | 'realm' | 'event' | 'item'
  key: string
  label: string
  importance: number // 1-10，剧情推动作用
  data?: Record<string, any>
}

export interface ExtractedEdge {
  fromKey: string
  fromType: string
  toKey: string
  toType: string
  relation: string
}

export interface GraphExtractionResult {
  nodes: ExtractedNode[]
  edges: ExtractedEdge[]
}
```

操作：用 `Write` 工具覆盖整个文件。

- [ ] **Step 2: 验证 server typecheck 通过**

```bash
pnpm --filter server typecheck 2>&1 | tail -10
```

预期：Done，无错误。检查 import GraphExtractionResult 的文件（combined-extractor.ts, graph-organizer.ts, graph-organizer-neighborhood.test.ts）仍能编译。

---

## Task 6: Prisma migration 删除 GraphNode/GraphEdge 两表

**Files:**
- Modify: `prisma/schema.prisma` (删 GraphNode + GraphEdge model 块)
- Create: `prisma/migrations/20260729000000_drop_graph_node_edge/migration.sql`

- [ ] **Step 1: 改 `prisma/schema.prisma` 删 GraphNode/GraphEdge model**

操作：用 `Edit` 工具删除 L176-L211（整个 GraphNode + GraphEdge model 块）。具体：
- old_string 从 `// 知识图谱节点` 到 `model GraphEdge { ... @@unique }` 结尾（L176-L211，36 行）
- new_string 为空（保留空行分隔即可）

> 注：先前的 T3 已强化了 @deprecated 注释；T6 一步删除整个 model 块。

- [ ] **Step 2: 创建 migration 目录**

```bash
mkdir -p prisma/migrations/20260729000000_drop_graph_node_edge
```

- [ ] **Step 3: 创建 `migration.sql`**

完整内容：

```sql
-- DropGraphNodeEdge
-- v3 唯一图谱数据源 = Chapter.cumulativeGraph JSON, GraphNode/GraphEdge 表不再使用。
-- 删除顺序: GraphEdge 先 (有 FK), GraphNode 后。
DROP TABLE IF EXISTS "GraphEdge";
DROP TABLE IF EXISTS "GraphNode";
```

操作：用 `Write` 工具写到 `prisma/migrations/20260729000000_drop_graph_node_edge/migration.sql`。

- [ ] **Step 4: 应用 migration + 验证表已删**

```bash
pnpm db:migrate 2>&1 | tail -10
echo "---tables containing 'Graph':"
/d/Environment/Android\ SDK/platform-tools/sqlite3 prisma/dev.db ".tables" 2>&1 | tr ' ' '\n' | grep -i graph || echo "(none)"
```

预期：
- migrate 应用成功，无错误
- grep 输出 "(none)" — GraphNode/GraphEdge 表已从 dev.db 删除

- [ ] **Step 5: 验证 server typecheck 通过（schema 改变后 Prisma client 重生成）**

```bash
pnpm db:generate 2>&1 | tail -5
pnpm typecheck 2>&1 | tail -10
```

预期：Prisma client 重生成成功；typecheck 全绿（注意：现在 prisma.graphNode / prisma.graphEdge 类型不存在，如果还有源码引用会报错——T4/T5 已清理 active path，T7 还要清 setup.ts mock）。

---

## Task 7: 删除 __tests__/setup.ts graph mock

**Files:**
- Modify: `apps/server/src/__tests__/setup.ts:113-114`

- [ ] **Step 1: 删除 setup.ts 的 graphNode/graphEdge mock**

完整新代码（替换 L113-L114）：

```ts
// 删除这两行:
//   graphNode: { findUnique: vi.fn(), create: vi.fn() },
//   graphEdge: { create: vi.fn() },
```

操作：用 `Edit` 工具，old_string 是当前两行，new_string 为空。

- [ ] **Step 2: 验证全 workspace typecheck + vitest 通过**

```bash
pnpm typecheck 2>&1 | tail -5
cd apps/server && pnpm vitest run 2>&1 | tail -8
```

预期：
- typecheck 全绿
- vitest 37 文件 / 294 用例（38 - 1 setup.ts 文件 - 2 case = 37/294；但 setup.ts 改动是删除 mock，不是删除文件，文件数不变 = 38 — 重看：实际 graph.test.ts 已删，文件数从 38 变 37）

---

## Task 8: 验证 + 2 commit

- [ ] **Step 1: grep 验证 0 命中（最终态）**

```bash
grep -rn "graphApi\b\|graphRoutes\b\|prisma\.graphNode\b\|prisma\.graphEdge\b\|graphNode\.create\|graphEdge\.create" apps/ prisma/schema.prisma 2>&1 | grep -v "apps/server/dist/" || echo "(0 hits — clean)"
```

预期：`(0 hits — clean)`。

- [ ] **Step 2: 全 workspace typecheck**

```bash
pnpm typecheck 2>&1 | tail -10
```

预期：8 个 workspace 全绿。

- [ ] **Step 3: server vitest**

```bash
cd apps/server && pnpm vitest run 2>&1 | tail -8
```

预期：`Test Files 37 passed (37)` / `Tests 294 passed (294)`。

- [ ] **Step 4: 全 workspace build**

```bash
pnpm build 2>&1 | tail -10
```

预期：server + web + packages/* 全过。

- [ ] **Step 5: show diff 给用户审（T1-T7 累积）**

```bash
git status --short
git diff --stat
```

按用户偏好 "show diff before committing"：让用户先 review，再 commit。

- [ ] **Step 6: commit 1 — v3 active path 修复 + 孤儿清理**

```bash
git add \
  apps/server/src/app.ts \
  apps/server/src/services/combined-extractor.ts \
  apps/server/src/services/graph-extractor.ts \
  apps/server/src/routes/graph.ts \
  apps/server/src/__tests__/routes/graph.test.ts \
  apps/web/src/api/graph.ts

git commit -m "$(cat <<'EOF'
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

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 7: commit 2 — 删 Prisma 两表 + 兜底清理**

```bash
git add \
  apps/server/src/routes/chapters-crud.ts \
  apps/server/src/__tests__/setup.ts \
  prisma/schema.prisma \
  prisma/migrations/20260729000000_drop_graph_node_edge/migration.sql

git commit -m "$(cat <<'EOF'
refactor: drop GraphNode/GraphEdge Prisma tables

- prisma/schema.prisma: remove GraphNode + GraphEdge models
- prisma/migrations/20260729000000_drop_graph_node_edge/migration.sql:
  DROP TABLE GraphEdge; DROP TABLE GraphNode;
- chapters-crud.ts: drop deleteMany(graphNode/graphEdge) fallback in
  "last chapter" cleanup (no code writes these tables)
- __tests__/setup.ts: drop graphNode/graphEdge prisma mocks

Verified dev.db had 0 rows in both tables before migration; zero
data risk.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 8: 验证 commit 落地**

```bash
git log --oneline -3
git status --short | head -5
```

预期：
- HEAD 是 commit 2 "refactor: drop GraphNode/GraphEdge Prisma tables"
- 工作树干净（除 untracked 工作树临时文件 `.claude/worktrees/`、spec/plan 等文档类 untracked）

---

## 实施注意事项

- T3 的注释改动会被 T6 删 model 覆盖，但执行顺序仍按 plan 走（T3 验证 typecheck 没破，再走 T6）
- T4 的 edit 要保留 `characterNodes`/`recentOtherNodes`/`existingKeys` 变量名（被后续 `existingNodeKeys` 引用）
- T5 的 graph-extractor.ts 重写后只剩 ~25 行；不需要新 import（type-only 文件）
- T6 的 migration SQL 注意 SQLite 没有 IF EXISTS 报错问题——但保留 IF EXISTS 防御性
- T7 的 setup.ts 删除 mock 后，如果某个测试 mock 不全可能导致 graph-related 测试失败；逐个 case 检查报错
- T8 commit 前一定要给用户看 diff（用户偏好）