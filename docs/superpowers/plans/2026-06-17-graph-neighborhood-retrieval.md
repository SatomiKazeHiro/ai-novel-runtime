# Graph Neighborhood Retrieval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the O(N) "feed full N-1 graph to AI" behavior in `graph-organize` with a 2-hop neighborhood expansion around matched `type:key` nodes, bounded by a dynamic token budget, eliminating input-side token overflow as chapter count grows.

**Architecture:** Split the prompt-assembled graph payload into (a) a `previousSnapshot` of unchanged N-1 nodes/edges, (b) the new chapter's `extractedGraph` from `combined-extract`. In `organizeGraph`, intersect `extractedGraph` node keys against N-1 keys, run a 2-hop BFS over N-1 nodes starting from matched keys, and constrain the result by `contextLength - maxTokens(output) - compiled.meta.totalTokens(non-graph prompt) - SAFETY_MARGIN`. When `matchedKeys` is empty, skip the AI call entirely and code-merge. `combined-extract` is enhanced to inject a compact N-1 entity inventory (type+key+label) and stricter node-quality / edge-importance constraints.

**Tech Stack:** TypeScript, Vitest, Prisma (no schema changes), Fastify (no route changes), pnpm monorepo.

**Reference spec:** `docs/superpowers/specs/2026-06-17-graph-neighborhood-retrieval-design.md`

---

## Working Directory

All commands run from the repo root unless noted. The vitest config (`apps/server/vitest.config.ts`) auto-loads `src/__tests__/setup.ts` which `vi.resetAllMocks()` between tests — no manual cleanup needed in test files.

Run a single test file:

```bash
cd apps/server && pnpm vitest run src/__tests__/<name>.test.ts
```

Run the full server test suite:

```bash
cd apps/server && pnpm vitest run
```

Type-check the whole monorepo:

```bash
pnpm typecheck
```

Lint:

```bash
pnpm lint
```

---

## Task 1: `expandNeighborhood` 纯函数 + 单元测试

**Files:**
- Modify: `apps/server/src/services/graph-snapshot.ts` (append new exports at the bottom; do not touch `saveGraphSnapshotAndDelta` / `rebuildGraphFromSnapshot`)
- Create: `apps/server/src/__tests__/graph-snapshot-expandNeighborhood.test.ts`

**Why first:** The function is pure (no I/O, no AI), so it can be built and tested in isolation. `organizeGraph` (Task 4) will import it.

### Step 1: Write the failing test

Create `apps/server/src/__tests__/graph-snapshot-expandNeighborhood.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { expandNeighborhood, type GraphSnapshot } from '../services/graph-snapshot.js'

function makeSnapshot(): GraphSnapshot {
  return {
    nodes: [
      { type: 'character', key: 'a', label: 'A', data: {} },
      { type: 'character', key: 'b', label: 'B', data: {} },
      { type: 'character', key: 'c', label: 'C', data: {} },
      { type: 'character', key: 'd', label: 'D', data: {} },
      { type: 'character', key: 'e', label: 'E', data: {} },
      { type: 'faction',   key: 'f1', label: 'F1', data: {} }
    ],
    edges: [
      { fromType: 'character', fromKey: 'a', toType: 'character', toKey: 'b', relation: 'friend',  weight: 1 },
      { fromType: 'character', fromKey: 'b', toType: 'character', toKey: 'c', relation: 'mentor',  weight: 1 },
      { fromType: 'character', fromKey: 'c', toType: 'character', toKey: 'd', relation: 'sibling', weight: 1 },
      { fromType: 'character', fromKey: 'a', toType: 'faction',   toKey: 'f1', relation: 'member',  weight: 1 },
      { fromType: 'character', fromKey: 'e', toType: 'character', toKey: 'a', relation: 'enemy',   weight: 1 }
    ],
    timestamp: '2026-06-17T00:00:00.000Z'
  }
}

describe('expandNeighborhood — basic BFS', () => {
  it('depth=0 returns only the matched keys themselves (no edges)', () => {
    const r = expandNeighborhood(makeSnapshot(), ['character:a'], { maxDepth: 0, maxTokens: 10_000 })
    expect(r.nodes.map(n => `${n.type}:${n.key}`).sort()).toEqual(['character:a'])
    expect(r.edges).toEqual([])
    expect(r.truncated).toBe(false)
  })

  it('depth=1 includes direct neighbors and the edges that connect matched -> neighbor', () => {
    const r = expandNeighborhood(makeSnapshot(), ['character:a'], { maxDepth: 1, maxTokens: 10_000 })
    const keys = r.nodes.map(n => `${n.type}:${n.key}`).sort()
    expect(keys).toEqual(['character:a', 'character:b', 'character:e', 'faction:f1'])
    // Edges should be only those whose BOTH endpoints are in the node set
    expect(r.edges).toHaveLength(3)
    expect(r.edges.every(e =>
      r.nodes.some(n => n.type === e.fromType && n.key === e.fromKey) &&
      r.nodes.some(n => n.type === e.toType   && n.key === e.toKey)
    )).toBe(true)
  })

  it('depth=2 reaches 2-hop neighbors (a -> b -> c, but not d which is 3-hop)', () => {
    const r = expandNeighborhood(makeSnapshot(), ['character:a'], { maxDepth: 2, maxTokens: 10_000 })
    const keys = r.nodes.map(n => `${n.type}:${n.key}`).sort()
    // depth 0: a
    // depth 1: a's direct neighbors b, e, f1
    // depth 2: b's new neighbor c (e and f1 have no new neighbors)
    // d is 3-hop (a -> b -> c -> d) — must NOT be included at maxDepth=2
    expect(keys).toContain('character:c')
    expect(keys).not.toContain('character:d')
  })

  it('drops edges whose endpoint was not visited (orphans)', () => {
    // BFS starts at 'b'. a is reachable (1 hop) but c is not.
    // The edge a->c has one endpoint visited (a) and one unvisited (c);
    // the edge must be pruned from the result.
    const snap: GraphSnapshot = {
      nodes: [
        { type: 'character', key: 'a', label: 'A', data: {} },
        { type: 'character', key: 'b', label: 'B', data: {} },
        { type: 'character', key: 'c', label: 'C', data: {} }
      ],
      edges: [
        { fromType: 'character', fromKey: 'a', toType: 'character', toKey: 'b', relation: 'friend', weight: 1 },
        { fromType: 'character', fromKey: 'a', toType: 'character', toKey: 'c', relation: 'sibling', weight: 1 }
      ],
      timestamp: ''
    }
    const r = expandNeighborhood(snap, ['character:b'], { maxDepth: 1, maxTokens: 10_000 })
    // a is 1-hop from b, so a is in. c is not connected to b, so c is OUT.
    // Edge a->b: both endpoints in {a, b} → keep.
    // Edge a->c: c is OUT → drop.
    expect(r.nodes.map(n => n.key).sort()).toEqual(['a', 'b'])
    expect(r.edges).toHaveLength(1)
    expect(r.edges[0].toKey).toBe('b')
  })

  it('returns empty when matched key is not in snapshot', () => {
    const r = expandNeighborhood(makeSnapshot(), ['character:zzz'], { maxDepth: 2, maxTokens: 10_000 })
    expect(r.nodes).toEqual([])
    expect(r.edges).toEqual([])
    expect(r.truncated).toBe(false)
  })
})

describe('expandNeighborhood — budget enforcement', () => {
  it('truncates when estimated tokens exceed maxTokens (token_budget)', () => {
    // Custom estimator that returns large values to force early stop
    const heavy = (n: any) => 100
    const r = expandNeighborhood(makeSnapshot(), ['character:a'], {
      maxDepth: 2, maxTokens: 250, tokenEstimator: heavy
    })
    expect(r.truncated).toBe(true)
    expect(r.truncateReason).toBe('token_budget')
    // 250 / 100 = at most 2 nodes (matched + 1 neighbor)
    expect(r.nodes.length).toBeLessThanOrEqual(2)
  })

  it('truncates when node count exceeds maxEntities (max_entities)', () => {
    const r = expandNeighborhood(makeSnapshot(), ['character:a'], {
      maxDepth: 2, maxTokens: 10_000, maxEntities: 2
    })
    expect(r.truncated).toBe(true)
    expect(r.truncateReason).toBe('max_entities')
    expect(r.nodes.length).toBeLessThanOrEqual(2)
  })

  it('reports estimatedTokens = sum of estimator over all included nodes', () => {
    const sizeOf = (n: any) => JSON.stringify(n).length
    const r = expandNeighborhood(makeSnapshot(), ['character:a'], {
      maxDepth: 1, maxTokens: 10_000, tokenEstimator: sizeOf
    })
    const expected = r.nodes.reduce((sum, n) => sum + sizeOf(n), 0)
    expect(r.estimatedTokens).toBe(expected)
  })
})
```

### Step 2: Run the test to confirm it fails

```bash
cd apps/server && pnpm vitest run src/__tests__/graph-snapshot-expandNeighborhood.test.ts
```

Expected: FAIL with `SyntaxError` / "export not found" because `expandNeighborhood` is not yet exported.

### Step 3: Implement the minimal function

Append to `apps/server/src/services/graph-snapshot.ts` (do not modify the two existing functions):

```typescript
export interface ExpandOptions {
  maxDepth: number
  maxTokens: number
  maxEntities?: number
  tokenEstimator?: (node: GraphNodeSnapshot) => number
}

export interface NeighborhoodResult {
  nodes: GraphNodeSnapshot[]
  edges: GraphEdgeSnapshot[]
  truncated: boolean
  truncateReason?: 'token_budget' | 'max_entities' | 'max_depth'
  estimatedTokens: number
}

const defaultTokenEstimator = (n: GraphNodeSnapshot): number => {
  // Rough heuristic: ~4 chars per token (English-leaning). Matches the project's
  // shared/estimateTokens convention; suitable for prompt-side planning only.
  return Math.ceil((n.label.length + JSON.stringify(n.data || {}).length) / 4)
}

export function expandNeighborhood(
  snapshot: GraphSnapshot,
  matchedKeys: string[],
  options: ExpandOptions
): NeighborhoodResult {
  const { maxDepth, maxTokens, maxEntities, tokenEstimator = defaultTokenEstimator } = options

  const allNodesByKey = new Map<string, GraphNodeSnapshot>()
  for (const n of snapshot.nodes) {
    allNodesByKey.set(`${n.type}:${n.key}`, n)
  }

  // Pre-build adjacency: nodeKey -> list of otherNodeKey
  const adj = new Map<string, string[]>()
  for (const e of snapshot.edges) {
    const from = `${e.fromType}:${e.fromKey}`
    const to = `${e.toType}:${e.toKey}`
    if (!adj.has(from)) adj.set(from, [])
    if (!adj.has(to)) adj.set(to, [])
    adj.get(from)!.push(to)
    adj.get(to)!.push(from)
  }

  // BFS, tracking depth per node
  const visited = new Map<string, number>() // key -> depth
  const queue: Array<{ key: string; depth: number }> = []
  for (const k of matchedKeys) {
    if (allNodesByKey.has(k) && !visited.has(k)) {
      visited.set(k, 0)
      queue.push({ key: k, depth: 0 })
    }
  }

  const includedNodes: GraphNodeSnapshot[] = []
  let estimatedTokens = 0
  let truncated = false
  let truncateReason: 'token_budget' | 'max_entities' | 'max_depth' | undefined

  while (queue.length > 0) {
    const { key, depth } = queue.shift()!
    const node = allNodesByKey.get(key)!
    const cost = tokenEstimator(node)

    // entity-count cap
    if (maxEntities !== undefined && includedNodes.length + 1 > maxEntities) {
      truncated = true
      truncateReason = 'max_entities'
      break
    }
    // budget cap — check BEFORE adding so we don't include a node we can't afford
    if (estimatedTokens + cost > maxTokens) {
      truncated = true
      truncateReason = 'token_budget'
      break
    }

    includedNodes.push(node)
    estimatedTokens += cost

    if (depth >= maxDepth) continue
    const neighbors = adj.get(key) || []
    for (const nb of neighbors) {
      if (!visited.has(nb)) {
        visited.set(nb, depth + 1)
        queue.push({ key: nb, depth: depth + 1 })
      }
    }
  }

  // Edge pruning: keep edges whose BOTH endpoints are in the included set
  const includedKeys = new Set(includedNodes.map(n => `${n.type}:${n.key}`))
  const includedEdges = snapshot.edges.filter(e =>
    includedKeys.has(`${e.fromType}:${e.fromKey}`) &&
    includedKeys.has(`${e.toType}:${e.toKey}`)
  )

  return {
    nodes: includedNodes,
    edges: includedEdges,
    truncated,
    truncateReason,
    estimatedTokens
  }
}
```

### Step 4: Run the test to confirm it passes

```bash
cd apps/server && pnpm vitest run src/__tests__/graph-snapshot-expandNeighborhood.test.ts
```

Expected: PASS — all 8 tests green.

### Step 5: Commit

```bash
git add apps/server/src/services/graph-snapshot.ts apps/server/src/__tests__/graph-snapshot-expandNeighborhood.test.ts
git commit -m "feat(graph-snapshot): add expandNeighborhood 2-hop BFS with budget cap"
```

---

## Task 2: `combined_extract` 注入 N-1 实体清单

**Files:**
- Modify: `apps/server/src/services/combined-extractor.ts:29-148` (the `extractAll` function — add a `previousSnapshot` parameter and inject the N-1 inventory block into `extractPrompt`)
- Modify: `apps/server/src/services/combined-extractor.ts:252-264` (`prepareArchiveData` — pass the parent chapter's graph snapshot to `extractAll`)
- Create: `apps/server/src/__tests__/combined-extractor-prev-snapshot.test.ts`

**Why separate from Task 3:** This task touches the prompt assembly and the `extractAll` signature, which is the bigger refactor. Task 3 only adds two prompt sections and is much smaller — easier to review.

### Step 1: Write the failing test

Create `apps/server/src/__tests__/combined-extractor-prev-snapshot.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { GraphSnapshot } from '../services/graph-snapshot.js'

const mockCallAIWithLog = vi.fn()
const mockLoadRuntimeBase = vi.fn()
const mockLoadWorkerTask = vi.fn()

vi.mock('../services/ai-call-logger.js', () => ({
  callAIWithLog: (...args: any[]) => mockCallAIWithLog(...args)
}))
vi.mock('../services/runtime-loader.js', () => ({
  loadRuntimeBase: (...args: any[]) => mockLoadRuntimeBase(...args),
  loadWorkerTask: (...args: any[]) => mockLoadWorkerTask(...args)
}))

import { extractAll } from '../services/combined-extractor.js'

const emptyPayload = {
  memories: { mainEvents: [], sideEvents: [], emotions: [], foreshadowing: [],
              relationshipChanges: [], characterStatusChanges: {},
              timelineDay: 1, summary: '', scenes: [] },
  graph: { nodes: [], edges: [] },
  plotArcs: { arcs: [] }
}

function buildPrisma() {
  return {
    character: { findMany: vi.fn().mockResolvedValue([]) },
    plotArc: { findMany: vi.fn().mockResolvedValue([]) },
    graphNode: { findMany: vi.fn().mockResolvedValue([]) }
  }
}

describe('extractAll — N-1 entity inventory injection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLoadRuntimeBase.mockResolvedValue({ identity: '', settings: {}, behavior: '', jailbreak: '' })
    mockLoadWorkerTask.mockResolvedValue({ workerType: 'memory', taskPrompt: '' })
    mockCallAIWithLog.mockResolvedValue('```json\n' + JSON.stringify(emptyPayload) + '\n```')
  })

  it('injects N-1 entity list into prompt when previousSnapshot is provided', async () => {
    const prev: GraphSnapshot = {
      nodes: [
        { type: 'character', key: 'zhangsan', label: '张三', data: {} },
        { type: 'faction',   key: 'qingmeng',  label: '青盟', data: { note: 'rank:1' } }
      ],
      edges: [],
      timestamp: ''
    }
    const prisma = buildPrisma()
    const app: any = { prisma, log: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }

    await extractAll(app, 'c1', 's1', 'content', 'outline', 1, prev)

    const userMessage: string = mockCallAIWithLog.mock.calls[0][1].compiled.userMessage
    expect(userMessage).toContain('N-1 全局图谱中的实体清单')
    expect(userMessage).toContain('character:zhangsan (张三)')
    expect(userMessage).toContain('faction:qingmeng (青盟)')
  })

  it('omits N-1 inventory block when previousSnapshot is null', async () => {
    const prisma = buildPrisma()
    const app: any = { prisma, log: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }

    await extractAll(app, 'c1', 's1', 'content', 'outline', 1, null)

    const userMessage: string = mockCallAIWithLog.mock.calls[0][1].compiled.userMessage
    expect(userMessage).not.toContain('N-1 全局图谱中的实体清单')
  })

  it('caps N-1 inventory at 500 nodes (defensive: trims by importance desc)', async () => {
    const nodes = Array.from({ length: 800 }, (_, i) => ({
      type: 'character' as const,
      key: `k${i}`,
      label: `L${i}`,
      data: { importance: i % 10 } // higher i = higher importance
    }))
    const prev: GraphSnapshot = { nodes, edges: [], timestamp: '' }
    const prisma = buildPrisma()
    const app: any = { prisma, log: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }

    await extractAll(app, 'c1', 's1', 'content', 'outline', 1, prev)

    const userMessage: string = mockCallAIWithLog.mock.calls[0][1].compiled.userMessage
    // 800 → 500; the 300 lowest-importance nodes (k0..k299 with importance 0..9) are dropped.
    // The 500 highest-importance (k300..k799) survive.
    const occurrences = (userMessage.match(/character:k\d+/g) || []).length
    expect(occurrences).toBe(500)
  })
})
```

### Step 2: Run the test to confirm it fails

```bash
cd apps/server && pnpm vitest run src/__tests__/combined-extractor-prev-snapshot.test.ts
```

Expected: FAIL with "expected ... to contain 'N-1 全局图谱中的实体清单'" — the current prompt has no such block.

### Step 3: Add the `previousSnapshot` parameter and prompt injection

In `apps/server/src/services/combined-extractor.ts`, make three changes:

**Change A — update the function signature (line 29-36):**

Replace:

```typescript
export async function extractAll(
  app: FastifyInstance,
  chapterId: string,
  storyId: string,
  content: string,
  outline?: string,
  fromChapterNumber?: number
): Promise<CombinedExtractionData | null> {
```

with:

```typescript
export async function extractAll(
  app: FastifyInstance,
  chapterId: string,
  storyId: string,
  content: string,
  outline?: string,
  fromChapterNumber?: number,
  previousSnapshot?: GraphSnapshot | null
): Promise<CombinedExtractionData | null> {
```

**Change B — build the inventory block before the prompt string (just after line 76, before `const extractPrompt`):**

Insert:

```typescript
  // Inject N-1 entity inventory so the AI reuses existing type:key values
  // instead of inventing new ones. Cap at 500 to defend against extremely
  // large graphs; trim by descending importance when capped.
  let previousEntitiesBlock = ''
  if (previousSnapshot && previousSnapshot.nodes.length > 0) {
    const sorted = [...previousSnapshot.nodes]
      .sort((a, b) => {
        const ai = (a.data?.importance as number) || 0
        const bi = (b.data?.importance as number) || 0
        return bi - ai
      })
    const trimmed = sorted.slice(0, 500)
    const lines = trimmed.map(n => `- ${n.type}:${n.key} (${n.label})`)
    previousEntitiesBlock = `\n\n=== N-1 全局图谱中的实体清单（用于 key 复用） ===\n本故事 N-1 章后的图谱共有 ${previousSnapshot.nodes.length} 个实体，请严格复用以下 type:key，禁止再造新 key：\n${lines.join('\n')}\n注意：N-1 没有出现的实体才允许创建新 key。新 key 必须用英文小写、下划线分隔。`
  }
```

**Change C — splice the block into the prompt string (line 128-129 area, just after the "已有实体" line):**

Find:

```
已有实体（不要重复提取，但可补充新属性）：${Array.from(existingKeys).join(', ') || '无'}
```

and replace with:

```
已有实体（不要重复提取，但可补充新属性）：${Array.from(existingKeys).join(', ') || '无'}${previousEntitiesBlock}
```

**Change D — update `prepareArchiveData` to fetch and pass the parent snapshot (line 264):**

Replace:

```typescript
  // 1. 纯提取
  const extraction = await extractAll(app, chapterId, storyId, content, outline || undefined, fromChapterNumber)
```

with:

```typescript
  // 1. 纯提取（传 N-1 图谱快照，combined_extract 注入 N-1 实体清单帮 AI 复用 key）
  //    同一份 previousSnapshot 后面 graph-organize 也会用（避免重查）
  const extraction = await extractAll(
    app, chapterId, storyId, content, outline || undefined, fromChapterNumber, previousSnapshot
  )
```

And insert (just before that line) the snapshot lookup already done in `organizeGraph` callers — but since `previousSnapshot` is already computed in `prepareArchiveData` for `organizeGraph`, refactor it to be computed once at the top of `prepareArchiveData` and passed both to `extractAll` and `organizeGraph`. Concretely: in `prepareArchiveData` (line 270-289), the `previousSnapshot` lookup is already in place; just pass it as the 7th argument to `extractAll`. The existing variable is already named `previousSnapshot` — the call becomes:

```typescript
  // 1. 纯提取
  const extraction = await extractAll(
    app, chapterId, storyId, content, outline || undefined, fromChapterNumber, previousSnapshot
  )
```

Note: this requires re-ordering — `previousSnapshot` is computed at line 270 *after* `extractAll` is called at line 264. Move the `previousSnapshot` lookup (lines 270-289) to BEFORE the `extractAll` call. Verify the rest of `prepareArchiveData` still uses it the same way (line 293 still references `previousSnapshot` for `organizeGraph`).

### Step 4: Run the test to confirm it passes

```bash
cd apps/server && pnpm vitest run src/__tests__/combined-extractor-prev-snapshot.test.ts
```

Expected: PASS — all 3 tests green.

Re-run the existing extractAll tests to make sure no regression:

```bash
cd apps/server && pnpm vitest run src/__tests__/combined-extractor-extractAll.test.ts
```

Expected: existing tests still pass (the new param has a default behavior, so old call sites work).

### Step 5: Commit

```bash
git add apps/server/src/services/combined-extractor.ts apps/server/src/__tests__/combined-extractor-prev-snapshot.test.ts
git commit -m "feat(combined-extract): inject N-1 entity inventory into extraction prompt"
```

---

## Task 3: `combined_extract` 节点质量约束 + 边 importance

**Files:**
- Modify: `apps/server/src/services/combined-extractor.ts:124-130` (the extractPrompt string for tasks 2)
- Create: `apps/server/src/__tests__/combined-extractor-prompt.test.ts`

**Why separate:** Pure prompt-text changes, isolated from the function-signature work in Task 2.

### Step 1: Write the failing test

Create `apps/server/src/__tests__/combined-extractor-prompt.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockCallAIWithLog = vi.fn()
const mockLoadRuntimeBase = vi.fn()
const mockLoadWorkerTask = vi.fn()

vi.mock('../services/ai-call-logger.js', () => ({
  callAIWithLog: (...args: any[]) => mockCallAIWithLog(...args)
}))
vi.mock('../services/runtime-loader.js', () => ({
  loadRuntimeBase: (...args: any[]) => mockLoadRuntimeBase(...args),
  loadWorkerTask: (...args: any[]) => mockLoadWorkerTask(...args)
}))

import { extractAll } from '../services/combined-extractor.js'

const emptyPayload = {
  memories: { mainEvents: [], sideEvents: [], emotions: [], foreshadowing: [],
              relationshipChanges: [], characterStatusChanges: {},
              timelineDay: 1, summary: '', scenes: [] },
  graph: { nodes: [], edges: [] },
  plotArcs: { arcs: [] }
}

function buildPrisma() {
  return {
    character: { findMany: vi.fn().mockResolvedValue([]) },
    plotArc: { findMany: vi.fn().mockResolvedValue([]) },
    graphNode: { findMany: vi.fn().mockResolvedValue([]) }
  }
}

describe('extractAll — node quality & edge importance (L2 prompt constraints)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLoadRuntimeBase.mockResolvedValue({ identity: '', settings: {}, behavior: '', jailbreak: '' })
    mockLoadWorkerTask.mockResolvedValue({ workerType: 'memory', taskPrompt: '' })
    mockCallAIWithLog.mockResolvedValue('```json\n' + JSON.stringify(emptyPayload) + '\n```')
  })

  it('prompt includes node quality constraint block', async () => {
    const prisma = buildPrisma()
    const app: any = { prisma, log: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }
    await extractAll(app, 'c1', 's1', 'content', 'outline', 1)
    const userMessage: string = mockCallAIWithLog.mock.calls[0][1].compiled.userMessage
    expect(userMessage).toContain('节点质量约束')
    expect(userMessage).toContain('路人甲乙丙')  // anti-example mentioned in spec
  })

  it('edge schema in prompt mentions importance field', async () => {
    const prisma = buildPrisma()
    const app: any = { prisma, log: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }
    await extractAll(app, 'c1', 's1', 'content', 'outline', 1)
    const userMessage: string = mockCallAIWithLog.mock.calls[0][1].compiled.userMessage
    expect(userMessage).toMatch(/edges.*importance.*1-10/)
  })
})
```

### Step 2: Run the test to confirm it fails

```bash
cd apps/server && pnpm vitest run src/__tests__/combined-extractor-prompt.test.ts
```

Expected: FAIL — the prompt currently has no "节点质量约束" block and the edge schema has no `importance`.

### Step 3: Update the prompt string

In `apps/server/src/services/combined-extractor.ts`, find the task 2 block in `extractPrompt` (line 124-130):

```
=== 任务2：实体与关系提取 ===
提取 importance >= 6 的核心实体和它们之间的关系：
- nodes: [{ type: "character"|"faction"|"event"|"item", key: "唯一标识（英文小写）", label: "显示名称", importance: 1-10, data: {...} }]
- edges: [{ fromKey, fromType, toKey, toType, relation }]
  relation 应该是一个简洁的核心词或短语（2-6字为佳），直接表达两实体间的核心联系，不要带状语、从句或补充说明
已有实体（不要重复提取，但可补充新属性）：${Array.from(existingKeys).join(', ') || '无'}
```

Replace with:

```
=== 任务2：实体与关系提取 ===
提取 importance >= 6 的核心实体和它们之间的关系：
- nodes: [{ type: "character"|"faction"|"event"|"item", key: "唯一标识（英文小写）", label: "显示名称", importance: 1-10, data: {...} }]
- edges: [{ fromKey, fromType, toKey, toType, relation, importance: 1-10 }]
  relation 应该是一个简洁的核心词或短语（2-6字为佳），直接表达两实体间的核心联系，不要带状语、从句或补充说明

=== 节点质量约束（重要）===
只提取能推动剧情发展的实体：
- 角色：仅当本章发生了状态变化（修为/位置/身份/阵营/关系）或剧情转折点
- 势力：仅当本章发生存亡/合并/对抗/结盟等变化
- 物品：仅当本章有归属变更、能力觉醒、用于关键事件
- 事件：仅当本章明确发生或被揭示
禁止提取：路人甲乙丙、纯环境描述、一次性对话提及、无后续影响的设定

已有实体（不要重复提取，但可补充新属性）：${Array.from(existingKeys).join(', ') || '无'}
```

### Step 4: Run the test to confirm it passes

```bash
cd apps/server && pnpm vitest run src/__tests__/combined-extractor-prompt.test.ts
```

Expected: PASS — both tests green.

Re-run the previous combined-extract tests:

```bash
cd apps/server && pnpm vitest run src/__tests__/combined-extractor-extractAll.test.ts src/__tests__/combined-extractor-prev-snapshot.test.ts
```

Expected: all green.

### Step 5: Commit

```bash
git add apps/server/src/services/combined-extractor.ts apps/server/src/__tests__/combined-extractor-prompt.test.ts
git commit -m "feat(combined-extract): add node quality constraints and edge importance to prompt"
```

---

## Task 4: `organizeGraph` 重构 (matchedKeys + expandNeighborhood + dynamic budget)

**Files:**
- Modify: `apps/server/src/services/graph-organizer.ts` (full rewrite of `organizeGraph` body)
- Create: `apps/server/src/__tests__/graph-organizer-neighborhood.test.ts`

**Why:** This is the core change. The function now:
1. Calls `expandNeighborhood` over `previousSnapshot` starting from `extractedGraph` node keys
2. Computes a dynamic token budget = `contextLength - maxTokens - compiled.meta.totalTokens - SAFETY_MARGIN`
3. Passes the (possibly truncated) neighborhood to AI, not the full snapshot
4. Falls back to a code-merge path when `matchedKeys` is empty

### Step 1: Write the failing test

Create `apps/server/src/__tests__/graph-organizer-neighborhood.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { GraphSnapshot } from '../services/graph-snapshot.js'

const mockCallAIWithLog = vi.fn()
const mockLoadRuntimeBase = vi.fn()
const mockLoadWorkerTask = vi.fn()
const mockResolveProvider = vi.fn()

vi.mock('../services/ai-call-logger.js', () => ({
  callAIWithLog: (...args: any[]) => mockCallAIWithLog(...args)
}))
vi.mock('../services/runtime-loader.js', () => ({
  loadRuntimeBase: (...args: any[]) => mockLoadRuntimeBase(...args),
  loadWorkerTask: (...args: any[]) => mockLoadWorkerTask(...args)
}))
// resolveProvider is imported transitively from ai-call-logger's dep, so mock the module
vi.mock('../services/ai-provider-init.js', () => ({
  resolveProvider: (...args: any[]) => mockResolveProvider(...args)
}))

import { organizeGraph } from '../services/graph-organizer.js'

const validResponse = {
  mergedGraph: {
    nodes: [{ type: 'character', key: 'a', label: 'A', data: {} }],
    edges: []
  },
  chapterGraph: {
    nodes: [{ type: 'character', key: 'a', label: 'A', data: {} }],
    edges: []
  }
}

function makePrev(): GraphSnapshot {
  return {
    nodes: [
      { type: 'character', key: 'a', label: 'A', data: {} },
      { type: 'character', key: 'b', label: 'B', data: {} },
      { type: 'character', key: 'c', label: 'C', data: {} }
    ],
    edges: [
      { fromType: 'character', fromKey: 'a', toType: 'character', toKey: 'b', relation: 'friend', weight: 1 }
    ],
    timestamp: ''
  }
}

function buildApp() {
  return { prisma: {}, log: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } } as any
}

function setupCommonMocks() {
  mockLoadRuntimeBase.mockResolvedValue({ identity: '', settings: {}, behavior: '', jailbreak: '' })
  mockLoadWorkerTask.mockResolvedValue({ workerType: 'graph', taskPrompt: '' })
  mockResolveProvider.mockResolvedValue({
    provider: { generateWithRuntime: vi.fn(), lastUsage: { promptTokens: 1000, completionTokens: 0, totalTokens: 1000 } },
    config: { id: 'cfg-1', name: 'deepseek', model: 'deepseek-chat', contextLength: 64000, maxTokens: 16384, temperature: 0.3 }
  })
}

describe('organizeGraph — key matching and prompt', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupCommonMocks()
    mockCallAIWithLog.mockResolvedValue('```json\n' + JSON.stringify(validResponse) + '\n```')
  })

  it('matchedKeys > 0: feeds neighborhood (not full snapshot) to AI', async () => {
    const prev = makePrev()
    const extracted = {
      nodes: [
        { type: 'character', key: 'a', label: 'A', importance: 8, data: {} }  // matches prev
      ],
      edges: []
    }
    const app = buildApp()
    await organizeGraph(app, 's1', 'c1', prev, extracted)

    expect(mockCallAIWithLog).toHaveBeenCalledTimes(1)
    const userMessage: string = mockCallAIWithLog.mock.calls[0][1].compiled.userMessage
    // Neighborhood should include 'a' and its 1-hop neighbor 'b'
    expect(userMessage).toContain('character:a')
    expect(userMessage).toContain('character:b')
    // The prompt header should reference the neighborhood concept
    expect(userMessage).toMatch(/邻域|neighborhood/i)
  })

  it('logs TODO warn when neighborhood was truncated by budget', async () => {
    // Force truncation: huge snapshot, tiny context, so budget cap kicks in
    const hugePrev: GraphSnapshot = {
      nodes: Array.from({ length: 200 }, (_, i) => ({
        type: 'character' as const, key: `n${i}`, label: `L${i}`, data: { blob: 'x'.repeat(200) }
      })),
      edges: [],
      timestamp: ''
    }
    mockResolveProvider.mockResolvedValue({
      provider: { generateWithRuntime: vi.fn(), lastUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } },
      config: { id: 'cfg-1', name: 'd', model: 'd', contextLength: 2000, maxTokens: 16384, temperature: 0.3 }
    })
    const extracted = {
      nodes: [{ type: 'character', key: 'n0', label: 'L0', importance: 8, data: {} }],
      edges: []
    }
    const app = buildApp()
    const log = app.log

    await organizeGraph(app, 's1', 'c1', hugePrev, extracted)

    expect(log.warn).toHaveBeenCalled()
    const warnMsg = (log.warn as any).mock.calls[0][0]
    expect(warnMsg).toMatch(/TODO/)
    expect(warnMsg).toMatch(/truncated|截断|token_budget|max_entities/)
  })
})

describe('organizeGraph — code-merge fallback when matchedKeys = 0', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupCommonMocks()
  })

  it('skips AI call entirely; mergedGraph = union of prev ∪ extracted (deduped)', async () => {
    const prev = makePrev()
    const extracted = {
      nodes: [
        // None of these match prev keys (a/b/c)
        { type: 'character', key: 'new1', label: 'New1', importance: 7, data: {} },
        { type: 'character', key: 'new2', label: 'New2', importance: 7, data: {} }
      ],
      edges: [
        { fromType: 'character', fromKey: 'new1', toType: 'character', toKey: 'new2', relation: 'ally', weight: 1 }
      ]
    }
    const app = buildApp()
    const result = await organizeGraph(app, 's1', 'c1', prev, extracted)

    // No AI call
    expect(mockCallAIWithLog).not.toHaveBeenCalled()

    // mergedGraph: prev (3 nodes) ∪ extracted (2 nodes) = 5
    expect(result.mergedGraph.nodes).toHaveLength(5)
    const keys = result.mergedGraph.nodes.map(n => `${n.type}:${n.key}`).sort()
    expect(keys).toEqual(['character:a', 'character:b', 'character:c', 'character:new1', 'character:new2'])

    // Edges: prev edge (a->b) + new edge (new1->new2) = 2
    expect(result.mergedGraph.edges).toHaveLength(2)

    // chapterGraph = extracted (透传)
    expect(result.chapterGraph.nodes).toHaveLength(2)
    expect(result.chapterGraph.edges).toHaveLength(1)
  })

  it('dedupes edges by (fromType:fromKey, relation, toType:toKey) when prev and extracted overlap', async () => {
    const prev: GraphSnapshot = {
      nodes: [{ type: 'character', key: 'a', label: 'A', data: {} }],
      edges: [
        { fromType: 'character', fromKey: 'a', toType: 'character', toKey: 'b', relation: 'friend', weight: 1 }
      ],
      timestamp: ''
    }
    // Extracted has NO matching node keys, so matchedKeys=0 -> code-merge path
    const extracted = {
      nodes: [{ type: 'character', key: 'b', label: 'B', importance: 7, data: {} }],
      edges: [
        // Same edge as prev but it would only matter if we went through the AI path;
        // code-merge by (fromType,fromKey,relation,toType) should dedupe
        { fromType: 'character', fromKey: 'a', toType: 'character', toKey: 'b', relation: 'friend', weight: 1 }
      ]
    }
    const app = buildApp()
    const result = await organizeGraph(app, 's1', 'c1', prev, extracted)

    expect(result.mergedGraph.edges).toHaveLength(1)
  })
})
```

### Step 2: Run the test to confirm it fails

```bash
cd apps/server && pnpm vitest run src/__tests__/graph-organizer-neighborhood.test.ts
```

Expected: FAIL — current `organizeGraph` always calls AI and feeds the full `previousSnapshot`.

### Step 3: Rewrite `organizeGraph`

Replace the entire `organizeGraph` function in `apps/server/src/services/graph-organizer.ts` with:

```typescript
import type { FastifyInstance } from 'fastify'
import { RuntimePromptCompiler } from '@novel-runtime/ai-provider'
import { cleanJsonBlock, estimateTokens } from '@novel-runtime/shared'
import { loadRuntimeBase, loadWorkerTask } from './runtime-loader.js'
import { callAIWithLog } from './ai-call-logger.js'
import { resolveProvider } from './ai-provider-init.js'
import type { GraphExtractionResult } from './graph-extractor.js'
import { expandNeighborhood, type GraphSnapshot } from './graph-snapshot.js'

const SAFETY_MARGIN_TOKENS = 2000
const NEIGHBORHOOD_BUDGET_HEADROOM = 0.9   // warn at 90% usage
const MAX_NEIGHBORHOOD_ENTITIES = 200
const NEIGHBORHOOD_MAX_DEPTH = 2

export async function organizeGraph(
  app: FastifyInstance,
  storyId: string,
  chapterId: string,
  previousSnapshot: GraphSnapshot | null,
  extractedGraph: GraphExtractionResult
): Promise<{ mergedGraph: GraphSnapshot; chapterGraph: GraphSnapshot }> {
  const prisma = app.prisma

  // Step 1: key matching — which N-1 nodes does this chapter re-use?
  const prevKeySet = new Set(
    (previousSnapshot?.nodes || []).map(n => `${n.type}:${n.key}`)
  )
  const newKeys = (extractedGraph.nodes || []).map(n => `${n.type}:${n.key}`)
  const matchedKeys = newKeys.filter(k => prevKeySet.has(k))

  // Step 2: code-merge fast path — no key overlap means no neighborhood to feed AI.
  // Skip the AI call entirely; the chapter's extracted graph IS the chapter delta.
  if (matchedKeys.length === 0) {
    return codeMerge(previousSnapshot, extractedGraph)
  }

  // Step 3: 2-hop BFS over N-1 starting from matched keys.
  const base = await loadRuntimeBase(storyId, prisma)
  const task = await loadWorkerTask(storyId, 'graph', prisma)

  // First compile pass with the FULL snapshot to learn how much of the prompt
  // budget is consumed by the non-graph parts (system + style + rules + ...).
  // We then use that number to compute the graph-side budget.
  const fullSnapshot = previousSnapshot || { nodes: [], edges: [], timestamp: '' }
  const firstCompiler = new RuntimePromptCompiler()
  const firstCompiled = firstCompiler.compile(base, task, buildOrganizePrompt(fullSnapshot, extractedGraph))
  const nonGraphTokens = firstCompiled.meta.totalTokens

  const resolved = await resolveProvider(prisma, storyId, chapterId)
  const contextLength = resolved?.config?.contextLength || 64000
  const outputReserve = resolved?.config?.maxTokens || 16384
  const graphBudget = Math.max(
    0,
    contextLength - nonGraphTokens - outputReserve - SAFETY_MARGIN_TOKENS
  )

  const neighborhood = expandNeighborhood(
    fullSnapshot,
    matchedKeys,
    {
      maxDepth: NEIGHBORHOOD_MAX_DEPTH,
      maxTokens: graphBudget,
      maxEntities: MAX_NEIGHBORHOOD_ENTITIES
    }
  )

  if (neighborhood.truncated) {
    const usageRatio = neighborhood.estimatedTokens / Math.max(1, graphBudget)
    if (usageRatio >= NEIGHBORHOOD_BUDGET_HEADROOM) {
      app.log.warn(
        `[TODO][GraphOrganizer] Neighborhood truncated (${neighborhood.truncateReason}), ` +
        `used ${neighborhood.estimatedTokens}/${graphBudget} tokens, ` +
        `${neighborhood.nodes.length} nodes. ` +
        `Consider increasing contextLength in ModelManager.`
      )
    }
  }

  // Second compile pass with the trimmed neighborhood as the "previous" graph.
  const trimmedSnapshot: GraphSnapshot = {
    nodes: neighborhood.nodes,
    edges: neighborhood.edges,
    timestamp: fullSnapshot.timestamp
  }
  const compiler = new RuntimePromptCompiler()
  const compiled = compiler.compile(base, task, buildOrganizePrompt(trimmedSnapshot, extractedGraph))

  // Step 4: AI call (unchanged from before)
  let raw: string | null
  try {
    raw = await callAIWithLog(app, {
      storyId, chapterId, callType: 'graph_organize',
      compiled, temperature: 0.2, maxTokens: 16384
    })
  } catch (err: any) {
    app.log.error(`[GraphOrganizer] AI call failed: ${err.message}`)
    throw err
  }
  if (!raw) {
    throw new Error('未配置可用的 AI Provider，请检查模型配置')
  }

  let result: any
  try {
    result = JSON.parse(cleanJsonBlock(raw))
  } catch (parseErr: any) {
    app.log.error(`[GraphOrganizer] JSON parse failed. Raw: ${raw.slice(0, 500)}`)
    throw new Error(`AI 返回格式错误，无法解析 JSON: ${parseErr.message}`)
  }

  const mergedGraph: GraphSnapshot = {
    nodes: result.mergedGraph?.nodes || [],
    edges: result.mergedGraph?.edges || [],
    timestamp: new Date().toISOString()
  }
  const chapterGraph: GraphSnapshot = {
    nodes: result.chapterGraph?.nodes || [],
    edges: result.chapterGraph?.edges || [],
    timestamp: new Date().toISOString()
  }

  app.log.info(
    `[GraphOrganizer] Neigh: ${neighborhood.nodes.length} nodes / ` +
    `${neighborhood.estimatedTokens} tok (cap ${graphBudget}). ` +
    `Merged: ${mergedGraph.nodes.length} nodes, ${mergedGraph.edges.length} edges. ` +
    `Chapter: ${chapterGraph.nodes.length} nodes, ${chapterGraph.edges.length} edges.`
  )

  return { mergedGraph, chapterGraph }
}

function buildOrganizePrompt(prev: GraphSnapshot, extracted: GraphExtractionResult): string {
  return `你是小说知识图谱整理助手。

【任务】
1. 将"上一章的邻域子图"与"本章新提取的节点/边"合并为一个新的全局图谱。
2. 基于"本章新提取的节点/边"，独立生成本章的范围图谱（本章纯净视图，不被全局历史污染）。

【上一章邻域子图（与本章新节点相关的 2 层邻居）】
${JSON.stringify(prev)}

【本章新提取】
${JSON.stringify(extracted)}

【全局合并规则（仅用于 mergedGraph）】
1. 节点去重：相同 type:key 的节点合并 data，label 以最新描述为准
2. 旧节点保留，不要删除

【关系合并与优化规则（核心）】
1. 同一对节点间，如果 relation 语义相同或相近（如"被收留"和"被收留并信任"），合并为一条，使用最能概括全貌的表述
2. 同一剧情线的连续经历（如"收留→教她学习→给她办理户口"），合并为一条概括性 relation，不怕长但要包含完整核心信息。例如合并为"收留并教她学习，给她办理户口"
3. 根本性不同的独立事件（如"教她武功"和"给她办理户口"），保留为多条边
4. 同一章内或时间上接近的事件，优先合并或优化
5. 语义不同但属同一对节点的不同情况（如"道侣，信任和恩爱" + "假装背叛"），保留为多条边
6. relation 可以是较长的概括性短语，但必须包含该关系的核心信息，不要遗漏关键内容

【边去重规则】
- 合并优化后，相同 (fromType:fromKey, relation, toType:toKey) 的边只保留一条
- 同一对节点间的不同 relation（如"师徒"和"兄弟"）保留为多条边

【type 约束】
所有 type 字段必须是以下四种之一："character"、"faction"、"event"、"item"。

【本章范围图谱规则（用于 chapterGraph）】
1. 只基于"本章新提取"的节点和边，不要从邻域子图中引入本章未提及的节点/边
2. 只对本章新提取做格式化和去重，不合并邻域 data
3. 节点 data 和边 relation 必须严格反映本章明确提及的内容
4. 如果本章新提取的关系是"投靠"，就保持"投靠"，不要替换成邻域中更复杂的历史关系
5. chapterGraph 是本章的纯净视图，不得夹带邻域历史前提

【type 约束（非常重要）】
所有 type 字段必须是以下四种标准值之一，不得使用其他值：
- "character"（角色/人物）
- "faction"（势力/组织/门派）
- "event"（事件）
- "item"（物品/道具/武器/装备/法宝）
如果 AI 想返回 "weapon"、"prop"、"object" 等其他值，一律收敛为 "item"。

【输出格式】
返回严格 JSON，不要 markdown：
{
  "mergedGraph": {
    "nodes": [{ "type": "character", "key": "zhangsan", "label": "张三", "data": {} }],
    "edges": [{ "fromType": "character", "fromKey": "zhangsan", "toType": "character", "toKey": "lisi", "relation": "兄弟", "weight": 1 }]
  },
  "chapterGraph": {
    "nodes": [...],
    "edges": [...]
  }
}

mergedGraph 是合并后的新全局图谱（包含邻域子图 + 本章新增/更新）。
chapterGraph 是本章的范围图谱（基于本章新提取独立生成，只反映本章内容，不夹带邻域历史）。`
}

function codeMerge(
  previousSnapshot: GraphSnapshot | null,
  extracted: GraphExtractionResult
): { mergedGraph: GraphSnapshot; chapterGraph: GraphSnapshot } {
  const prevNodes = previousSnapshot?.nodes || []
  const prevEdges = previousSnapshot?.edges || []
  const newNodes = extracted.nodes || []
  const newEdges = extracted.edges || []

  // Node union, dedupe by type:key (extracted overrides on collision)
  const nodeMap = new Map<string, any>()
  for (const n of prevNodes) nodeMap.set(`${n.type}:${n.key}`, n)
  for (const n of newNodes) nodeMap.set(`${n.type}:${n.key}`, n)

  // Edge union, dedupe by (fromType, fromKey, relation, toType, toKey)
  const seen = new Set<string>()
  const mergedEdges: any[] = []
  for (const e of [...prevEdges, ...newEdges]) {
    const k = `${e.fromType}:${e.fromKey}|${e.relation}|${e.toType}:${e.toKey}`
    if (seen.has(k)) continue
    seen.add(k)
    mergedEdges.push(e)
  }

  const now = new Date().toISOString()
  return {
    mergedGraph: {
      nodes: Array.from(nodeMap.values()),
      edges: mergedEdges,
      timestamp: now
    },
    chapterGraph: {
      nodes: newNodes,
      edges: newEdges,
      timestamp: now
    }
  }
}
```

Also add a top-level `export` for `cleanJsonBlock` re-import is no longer needed because the function body is rewritten — remove the import of `cleanJsonBlock` only if it's no longer used. Verify before deleting: the new code still calls `cleanJsonBlock(raw)` once in the AI path, so keep the import. Also add an import for `expandNeighborhood` and `GraphSnapshot` from `./graph-snapshot.js`. The new import list at the top of the file becomes:

```typescript
import type { FastifyInstance } from 'fastify'
import { RuntimePromptCompiler } from '@novel-runtime/ai-provider'
import { cleanJsonBlock } from '@novel-runtime/shared'
import { loadRuntimeBase, loadWorkerTask } from './runtime-loader.js'
import { callAIWithLog } from './ai-call-logger.js'
import { resolveProvider } from './ai-provider-init.js'
import type { GraphExtractionResult } from './graph-extractor.js'
import { expandNeighborhood, type GraphSnapshot } from './graph-snapshot.js'
```

Note: the `estimateTokens` import that was in the sketch above is **not** actually used by the final code — drop it from the import.

### Step 4: Run the test to confirm it passes

```bash
cd apps/server && pnpm vitest run src/__tests__/graph-organizer-neighborhood.test.ts
```

Expected: PASS — all 4 tests green.

### Step 5: Commit

```bash
git add apps/server/src/services/graph-organizer.ts apps/server/src/__tests__/graph-organizer-neighborhood.test.ts
git commit -m "refactor(graph-organizer): 2-hop neighborhood + dynamic budget, code-merge fallback"
```

---

## Task 5: 端到端验证 + typecheck

**Files:** none (verification only)

### Step 1: Run the full server test suite

```bash
cd apps/server && pnpm vitest run
```

Expected: all tests pass — including pre-existing tests for `cleanJsonBlock`, `combined-extractor-extractAll`, and any others.

### Step 2: Type-check the monorepo

```bash
pnpm typecheck
```

Expected: 0 errors.

### Step 3: Lint

```bash
pnpm lint
```

Expected: 0 errors (warnings OK if they were pre-existing).

### Step 4: Manual smoke (optional but recommended)

If the dev DB has archived chapters:

```bash
pnpm --filter server dev
# in another terminal, trigger an archive on a non-trivial chapter via the API or UI
# then check the new PromptLog rows for callType='graph_organize' — the userMessage
# should contain the 2-hop neighborhood JSON, not the full N-1 graph.
```

Skip this step if no archived chapters exist; the unit + integration tests are the source of truth.

### Step 5: Commit (verification-only — usually no commit)

If `pnpm typecheck` or `pnpm lint` surfaced a fix that wasn't covered above, commit it as a `chore` commit. Otherwise, no commit.

```bash
git status
# If clean: nothing to do.
# If dirty:
git add <fixed-files>
git commit -m "chore: typecheck/lint fixes for graph neighborhood retrieval"
```

---

## Self-Review Checklist

- [x] **Spec coverage**:
  - §4.1 N-1 inventory injection → Task 2
  - §4.2 node quality constraints → Task 3
  - §4.3 edge importance → Task 3
  - §4.4 expandNeighborhood → Task 1
  - §4.5 organizeGraph main flow → Task 4
  - §4.6 codeMerge path → Task 4 (matchedKeys=0)
  - §6.1 unit tests → Task 1
  - §6.2 integration tests → Task 4
  - §6.3 prompt-text tests → Tasks 2 & 3
- [x] **No placeholders**: every code step has the actual code; no "TBD" or "类似 Task N".
- [x] **Type consistency**: `expandNeighborhood` returns `NeighborhoodResult` in both producer (Task 1) and consumer (Task 4). `GraphSnapshot` is imported from `graph-snapshot.js` in both files. `GraphExtractionResult` is imported from `graph-extractor.js` (not modified). `resolveProvider` signature `(prisma, storyId, chapterId)` matches existing callsites.
- [x] **No backward-compat shims**: `organizeGraph` is rewritten in place; old call sites in `combined-extractor.ts` and `chapters.ts` still pass `(app, storyId, chapterId, previousSnapshot, extractedGraph)` and get the same return shape `{ mergedGraph, chapterGraph }`.
- [x] **TDD throughout**: each task writes the failing test FIRST, then implements, then re-runs.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-17-graph-neighborhood-retrieval.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
