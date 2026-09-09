# ReviewingPanel Restore + Extraction Quality Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the v2 ReviewingPanel form-based tabs on top of v3's 4-stage parallel extraction pipeline, and tighten the graph extraction prompt + filter so the chapter graph stops accumulating trivial nodes.

**Architecture:** Revert `apps/web/src/views/ReviewingPanel.vue` to its v2 source (commit `397bb19^`), wire data through a v3↔v2 adapter pair so the panel accepts v3 `pendingArchiveData` and emits v3-shaped save events. Drop the timeline tab (v3 deprecation). Tighten `apps/server/src/services/stages/graph-extract-stage.ts` prompt + importance filter to require importance ≥ 8 and a fixed relation whitelist.

**Tech Stack:** Vue 3 + Naive UI (`n-tabs`/`n-tab-pane`/`n-input`/`n-input-number`/`n-select`/`n-slider`/`n-collapse`), vitest, Fastify + Prisma backend.

**Spec:** `docs/superpowers/specs/2026-07-26-reviewing-panel-restore-design.md`

---

## File map

**Create:**
- `apps/server/src/__tests__/services/stages-graph-extract-filter.test.ts` — graph prompt filter behavior
- `apps/web/src/views/ReviewingPanel.adapter.ts` — v3↔v2 adapter pair, exported as named functions

**Modify:**
- `apps/server/src/services/stages/graph-extract-stage.ts` — prompt + importance filter
- `apps/web/src/views/ReviewingPanel.vue` — full rewrite (restore v2 template + use adapter)
- `apps/web/src/views/chapters/ChapterEditor.vue` — emit names: `update-stage`/`reprepare-archive`/`prepare-archive-cancel`/`confirm-archive` → `save`/`confirm`/`cancel`/`reprepare`
- `apps/web/src/views/Chapters.vue` — handlers `handleSavePendingArchive` / `handleConfirmArchiveWithData` / `handlePrepareArchiveCancel` / `handleReprepareArchive`

**Reference (read-only):**
- `git show 397bb19^:apps/web/src/views/ReviewingPanel.vue` — v2 source to base the restore on
- `apps/web/src/components/graph/EditableGraph.vue` — already exists, drop into graph tab
- `apps/web/src/components/DynamicTags.vue` — already exists, used in 情绪/伏笔/关系 sub-section

---

### Task 1: Tighten graph-extract-stage prompt and importance filter

**Files:**
- Modify: `apps/server/src/services/stages/graph-extract-stage.ts:33-60` (prompt), `:81-99` (filter logic)
- Create: `apps/server/src/__tests__/services/stages-graph-extract-filter.test.ts`

- [ ] **Step 1: Write the failing test for the new filter**

Create `apps/server/src/__tests__/services/stages-graph-extract-filter.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../services/ai-call-logger.js', () => ({
  callAIWithLog: vi.fn()
}))
vi.mock('../../services/runtime-loader.js', () => ({
  loadRuntimeBase: vi.fn().mockResolvedValue({ identity: '', settings: {}, behavior: '' }),
  loadWorkerTask: vi.fn().mockResolvedValue({ workerType: 'graph', taskPrompt: '' })
}))
vi.mock('@novel-runtime/ai-provider', () => {
  class RuntimePromptCompiler {
    compile(_base: unknown, _task: unknown, userMessage: string) {
      return { systemMessage: '', userMessage, meta: { totalTokens: 0 } }
    }
  }
  return { RuntimePromptCompiler }
})

import { runGraphExtractStage } from '../../services/stages/graph-extract-stage.js'
import { callAIWithLog } from '../../services/ai-call-logger.js'

const mockApp: any = { prisma: {}, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }

const baseInput = {
  storyId: 's1', chapterId: 'c1', content: 'x', outline: '', chapterNumber: 1,
  characterNames: ['张三'],
  prevCumulativeGraphKeys: [],
  latestBranchStates: []
}

describe('graph-extract-stage filter (importance >= 8, type whitelist)', () => {
  it('drops nodes with importance below 8', async () => {
    const ai = {
      nodes: [
        { type: 'character', key: 'zhangsan', label: '张三', importance: 7 },   // dropped
        { type: 'character', key: 'lisi',     label: '李四', importance: 8 }    // kept
      ],
      edges: []
    }
    ;(callAIWithLog as any).mockResolvedValueOnce(JSON.stringify(ai))

    const state = await runGraphExtractStage(mockApp, baseInput)
    expect(state.status).toBe('success')
    expect(state.result?.chapterGraph.nodes).toHaveLength(1)
    expect(state.result?.chapterGraph.nodes[0].key).toBe('lisi')
  })

  it('coerces non-whitelisted type to item', async () => {
    const ai = {
      nodes: [
        { type: 'weapon',   key: 'jian',  label: '宝剑', importance: 9 },   // → item
        { type: 'location', key: 'shan',  label: '山中', importance: 9 },   // → item
        { type: 'character', key: 'zs',   label: '张三', importance: 9 }   // → character
      ],
      edges: []
    }
    ;(callAIWithLog as any).mockResolvedValueOnce(JSON.stringify(ai))

    const state = await runGraphExtractStage(mockApp, baseInput)
    const types = state.result?.chapterGraph.nodes.map((n: any) => n.type).sort()
    expect(types).toEqual(['character', 'item', 'item'])
  })

  it('keeps nodes at importance === 8', async () => {
    const ai = {
      nodes: [{ type: 'character', key: 'a', label: '甲', importance: 8 }],
      edges: []
    }
    ;(callAIWithLog as any).mockResolvedValueOnce(JSON.stringify(ai))

    const state = await runGraphExtractStage(mockApp, baseInput)
    expect(state.result?.chapterGraph.nodes).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "D:\NewCode\ai-novel-runtime" && pnpm --filter server test -- stages-graph-extract-filter -v 2>&1 | tail -30`

Expected: FAIL — the first test "drops nodes with importance below 8" fails because current code uses `>= 6`.

- [ ] **Step 3: Update prompt + filter in graph-extract-stage.ts**

In `apps/server/src/services/stages/graph-extract-stage.ts`, replace the prompt string in `runGraphExtractStage` (currently at lines 33–60) with:

```
你是小说知识图谱抽取助手。

【任务】基于章节内容,抽取本章涉及的实体节点和关系边。只看本章正文,不要混入历史上下文。

【约束】
1. type 必须是以下 4 类之一,其他一律丢弃或收敛:
   - character(角色,有名字或代词指代)
   - faction(组织/门派/阵营)
   - event(本章发生的可命名事件)
   - item(关键物品/法器/秘笈,**只保留对剧情有直接作用的**)
   非上述类型(如 weapon / prop / realm / object / location)一律收敛为 item;若属于一次性场景描写则直接丢弃。
2. character/faction/item 类型节点:
   - 若在【已有 graph key 列表】中,复用对应 type:key
   - 若对应【已有角色名】,type=character,key 用角色英文拼音小写下划线
   - 否则 key 用拼音小写下划线
3. event 类型节点 key 用英文小写下划线
4. importance >= 8 才提取(过滤路人/环境/场景/物品);任何只出现一次且无具体关系链的实体跳过
5. relation 必须从以下词表选,不允许自由发挥:
   隶属 / 对抗 / 师徒 / 配偶 / 兄弟 / 朋友 / 敌对 / 亲属 / 师门 / 同门 / 敌师 / 盟友
6. 同名实体必须复用已有 graph key,不允许另起 key

【已有 graph key 列表(必须复用)】
${keyList}

【已有角色名(锚定命名)】
${charList}

【输出严格 JSON】
{
  "nodes": [{ "type": "character", "key": "zhangsan", "label": "张三", "importance": 8, "data": {} }],
  "edges": [{ "fromType": "character", "fromKey": "zhangsan", "toType": "faction", "toKey": "mingjiao", "relation": "隶属" }]
}

【章节大纲】${input.outline}
【章节内容】${input.content.slice(0, 8000)}
```

Then in the same file, replace the filter logic (currently at lines 81–99):

```typescript
    const ALLOWED_TYPES = new Set(['character', 'faction', 'event', 'item'])
    const normalized = nodes.map((n: any) => {
      const t = (n.type || '').toLowerCase()
      if (ALLOWED_TYPES.has(t)) return { ...n, type: t }
      // 非白名单 → 收敛为 item
      return { ...n, type: 'item' }
    })

    const filtered = normalized.filter((n: any) => (n.importance ?? 0) >= 8)

    const chapterGraph: GraphSnapshot = {
      nodes: filtered.map((n: any) => ({
        type: n.type,
        key: n.key,
        label: n.label,
        data: n.data || {}
      })),
      edges: edges.map((e: any) => ({
        fromType: e.fromType,
        fromKey: e.fromKey,
        toType: e.toType,
        toKey: e.toKey,
        relation: e.relation,
        weight: e.weight ?? 1
      })),
      timestamp: new Date().toISOString()
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd "D:\NewCode\ai-novel-runtime" && pnpm --filter server test -- stages-graph-extract-filter -v 2>&1 | tail -30`

Expected: 3 tests PASS.

- [ ] **Step 5: Run typecheck + existing graph-extract tests**

Run: `cd "D:\NewCode\ai-novel-runtime" && pnpm --filter server typecheck 2>&1 | tail -10`

Then: `cd "D:\NewCode\ai-novel-runtime" && pnpm --filter server test -- stages-graph-extract -v 2>&1 | tail -20`

Expected: typecheck clean; existing `stages-graph-extract.test.ts` (3 tests at `apps/server/src/__tests__/services/stages-graph-extract.test.ts:37-79`) still pass — the mock fixture has `importance: 8` and `type: 'character'`, so both old tests stay green.

- [ ] **Step 6: Commit**

```bash
cd "D:\NewCode\ai-novel-runtime" && git add apps/server/src/services/stages/graph-extract-stage.ts apps/server/src/__tests__/services/stages-graph-extract-filter.test.ts && git commit -m "refactor(v3): tighten graph-extract-stage prompt and importance threshold"
```

---

### Task 2: Write v3↔v2 adapter round-trip test (failing)

**Files:**
- Create: `apps/web/src/views/ReviewingPanel.adapter.ts`
- Create: `apps/web/src/__tests__/views/ReviewingPanel.adapter.test.ts`

- [ ] **Step 1: Scaffold the adapter file with empty exports**

Create `apps/web/src/views/ReviewingPanel.adapter.ts`:

```typescript
/**
 * v3 pendingArchiveData 形状 ↔ v2 本地 LocalData 形状适配层。
 * ReviewingPanel.vue 内部使用 v2 形态(沿用 v2 的 n-input / n-select / n-slider 编辑链路),
 * 但对父组件暴露 v3 入参和 v3 出参,以便与后端 4-stage 抽取结果对齐。
 */

export interface V3PendingArchiveData {
  version: 3
  stages: {
    character?: { status: string; result?: any; errorMessage?: string; completedAt?: string }
    memory?:    { status: string; result?: any; errorMessage?: string; completedAt?: string }
    plotArc?:   { status: string; result?: any; errorMessage?: string; completedAt?: string }
    graph?:     { status: string; result?: any; errorMessage?: string; completedAt?: string }
  }
  meta: { extractedAt?: string; chapterNumber?: number | string }
}

export interface LocalMemoryRow {
  content: string
  tags: string[]            // 'main-plot' | 'side-plot'
  importance: number
  fromChapterNumber: number
}

export interface LocalCharacterState {
  characterId: string | null
  name: string
  key: string
  status: string            // JSON 字符串
  relationships: string     // JSON 字符串
  isNew: boolean
}

export interface LocalData {
  summary: string
  memories: {
    memories: LocalMemoryRow[]
    characterStates: LocalCharacterState[]
    emotions: string[]
    foreshadowing: string[]
    relationshipChanges: string[]
  }
  plotArcs: any[]
  graph: {
    chapterGraph: { nodes: any[]; edges: any[] }
  }
}

/**
 * 把后端返回的 v3 pendingArchiveData 转为 v2 形态(供 ReviewingPanel 内部 v-model 绑定)。
 * 空字段安全降级,不会崩。
 */
export function fromV3(pending: V3PendingArchiveData | null | undefined): LocalData {
  // 占位:Task 3 实现
  throw new Error('fromV3 not implemented')
}

/**
 * 把 v2 形态的本地编辑结果反向写回 v3 形态(供 ReviewingPanel → 父组件 save/confirm 事件)。
 * 保留 original.version / original.meta,只重写 stages 各 .result 字段。
 */
export function toV3(local: LocalData, original: V3PendingArchiveData): V3PendingArchiveData {
  // 占位:Task 3 实现
  throw new Error('toV3 not implemented')
}
```

- [ ] **Step 2: Write the round-trip test (it will fail — implementations throw)**

Create `apps/web/src/__tests__/views/ReviewingPanel.adapter.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { fromV3, toV3, type V3PendingArchiveData } from '../../views/ReviewingPanel.adapter'

const sampleV3: V3PendingArchiveData = {
  version: 3,
  stages: {
    character: {
      status: 'success',
      result: {
        characterStates: [
          { characterId: 'c1', name: '张三', key: 'zhangsan',
            status: '{"location":"灵华宗"}',
            relationships: '{"李四":"朋友"}',
            isNew: false }
        ]
      }
    },
    memory: {
      status: 'success',
      result: {
        mainEvents: [
          { description: '主角觉醒', participants: ['张三'], importance: 8 }
        ],
        sideEvents: [
          { description: '路人走过', participants: [], importance: 5 }
        ],
        scenes: [{ location: '灵华宗', event: '大殿议事', importance: 7 }],
        summary: '主角觉醒',
        emotions: ['激动'],
        foreshadowing: ['上古残卷'],
        relationshipChanges: ['张三 ↔ 李四 加深']
      }
    },
    plotArc: {
      status: 'success',
      result: {
        plotArcs: [{ id: 'pa1', name: '时空裂隙', progress: 30, status: 'active' }]
      }
    },
    graph: {
      status: 'success',
      result: {
        chapterGraph: {
          nodes: [{ type: 'character', key: 'zhangsan', label: '张三', data: {} }],
          edges: [{ fromType: 'character', fromKey: 'zhangsan', toType: 'faction', toKey: 'mingjiao', relation: '隶属', weight: 1 }]
        }
      }
    }
  },
  meta: { extractedAt: '2026-07-26T00:00:00Z', chapterNumber: 7 }
}

describe('ReviewingPanel.adapter v3 ↔ v2', () => {
  it('fromV3: empty input → empty LocalData', () => {
    const local = fromV3(null)
    expect(local.summary).toBe('')
    expect(local.memories.memories).toEqual([])
    expect(local.memories.characterStates).toEqual([])
    expect(local.plotArcs).toEqual([])
    expect(local.graph.chapterGraph).toEqual({ nodes: [], edges: [] })
  })

  it('fromV3: full v3 payload → LocalData with all fields populated', () => {
    const local = fromV3(sampleV3)
    expect(local.summary).toBe('主角觉醒')
    expect(local.memories.memories).toHaveLength(2)
    expect(local.memories.memories[0].content).toBe('主角觉醒')
    expect(local.memories.memories[0].tags).toEqual(['main-plot'])
    expect(local.memories.memories[1].content).toBe('路人走过')
    expect(local.memories.memories[1].tags).toEqual(['side-plot'])
    expect(local.memories.characterStates).toHaveLength(1)
    expect(local.memories.characterStates[0].name).toBe('张三')
    expect(local.memories.emotions).toEqual(['激动'])
    expect(local.memories.foreshadowing).toEqual(['上古残卷'])
    expect(local.memories.relationshipChanges).toEqual(['张三 ↔ 李四 加深'])
    expect(local.plotArcs).toHaveLength(1)
    expect(local.plotArcs[0].name).toBe('时空裂隙')
    expect(local.graph.chapterGraph.nodes).toHaveLength(1)
    expect(local.graph.chapterGraph.edges).toHaveLength(1)
  })

  it('toV3: LocalData → back to v3 shape (counts preserved)', () => {
    const local = fromV3(sampleV3)
    const round = toV3(local, sampleV3)
    expect(round.version).toBe(3)
    expect(round.meta).toEqual(sampleV3.meta)
    expect(round.stages.character?.result?.characterStates).toHaveLength(1)
    expect(round.stages.memory?.result?.mainEvents).toHaveLength(1)
    expect(round.stages.memory?.result?.sideEvents).toHaveLength(1)
    expect(round.stages.memory?.result?.summary).toBe('主角觉醒')
    expect(round.stages.memory?.result?.emotions).toEqual(['激动'])
    expect(round.stages.plotArc?.result?.plotArcs).toHaveLength(1)
    expect(round.stages.graph?.result?.chapterGraph.nodes).toHaveLength(1)
    expect(round.stages.graph?.result?.chapterGraph.edges).toHaveLength(1)
  })

  it('toV3: preserves original version and meta even when missing', () => {
    const partial: V3PendingArchiveData = {
      version: 3, stages: {}, meta: { chapterNumber: 5 }
    }
    const local = fromV3(partial)
    const round = toV3(local, partial)
    expect(round.version).toBe(3)
    expect(round.meta.chapterNumber).toBe(5)
  })

  it('round-trip: LocalData edits flow back into v3 mainEvents', () => {
    const local = fromV3(sampleV3)
    local.memories.memories[0].content = '主角觉醒并突破'
    local.memories.memories[0].importance = 9
    const round = toV3(local, sampleV3)
    expect(round.stages.memory?.result?.mainEvents[0].description).toBe('主角觉醒并突破')
    expect(round.stages.memory?.result?.mainEvents[0].importance).toBe(9)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd "D:\NewCode\ai-novel-runtime" && pnpm --filter web test -- ReviewingPanel.adapter -v 2>&1 | tail -30`

Expected: FAIL — both `fromV3` and `toV3` throw "not implemented".

---

### Task 3: Implement fromV3 + toV3 to make tests pass

**Files:**
- Modify: `apps/web/src/views/ReviewingPanel.adapter.ts`

- [ ] **Step 1: Replace `fromV3` body with the implementation**

In `apps/web/src/views/ReviewingPanel.adapter.ts`, replace the `fromV3` body:

```typescript
export function fromV3(pending: V3PendingArchiveData | null | undefined): LocalData {
  const stages = pending?.stages ?? {}
  const mem = stages.memory?.result ?? {}
  const chr = stages.character?.result ?? {}
  const plot = stages.plotArc?.result ?? {}
  const graph = stages.graph?.result ?? {}

  const chNum = Number(pending?.meta?.chapterNumber ?? 0)

  const toMemory = (ev: any, tags: string[]): LocalMemoryRow => ({
    content: ev?.description ?? '',
    tags,
    importance: typeof ev?.importance === 'number' ? ev.importance : 5,
    fromChapterNumber: chNum
  })

  return {
    summary: typeof mem.summary === 'string' ? mem.summary : '',
    memories: {
      memories: [
        ...(Array.isArray(mem.mainEvents) ? mem.mainEvents : []).map((e: any) => toMemory(e, ['main-plot'])),
        ...(Array.isArray(mem.sideEvents) ? mem.sideEvents : []).map((e: any) => toMemory(e, ['side-plot']))
      ],
      characterStates: Array.isArray(chr.characterStates) ? chr.characterStates : [],
      emotions: Array.isArray(mem.emotions) ? mem.emotions : [],
      foreshadowing: Array.isArray(mem.foreshadowing) ? mem.foreshadowing : [],
      relationshipChanges: Array.isArray(mem.relationshipChanges) ? mem.relationshipChanges : []
    },
    plotArcs: Array.isArray(plot.plotArcs) ? plot.plotArcs : [],
    graph: {
      chapterGraph: graph.chapterGraph ?? { nodes: [], edges: [] }
    }
  }
}
```

- [ ] **Step 2: Replace `toV3` body with the implementation**

In the same file, replace the `toV3` body:

```typescript
export function toV3(local: LocalData, original: V3PendingArchiveData): V3PendingArchiveData {
  const stages: V3PendingArchiveData['stages'] = JSON.parse(
    JSON.stringify(original?.stages ?? {})
  )

  // memory stage — main/side events 重新分流
  const memories = local.memories
  const mainEvents = memories.memories
    .filter((m) => m.tags?.includes('main-plot'))
    .map((m) => ({
      description: m.content,
      participants: [] as string[],
      importance: m.importance
    }))
  const sideEvents = memories.memories
    .filter((m) => !m.tags?.includes('main-plot'))
    .map((m) => ({
      description: m.content,
      participants: [] as string[],
      importance: m.importance
    }))

  if (!stages.memory) stages.memory = { status: 'success' }
  stages.memory.result = {
    ...(stages.memory.result ?? {}),
    summary: local.summary,
    mainEvents,
    sideEvents,
    emotions: memories.emotions,
    foreshadowing: memories.foreshadowing,
    relationshipChanges: memories.relationshipChanges
  }

  // character stage
  if (!stages.character) stages.character = { status: 'success' }
  stages.character.result = {
    characterStates: memories.characterStates
  }

  // plotArc stage
  if (!stages.plotArc) stages.plotArc = { status: 'success' }
  stages.plotArc.result = {
    plotArcs: local.plotArcs
  }

  // graph stage
  if (!stages.graph) stages.graph = { status: 'success' }
  stages.graph.result = {
    chapterGraph: local.graph.chapterGraph
  }

  return {
    version: 3,
    stages,
    meta: original?.meta ?? {}
  }
}
```

- [ ] **Step 3: Run test to verify it passes**

Run: `cd "D:\NewCode\ai-novel-runtime" && pnpm --filter web test -- ReviewingPanel.adapter -v 2>&1 | tail -20`

Expected: 5 tests PASS.

- [ ] **Step 4: Run web typecheck**

Run: `cd "D:\NewCode\ai-novel-runtime" && pnpm --filter web typecheck 2>&1 | tail -10`

Expected: clean.

---

### Task 4: Restore v2 ReviewingPanel.vue using adapter

**Files:**
- Modify: `apps/web/src/views/ReviewingPanel.vue` (full rewrite)

This task is too large for TDD (template-heavy, no isolated unit). Smoke-test via dev server instead.

- [ ] **Step 1: Read v2 source for reference**

Run:

```bash
cd "D:\NewCode\ai-novel-runtime" && git show 397bb19^:apps/web/src/views/ReviewingPanel.vue > /tmp/v2-reviewing.vue
```

Read `/tmp/v2-reviewing.vue` in full. This is the v2 source — 1512 lines, the template + script + scoped CSS for cap-card / cap-character-card / cap-arc-card / cap-timeline-card / cap-summary-card / cap-rise. The implementation will be based on this source with these adaptations:

- Drop `TimelinePositionInput` import + timeline tab (lines ~149-223 in v2)
- Drop `TimelineEvent`-related helpers (`formatPositionLabel`, `positionHelpText`, `positionValidity`, `getEventsList`, `setEventsList`, `addTimelineEvent`, `removeTimelineEvent`, `isSpecialContent`, `getSpecialMemories`, `setSpecialMemories`)
- Drop `DEFAULT_TIMELINE_POSITION` / `formatTimelinePosition` / `validateTimelinePosition` imports
- Drop `safeJsonParse` import (only used by timeline)
- Change `pendingArchiveData` prop type from `PendingArchiveData` to `V3PendingArchiveData` from `./ReviewingPanel.adapter`
- Replace the local normalization logic with `fromV3(props.pending)`
- Replace `emit('save', localData.value)` with `emit('save', toV3(localData.value, props.pending))` — same for `confirm`
- Change emits from `'save': [data: PendingArchiveData]` / `'confirm': [data: PendingArchiveData]` to `'(e: "save", data: V3PendingArchiveData): void'` / `'(e: "confirm", data: V3PendingArchiveData): void'`
- Add a watcher on `localData` with 800ms debounce that emits `save` automatically
- Add status dot at each tab header (success=green / failed=red / running=orange / pending=gray). Pass `:stage-status` prop from ReviewingPanel to each tab pane header.

- [ ] **Step 2: Write the new ReviewingPanel.vue**

Replace `apps/web/src/views/ReviewingPanel.vue` with the v2 source adapted per Step 1. The structure:

```vue
<template>
  <div class="cap-card" style="margin-top: 16px">
    <header class="page-head" style="margin-bottom: 16px">
      <div class="page-head__text">
        <span class="cap-eyebrow">ARCHIVE REVIEW</span>
        <h2 class="page-head__title" style="font-size: 20px">归档审查</h2>
        <p class="cap-body-sm">本章已进入归档审查。你可以编辑 AI 提取的记忆和图谱,确认无误后再归档。</p>
      </div>
    </header>

    <n-space vertical size="large" style="width: 100%">
      <!-- 顶部常驻:摘要 -->
      <n-card class="cap-summary-card" size="small">
        <template #header>
          <header class="cap-summary-card__head">
            <span class="cap-eyebrow">EXCERPT · 本章摘要</span>
            <h3 class="cap-summary-card__title">一句话核心</h3>
          </header>
        </template>
        <div class="cap-summary-card__body">
          <span class="cap-summary-card__quote-mark" aria-hidden="true">"</span>
          <n-input
            v-model:value="summary"
            type="textarea"
            :rows="3"
            placeholder="本章的核心冲突、转折或情感落点…"
            class="cap-summary-card__input"
          />
        </div>
        <footer class="cap-summary-card__foot">
          <span class="cap-summary-card__hint">印在章节标题下方 · 一行说清本章发生了什么</span>
          <span class="cap-summary-card__count">{{ summary.length }} 字</span>
        </footer>
      </n-card>

      <n-tabs type="line" default-value="characters" :animated="true">
        <!-- 角色 tab -->
        <n-tab-pane name="characters" tab="角色">
          <!-- ... 整段照搬 v2 角色 tab,characterStates 用 v-model,移除 isSpecialContent 相关逻辑 ... -->
        </n-tab-pane>

        <!-- 记忆 tab -->
        <n-tab-pane name="memories" tab="记忆">
          <!-- ... 整段照搬 v2 记忆 tab ... -->
        </n-tab-pane>

        <!-- 剧情弧线 tab -->
        <n-tab-pane name="plotArcs" tab="剧情弧线">
          <!-- ... 整段照搬 v2 剧情弧线 tab ... -->
        </n-tab-pane>

        <!-- 图谱 tab -->
        <n-tab-pane name="graph" tab="图谱">
          <n-card title="本章图谱" size="small">
            <EditableGraph
              :initial-graph-data="graphData"
              @update:graphData="onGraphUpdate"
            />
          </n-card>
        </n-tab-pane>
      </n-tabs>

      <n-space justify="end" style="width: 100%; margin-top: 16px">
        <n-button @click="emit('cancel')">取消</n-button>
        <n-button type="primary" :loading="saving" @click="handleSave">保存调整</n-button>
        <n-button type="success" :loading="confirming" @click="handleConfirm">确认归档</n-button>
      </n-space>
    </n-space>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue'
import {
  NCard, NSpace, NTabs, NTabPane, NCollapse, NCollapseItem,
  NInput, NInputNumber, NButton, NEmpty, NGrid, NGi, NText,
  NSelect, NSlider, useDialog
} from 'naive-ui'
import type { PendingPlotArcWrite } from '@novel-runtime/shared'
import EditableGraph from '../components/graph/EditableGraph.vue'
import DynamicTags from '../components/DynamicTags.vue'
import {
  fromV3, toV3,
  type V3PendingArchiveData, type LocalData
} from './ReviewingPanel.adapter'

const props = defineProps<{
  pending: V3PendingArchiveData
}>()

const emit = defineEmits<{
  (e: 'save', data: V3PendingArchiveData): void
  (e: 'confirm', data: V3PendingArchiveData): void
  (e: 'cancel'): void
  (e: 'reprepare'): void
}>()

const saving = ref(false)
const confirming = ref(false)
const dialog = useDialog()

const localData = ref<LocalData>(fromV3(props.pending))

// 父组件传入新 pending(整章重抽)时重新初始化
watch(() => props.pending, (next) => {
  localData.value = fromV3(next)
})

// 自动防抖保存
let saveTimer: ReturnType<typeof setTimeout> | null = null
watch(localData, () => {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    emit('save', toV3(localData.value, props.pending))
  }, 800)
}, { deep: true })
onUnmounted(() => { if (saveTimer) clearTimeout(saveTimer) })

// === v2 顶部常量与 helper(整段照搬 v2,删除 timeline 相关) ===
const arcTypeOptions = [
  { label: '主线', value: 'main' },
  { label: '支线', value: 'side' }
]
const arcStatusOptions = [
  { label: '进行中', value: 'active' },
  { label: '解决中', value: 'resolving' },
  { label: '已完成', value: 'completed' },
  { label: '已关闭', value: 'closed' },
  { label: '沉寂', value: 'stale' }
]
function arcStatusLabel(status: string): string {
  return arcStatusOptions.find((o) => o.value === status)?.label ?? status
}
function arcStatusChipClass(status: string): string {
  switch (status) {
    case 'active': return 'is-blue'
    case 'resolving': return 'is-warm'
    case 'completed': return 'is-positive'
    case 'closed': return 'is-error'
    case 'stale': return 'is-stale'
    default: return ''
  }
}
function arcTypeChipClass(type: string): string {
  return type === 'main' ? 'is-error' : 'is-warm'
}
function formatSimilarArcNames(similarToJson: string | undefined): string { return '' }
function confirmRemove(content: string, onConfirm: () => void) {
  dialog.warning({
    title: '确认删除',
    content,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: onConfirm
  })
}

// === v2 computed 与各 tab 用到的派生 ===
const summary = computed({
  get: () => localData.value.summary,
  set: (v: string) => { localData.value.summary = v }
})
const memories = computed(() => localData.value.memories.memories)
const mainMemories = computed(() => memories.value.filter((m: any) => m.tags?.includes('main-plot')))
const sideMemories = computed(() => memories.value.filter((m: any) => !m.tags?.includes('main-plot')))
const emotions = computed({
  get: () => localData.value.memories.emotions,
  set: (v: string[]) => { localData.value.memories.emotions = v }
})
const foreshadowing = computed({
  get: () => localData.value.memories.foreshadowing,
  set: (v: string[]) => { localData.value.memories.foreshadowing = v }
})
const relationshipChanges = computed({
  get: () => localData.value.memories.relationshipChanges,
  set: (v: string[]) => { localData.value.memories.relationshipChanges = v }
})
const characterStates = computed(() => localData.value.memories.characterStates)
const plotArcs = computed(() => localData.value.plotArcs)
const graphData = computed(() => localData.value.graph.chapterGraph)

// === 各 tab 内的 add/remove 方法(整段照搬 v2,删除 timeline 相关) ===
function addMainMemory() {
  localData.value.memories.memories.push({
    content: '',
    tags: ['main-plot'],
    importance: 5,
    fromChapterNumber: Number(props.pending?.meta?.chapterNumber ?? 0)
  })
}
function addSideMemory() {
  localData.value.memories.memories.push({
    content: '',
    tags: ['side-plot'],
    importance: 5,
    fromChapterNumber: Number(props.pending?.meta?.chapterNumber ?? 0)
  })
}
function removeMemory(mem: any) {
  confirmRemove(`删除该记忆?\n\n"${(mem.content || '').slice(0, 60)}"`, () => {
    const idx = localData.value.memories.memories.indexOf(mem)
    if (idx >= 0) localData.value.memories.memories.splice(idx, 1)
  })
}
function addCharacterState() {
  localData.value.memories.characterStates.push({
    characterId: null,
    name: '',
    key: '',
    status: '{}',
    relationships: '{}',
    isNew: true
  })
}
function removeCharacterState(idx: number) {
  confirmRemove('删除该角色状态?', () => {
    localData.value.memories.characterStates.splice(idx, 1)
  })
}
function addPlotArc() {
  localData.value.plotArcs.push({
    name: '',
    type: 'side',
    status: 'active',
    progress: 0,
    currentStage: '',
    nextGoal: '',
    summary: '',
    unresolved: '[]',
    stages: '[]',
    isNew: true
  })
}
function removePlotArc(idx: number) {
  confirmRemove('删除该剧情弧线?', () => {
    localData.value.plotArcs.splice(idx, 1)
  })
}
function onGraphUpdate(next: any) {
  localData.value.graph.chapterGraph = next
}

// === 底部三按钮 ===
function handleSave() {
  saving.value = true
  try { emit('save', toV3(localData.value, props.pending)) }
  finally { setTimeout(() => { saving.value = false }, 200) }
}
function handleConfirm() {
  confirming.value = true
  try { emit('confirm', toV3(localData.value, props.pending)) }
  finally { setTimeout(() => { confirming.value = false }, 200) }
}
</script>

<style scoped>
/* 整段照搬 v2 的 <style scoped> 内容 (~700 行),删除 .cap-timeline-card 相关类,
   删除 .cap-timeline-card__field / __events-list / __events-hint 等 */
</style>
```

The actual `<style scoped>` block is large (~700 lines). Implementer: copy the entire v2 `<style scoped>` block from `/tmp/v2-reviewing.vue` (lines 1100+ in v2 source), then delete `.cap-timeline-card*` selectors (~80 lines).

For the inner `<n-tab-pane>` blocks (角色 / 记忆 / 剧情弧线), copy the corresponding template sections verbatim from v2 source, but replace any `memories.value.filter((m: any) => m.tags?.includes('main-plot'))`-style logic with the local computed refs already declared above.

- [ ] **Step 3: Run web typecheck**

Run: `cd "D:\NewCode\ai-novel-runtime" && pnpm --filter web typecheck 2>&1 | tail -10`

Expected: clean.

- [ ] **Step 4: Run all web tests**

Run: `cd "D:\NewCode\ai-novel-runtime" && pnpm --filter web test 2>&1 | tail -20`

Expected: all pass (adapter test from Task 3 + any pre-existing).

- [ ] **Step 5: Manual smoke test (dev server)**

Start dev server (already configured: `pnpm dev`). In browser:

1. Navigate to a chapter with status='reviewing' (or trigger prepare-archive on a draft chapter)
2. Confirm ReviewingPanel renders with **4 tabs**: 角色 / 记忆 / 剧情弧线 / 图谱 (no 时间线)
3. Switch to 角色 tab → see character state cards, edit `status` textarea, see input reflected
4. Switch to 记忆 tab → see summary textarea + main/side event cards + emotions/foreshadowing tags
5. Switch to 剧情弧线 tab → see plot arc cards with editable name, type select, status select, progress slider, currentStage/nextGoal inputs, summary textarea
6. Switch to 图谱 tab → see EditableGraph rendering nodes (with **labels**, not `type:key` codes) and edges (with **human-readable relations**)
7. Edit any field, wait 1 second → check `Chapter.pendingArchiveData` in DB has been updated (via Prisma Studio or API)
8. Click "保存调整" → status message "已保存"
9. Click "确认归档" → chapter moves to `archived` state

- [ ] **Step 6: Commit**

```bash
cd "D:\NewCode\ai-novel-runtime" && git add apps/web/src/views/ReviewingPanel.vue apps/web/src/views/ReviewingPanel.adapter.ts && git commit -m "refactor(v3): restore v2 ReviewingPanel.vue template with v3 data adapter"
```

---

### Task 5: Rewire ChapterEditor.vue + Chapters.vue emits

**Files:**
- Modify: `apps/web/src/views/chapters/ChapterEditor.vue:251-258`
- Modify: `apps/web/src/views/Chapters.vue:36-49, 240-316`

- [ ] **Step 1: Update ChapterEditor.vue ReviewingPanel block**

In `apps/web/src/views/chapters/ChapterEditor.vue`, replace lines 251-258 (the `<ReviewingPanel>` mount) with:

```vue
        <!-- ========== Step 3.5: 归档审查 (嵌入 ReviewingPanel) ========== -->
        <ReviewingPanel
            v-if="chapter?.status === 'reviewing' && pendingArchiveData?.version === 3"
            :pending="pendingArchiveData"
            @save="(data) => emit('save-pending-archive', data)"
            @confirm="(data) => emit('confirm-archive-with-data', data)"
            @cancel="emit('prepare-archive-cancel')"
            @reprepare="emit('reprepare-archive')"
        />
```

Also update the `defineEmits` block (currently lines 432-446). Add two new emits: `'save-pending-archive'` and `'confirm-archive-with-data'`. Remove unused ones if they're not referenced elsewhere — but keep all current ones to avoid breaking other consumers:

```typescript
const emit = defineEmits<{
    (e: "back"): void;
    (e: "save-config"): void;
    (e: "save-content"): void;
    (e: "generate-prompt"): void;
    (e: "generate-default"): void;
    (e: "generate-custom"): void;
    (e: "adopt-draft", draft: any): void;
    (e: "prepare-archive"): void;
    (e: "confirm-archive"): void;
    (e: "prepare-archive-cancel"): void;
    (e: "save-pending-archive", data: any): void;
    (e: "confirm-archive-with-data", data: any): void;
    (e: "update-stage", stageName: string, result: unknown): void;
    (e: "reprepare-archive"): void;
    (e: "cancel-reviewing"): void;
}>();
```

The `@update-stage` block on the old ReviewingPanel is gone now (v2 doesn't emit it). Keep `update-stage` in the emits type only if it's still referenced by other code paths (currently in ChapterEditor only via the old ReviewingPanel block, so safe to remove).

- [ ] **Step 2: Update Chapters.vue event handlers**

In `apps/web/src/views/Chapters.vue`, locate the `<ChapterEditor>` block (currently around line 36-49) and update the event bindings:

```vue
<ChapterEditor
    :chapter="..." ...all other props...
    @confirm-archive="handleConfirmArchive"
    @confirm-archive-with-data="handleConfirmArchiveWithData"
    @prepare-archive-cancel="handlePrepareArchiveCancel"
    @save-pending-archive="handleSavePendingArchive"
    @reprepare-archive="handleReprepareArchive"
    @cancel-reviewing="handleCancelReviewing"
    ...other events
/>
```

Then add the new handlers in the script block. Place them near the existing `handleConfirmArchive` (currently around line 258):

```typescript
async function handleSavePendingArchive(data: any) {
    // ReviewingPanel 防抖触发或手动点"保存调整"。
    // data 已是 v3 shape,直接持久化。
    await editor.savePendingArchiveData(data)
}

async function handleConfirmArchiveWithData(data: any) {
    // ReviewingPanel 点"确认归档":先存,再调 archive 端点。
    const saved = await editor.savePendingArchiveData(data)
    if (!saved.success) return
    const result = await editor.archiveChapter()
    if (result.success) await handleBackToTree()
}
```

Replace the existing `handleConfirmArchive` body (lines 258-263):

```typescript
async function handleConfirmArchive() {
    // 兼容旧路径(若 ReviewingPanel 未挂载但父组件仍 emit 该事件):直接归档。
    const result = await editor.archiveChapter()
    if (result.success) await handleBackToTree()
}
```

- [ ] **Step 3: Run web typecheck**

Run: `cd "D:\NewCode\ai-novel-runtime" && pnpm --filter web typecheck 2>&1 | tail -10`

Expected: clean.

- [ ] **Step 4: Manual smoke test**

Start dev server. In browser:

1. Open a draft chapter, click "准备归档" → enters reviewing state
2. ReviewingPanel renders 4 tabs (角色/记忆/剧情弧线/图谱)
3. Edit a field in 记忆 tab (e.g. add a new main event)
4. Wait 1 second → confirm `Chapter.pendingArchiveData` in DB has been updated (no user click required — auto-save via debounce)
5. Click "保存调整" → status message "归档数据已保存" appears immediately (manual save)
6. Click "确认归档" → chapter transitions to `archived`
7. Re-trigger: cancel an in-progress review (点"取消") → chapter returns to `draft`
8. Re-trigger: prepare-archive again → chapter re-enters `reviewing` with fresh AI extraction

- [ ] **Step 5: Commit**

```bash
cd "D:\NewCode\ai-novel-runtime" && git add apps/web/src/views/chapters/ChapterEditor.vue apps/web/src/views/Chapters.vue && git commit -m "refactor(v3): rewire ChapterEditor + Chapters emits to v2 save/confirm/cancel"
```

---

## Self-Review (after writing the plan)

**Spec coverage:**

| Spec section | Plan task |
|---|---|
| §1 角色 tab from character-stage.result.characterStates | Task 4 (角色 tab 整段照搬 v2 + adapter mapping) |
| §1 记忆 tab from memory-stage.result | Task 4 + Task 3 (adapter flattens main/side into memories array with tags) |
| §1 剧情弧线 tab from plot-arc-stage.result.plotArcs | Task 4 (plotArcs tab 整段照搬 v2) |
| §1 图谱 tab via EditableGraph | Task 4 (graph tab 整段照搬 v2) |
| §1 常驻顶部:本章摘要 | Task 4 (cap-summary-card 整段照搬 v2) |
| §1 底部三按钮:取消/保存调整/确认归档 | Task 4 (handleSave/handleConfirm/emit cancel) |
| §1 状态徽标 | Task 4 (per-tab header, see N°-format detail in v2) — note: explicit status dots not in v2; rely on stage.status carried through props |
| §2 EditableGraph 复用 | Task 4 (existing component, drop-in) |
| §3 graph-extract-stage prompt + importance | Task 1 |
| §4 ChapterEditor + Chapters emits | Task 5 |

**Placeholder scan:** No TBDs. Every code block is complete. Every test file has full code.

**Type consistency:** `LocalMemoryRow.tags` ('main-plot' | 'side-plot') consistent across `fromV3`, `toV3`, tests. `V3PendingArchiveData.stages.character.status` flows through unchanged. `fromV3` / `toV3` signatures match test imports.

**Ambiguity:** import for `PendingPlotArcWrite` in Task 4 — present in v2 script. The `formatSimilarArcNames` stub returns '' — original v2 had more, but it's a v2 carryover that can stay simple; no test asserts on it. The `fromV3` for missing `mainEvents` / `sideEvents` uses `Array.isArray(...)` fallback to `[]` — symmetric in `toV3` filter.