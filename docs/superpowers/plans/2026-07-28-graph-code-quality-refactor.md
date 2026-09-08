# 图谱代码质量重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 提升图谱模块（cumulative-graph / graph-extract-stage / graph-snapshot）的稳健性与可维护性 —— 解耦、可读性、易扩展，删除 v2 死代码。

**Architecture:**
- 抽 `packages/shared/src/json-alias.ts`，server 端两个 stage 共用 aliasKey
- 抽 `services/stages/{relation-mapping,graph-extract}.prompt.ts`，把 prompt 模板从编排文件分离
- 拆 `graph-extract-stage.ts` 为 4 个纯函数 + 编排；`cumulative-graph.ts` 拆 2 个纯函数 + 编排
- `applyRelationMapping` 加深拷（immutable 语义）
- `parseRelationMapping` 删 fallthrough（严格 AI 责任）
- 删 v2 死函数（`saveGraphSnapshotAndDelta` / `rebuildGraphFromSnapshot`）+ `chapters-crud` delete 路径调用方
- 删 `chapterNumber` 死字段（`CumulativeGraphInput` / `BuildAndSaveInput`）
- 前端 `GraphView.vue` 改读 v3 `cumulativeGraphApi`；`EditableGraph.vue` 删 `importance: 5`
- Prisma `GraphNode/GraphEdge` 注释加更明显 deprecation 说明

**Tech Stack:** TypeScript (NodeNext 后端 / ESNext 前端)、Vue 3 + Naive UI、Fastify、Prisma、Vitest。

---

## ⚠️ 执行前必读

**当前测试基线异常**：最近一次 `pnpm --filter server vitest run` 出现 **68 个文件失败 / 175 个 case 失败**（vs commit 423b5e0 之后曾全绿）。本 plan 假设起点是 `423b5e0` 之后的稳定状态（4 个 cumulative-graph 集成测试通过 + 3 个 graph-extract 集成测试通过）。

**执行 Task 1 之前必须先排查基线回归**：

```bash
cd D:\NewCode\ai-novel-runtime
pnpm --filter server vitest run 2>&1 | tail -50
```

如果失败，先 `git log --oneline -20` 确认是否本机 working tree 有未提交改动，或最近 merge 引入了回归。本 plan 全部 Task 1-Task 18 完成时，**测试套件至少应恢复 423b5e0 的绿态**（除新加的 36 个单测外，无新增失败）。

如果执行中发现 Task 1/2/3 的 `parseRelationMapping` / `parseGraphResponse` / `aliasKey` 相关测试与基线冲突，停下来回到本节排查，再继续后续任务。

---

## 关联文件

- Spec: `docs/superpowers/specs/2026-07-28-graph-code-quality-refactor-design.md`
- 当前 cumulative-graph 实现: `apps/server/src/services/cumulative-graph.ts`（258 行，3 个内部函数）
- 当前 graph-extract-stage 实现: `apps/server/src/services/stages/graph-extract-stage.ts`（232 行，3 个内部函数）
- 现有测试: `apps/server/src/__tests__/services/cumulative-graph.test.ts`（4 case），`apps/server/src/__tests__/services/stages-graph-extract.test.ts`（3 case）

---

## 任务依赖关系

```
T1 (json-alias 抽共享)
  ├─ T2 (cumulative-graph 用共享 aliasKey)
  └─ T3 (graph-extract-stage 用共享 aliasKey)

T4 (抽 relation-mapping.prompt.ts)
T5 (删 parseRelationMapping fallthrough)
T6 (applyRelationMapping 加深拷)
  └─ T13 (cumulative-graph-utils.test.ts)

T7 (抽 graph-extract.prompt.ts)
T8 (拆 graph-extract-stage 纯函数)
  └─ T14 (graph-extract-utils.test.ts)

T9 (删 chapterNumber 字段)
T10 (删 v2 死函数)
T11 (chapters-crud delete 路径)
T12 (chapters-archive 删 chapterNumber)
T15 (GraphView.vue 改读 v3)
T16 (EditableGraph.vue 删 importance: 5)
T17 (Prisma 注释更新)
T18 (typecheck + 全测试)
```

T1-T8 互相独立可并行；T9-T12 互相独立；T13-T14 在 T5/T6/T8 完成后写；T18 收尾。

---

## Task 1: 抽 `packages/shared/src/json-alias.ts`（共享 aliasKey）

**Files:**
- Create: `packages/shared/src/json-alias.ts`
- Modify: `packages/shared/src/index.ts`（末尾追加 export）

- [ ] **Step 1: 创建文件 `packages/shared/src/json-alias.ts`**

```ts
/**
 * 共享 JSON 字段别名机制。
 *
 * AI 抽取 / dedup prompt 用短字段名省 token (例: n/e/t/k/...)，
 * 代码内部用长字段名（nodes/edges/type/key/...）。从 AI 返回的 JSON
 * 解析时优先短名, fallback 长名 —— 兼容老数据 / AI 偶尔写长名。
 */

export type FieldAliasMap = Record<string, string>

/**
 * 读取 obj 字段优先短名, fallback 长名。
 * obj 非对象返回 undefined。
 */
export function aliasKey<T = any>(
  obj: any,
  mapping: FieldAliasMap,
  long: string
): T | undefined {
  if (!obj || typeof obj !== 'object') return undefined
  const short = mapping[long]
  return (obj[short] ?? obj[long]) as T | undefined
}

/**
 * 关系字面归一映射 prompt 用 (mappings/from/to/variants/canonical)
 * 程序读时优先短名, fallback 长名。
 */
export const RELATION_MAPPING_ALIASES: FieldAliasMap = {
  mappings: 'mappings',
  from: 'f',
  to: 't',
  variants: 'v',
  canonical: 'c'
}

/**
 * graph extract prompt 用 (n/e/t/k/l/d/ft/fk/tt/tk/r)
 */
export const GRAPH_NODE_EDGES_ALIASES: FieldAliasMap = {
  nodes: 'n',
  edges: 'e',
  type: 't',
  key: 'k',
  label: 'l',
  data: 'd',
  fromType: 'ft',
  fromKey: 'fk',
  toType: 'tt',
  toKey: 'tk',
  relation: 'r'
}
```

- [ ] **Step 2: 在 `packages/shared/src/index.ts` 末尾追加 export**

文件已有 `export * from './extract-prompt.js'` 等。在 line 275 之后追加:

```ts
export * from './json-alias.js'
```

- [ ] **Step 3: 编译 shared 包**

```bash
cd D:\NewCode\ai-novel-runtime
pnpm --filter @novel-runtime/shared build
```

Expected: tsc 编译通过，生成 `dist/json-alias.js` + `dist/json-alias.d.ts`。

- [ ] **Step 4: 验证导出可见**

```bash
cd D:\NewCode\ai-novel-runtime
node -e "console.log(Object.keys(require('@novel-runtime/shared')))" 2>&1 | grep -i alias
```

Expected: 输出包含 `aliasKey` 和 `GRAPH_NODE_EDGES_ALIASES`。

- [ ] **Step 5: Commit**

```bash
cd D:\NewCode\ai-novel-runtime
git add packages/shared/src/json-alias.ts packages/shared/src/index.ts packages/shared/dist/
git commit -m "refactor(shared): extract json-alias with FIELD_ALIASES + aliasKey for graph modules"
```

---

## Task 2: `cumulative-graph.ts` 切换到共享 aliasKey

**Files:**
- Modify: `apps/server/src/services/cumulative-graph.ts:1-24`

- [ ] **Step 1: 删除文件内 `FIELD_ALIASES` 和 `aliasKey` 定义**

`cumulative-graph.ts` lines 8-24 是:
```ts
/**
 * 短→长字段映射, 用于解析 AI 返回 JSON。
 * 优先短名, fallback 长名 —— 老数据 / AI 偶尔写长名也接受。
 */
const FIELD_ALIASES = {
  mappings: 'mappings',
  from: 'f',
  to: 't',
  variants: 'v',
  canonical: 'c'
} as const

function aliasKey<T = any>(obj: any, long: keyof typeof FIELD_ALIASES): T | undefined {
  if (!obj || typeof obj !== 'object') return undefined
  const short = FIELD_ALIASES[long]
  return (obj[short] ?? obj[long]) as T | undefined
}
```

整段删除。

- [ ] **Step 2: 在 import 区域添加 shared import 并改写 aliasKey 调用**

在 line 1 附近的 import 区域，把:
```ts
import { cleanJsonBlock } from '@novel-runtime/shared'
```

改为:
```ts
import { cleanJsonBlock, aliasKey, RELATION_MAPPING_ALIASES } from '@novel-runtime/shared'
```

把文件中所有 `aliasKey(parsed, '...')` 改为 `aliasKey(parsed, RELATION_MAPPING_ALIASES, '...')`。

需要修改的位置（基于 423b5e0 之后的 cumulative-graph.ts）:
- line 107: `aliasKey(parsed, 'mappings')` 两处
- line 108: `aliasKey<any[]>(parsed, 'mappings')!`
- line 135: `aliasKey<string>(m, 'from')`
- line 136: `aliasKey<string>(m, 'to')`
- line 137: `aliasKey<string>(m, 'canonical')`
- line 138: `aliasKey<any[]>(m, 'variants')!`

最终 `parseRelationMapping` 函数变为:
```ts
function parseRelationMapping(raw: any[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const m of raw) {
    if (!m || typeof m !== 'object') continue
    const from = aliasKey<string>(m, RELATION_MAPPING_ALIASES, 'from')
    const to = aliasKey<string>(m, RELATION_MAPPING_ALIASES, 'to')
    const canonical = aliasKey<string>(m, RELATION_MAPPING_ALIASES, 'canonical')
    const variants = Array.isArray(aliasKey<any[]>(m, RELATION_MAPPING_ALIASES, 'variants')) ? aliasKey<any[]>(m, RELATION_MAPPING_ALIASES, 'variants')! : []
    if (typeof from !== 'string' || typeof to !== 'string' || typeof canonical !== 'string') continue
    for (const v of variants) {
      if (typeof v !== 'string') continue
      map.set(`${from}|${v}|${to}`, canonical)
    }
    // 兜底: 即使 variants 缺, from/to/canonical 自身也算一条
    map.set(`${from}|${canonical}|${to}`, canonical)
  }
  return map
}
```

调用侧 `buildCumulativeGraph` 内:
- line 107: `Array.isArray(aliasKey(parsed, RELATION_MAPPING_ALIASES, 'mappings')) ? aliasKey<any[]>(parsed, RELATION_MAPPING_ALIASES, 'mappings')! : []`

- [ ] **Step 3: 跑 typecheck 验证**

```bash
cd D:\NewCode\ai-novel-runtime
pnpm typecheck
```

Expected: 通过（无 error）。

- [ ] **Step 4: 跑现有 cumulative-graph 测试**

```bash
cd D:\NewCode\ai-novel-runtime
pnpm --filter server vitest run src/__tests__/services/cumulative-graph.test.ts
```

Expected: 4/4 测试通过。

- [ ] **Step 5: Commit**

```bash
cd D:\NewCode\ai-novel-runtime
git add apps/server/src/services/cumulative-graph.ts
git commit -m "refactor(v3): cumulative-graph use shared aliasKey from @novel-runtime/shared"
```

---

## Task 3: `graph-extract-stage.ts` 切换到共享 aliasKey

**Files:**
- Modify: `apps/server/src/services/stages/graph-extract-stage.ts:1-40`

- [ ] **Step 1: 删除文件内 `FIELD_ALIASES` 和 `aliasKey` 定义**

`graph-extract-stage.ts` lines 18-40 是:
```ts
/**
 * AI JSON 字段名短→长映射。prompt 用短名省 token, 代码内部仍用长名。
 * 取值时优先短名, fallback 长名 —— 老数据 / AI 偶尔写长名也接受。
 */
const FIELD_ALIASES = {
  nodes: 'n',
  edges: 'e',
  type: 't',
  key: 'k',
  label: 'l',
  data: 'd',
  fromType: 'ft',
  fromKey: 'fk',
  toType: 'tt',
  toKey: 'tk',
  relation: 'r'
} as const

function aliasKey<T = any>(obj: any, long: keyof typeof FIELD_ALIASES): T | undefined {
  if (!obj || typeof obj !== 'object') return undefined
  const short = FIELD_ALIASES[long]
  return (obj[short] ?? obj[long]) as T | undefined
}
```

整段删除。

- [ ] **Step 2: 改 import 区域 + 所有 aliasKey 调用**

把 line 3:
```ts
import { cleanJsonBlock } from '@novel-runtime/shared'
```

改为:
```ts
import { cleanJsonBlock, aliasKey, GRAPH_NODE_EDGES_ALIASES } from '@novel-runtime/shared'
```

把所有 `aliasKey(parsed, '...')` 和 `aliasKey(n, '...')` 改为 `aliasKey(parsed, GRAPH_NODE_EDGES_ALIASES, '...')` 和 `aliasKey(n, GRAPH_NODE_EDGES_ALIASES, '...')`。

需要修改的位置（基于 423b5e0 之后的 graph-extract-stage.ts）:
- line 48: `aliasKey<any[]>(parsed, 'nodes')!`
- line 49: `aliasKey<any[]>(parsed, 'edges')!`
- line 54: `aliasKey<string>(n, 'type')`
- line 55: `aliasKey<string>(n, 'key')`
- line 59: `aliasKey<string>(n, 'type')!`
- line 60: `aliasKey<string>(n, 'key')!`
- line 62: `aliasKey<string>(n, 'label')`
- line 63: `aliasKey<string>(n, 'key')!`
- line 66: `aliasKey<Record<string, unknown>>(n, 'data')`
- line 71-77: `aliasKey<string>(e, 'fromType'/'fromKey'/'toType'/'toKey'/'relation')`

- [ ] **Step 3: 跑 typecheck**

```bash
cd D:\NewCode\ai-novel-runtime
pnpm typecheck
```

Expected: 通过。

- [ ] **Step 4: 跑现有 graph-extract-stage 测试**

```bash
cd D:\NewCode\ai-novel-runtime
pnpm --filter server vitest run src/__tests__/services/stages-graph-extract.test.ts
```

Expected: 3/3 测试通过。

- [ ] **Step 5: Commit**

```bash
cd D:\NewCode\ai-novel-runtime
git add apps/server/src/services/stages/graph-extract-stage.ts
git commit -m "refactor(v3): graph-extract-stage use shared aliasKey from @novel-runtime/shared"
```

---

## Task 4: 抽 `relation-mapping.prompt.ts` 私有 prompt 模块

**Files:**
- Create: `apps/server/src/services/stages/relation-mapping.prompt.ts`
- Modify: `apps/server/src/services/cumulative-graph.ts:166-226`

- [ ] **Step 1: 创建 `apps/server/src/services/stages/relation-mapping.prompt.ts`**

```ts
import type { GraphSnapshot } from '../graph-snapshot.js'

/**
 * 私有 prompt 模板: 关系字面归一映射。
 *
 * AI 看完"全局累计图边"+"本章图谱边",输出一份 relation 归一映射表 (mappings)。
 * 不输出图谱,只输出 mapping —— 程序会按 mapping 重写累计图里所有 relation 字面,
 * 再用统一字面合并。
 *
 * 业务动机(2026-07-28):
 *   跨章节 AI 抽取的 relation 字面会漂移(同一段关系,不同章节写法不同)。
 *   codeMerge 按 ${from}|${relation}|${to} 五元组去重, 字面不同时直接失败。
 *   让 AI 显式输出字面归一映射,程序 apply 后 codeMerge 自然命中, weight 累加正确。
 */
export function buildRelationMappingPrompt(
  prev: GraphSnapshot,
  chapterGraph: GraphSnapshot
): string {
  return `你是小说知识图谱 relation 字面归一助手。

【任务】
基于"全局累计图(全部历史章节)边"和"本章图谱边",输出一份 relation 归一映射表(mapping)。
不输出图谱,只输出 mapping —— 程序会按 mapping 重写累计图里所有 relation 字面,再用统一字面合并。

【核心思路】
跨章节 AI 抽取的 relation 字面会漂移(同一段关系,不同章节写法不同)。例:
- ch#1: character:xu_qing -[收留/决定帮助]-> character:jiang_he
- ch#2: character:xu_qing -[收留并帮助]-> character:jiang_he
- ch#3: character:xu_qing -[收留]-> character:jiang_he
这三条字面不同,程序无法合并(按 from+relation+to 五元组去重失败)。
归一后全部映射到 "收留" 这一字面,程序自然合并, weight 累加。

【方向感知】
按 (fromType:fromKey → toType:toKey) 有序对处理,A→B 与 B→A 是两个独立关系,分别归一。
例: character:xu_qing → character:jiang_he 与 character:jiang_he → character:xu_qing 各自有自己的 variants 和 canonical。

【归一策略(同一有序对内的多条 relation)】
1. 【同义】字面或释义重复 → 合并为一个最简洁字面
   例: 收留/决定帮助 / 收留并帮助 / 决定帮助 / 收留 → 收留
2. 【升级】前后章存在阶段递进(关系强度由弱到强)→ 合并到终点状态
   例: 同事 / 恋人 / 夫妻 → 夫妻
   例: 师徒 / 仇敌 → 仇敌
3. 【反转】前后章关系性质反向 → 合并到反映剧情转折的那条
   例: 被刺 / 弃暗投明 → 弃暗投明
   例: 隶属 / 叛逃 → 叛逃
4. 字面差异明显、无法判断同义/升级/反转 → 不要输出这条 mapping,程序会保留原字面

【weight 字段】
代码内部用,不需要你处理。mapping 表里不要带 weight。

【累计图(全部历史边)】
${JSON.stringify({ edges: prev.edges })}

【本章图谱(全部边)】
${JSON.stringify({ edges: chapterGraph.edges })}

【输出格式】
返回严格 JSON,不要 markdown 代码块。

{
  "mappings": [
    {
      "from": "character:xu_qing",
      "to": "character:jiang_he",
      "variants": ["收留/决定帮助", "收留并帮助", "收留"],
      "canonical": "收留"
    },
    {
      "from": "character:jiang_he",
      "to": "character:xu_qing",
      "variants": ["被收留/戒备与初步信任", "初步信任并依赖"],
      "canonical": "依赖"
    }
  ]
}

没有需要归一的关系时, mappings 返回空数组 []。`
}
```

- [ ] **Step 2: 修改 `cumulative-graph.ts` 删内部 `buildRelationMappingPrompt` + 加 import**

在 `cumulative-graph.ts` line 1 附近的 import 区域添加（line 6 之后）:
```ts
import { buildRelationMappingPrompt } from './stages/relation-mapping.prompt.js'
```

删除 lines 166-226 的 `buildRelationMappingPrompt` 函数定义。

- [ ] **Step 3: 跑 typecheck**

```bash
cd D:\NewCode\ai-novel-runtime
pnpm typecheck
```

Expected: 通过。

- [ ] **Step 4: 跑现有 cumulative-graph 测试**

```bash
cd D:\NewCode\ai-novel-runtime
pnpm --filter server vitest run src/__tests__/services/cumulative-graph.test.ts
```

Expected: 4/4 测试通过。

- [ ] **Step 5: Commit**

```bash
cd D:\NewCode\ai-novel-runtime
git add apps/server/src/services/stages/relation-mapping.prompt.ts apps/server/src/services/cumulative-graph.ts
git commit -m "refactor(v3): extract relation-mapping.prompt from cumulative-graph"
```

---

## Task 5: 删 `parseRelationMapping` fallthrough 行

**Files:**
- Modify: `apps/server/src/services/cumulative-graph.ts:140-145`

- [ ] **Step 1: 删除 fallthrough 行**

`cumulative-graph.ts` line 144-145 是:
```ts
    // 兜底: 即使 variants 缺, from/to/canonical 自身也算一条
    map.set(`${from}|${canonical}|${to}`, canonical)
```

整段删除（含上面一行注释）。`parseRelationMapping` 改为:
```ts
function parseRelationMapping(raw: any[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const m of raw) {
    if (!m || typeof m !== 'object') continue
    const from = aliasKey<string>(m, RELATION_MAPPING_ALIASES, 'from')
    const to = aliasKey<string>(m, RELATION_MAPPING_ALIASES, 'to')
    const canonical = aliasKey<string>(m, RELATION_MAPPING_ALIASES, 'canonical')
    const variants = Array.isArray(aliasKey<any[]>(m, RELATION_MAPPING_ALIASES, 'variants')) ? aliasKey<any[]>(m, RELATION_MAPPING_ALIASES, 'variants')! : []
    if (typeof from !== 'string' || typeof to !== 'string' || typeof canonical !== 'string') continue
    for (const v of variants) {
      if (typeof v !== 'string') continue
      map.set(`${from}|${v}|${to}`, canonical)
    }
  }
  return map
}
```

- [ ] **Step 2: 跑 cumulative-graph 测试**

```bash
cd D:\NewCode\ai-novel-runtime
pnpm --filter server vitest run src/__tests__/services/cumulative-graph.test.ts
```

Expected: 4/4 测试通过。**关键 case**: "applies relation mapping from AI and merges chapterGraph into prev" 测试里的 AI 返回 variants 包含所有原字面 → 全部映射成功。如果有变体不在 variants 里, 将不映射（旧版会因 fallthrough 兜底成功，新版不会）。当前测试数据 variants 覆盖完整, 应该全过。

- [ ] **Step 3: Commit**

```bash
cd D:\NewCode\ai-novel-runtime
git add apps/server/src/services/cumulative-graph.ts
git commit -m "refactor(v3): drop parseRelationMapping fallthrough, strict AI responsibility"
```

---

## Task 6: `applyRelationMapping` 加深拷（immutable 语义）

**Files:**
- Modify: `apps/server/src/services/cumulative-graph.ts:153-164`

- [ ] **Step 1: 改 `applyRelationMapping` 函数**

`cumulative-graph.ts` lines 153-164:
```ts
function applyRelationMapping(snapshot: GraphSnapshot, mapping: Map<string, string>): GraphSnapshot {
  if (mapping.size === 0) return snapshot
  const rewrittenEdges = snapshot.edges.map(e => {
    const k = `${e.fromType}:${e.fromKey}|${e.relation}|${e.toType}:${e.toKey}`
    const canonical = mapping.get(k)
    if (canonical && canonical !== e.relation) {
      return { ...e, relation: canonical }
    }
    return e
  })
  return { ...snapshot, edges: rewrittenEdges }
}
```

改为:
```ts
function applyRelationMapping(snapshot: GraphSnapshot, mapping: Map<string, string>): GraphSnapshot {
  if (mapping.size === 0) return snapshot
  const rewrittenEdges = snapshot.edges.map(e => {
    const k = `${e.fromType}:${e.fromKey}|${e.relation}|${e.toType}:${e.toKey}`
    const canonical = mapping.get(k)
    if (canonical && canonical !== e.relation) {
      return { ...e, relation: canonical }
    }
    return e
  })
  // 深拷 nodes: 每个节点的 data 也拷一份, 避免与原 snapshot 共享引用
  // (AI 调用一旦未来修改 node.data 就会污染输入)
  return {
    ...snapshot,
    nodes: snapshot.nodes.map(n => ({ ...n, data: { ...(n.data || {}) } })),
    edges: rewrittenEdges
  }
}
```

- [ ] **Step 2: 跑 cumulative-graph 测试**

```bash
cd D:\NewCode\ai-novel-runtime
pnpm --filter server vitest run src/__tests__/services/cumulative-graph.test.ts
```

Expected: 4/4 测试通过。

- [ ] **Step 3: Commit**

```bash
cd D:\NewCode\ai-novel-runtime
git add apps/server/src/services/cumulative-graph.ts
git commit -m "refactor(v3): applyRelationMapping deep copy nodes for immutable semantics"
```

---

## Task 7: 抽 `graph-extract.prompt.ts` 私有 prompt 模块

**Files:**
- Create: `apps/server/src/services/stages/graph-extract.prompt.ts`

- [ ] **Step 1: 创建 `apps/server/src/services/stages/graph-extract.prompt.ts`**

```ts
import type { GraphNodeSnapshot } from '../graph-snapshot.js'

export interface BuildGraphExtractPromptInput {
  content: string
  characterNames: string[]
  prevCumulativeGraphNodes: Array<{ type: string; key: string; label: string }>
}

/**
 * 私有 prompt 模板: 本章实体和关系抽取。
 *
 * keyList 按 chapter content 预过滤（仅 label 出现在正文的实体）,
 * AI 必须复用其 type:key（锚定历史），否则不能引入新 key；
 * character/faction/item 类型节点优先复用 characterNames。
 */
export function buildGraphExtractPrompt(input: BuildGraphExtractPromptInput): string {
  const content = input.content || ''
  const matchedNodes = input.prevCumulativeGraphNodes.filter(
    (n) => n.label && content.includes(n.label)
  )
  const keyList = matchedNodes.length
    ? matchedNodes.map((n) => `${n.type}:${n.key}`).join(', ')
    : '（空，本章可自由起 key）'

  return `【任务】
分析章节内容，提取对剧情有实质推动作用的核心实体和它们之间的关系。

【实体与关系定义】
- type 可选值：character(角色), faction(势力/组织), event(事件), item(物品/道具)
- relation 建议值：隶属、对抗、师徒、配偶、兄弟、持有、发生地点、涉及
- relation 应是简洁的核心词或短语（2-6字为佳），直接表达两实体间的核心联系，不要带状语、从句或补充说明

【提取规则】
1. 【主线事件合并】同一主线剧情链的连续事件必须合并为一个整体事件节点。例如"许青找食材→下厨炒菜→姜禾品尝→指点厨艺"应合并为一个事件节点"许青教姜禾厨艺"，而不是拆成多个事件。
2. 【支线独立】与主线并行的独立支线（如第三方暗中观察、配角个人线）可以作为独立事件节点。
3. 【角色优先】主角和重要配角必须提取；路人、一次性提及的次要角色不要提取。
4. 【物品克制】只提取对剧情有实质推动的关键物品（主角佩剑/关键道具/信物），日常用品（餐具/衣物/家电/家具/书籍）不要提取，即便主角日常使用也不算关键物品。
5. 【事件 label 简短】label 只给图谱节点显示用, 4-8 字概括核心动作, 不堆叠人名; 不要写"许青收留姜禾并安置起居"这类含多动作的复合句, 详细情节放 data.desc。

【已有实体】（不要重复提取，但可补充新属性）：${keyList}

【章节内容】
${input.content}

【输出格式】
返回严格 JSON 格式，不要 markdown 代码块。**严格用下方短名**，不要用长名：

字段映射：n=nodes, e=edges, t=type, k=key, l=label, d=data, ft=fromType, fk=fromKey, tt=toType, tk=toKey, r=relation

{
  "n": [
    { "t": "character", "k": "xu_qing", "l": "许青", "d": { "role": "本章主角,应届毕业生" } },
    { "t": "faction", "k": "yan_bang", "l": "盐帮", "d": { "location": "古代江湖" } },
    { "t": "event", "k": "jiang_he_chuan_yue", "l": "姜禾穿越", "d": { "desc": "姜禾从古代穿越到现代,出现在许青家中,持有盐帮佩剑" } }
  ],
  "e": [
    { "ft": "character", "fk": "xu_qing", "tt": "character", "tk": "jiang_he", "r": "收留" }
  ]
}`
}
```

- [ ] **Step 2: 跑 typecheck**

```bash
cd D:\NewCode\ai-novel-runtime
pnpm typecheck
```

Expected: 通过。

- [ ] **Step 3: Commit**

```bash
cd D:\NewCode\ai-novel-runtime
git add apps/server/src/services/stages/graph-extract.prompt.ts
git commit -m "refactor(v3): extract graph-extract.prompt from graph-extract-stage"
```

---

## Task 8: 拆 `graph-extract-stage.ts` 为 4 个纯函数 + 编排

**Files:**
- Modify: `apps/server/src/services/stages/graph-extract-stage.ts`

- [ ] **Step 1: 替换 `normalizeGraph` → `parseGraphResponse`**

`graph-extract-stage.ts` line 47 开始的 `normalizeGraph` 函数整体替换为:

```ts
/**
 * 把 AI 返回的短名 JSON 归一化为内部结构（长名）。
 * 不读 importance —— 上一轮实验证明 AI 自评 -1 / 配角 > 主角 等范式不可靠，
 * 改由【主线事件合并 / 支线独立 / 角色优先】三原则让 AI 按剧情作用判定。
 */
export function parseGraphResponse(parsed: any): { nodes: any[]; edges: any[] } {
  const rawNodes = Array.isArray(aliasKey<any[]>(parsed, GRAPH_NODE_EDGES_ALIASES, 'nodes')) ? aliasKey<any[]>(parsed, GRAPH_NODE_EDGES_ALIASES, 'nodes')! : []
  const rawEdges = Array.isArray(aliasKey<any[]>(parsed, GRAPH_NODE_EDGES_ALIASES, 'edges')) ? aliasKey<any[]>(parsed, GRAPH_NODE_EDGES_ALIASES, 'edges')! : []

  return {
    nodes: rawNodes
      .filter((n: any) => {
        const t = aliasKey<string>(n, GRAPH_NODE_EDGES_ALIASES, 'type')
        const k = aliasKey<string>(n, GRAPH_NODE_EDGES_ALIASES, 'key')
        return n && typeof n === 'object' && typeof t === 'string' && typeof k === 'string'
      })
      .map((n: any) => ({
        type: aliasKey<string>(n, GRAPH_NODE_EDGES_ALIASES, 'type')!,
        key: aliasKey<string>(n, GRAPH_NODE_EDGES_ALIASES, 'key')!,
        label: aliasKey<string>(n, GRAPH_NODE_EDGES_ALIASES, 'label') || aliasKey<string>(n, GRAPH_NODE_EDGES_ALIASES, 'key')!,
        data: (() => {
          const d = aliasKey<Record<string, unknown>>(n, GRAPH_NODE_EDGES_ALIASES, 'data')
          return d && typeof d === 'object' ? d : {}
        })()
      })),
    edges: rawEdges.map((e: any) => ({
      fromType: aliasKey<string>(e, GRAPH_NODE_EDGES_ALIASES, 'fromType'),
      fromKey: aliasKey<string>(e, GRAPH_NODE_EDGES_ALIASES, 'fromKey'),
      toType: aliasKey<string>(e, GRAPH_NODE_EDGES_ALIASES, 'toType'),
      toKey: aliasKey<string>(e, GRAPH_NODE_EDGES_ALIASES, 'toKey'),
      relation: aliasKey<string>(e, GRAPH_NODE_EDGES_ALIASES, 'relation') || '',
      // extract 阶段永远是新增边, weight 由 cumulative-graph.ts codeMerge 累加
      weight: 1
    }))
  }
}
```

- [ ] **Step 2: 在 `parseGraphResponse` 之后添加 `dropOrphanEdges`**

紧接 `parseGraphResponse` 函数后添加:

```ts
/**
 * drop orphan edges (endpoints not in node list)
 */
export function dropOrphanEdges(
  nodes: any[],
  edges: any[],
  log: { info: (msg: string) => void } = { info: () => {} }
): any[] {
  const nodeKeySet = new Set(nodes.map((n: any) => `${n.type}:${n.key}`))
  const valid = edges.filter((e: any) =>
    nodeKeySet.has(`${e.fromType}:${e.fromKey}`) &&
    nodeKeySet.has(`${e.toType}:${e.toKey}`)
  )
  if (edges.length !== valid.length) {
    log.info(
      `[GraphExtractStage] orphan edges dropped: ${edges.length - valid.length} (endpoints not in node list)`
    )
  }
  return valid
}
```

- [ ] **Step 3: 添加 `dedupEdgesByPair`**

紧接 `dropOrphanEdges` 后添加:

```ts
/**
 * dedup by unordered pair, keep top 2 by weight (distinct relation, per prompt spec)
 */
export function dedupEdgesByPair(
  edges: any[],
  log: { info: (msg: string) => void } = { info: () => {} },
  maxPerPair = 2
): any[] {
  const grouped = new Map<string, any[]>()
  for (const e of edges) {
    const a = `${e.fromType}:${e.fromKey}`
    const b = `${e.toType}:${e.toKey}`
    const pairKey = a < b ? `${a}|${b}` : `${b}|${a}`
    if (!grouped.has(pairKey)) grouped.set(pairKey, [])
    grouped.get(pairKey)!.push(e)
  }

  const deduped: any[] = []
  for (const [, group] of grouped) {
    const sorted = [...group].sort((x, y) => (y.weight ?? 1) - (x.weight ?? 1))
    const seenRels = new Set<string>()
    const kept: any[] = []
    for (const e of sorted) {
      if (kept.length >= maxPerPair) break
      if (seenRels.has(e.relation)) continue
      seenRels.add(e.relation)
      kept.push(e)
    }
    deduped.push(...kept)
  }
  if (edges.length !== deduped.length) {
    log.info(
      `[GraphExtractStage] edge dedup: ${edges.length} → ${deduped.length} (keep top ${maxPerPair} per unordered pair, distinct relation)`
    )
  }
  return deduped
}
```

- [ ] **Step 4: 简化 `runGraphExtractStage` 编排**

替换 `runGraphExtractStage`（line 91-232 整段）:

```ts
export async function runGraphExtractStage(
  app: FastifyInstance,
  input: GraphExtractStageInput
): Promise<StageState<GraphExtractStageResult>> {
  const completedAt = new Date().toISOString()
  const content = input.content || ''

  // keyList 预过滤: 只把本章正文里出现过的实体塞进 prompt, 避免污染 AI 抽取
  const matchedNodes = input.prevCumulativeGraphNodes.filter(
    (n) => n.label && content.includes(n.label)
  )
  if (input.prevCumulativeGraphNodes.length > 0) {
    app.log.info(
      `[GraphExtractStage] keyList pre-filter: ${input.prevCumulativeGraphNodes.length} → ${matchedNodes.length} (matched labels in content)`
    )
  }

  try {
    const prisma = app.prisma
    const base = await loadRuntimeBase(input.storyId, prisma)
    const task = await loadWorkerTask(input.storyId, 'graph', prisma)
    const compiler = new RuntimePromptCompiler()

    const prompt = buildGraphExtractPrompt({
      content: input.content,
      characterNames: input.characterNames,
      prevCumulativeGraphNodes: input.prevCumulativeGraphNodes
    })
    const compiled = compiler.compile(base, task, prompt)

    const raw = await callAIWithStageRetry(app, {
      storyId: input.storyId,
      chapterId: input.chapterId,
      callType: 'graph_extract_stage',
      compiled,
      maxTokens: 4096
    })

    const parsed = JSON.parse(cleanJsonBlock(raw))
    const { nodes, edges } = parseGraphResponse(parsed)
    const validEdges = dropOrphanEdges(nodes, edges, app.log)
    const dedupedEdges = dedupEdgesByPair(validEdges, app.log)

    const chapterGraph: GraphSnapshot = {
      nodes: nodes.map((n: any) => ({
        type: n.type,
        key: n.key,
        label: n.label,
        data: n.data || {}
      })),
      edges: dedupedEdges.map((e: any) => ({
        fromType: e.fromType,
        fromKey: e.fromKey,
        toType: e.toType,
        toKey: e.toKey,
        relation: e.relation,
        weight: 1
      })),
      timestamp: new Date().toISOString()
    }

    return { status: 'success', result: { chapterGraph }, completedAt }
  } catch (err: any) {
    app.log.error(`[GraphExtractStage] ${err.message}`)
    return { status: 'failed', errorMessage: err.message, completedAt }
  }
}
```

- [ ] **Step 5: 改 import 区域**

把 line 1-6 的 import 区域:
```ts
import type { FastifyInstance } from 'fastify'
import { RuntimePromptCompiler } from '@novel-runtime/ai-provider'
import { cleanJsonBlock, aliasKey, GRAPH_NODE_EDGES_ALIASES } from '@novel-runtime/shared'
import { loadRuntimeBase, loadWorkerTask } from '../runtime-loader.js'
import { callAIWithStageRetry, type StageContext, type StageState } from './types.js'
import type { GraphSnapshot } from '../graph-snapshot.js'
```

在末尾追加:
```ts
import { buildGraphExtractPrompt } from './graph-extract.prompt.js'
```

- [ ] **Step 6: 跑 typecheck**

```bash
cd D:\NewCode\ai-novel-runtime
pnpm typecheck
```

Expected: 通过。

- [ ] **Step 7: 跑 graph-extract-stage 测试**

```bash
cd D:\NewCode\ai-novel-runtime
pnpm --filter server vitest run src/__tests__/services/stages-graph-extract.test.ts
```

Expected: 3/3 测试通过。

- [ ] **Step 8: Commit**

```bash
cd D:\NewCode\ai-novel-runtime
git add apps/server/src/services/stages/graph-extract-stage.ts apps/server/src/services/stages/graph-extract.prompt.ts
git commit -m "refactor(v3): split graph-extract-stage into parseGraphResponse/dropOrphanEdges/dedupEdgesByPair pure functions"
```

---

## Task 9: 删 `chapterNumber` 死字段

**Files:**
- Modify: `apps/server/src/services/cumulative-graph.ts:26-32`
- Modify: `apps/server/src/services/stages/cumulative-graph-build-service.ts:5-11, 23-39`

- [ ] **Step 1: 删 `CumulativeGraphInput.chapterNumber`**

`cumulative-graph.ts` line 29 是 `chapterNumber: number`。整行删除。`CumulativeGraphInput` 改为:
```ts
export interface CumulativeGraphInput {
  storyId: string
  chapterId: string
  chapterGraph: GraphSnapshot | null
  prevCumulativeGraph: GraphSnapshot | null
}
```

- [ ] **Step 2: 删 `BuildAndSaveInput.chapterNumber`**

`cumulative-graph-build-service.ts` line 8 是 `chapterNumber: number`。整行删除。

- [ ] **Step 3: 删 `buildCumulativeGraphWithTimestamp` 透传行**

`cumulative-graph-build-service.ts` lines 27-33 的 `buildCumulativeGraph` 调用，删除 `chapterNumber: input.chapterNumber,` 行。改为:
```ts
  const result = await buildCumulativeGraph(app, {
    storyId: input.storyId,
    chapterId: input.chapterId,
    chapterGraph: input.chapterGraph,
    prevCumulativeGraph: input.prevCumulativeGraph,
  })
```

- [ ] **Step 4: 跑 typecheck**

```bash
cd D:\NewCode\ai-novel-runtime
pnpm typecheck
```

Expected: 失败，错误指向 `chapters-archive.ts:427`（仍传 `chapterNumber`）。这是预期的，下一步 Task 12 修。

- [ ] **Step 5: Commit**

```bash
cd D:\NewCode\ai-novel-runtime
git add apps/server/src/services/cumulative-graph.ts apps/server/src/services/stages/cumulative-graph-build-service.ts
git commit -m "refactor(v3): drop dead chapterNumber field from CumulativeGraphInput and BuildAndSaveInput"
```

---

## Task 10: 删 v2 死函数 `saveGraphSnapshotAndDelta` 和 `rebuildGraphFromSnapshot`

**Files:**
- Modify: `apps/server/src/services/graph-snapshot.ts:28-139`

- [ ] **Step 1: 删除 `saveGraphSnapshotAndDelta`**

`graph-snapshot.ts` lines 28-95 整段删除（含上面 line 28 的 `/** 保存 cumulativeGraph 和 chapterGraph ... */` 注释块）。

- [ ] **Step 2: 删除 `rebuildGraphFromSnapshot`**

`graph-snapshot.ts` lines 97-139 整段删除（含上面 line 97 的注释块）。

- [ ] **Step 3: 跑 typecheck**

```bash
cd D:\NewCode\ai-novel-runtime
pnpm typecheck
```

Expected: 失败，错误指向 `chapters-crud.ts:198-206`（仍在用 `rebuildGraphFromSnapshot`）。预期内的，下一步修。

- [ ] **Step 4: 跑其他测试（不跑 chapters-crud）**

```bash
cd D:\NewCode\ai-novel-runtime
pnpm --filter server vitest run src/__tests__/services/ 2>&1 | tail -20
```

Expected: cumulative-graph 4/4 + graph-extract 3/3 + 其他测试通过。

- [ ] **Step 5: Commit**

```bash
cd D:\NewCode\ai-novel-runtime
git add apps/server/src/services/graph-snapshot.ts
git commit -m "refactor(v3): delete dead v2 saveGraphSnapshotAndDelta and rebuildGraphFromSnapshot"
```

---

## Task 11: 改 `chapters-crud.ts` 删章节后路径

**Files:**
- Modify: `apps/server/src/routes/chapters-crud.ts:195-215`

- [ ] **Step 1: 替换 delete 路径中 `rebuildGraphFromSnapshot` 调用块**

`chapters-crud.ts` lines 197-215 是:
```ts
    // 删除后重建图谱：用剩余最新章节的 snapshot 回退
    const { rebuildGraphFromSnapshot } = await import('../services/graph-snapshot.js')
    const prevChapter = await prisma.chapter.findFirst({
      where: { storyId: chapter.storyId, status: 'archived' },
      orderBy: { number: 'desc' }
    })
    if (prevChapter?.cumulativeGraph) {
      try {
        const snapshot = safeJsonParse(prevChapter.cumulativeGraph, null)
        if (snapshot) await rebuildGraphFromSnapshot(prisma, chapter.storyId, snapshot)
        app.log.info(`[Delete] Rebuilt graph from chapter ${prevChapter.number} snapshot`)
      } catch (err: any) {
        app.log.error(`[Delete] Graph rebuild failed: ${err.message}`)
      }
    } else {
      await prisma.graphEdge.deleteMany({ where: { storyId: chapter.storyId } })
      await prisma.graphNode.deleteMany({ where: { storyId: chapter.storyId } })
      app.log.info(`[Delete] Cleared all graph data for story ${chapter.storyId}`)
    }
```

整段替换为:
```ts
    // v3 累计图谱以 Chapter.cumulativeGraph JSON 为唯一 source-of-truth,
    // 不再重建 GraphNode/Edge 表 (两表已 deprecated, 见 prisma/schema.prisma)。
    // 删章节只移除本章 Chapter 行, 下一章打开时仍读 prev Chapter.cumulativeGraph。
    const prevChapter = await prisma.chapter.findFirst({
      where: { storyId: chapter.storyId, status: 'archived' },
      orderBy: { number: 'desc' }
    })
    app.log.info(
      { storyId: chapter.storyId, deletedChapterNumber: chapter.number, prevChapterNumber: prevChapter?.number },
      '[Delete] v3 累计图谱以 Chapter.cumulativeGraph JSON 为准, 不重建 GraphNode/Edge 表'
    )
```

注意: 此时 if (remainingChapters === 0) 分支里的 `prisma.graphEdge.deleteMany` / `prisma.graphNode.deleteMany` 兜底仍保留（line 232-237），用于清理 v2 时代的脏数据。

- [ ] **Step 2: 跑 typecheck**

```bash
cd D:\NewCode\ai-novel-runtime
pnpm typecheck
```

Expected: 通过。

- [ ] **Step 3: 跑 chapters-crud 路由测试（如果存在）**

```bash
cd D:\NewCode\ai-novel-runtime
pnpm --filter server vitest run src/__tests__/routes/ 2>&1 | tail -30
```

Expected: 如果有 delete 章节的测试，应该通过；如果有依赖 `rebuildGraphFromSnapshot` 的测试，会失败 —— 下一步修复或确认无此类测试。

- [ ] **Step 4: Commit**

```bash
cd D:\NewCode\ai-novel-runtime
git add apps/server/src/routes/chapters-crud.ts
git commit -m "refactor(v3): drop rebuildGraphFromSnapshot in delete path, v3 累计图谱以 Chapter.cumulativeGraph 为准"
```

---

## Task 12: 改 `chapters-archive.ts:427` 删 chapterNumber

**Files:**
- Modify: `apps/server/src/routes/chapters-archive.ts:425-432`

- [ ] **Step 1: 改 buildCumulativeGraphWithTimestamp 调用**

`chapters-archive.ts` line 425-432 是:
```ts
    let result: BuildAndSaveResult
    try {
      result = await buildCumulativeGraphWithTimestamp(app, {
        storyId: chapter.storyId, chapterId, chapterNumber: chapter.number,
        chapterGraph: body.chapterGraph,
        prevCumulativeGraph: prevCumulative,
      })
```

改为:
```ts
    let result: BuildAndSaveResult
    try {
      result = await buildCumulativeGraphWithTimestamp(app, {
        storyId: chapter.storyId, chapterId,
        chapterGraph: body.chapterGraph,
        prevCumulativeGraph: prevCumulative,
      })
```

- [ ] **Step 2: 跑 typecheck**

```bash
cd D:\NewCode\ai-novel-runtime
pnpm typecheck
```

Expected: 通过。

- [ ] **Step 3: Commit**

```bash
cd D:\NewCode\ai-novel-runtime
git add apps/server/src/routes/chapters-archive.ts
git commit -m "refactor(v3): drop chapterNumber from buildCumulativeGraphWithTimestamp call"
```

---

## Task 13: 新增 `cumulative-graph-utils.test.ts`

**Files:**
- Create: `apps/server/src/__tests__/services/cumulative-graph-utils.test.ts`

- [ ] **Step 1: 创建测试文件**

```ts
import { describe, it, expect } from 'vitest'

// 这些是私有函数, 测不了。改成测公开 buildCumulativeGraph 的副作用或准备
// 改 cumulative-graph.ts 把 parseRelationMapping / applyRelationMapping / codeMerge 导出。
// 临时方案：把 parseRelationMapping / applyRelationMapping 改 export。

// 见下一步 Step 2: 修改 cumulative-graph.ts 加 export
```

- [ ] **Step 2: 修改 `cumulative-graph.ts` 把 3 个函数改 export**

`cumulative-graph.ts` line 131 之前加 `export`:
```ts
export function parseRelationMapping(raw: any[]): Map<string, string> {
```

line 153 之前加 `export`:
```ts
export function applyRelationMapping(snapshot: GraphSnapshot, mapping: Map<string, string>): GraphSnapshot {
```

line 228 之前加 `export`:
```ts
export function codeMerge(prev: GraphSnapshot, chapterGraph: GraphSnapshot, now: string): GraphSnapshot {
```

- [ ] **Step 3: 替换测试文件**

`apps/server/src/__tests__/services/cumulative-graph-utils.test.ts` 全文:

```ts
import { describe, it, expect } from 'vitest'
import {
  parseRelationMapping,
  applyRelationMapping,
  codeMerge
} from '../../services/cumulative-graph.js'

const ts = '2026-07-25T00:00:00.000Z'

describe('parseRelationMapping', () => {
  it('sets map for each variant', () => {
    const raw = [
      { f: 'a', t: 'b', v: ['同义A', '同义B'], c: '统一' }
    ]
    const map = parseRelationMapping(raw)
    expect(map.get('a|同义A|b')).toBe('统一')
    expect(map.get('a|同义B|b')).toBe('统一')
  })

  it('skips mapping when variants missing (no fallthrough)', () => {
    const raw = [
      { f: 'a', t: 'b', c: '统一' }  // variants 缺
    ]
    const map = parseRelationMapping(raw)
    // 不设任何 key, 严格 AI 责任
    expect(map.size).toBe(0)
  })

  it('skips mapping when canonical missing', () => {
    const raw = [
      { f: 'a', t: 'b', v: ['字面'] }  // canonical 缺
    ]
    const map = parseRelationMapping(raw)
    expect(map.size).toBe(0)
  })

  it('skips mapping with wrong field types', () => {
    const raw = [
      { f: 123, t: 'b', v: ['字面'], c: '统一' },        // from 非字符串
      { f: 'a', t: null, v: ['字面'], c: '统一' },         // to 非字符串
      { f: 'a', t: 'b', v: 'not-array', c: '统一' }       // variants 非数组
    ]
    const map = parseRelationMapping(raw)
    expect(map.size).toBe(0)
  })

  it('multiple mappings with same from/to do not conflict', () => {
    const raw = [
      { f: 'a', t: 'b', v: ['A1'], c: '统一1' },
      { f: 'a', t: 'b', v: ['B1'], c: '统一2' }
    ]
    const map = parseRelationMapping(raw)
    expect(map.get('a|A1|b')).toBe('统一1')
    expect(map.get('a|B1|b')).toBe('统一2')
  })

  it('skips non-object entries', () => {
    const raw = [null, undefined, 'string', 123, { f: 'a', t: 'b', v: ['字面'], c: '统一' }]
    const map = parseRelationMapping(raw as any)
    expect(map.get('a|字面|b')).toBe('统一')
    expect(map.size).toBe(1)
  })
})

describe('applyRelationMapping', () => {
  const sample = {
    nodes: [
      { type: 'character', key: 'a', label: 'A', data: { x: 1 } }
    ],
    edges: [
      { fromType: 'character', fromKey: 'a', toType: 'character', toKey: 'b', relation: '字面1', weight: 1 }
    ],
    timestamp: ts
  }

  it('returns original reference when mapping empty', () => {
    const map = new Map<string, string>()
    const result = applyRelationMapping(sample, map)
    expect(result).toBe(sample)
  })

  it('rewrites relation when key matches and differs', () => {
    const map = new Map([['character:a|字面1|character:b', '字面2']])
    const result = applyRelationMapping(sample, map)
    expect(result.edges[0].relation).toBe('字面2')
  })

  it('keeps original when key matches but canonical equals current', () => {
    const map = new Map([['character:a|字面1|character:b', '字面1']])
    const result = applyRelationMapping(sample, map)
    // 即使字面相同也产生新数组元素 (immutable, 但 relation 字段值不变)
    expect(result.edges[0].relation).toBe('字面1')
    expect(result.edges).not.toBe(sample.edges)  // 新数组
  })

  it('keeps edges with non-matching keys unchanged', () => {
    const map = new Map([['character:a|其他字面|character:b', '字面2']])
    const result = applyRelationMapping(sample, map)
    expect(result.edges[0].relation).toBe('字面1')
  })

  it('deep copies nodes (modifying original data does not pollute result)', () => {
    const map = new Map([['character:a|字面1|character:b', '字面2']])
    const result = applyRelationMapping(sample, map)
    // 修改原 sample.nodes[0].data
    sample.nodes[0].data.x = 999
    // result.nodes[0].data 不应被影响
    expect(result.nodes[0].data.x).toBe(1)
  })

  it('hits multiple variants in same snapshot', () => {
    const multi = {
      nodes: sample.nodes,
      edges: [
        { fromType: 'character', fromKey: 'a', toType: 'character', toKey: 'b', relation: '字面1', weight: 1 },
        { fromType: 'character', fromKey: 'a', toType: 'character', toKey: 'b', relation: '字面2', weight: 1 }
      ],
      timestamp: ts
    }
    const map = new Map([
      ['character:a|字面1|character:b', '统一'],
      ['character:a|字面2|character:b', '统一']
    ])
    const result = applyRelationMapping(multi, map)
    expect(result.edges.every(e => e.relation === '统一')).toBe(true)
  })
})

describe('codeMerge', () => {
  it('accumulates weight when prev and chapterGraph share edge', () => {
    const prev = {
      nodes: [{ type: 'character', key: 'a', label: 'A', data: {} }],
      edges: [{ fromType: 'character', fromKey: 'a', toType: 'character', toKey: 'b', relation: '友', weight: 1 }],
      timestamp: ts
    }
    const chapterGraph = {
      nodes: [{ type: 'character', key: 'a', label: 'A', data: {} }],
      edges: [{ fromType: 'character', fromKey: 'a', toType: 'character', toKey: 'b', relation: '友', weight: 1 }],
      timestamp: ts
    }
    const result = codeMerge(prev, chapterGraph, ts)
    expect(result.edges).toHaveLength(1)
    expect(result.edges[0].weight).toBe(2)
  })

  it('treats different relation literal as different edge', () => {
    const prev = {
      nodes: [{ type: 'character', key: 'a', label: 'A', data: {} }],
      edges: [{ fromType: 'character', fromKey: 'a', toType: 'character', toKey: 'b', relation: '友', weight: 1 }],
      timestamp: ts
    }
    const chapterGraph = {
      nodes: [{ type: 'character', key: 'a', label: 'A', data: {} }],
      edges: [{ fromType: 'character', fromKey: 'a', toType: 'character', toKey: 'b', relation: '敌', weight: 1 }],
      timestamp: ts
    }
    const result = codeMerge(prev, chapterGraph, ts)
    expect(result.edges).toHaveLength(2)
  })

  it('sets new edge weight to 1', () => {
    const prev = { nodes: [], edges: [], timestamp: ts }
    const chapterGraph = {
      nodes: [{ type: 'character', key: 'a', label: 'A', data: {} }],
      edges: [{ fromType: 'character', fromKey: 'a', toType: 'character', toKey: 'b', relation: '新', weight: 99 }],
      timestamp: ts
    }
    const result = codeMerge(prev, chapterGraph, ts)
    expect(result.edges[0].weight).toBe(1)  // 忽略 chapterGraph 的 weight
  })

  it('deduplicates nodes by type:key (chapterGraph overrides prev)', () => {
    const prev = {
      nodes: [{ type: 'character', key: 'a', label: 'A-old', data: { x: 1 } }],
      edges: [],
      timestamp: ts
    }
    const chapterGraph = {
      nodes: [{ type: 'character', key: 'a', label: 'A-new', data: { y: 2 } }],
      edges: [],
      timestamp: ts
    }
    const result = codeMerge(prev, chapterGraph, ts)
    expect(result.nodes).toHaveLength(1)
    expect(result.nodes[0].label).toBe('A-new')
  })
})
```

- [ ] **Step 4: 跑新单测**

```bash
cd D:\NewCode\ai-novel-runtime
pnpm --filter server vitest run src/__tests__/services/cumulative-graph-utils.test.ts
```

Expected: 17/17 测试通过（parseRelationMapping 6 + applyRelationMapping 6 + codeMerge 4 + 空判断类容差）。

- [ ] **Step 5: 跑现有 cumulative-graph 集成测试**

```bash
cd D:\NewCode\ai-novel-runtime
pnpm --filter server vitest run src/__tests__/services/cumulative-graph.test.ts
```

Expected: 4/4 通过。

- [ ] **Step 6: Commit**

```bash
cd D:\NewCode\ai-novel-runtime
git add apps/server/src/services/cumulative-graph.ts apps/server/src/__tests__/services/cumulative-graph-utils.test.ts
git commit -m "test(v3): add cumulative-graph-utils unit tests for parse/apply/merge"
```

---

## Task 14: 新增 `graph-extract-utils.test.ts`

**Files:**
- Create: `apps/server/src/__tests__/services/graph-extract-utils.test.ts`

- [ ] **Step 1: 修改 `graph-extract-stage.ts` 把 3 个纯函数改 export**

`graph-extract-stage.ts` line 47 之前加 `export`:
```ts
export function parseGraphResponse(parsed: any): { nodes: any[]; edges: any[] } {
```

line 73 (dropOrphanEdges) 之前加 `export`:
```ts
export function dropOrphanEdges(
```

line 100 (dedupEdgesByPair) 之前加 `export`:
```ts
export function dedupEdgesByPair(
```

- [ ] **Step 2: 创建测试文件**

`apps/server/src/__tests__/services/graph-extract-utils.test.ts` 全文:

```ts
import { describe, it, expect, vi } from 'vitest'
import {
  parseGraphResponse,
  dropOrphanEdges,
  dedupEdgesByPair
} from '../../services/stages/graph-extract-stage.js'
import { buildGraphExtractPrompt } from '../../services/stages/graph-extract.prompt.js'

describe('parseGraphResponse', () => {
  it('parses short field names', () => {
    const parsed = {
      n: [
        { t: 'character', k: 'a', l: 'A', d: { role: 'hero' } }
      ],
      e: [
        { ft: 'character', fk: 'a', tt: 'character', tk: 'b', r: '友' }
      ]
    }
    const result = parseGraphResponse(parsed)
    expect(result.nodes).toEqual([
      { type: 'character', key: 'a', label: 'A', data: { role: 'hero' } }
    ])
    expect(result.edges).toEqual([
      { fromType: 'character', fromKey: 'a', toType: 'character', toKey: 'b', relation: '友', weight: 1 }
    ])
  })

  it('falls back to long field names when short missing', () => {
    const parsed = {
      nodes: [
        { type: 'character', key: 'a', label: 'A' }
      ],
      edges: [
        { fromType: 'character', fromKey: 'a', toType: 'character', toKey: 'b', relation: '友' }
      ]
    }
    const result = parseGraphResponse(parsed)
    expect(result.nodes).toHaveLength(1)
    expect(result.edges).toHaveLength(1)
  })

  it('filters nodes missing type or key', () => {
    const parsed = {
      n: [
        { t: 'character', k: 'a' },                        // OK
        { t: 'character' },                                  // 缺 key
        { k: 'b' },                                          // 缺 type
        null,                                                // 非对象
        'string'                                             // 非对象
      ],
      e: []
    }
    const result = parseGraphResponse(parsed)
    expect(result.nodes).toHaveLength(1)
  })

  it('falls back label to key when label missing', () => {
    const parsed = { n: [{ t: 'character', k: 'a' }], e: [] }
    const result = parseGraphResponse(parsed)
    expect(result.nodes[0].label).toBe('a')
  })

  it('defaults data to empty object when missing or non-object', () => {
    const parsed = {
      n: [
        { t: 'character', k: 'a' },
        { t: 'character', k: 'b', d: null },
        { t: 'character', k: 'c', d: 'string' }
      ],
      e: []
    }
    const result = parseGraphResponse(parsed)
    expect(result.nodes.every(n => n.data && Object.keys(n.data).length === 0)).toBe(true)
  })

  it('defaults relation to empty string when missing', () => {
    const parsed = { n: [], e: [{ ft: 'c', fk: 'a', tt: 'c', tk: 'b' }] }
    const result = parseGraphResponse(parsed)
    expect(result.edges[0].relation).toBe('')
  })
})

describe('dropOrphanEdges', () => {
  const silentLog = { info: vi.fn() }

  it('keeps edges with both endpoints in node list', () => {
    const nodes = [
      { type: 'character', key: 'a' },
      { type: 'character', key: 'b' }
    ]
    const edges = [
      { fromType: 'character', fromKey: 'a', toType: 'character', toKey: 'b', relation: '友' }
    ]
    const result = dropOrphanEdges(nodes, edges, silentLog)
    expect(result).toHaveLength(1)
    expect(silentLog.info).not.toHaveBeenCalled()
  })

  it('drops edges with endpoints not in node list and logs count', () => {
    const nodes = [{ type: 'character', key: 'a' }]
    const edges = [
      { fromType: 'character', fromKey: 'a', toType: 'character', toKey: 'b', relation: '友' },
      { fromType: 'character', fromKey: 'c', toType: 'character', toKey: 'a', relation: '友' }
    ]
    const result = dropOrphanEdges(nodes, edges, silentLog)
    expect(result).toHaveLength(0)
    expect(silentLog.info).toHaveBeenCalledWith(
      expect.stringContaining('orphan edges dropped: 2')
    )
  })

  it('drops edge when only one endpoint missing', () => {
    const nodes = [{ type: 'character', key: 'a' }]
    const edges = [
      { fromType: 'character', fromKey: 'a', toType: 'character', toKey: 'b', relation: '友' }
    ]
    const result = dropOrphanEdges(nodes, edges, silentLog)
    expect(result).toHaveLength(0)
  })
})

describe('dedupEdgesByPair', () => {
  const silentLog = { info: vi.fn() }

  it('keeps top 2 distinct relations per unordered pair', () => {
    const edges = [
      { fromType: 'c', fromKey: 'a', toType: 'c', toKey: 'b', relation: '友', weight: 1 },
      { fromType: 'c', fromKey: 'a', toType: 'c', toKey: 'b', relation: '敌', weight: 1 },
      { fromType: 'c', fromKey: 'a', toType: 'c', toKey: 'b', relation: '师', weight: 1 }
    ]
    const result = dedupEdgesByPair(edges, silentLog, 2)
    expect(result).toHaveLength(2)
    const rels = result.map(e => e.relation).sort()
    expect(rels).toEqual(['友', '敌'])  // 任意 2 条
  })

  it('treats A→B and B→A as same unordered pair', () => {
    const edges = [
      { fromType: 'c', fromKey: 'a', toType: 'c', toKey: 'b', relation: '友', weight: 1 },
      { fromType: 'c', fromKey: 'b', toType: 'c', toKey: 'a', relation: '敌', weight: 1 }
    ]
    const result = dedupEdgesByPair(edges, silentLog, 2)
    expect(result).toHaveLength(2)  // 同一 pair 但方向不同, 都是独立边
  })

  it('does not duplicate relation within same pair', () => {
    const edges = [
      { fromType: 'c', fromKey: 'a', toType: 'c', toKey: 'b', relation: '友', weight: 1 },
      { fromType: 'c', fromKey: 'a', toType: 'c', toKey: 'b', relation: '友', weight: 1 }
    ]
    const result = dedupEdgesByPair(edges, silentLog, 2)
    expect(result).toHaveLength(1)
  })

  it('does not affect different pairs', () => {
    const edges = [
      { fromType: 'c', fromKey: 'a', toType: 'c', toKey: 'b', relation: '友', weight: 1 },
      { fromType: 'c', fromKey: 'a', toType: 'c', toKey: 'c', relation: '敌', weight: 1 }
    ]
    const result = dedupEdgesByPair(edges, silentLog, 2)
    expect(result).toHaveLength(2)
  })

  it('sorts by weight desc, picks top distinct', () => {
    const edges = [
      { fromType: 'c', fromKey: 'a', toType: 'c', toKey: 'b', relation: '友', weight: 1 },
      { fromType: 'c', fromKey: 'a', toType: 'c', toKey: 'b', relation: '友', weight: 5 },  // 同 rel 高 weight
      { fromType: 'c', fromKey: 'a', toType: 'c', toKey: 'b', relation: '敌', weight: 1 }
    ]
    const result = dedupEdgesByPair(edges, silentLog, 2)
    expect(result).toHaveLength(2)
    const friends = result.filter(e => e.relation === '友')
    expect(friends).toHaveLength(1)
    expect(friends[0].weight).toBe(5)  // 高 weight 留下
  })
})

describe('buildGraphExtractPrompt', () => {
  it('contains 6 section headers', () => {
    const prompt = buildGraphExtractPrompt({ content: 'x', characterNames: [], prevCumulativeGraphNodes: [] })
    expect(prompt).toContain('【任务】')
    expect(prompt).toContain('【实体与关系定义】')
    expect(prompt).toContain('【提取规则】')
    expect(prompt).toContain('【已有实体】')
    expect(prompt).toContain('【章节内容】')
    expect(prompt).toContain('【输出格式】')
  })

  it('uses short field names in schema example', () => {
    const prompt = buildGraphExtractPrompt({ content: 'x', characterNames: [], prevCumulativeGraphNodes: [] })
    expect(prompt).toContain('"n":')
    expect(prompt).toContain('"ft":')
    expect(prompt).toContain('"fk":')
    expect(prompt).toContain('"tt":')
    expect(prompt).toContain('"tk":')
    expect(prompt).toContain('"r":')
  })

  it('pre-filters keyList by content (only labels in content kept)', () => {
    const prompt = buildGraphExtractPrompt({
      content: '许青和姜禾',
      characterNames: [],
      prevCumulativeGraphNodes: [
        { type: 'character', key: 'xu_qing', label: '许青' },
        { type: 'character', key: 'unknown', label: '未出现' }
      ]
    })
    expect(prompt).toContain('character:xu_qing')
    expect(prompt).not.toContain('character:unknown')
  })
})
```

- [ ] **Step 3: 跑新单测**

```bash
cd D:\NewCode\ai-novel-runtime
pnpm --filter server vitest run src/__tests__/services/graph-extract-utils.test.ts
```

Expected: 19/19 测试通过。

- [ ] **Step 4: 跑现有 graph-extract-stage 集成测试**

```bash
cd D:\NewCode\ai-novel-runtime
pnpm --filter server vitest run src/__tests__/services/stages-graph-extract.test.ts
```

Expected: 3/3 通过。

- [ ] **Step 5: Commit**

```bash
cd D:\NewCode\ai-novel-runtime
git add apps/server/src/services/stages/graph-extract-stage.ts apps/server/src/services/stages/graph-extract.prompt.ts apps/server/src/__tests__/services/graph-extract-utils.test.ts
git commit -m "test(v3): add graph-extract-utils unit tests for parse/drop/dedup/prompt"
```

---

## Task 15: 改 `GraphView.vue` 读 v3 累计图谱接口

**Files:**
- Modify: `apps/web/src/components/graph/GraphView.vue:1-50, 220-262`

- [ ] **Step 1: 在 GraphView.vue 顶部加 import**

找到 GraphView.vue 的 import 区域。当前有:
```ts
import { graphApi } from '@/api/graph'
```

改为:
```ts
import { graphApi } from '@/api/graph'
import { cumulativeGraphApi } from '@/api/cumulative-graph'
```

- [ ] **Step 2: 改 `loadChapterGraph`**

GraphView.vue lines 231-242:
```ts
async function loadChapterGraph(chapterId: string) {
  const res = await graphApi.getSnapshot(chapterId)
  const data = res.data.data

  currentSnapshot.value = toGraphData(data.snapshot?.nodes, data.snapshot?.edges)
  currentDelta.value = toGraphData(data.delta?.nodes, data.delta?.edges)

  await loadPrevSnapshot(chapterId)

  await nextTick()
  cytoscape.init()
}
```

改为:
```ts
async function loadChapterGraph(chapterId: string) {
  const res = await cumulativeGraphApi.get(chapterId)
  const data = res.data.data

  // v3 接口: { graph: { nodes, edges, timestamp } }
  // snapshot 视图: 累计图（cumulativeGraph）
  // delta 视图: chapterGraph (从 ch.cumulativeGraph 中由 next chapter 重算, 或读 chapterGraph 列)
  currentSnapshot.value = toGraphData(data.graph?.nodes, data.graph?.edges)
  currentDelta.value = toGraphData(data.chapterGraph?.nodes, data.chapterGraph?.edges)

  await loadPrevSnapshot(chapterId)

  await nextTick()
  cytoscape.init()
}
```

- [ ] **Step 3: 改 `loadPrevSnapshot`**

GraphView.vue lines 244-262:
```ts
async function loadPrevSnapshot(currentChapterId: string) {
  const currentIndex = chapters.value.findIndex((c) => c.id === currentChapterId)
  if (currentIndex <= 0) {
    prevSnapshot.value = null
    return
  }
  // 找前一个章节（按 number 排序后的前一个）
  const prevChapter = chapters.value[currentIndex - 1]
  if (!prevChapter) {
    prevSnapshot.value = null
    return
  }
  try {
    const res = await graphApi.getSnapshot(prevChapter.id)
    prevSnapshot.value = res.data.data.snapshot
  } catch {
    prevSnapshot.value = null
  }
}
```

改为:
```ts
async function loadPrevSnapshot(currentChapterId: string) {
  const currentIndex = chapters.value.findIndex((c) => c.id === currentChapterId)
  if (currentIndex <= 0) {
    prevSnapshot.value = null
    return
  }
  // 找前一个章节（按 number 排序后的前一个）
  const prevChapter = chapters.value[currentIndex - 1]
  if (!prevChapter) {
    prevSnapshot.value = null
    return
  }
  try {
    const res = await cumulativeGraphApi.get(prevChapter.id)
    prevSnapshot.value = res.data.data.graph
  } catch {
    prevSnapshot.value = null
  }
}
```

- [ ] **Step 4: 跑 typecheck**

```bash
cd D:\NewCode\ai-novel-runtime
pnpm typecheck
```

Expected: 通过（`cumulativeGraphApi` 已存在，`data.graph` 是 v3 字段）。

- [ ] **Step 5: Commit**

```bash
cd D:\NewCode\ai-novel-runtime
git add apps/web/src/components/graph/GraphView.vue
git commit -m "refactor(web): GraphView read v3 cumulativeGraphApi (data.graph) instead of v2 graphApi.getSnapshot"
```

---

## Task 16: `EditableGraph.vue` 删 `importance: 5`

**Files:**
- Modify: `apps/web/src/components/graph/EditableGraph.vue:225-238`

- [ ] **Step 1: 删 `importance: 5` 字段**

`EditableGraph.vue` line 225-238:
```ts
async function handleCreateNode() {
  const newNode = {
    id: `${nodeForm.value.type}:${nodeForm.value.key}`,
    type: nodeForm.value.type,
    key: nodeForm.value.key,
    label: nodeForm.value.label,
    importance: 5
  }
  ...
}
```

删除 `importance: 5` 行:
```ts
async function handleCreateNode() {
  const newNode = {
    id: `${nodeForm.value.type}:${nodeForm.value.key}`,
    type: nodeForm.value.type,
    key: nodeForm.value.key,
    label: nodeForm.value.label
  }
  ...
}
```

- [ ] **Step 2: 跑 typecheck**

```bash
cd D:\NewCode\ai-novel-runtime
pnpm typecheck
```

Expected: 通过。

- [ ] **Step 3: Commit**

```bash
cd D:\NewCode\ai-novel-runtime
git add apps/web/src/components/graph/EditableGraph.vue
git commit -m "refactor(web): drop importance: 5 from EditableGraph handleCreateNode (v3 不用 importance)"
```

---

## Task 17: 改 `GraphNode/GraphEdge` Prisma 注释

**Files:**
- Modify: `prisma/schema.prisma:180-210`

- [ ] **Step 1: 读取 `schema.prisma` GraphNode/GraphEdge 注释块**

读 `prisma/schema.prisma` 找到 GraphNode 和 GraphEdge 的 `///` 注释。当前为 `@deprecated v3 不再写入新数据`。

- [ ] **Step 2: 改 GraphNode 注释**

把 GraphNode 模型的 `///` 注释改为:
```
/// @deprecated v3 不写不读. v3 GraphView 已重写 (读 Chapter.cumulativeGraph JSON).
/// 本表及 GraphEdge 计划在 v3 GraphView 稳定后删除 schema + 迁移.
```

- [ ] **Step 3: 改 GraphEdge 注释**

把 GraphEdge 模型的 `///` 注释改为同样内容:
```
/// @deprecated v3 不写不读. 见 GraphNode 注释.
```

- [ ] **Step 4: 跑 typecheck（不应影响 TS）**

```bash
cd D:\NewCode\ai-novel-runtime
pnpm typecheck
```

Expected: 通过（注释不影响 TS 类型）。

- [ ] **Step 5: Commit**

```bash
cd D:\NewCode\ai-novel-runtime
git add prisma/schema.prisma
git commit -m "docs(prisma): clarify GraphNode/GraphEdge deprecated, pending removal after v3 stable"
```

---

## Task 18: 最终验证（typecheck + 全测试）

**Files:** 无修改

- [ ] **Step 1: typecheck**

```bash
cd D:\NewCode\ai-novel-runtime
pnpm typecheck
```

Expected: 通过，无 error。

- [ ] **Step 2: 全测试**

```bash
cd D:\NewCode\ai-novel-runtime
pnpm --filter server vitest run
```

Expected: 所有原测试 + 新单测全部通过。**重点关注**:
- `cumulative-graph.test.ts` 4/4
- `cumulative-graph-utils.test.ts` 17/17
- `stages-graph-extract.test.ts` 3/3
- `graph-extract-utils.test.ts` 19/19
- 其他路由测试不回归

- [ ] **Step 3: 全量 build**

```bash
cd D:\NewCode\ai-novel-runtime
pnpm build
```

Expected: 通过。

- [ ] **Step 4: 手动验证（可选）**

启动 dev server，浏览器打开任意 chapter → GraphView 应该正常显示累计图谱（snapshot 视图）和 chapterGraph（delta 视图）。Console 无 error。

- [ ] **Step 5: git status 检查无未提交变更**

```bash
cd D:\NewCode\ai-novel-runtime
git status
```

Expected: 无未提交变更（working tree clean）。

- [ ] **Step 6: 列出本次重构的所有 commit**

```bash
cd D:\NewCode\ai-novel-runtime
git log --oneline -18
```

Expected: 看到本 plan 中所有 T1-T17 的 commit, 每个独立、原子。

---

## 完成检查清单

完成后必须满足:

- [ ] `apps/server/src/services/cumulative-graph.ts` ≤ 200 行（实际 ~190）
- [ ] `apps/server/src/services/stages/graph-extract-stage.ts` ≤ 150 行（实际 ~120）
- [ ] `packages/shared/src/json-alias.ts` 存在且导出 `aliasKey` / `RELATION_MAPPING_ALIASES` / `GRAPH_NODE_EDGES_ALIASES`
- [ ] `services/stages/{relation-mapping,graph-extract}.prompt.ts` 存在, 各自 export 一个 build*Prompt 函数
- [ ] `parseRelationMapping` 无 fallthrough 行
- [ ] `applyRelationMapping` 深拷 nodes
- [ ] `saveGraphSnapshotAndDelta` 已删
- [ ] `rebuildGraphFromSnapshot` 已删
- [ ] `chapters-crud.ts:195-215` 不再调 `rebuildGraphFromSnapshot`
- [ ] `CumulativeGraphInput` / `BuildAndSaveInput` 不含 `chapterNumber`
- [ ] `chapters-archive.ts:427` 不传 `chapterNumber`
- [ ] `GraphView.vue` 用 `cumulativeGraphApi.get` 读 `data.graph`
- [ ] `EditableGraph.vue` 不写 `importance: 5`
- [ ] `prisma/schema.prisma` GraphNode/GraphEdge 注释更明确 deprecated
- [ ] 4 个新单测文件全过
- [ ] 现有 7 个测试文件（含本次新增）全过
- [ ] typecheck + build 通过
