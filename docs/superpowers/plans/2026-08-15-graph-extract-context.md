# 图谱抽取上下文增强 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 图谱抽取时给 AI 传「正文人名 + 其关联点（事件/物品）」的紧凑上下文，从源头减少同实体不同 key 的重复输出。

**Architecture:** 从 prev.cumulativeGraph 额外提取 edges；graph-extract-stage 把 nodes + edges 传给 prompt；prompt 按「正文出现的 character」预过滤、组织成「人→关系→关联实体」上下文，并加「增量抽取」约束。

**Tech Stack:** TypeScript、Fastify、Vitest（server）

**Spec:** `docs/superpowers/specs/2026-08-15-graph-extract-context-design.md`

---

## 文件结构

- 修改 `apps/server/src/routes/chapters-archive.ts` — 新增 `extractGraphEdges` + 调用处提取 edges
- 修改 `apps/server/src/services/stages/graph-extract-stage.ts` — 输入加 edges + 传参
- 修改 `apps/server/src/services/stages/graph-extract.prompt.ts` — prompt 生成实体+关系上下文 + 增量约束
- 测试：`apps/server/src/__tests__/services/graph-extract-utils.test.ts`（或新建 prompt 测试）

---

## Task 1: extractGraphEdges + 调用处提取 edges

**Files:**
- Modify: `apps/server/src/routes/chapters-archive.ts`

### Step 1: 加 extractGraphEdges

在 `extractGraphNodes`（约 16-27 行）之后加：

```typescript
function extractGraphEdges(
  raw: string | null | undefined
): Array<{ fromType: string; fromKey: string; toType: string; toKey: string; relation: string }> {
  const parsed = safeJsonParse<{ edges?: Array<{ fromType?: unknown; fromKey?: unknown; toType?: unknown; toKey?: unknown; relation?: unknown }> } | null>(raw, null)
  if (!parsed?.edges) return []
  return parsed.edges.filter((e): e is { fromType: string; fromKey: string; toType: string; toKey: string; relation: string } =>
    typeof e?.fromType === 'string' &&
    typeof e?.fromKey === 'string' &&
    typeof e?.toType === 'string' &&
    typeof e?.toKey === 'string' &&
    typeof e?.relation === 'string'
  )
}
```

### Step 2: 更新调用处（prepare-archive + retry-stage，共 2 处 × 3 点）

在 `let prevCumulativeGraphNodes = []` 声明后加 edges 声明；在每处 `prevCumulativeGraphNodes = extractGraphNodes(...)` 后加 edges 提取。

prepare-archive（约 128-150 行）与 retry-stage（约 342-363 行）同构，改动如下：

```typescript
let prevCumulativeGraphNodes: Array<{ type: string; key: string; label: string }> = []
let prevCumulativeGraphEdges: Array<{ fromType: string; fromKey: string; toType: string; toKey: string; relation: string }> = []
if (chapter.parentChapterId) {
  const parent = await prisma.chapter.findUnique({ ... })
  prevCumulativeGraphNodes = extractGraphNodes(parent?.cumulativeGraph)
  prevCumulativeGraphEdges = extractGraphEdges(parent?.cumulativeGraph)
}
if (prevCumulativeGraphNodes.length === 0) {
  const prev = await prisma.chapter.findFirst({ ... })
  prevCumulativeGraphNodes = extractGraphNodes(prev?.cumulativeGraph)
  prevCumulativeGraphEdges = extractGraphEdges(prev?.cumulativeGraph)
}
```

### Step 3: 在 runGraphExtractStage 调用处传 edges

把传给 `runGraphExtractStage` 的对象加 `prevCumulativeGraphEdges`（两处：prepare-archive 与 retry-stage）：

```typescript
runGraphExtractStage(app, {
  ...,
  prevCumulativeGraphNodes,
  prevCumulativeGraphEdges,
  ...
})
```

### Step 4: Commit

```bash
git add apps/server/src/routes/chapters-archive.ts
git commit -m "feat(graph): extract edges alongside nodes from cumulative graph"
```

---

## Task 2: graph-extract-stage 传 edges

**Files:**
- Modify: `apps/server/src/services/stages/graph-extract-stage.ts`

### Step 1: 输入类型加 edges

`GraphExtractStageInput` 加：

```typescript
export interface GraphExtractStageInput extends StageContext {
  characterNames: string[]
  prevCumulativeGraphNodes: Array<{ type: string; key: string; label: string }>
  prevCumulativeGraphEdges: Array<{ fromType: string; fromKey: string; toType: string; toKey: string; relation: string }>
  latestBranchStates: Array<{ characterId: string; name: string; status: string }>
}
```

### Step 2: 传参给 prompt

`runGraphExtractStage` 里的 `buildGraphExtractPrompt` 调用加 edges：

```typescript
const prompt = buildGraphExtractPrompt({
  content: input.content,
  characterNames: input.characterNames,
  prevCumulativeGraphNodes: input.prevCumulativeGraphNodes,
  prevCumulativeGraphEdges: input.prevCumulativeGraphEdges
})
```

### Step 3: Commit

```bash
git add apps/server/src/services/stages/graph-extract-stage.ts
git commit -m "feat(graph): pass edges to graph extract prompt"
```

---

## Task 3: prompt 生成实体+关系上下文 + 增量约束

**Files:**
- Modify: `apps/server/src/services/stages/graph-extract.prompt.ts`

### Step 1: 输入类型加 edges + 写失败测试

先写测试（`apps/server/src/__tests__/services/graph-extract.prompt.test.ts`，新建）：

```typescript
import { describe, it, expect } from 'vitest'
import { buildGraphExtractPrompt } from '../../services/stages/graph-extract.prompt.js'

describe('buildGraphExtractPrompt — 实体+关系上下文', () => {
  const base = {
    content: '本章姜禾拿出剑，许青帮她适应现代生活',
    characterNames: ['姜禾', '许青'],
    prevCumulativeGraphNodes: [
      { type: 'character', key: 'jiang_he', label: '姜禾' },
      { type: 'character', key: 'xu_qing', label: '许青' },
      { type: 'item', key: 'jianghe_peijian', label: '盐帮佩剑' },
      { type: 'event', key: 'jiang_he_chuan_yue', label: '姜禾穿越' }
    ],
    prevCumulativeGraphEdges: [
      { fromType: 'character', fromKey: 'jiang_he', toType: 'item', toKey: 'jianghe_peijian', relation: '持有' },
      { fromType: 'character', fromKey: 'jiang_he', toType: 'event', toKey: 'jiang_he_chuan_yue', relation: '参与' },
      { fromType: 'character', fromKey: 'xu_qing', toType: 'event', toKey: 'help_adapt', relation: '参与' }
    ]
  }

  it('按正文出现的 character 组织关系上下文', () => {
    const prompt = buildGraphExtractPrompt(base)
    expect(prompt).toContain('姜禾(character:jiang_he)')
    expect(prompt).toContain('持有-item:jianghe_peijian')
    expect(prompt).toContain('许青(character:xu_qing)')
  })

  it('正文未出现的角色不进上下文', () => {
    const prompt = buildGraphExtractPrompt({
      ...base,
      content: '本章只有姜禾出现',
      prevCumulativeGraphNodes: base.prevCumulativeGraphNodes
    })
    expect(prompt).not.toContain('许青(character:xu_qing)')
  })

  it('含增量抽取约束', () => {
    const prompt = buildGraphExtractPrompt(base)
    expect(prompt).toContain('新增')
  })
})
```

### Step 2: 运行确认失败

Run: `pnpm --filter server exec vitest run src/__tests__/services/graph-extract.prompt.test.ts`

Expected: FAIL（buildGraphExtractPrompt 还没加 edges 参数 / 新逻辑）。

### Step 3: 实现

替换 `graph-extract.prompt.ts` 的 `BuildGraphExtractPromptInput` 和 `buildGraphExtractPrompt`：

```typescript
export interface BuildGraphExtractPromptInput {
  content: string
  characterNames: string[]
  prevCumulativeGraphNodes: Array<{ type: string; key: string; label: string }>
  prevCumulativeGraphEdges: Array<{ fromType: string; fromKey: string; toType: string; toKey: string; relation: string }>
}

export function buildGraphExtractPrompt(input: BuildGraphExtractPromptInput): string {
  const content = input.content || ''
  const matchedNodes = input.prevCumulativeGraphNodes.filter(
    (n) => n.label && content.includes(n.label)
  )

  // 按「正文出现的 character」组织关系上下文（人名 + 其关联点）
  const contextLines = matchedNodes
    .filter(n => n.type === 'character')
    .map(person => {
      const personKey = `${person.type}:${person.key}`
      const related = input.prevCumulativeGraphEdges.filter(e => {
        const f = `${e.fromType}:${e.fromKey}`
        const t = `${e.toType}:${e.toKey}`
        return f === personKey || t === personKey
      })
      if (related.length === 0) return `${person.label}(${personKey})`
      const relText = related.map(e => {
        const other = `${e.fromType}:${e.fromKey}` === personKey
          ? `${e.toType}:${e.toKey}`
          : `${e.fromType}:${e.fromKey}`
        return `${e.relation}-${other}`
      }).join('、')
      return `${person.label}(${personKey}): ${relText}`
    })

  const keyList = contextLines.length
    ? contextLines.join('\n')
    : '（空，本章可自由起 key）'

  return `【任务】
分析章节内容，提取对剧情有实质推动作用的核心实体和它们之间的关系。

【实体与关系定义】
- type 可选值：character(角色), faction(势力/组织), event(事件), item(物品/道具)
- relation 建议值：隶属、对抗、师徒、配偶、兄弟、持有、发生地点、涉及
- relation 应是简洁的核心词或短语（2-6字为佳）

【提取规则】
1. 【主线事件合并】同一主线剧情链的连续事件必须合并为一个整体事件节点。
2. 【支线独立】与主线并行的独立支线可以作为独立事件节点。
3. 【角色优先】主角和重要配角必须提取；路人、一次性提及的次要角色不要提取。
4. 【物品克制】只提取对剧情有实质推动的关键物品，日常用品不要提取。
5. 【事件 label 简短】label 4-8 字概括核心动作，详细情节放 data.desc。

【已有实体及关系】（复用已有 key，不要重复提取）
本章图谱只抽取「新增」的实体和关系——新人 / 新物品 / 新事件，或已有人物之间的新关系 / 新进展。如果本章只是延续前面剧情（无新增），少输出甚至输出空。
${keyList}

【章节内容】
${input.content}

【输出格式】
返回严格 JSON 格式，不要 markdown 代码块。**严格用下方短名**，不要用长名：

字段映射：n=nodes, e=edges, t=type, k=key, l=label, d=data, ft=fromType, fk=fromKey, tt=toType, tk=toKey, r=relation

{
  "n": [
    { "t": "character", "k": "xu_qing", "l": "许青", "d": { "role": "本章主角" } }
  ],
  "e": [
    { "ft": "character", "fk": "xu_qing", "tt": "character", "tk": "jiang_he", "r": "收留" }
  ]
}`
}
```

### Step 4: 运行确认通过

Run: `pnpm --filter server exec vitest run src/__tests__/services/graph-extract.prompt.test.ts`

Expected: PASS。

再跑全量 graph 相关测试确认无回归：

Run: `pnpm --filter server exec vitest run src/__tests__/services/graph-extract-utils.test.ts src/__tests__/services/stages-graph-extract.test.ts`

Expected: 通过。

### Step 5: Commit

```bash
git add apps/server/src/services/stages/graph-extract.prompt.ts apps/server/src/__tests__/services/graph-extract.prompt.test.ts
git commit -m "feat(graph): inject entity-relation context + incremental extraction"
```

---

## 完成验证

所有 Task 完成后：

1. `pnpm --filter server test` 全量通过。
2. `pnpm typecheck` 全仓通过。
3. 浏览器走通：归档几章 → 生成累计图谱 → 下一章归档时检查 prompt 里是否带「人名 + 关系」上下文。
