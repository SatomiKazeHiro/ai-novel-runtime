# Phase 5: Graph.vue 拆 display + editable

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `apps/web/src/views/Graph.vue`(793 行)按 display + editable 两种语义拆为 view shell(< 100)+ GraphView + EditableGraph + 共享 `useCytoscapeLifecycle` hook,知识图谱页 + ReviewingPanel 嵌入图谱 100% byte-equivalent。

**Architecture:** 用"共享 hook + 双组件 + view shell"三层结构。`useCytoscapeLifecycle` 抽离 cytoscape 实例生命周期 + normalizeGraph + elements/style/layout 配置,GraphView 和 EditableGraph 各自调用 hook 获得不同语义。Graph.vue 重写为 view shell(< 100 行),只 import + 使用 GraphView。ReviewingPanel.vue:138 的 `<graph>` 嵌入改为 `<EditableGraph>`。

**Tech Stack:** Vue 3 `<script setup>` + cytoscape(已装) + Naive UI(已装)。0 新库。

---

## 1. 目标

承袭 `docs/superpowers/specs/2026-06-18-decoupling-roadmap-design.md` Phase 5(2026-06-18 路线图)第 263-291 行 + `memory/planned-graph-split.md` 用户决策。本次实施细化为:

- **行数**:Graph.vue 793 行 → 1 view shell(< 100)+ GraphView(~280)+ EditableGraph(~290)+ useCytoscapeLifecycle(~140)
- **文件数**:净增 3 个(GraphView + EditableGraph + useCytoscapeLifecycle)+ 1 改写(Graph.vue 变 view shell)+ 1 改写(ReviewingPanel.vue:138 嵌入更新 import + 组件名)
- **行为**:知识图谱页 + ReviewingPanel 嵌入图谱 100% byte-equivalent
- **共享**:cytoscape 生命周期 + normalizeGraph + elements 构造全部抽到 `useCytoscapeLifecycle`
- **cytoscape null bug 修复保留**: 4def263 修复的 `destroyCytoscape`(`removeAllListeners` 在 destroy 前)路径在 hook 内统一

## 2. 文件改动清单

| 文件 | 状态 | 职责 | 预计行数 |
|---|---|---|---|
| `apps/web/src/composables/graph/useCytoscapeLifecycle.ts` | 新建 | 共享 cytoscape 实例 + normalizeGraph + elements/style/layout + tap callback 转发 + onBeforeUnmount 清理 | ~140 |
| `apps/web/src/components/graph/GraphView.vue` | 新建 | display 模式:API 加载 + 章节选择 + 视图切换 + diff 高亮 + resetLayout + 不接 tap callback(只读)| ~280 |
| `apps/web/src/components/graph/EditableGraph.vue` | 新建 | editable 模式:draftGraphData + tap → emit 选择 + add/edit/delete node/edge 3 modal + emit `update:graphData` | ~290 |
| `apps/web/src/views/Graph.vue` | **改写** | view shell,只 import + 使用 `<GraphView>` + 路由参数传递 | < 100 |
| `apps/web/src/views/ReviewingPanel.vue` | **改写 1 行 import + 1 行组件名** | line 166 import + line 139 `<graph>` → `<editable-graph>` | 改 2 行 |
| `apps/web/src/components/ChapterBranchTree.vue` | **不动** | 独立组件,无关 | 0 |
| `apps/web/src/api/graph.ts` / `api/chapters.ts` | **不动** | API 不变 | 0 |

**澄清 — planned-graph-split.md 的一个误判**:原文档说 "`Chapters.vue:561` Step 4 本章范围图谱" 是 editable 类型,实际代码里 ChapterEditor.vue Step 4(line 562-613 现有)只是 `<n-card>` + `<n-collapse>` + `<n-tag>` + `<n-text>` 显示 graphDelta 数据,**无 cytoscape 嵌入**。本次不替换 Step 4;若未来想用 cytoscape 嵌入,另起 spec。

## 3. `useCytoscapeLifecycle` API

### 3.1 签名

```ts
import type { Ref } from 'vue'

export interface GraphNode {
  id?: string
  type: string
  key: string
  label: string
  isNew?: boolean
  [k: string]: any
}

export interface GraphEdge {
  id?: string
  source: string
  target: string
  relation: string
  fromType?: string
  fromKey?: string
  toType?: string
  toKey?: string
  weight?: number
  isNew?: boolean
  [k: string]: any
}

export interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export interface CytoscapeLifecycleOptions {
  containerRef: Ref<HTMLDivElement | undefined>
  getDisplayData: () => GraphData | null
  getNewIds?: () => { newNodes: Set<string>; newEdges: Set<string> }
  onNodeTap?: (node: { id: string; label: string; key: string; type: string }) => void
  onEdgeTap?: (edge: { id: string; source: string; target: string; relation: string }) => void
  onBackgroundTap?: () => void
}

export interface CytoscapeLifecycle {
  init(): void
  destroy(): void
  resetLayout(): void
  getInstance(): cytoscape.Core | null
}

export function useCytoscapeLifecycle(
  options: CytoscapeLifecycleOptions
): CytoscapeLifecycle
```

### 3.2 契约

**`init()`**:
- 若 `containerRef.value` 不存在 → return
- 若 `getDisplayData()` 返回 null 或 nodes 长度 = 0 → return
- 先调 `destroy()`(复用 unmount 路径,保证 destroy 行为一致,4def263 修复点)
- 构造 elements:遍历 nodes + edges,过滤 source/target 不存在的边(line 316-321 现有)
- 应用 style:node + edge + :selected + layout `cose`
- 注册 tap 监听器(若 options 提供):
  - `'tap', 'node'`:调 `onNodeTap`
  - `'tap', 'edge'`:调 `onEdgeTap`
  - `'tap'`(背景,evt.target === cy):调 `onBackgroundTap`
- 缓存 cy 实例到内部闭包

**`destroy()`**:
- 若 cy 不存在 → return
- 先 `cy.removeAllListeners()`(关键,4def263 修复)
- 再 `cy.destroy()`
- cy = null

**`resetLayout()`**:
- 若 cy 不存在 → return
- 重建 layout + `layout.run()`

**`getInstance()`**:
- 返回当前 cy 实例(可空)

**`onBeforeUnmount`** (hook 内部注册):
- 自动调 `destroy()`,无需外部手动管理

### 3.3 `normalizeGraph` 导出

`useCytoscapeLifecycle.ts` 文件顶部同时 export `normalizeGraph(rawNodes, rawEdges)` 和 `TYPE_NORMALIZE_MAP`(中文/英文 → 4 类型收敛),由 GraphView / EditableGraph 各自 import 处理 API / initialGraphData 规范化。

```ts
export const TYPE_NORMALIZE_MAP: Record<string, string> = { ... }
export function normalizeType(type: string): string { ... }
export function normalizeGraph(rawNodes: any[], rawEdges: any[]): { nodes: any[]; edges: any[] }
```

normalizeGraph 行为与原 Graph.vue line 498-519 完全一致,无变更。

## 4. GraphView.vue (display)

### 4.1 Props / Emits

GraphView **不暴露 props**(完全自治),从 `useRoute()` 拿 storyId,从 API 加载数据。

### 4.2 State

```ts
const chapters = ref<any[]>([])
const selectedChapterId = ref<string>('')
const viewMode = ref<'snapshot' | 'delta'>('snapshot')
const currentSnapshot = ref<GraphData | null>(null)
const currentDelta = ref<GraphData | null>(null)
const prevSnapshot = ref<GraphData | null>(null)
const cyContainer = ref<HTMLDivElement>()
```

### 4.3 Computed

```ts
const effectiveStoryId = computed(() => route.params.storyId as string || '')

const displayGraphData = computed(() => {
  if (viewMode.value === 'delta') return currentDelta.value
  return currentSnapshot.value
})

const diffStats = computed(() => {
  // 计算 prevSnapshot 与 currentSnapshot 的新增 nodes/edges 数
  // (原 Graph.vue line 233-251)
})
```

### 4.4 Hook 集成

```ts
const cytoscape = useCytoscapeLifecycle({
  containerRef: cyContainer,
  getDisplayData: () => displayGraphData.value,
  getNewIds: () => {
    if (viewMode.value !== 'snapshot' || !currentSnapshot.value || !prevSnapshot.value) {
      return { newNodes: new Set(), newEdges: new Set() }
    }
    // 计算 newIds(原 Graph.vue line 270-294)
  }
  // 不传 tap callback(只读)
})
```

### 4.5 Functions

```ts
async function loadChapters() { ... }       // 原 Graph.vue line 458-473
async function selectChapter(chapterId: string) { ... }  // line 475-478
async function loadChapterGraph(chapterId: string) { ... }  // line 544-589
async function loadPrevSnapshot(currentChapterId: string) { ... }  // line 591-609
function resetLayout() { cytoscape.resetLayout() }  // 委托给 hook
```

### 4.6 Lifecycle

```ts
watch(() => route.params.storyId, loadChapters)
watch(viewMode, () => nextTick(() => cytoscape.init()))

onMounted(() => {
  if (route.params.storyId) loadChapters()
})
// onBeforeUnmount 由 hook 内部处理
```

### 4.7 Template

复制原 Graph.vue template line 1-143 全部内容,章节选择器(line 14-31)、视图切换 + 图例(line 34-57)、纯净视图提示(line 60-62)、新增高亮提示(line 65-73)、cytoscape 画布(line 76)、empty(line 78)、resetLayout 按钮(line 8)。

**注意**:原 Graph.vue template 内嵌入的 3 个 modal(添加节点 / 编辑节点 / 添加关系 line 81-141)**是 draft 模式专用**,display 模式不可见。**GraphView 不渲染这 3 个 modal**(原 Graph.vue 模板里这 3 个 modal 的 `v-model:show` 绑定到 `showNodeModal` / `showEditNodeModal` / `showEdgeModal` ref,这些 ref 在 display 模式流程内不会被 set true,UI 上不显示)。

**保留**:template 顶部"添加节点"按钮(line 9),它调用 `showNodeModal.value = true`,但 display 模式不实现 `handleCreateNode`(只调 API,不操作 draft)。GraphView 实现 `handleCreateNode` 调 `graphApi.createNode` + 刷新当前视图(原 line 632-639)。

## 5. EditableGraph.vue (editable)

### 5.1 Props / Emits

```ts
const props = defineProps<{
  initialGraphData?: GraphData | null
}>()

const emit = defineEmits<{
  'update:graphData': [data: GraphData]
}>()
```

### 5.2 State

```ts
const draftGraphData = ref<GraphData>({ nodes: [], edges: [] })
const showNodeModal = ref(false)
const showEdgeModal = ref(false)
const showEditNodeModal = ref(false)
const selectedNode = ref<{ id: string; label: string; key: string; type: string } | null>(null)
const selectedEdge = ref<{ id: string; source: string; target: string; relation: string } | null>(null)
const nodeForm = ref({ type: 'character', key: '', label: '' })
const edgeForm = ref({ targetId: '', relation: '' })
const editNodeForm = ref({ id: '', type: 'character', key: '', label: '' })
const cyContainer = ref<HTMLDivElement>()
```

### 5.3 Hook 集成

```ts
const cytoscape = useCytoscapeLifecycle({
  containerRef: cyContainer,
  getDisplayData: () => draftGraphData.value,
  onNodeTap: (node) => {
    if (selectedNode.value && selectedNode.value.id !== node.id) {
      edgeForm.value = { targetId: node.id, relation: '' }
      showEdgeModal.value = true
    } else {
      selectedNode.value = node
      selectedEdge.value = null
    }
  },
  onEdgeTap: (edge) => {
    selectedEdge.value = edge
    selectedNode.value = null
  },
  onBackgroundTap: () => {
    selectedNode.value = null
    selectedEdge.value = null
  }
})
```

### 5.4 Functions

```ts
function loadDraftGraph(raw?: GraphData | null) { ... }  // 原 Graph.vue line 521-542
function handleCreateNode() { ... }     // 原 line 611-629(draft 分支)
function cancelEdge() { ... }           // 原 line 642-648
function handleCreateEdge() { ... }     // 原 line 650-674(draft 分支)
function openEditNode() { ... }         // 原 line 690-699
function handleUpdateNode() { ... }     // 原 line 701-741
function handleDelete() { ... }         // 原 line 743-767
function resetLayout() { cytoscape.resetLayout() }  // 委托
```

### 5.5 Lifecycle

```ts
watch(() => props.initialGraphData, (val) => {
  loadDraftGraph(val)
  nextTick(() => cytoscape.init())
}, { immediate: true, deep: true })
// onBeforeUnmount 由 hook 内部处理
```

### 5.6 Template

复制原 Graph.vue template line 4-11(顶部按钮组,但去掉"重新布局"按钮,因为 EditableGraph 不暴露 resetLayout),+ line 76 cytoscape 画布 + line 78 empty + **3 个 modal**(line 81-141 全部,因为 editable 模式需要)。

**Editable 顶部按钮**(原 line 4-10,但过滤掉"重新布局"):
```vue
<n-space justify="space-between" align="center" style="margin-bottom: 16px">
  <n-h1>本章图谱</n-h1>
  <n-space>
    <n-button :disabled="!selectedNode" @click="openEditNode">编辑节点</n-button>
    <n-button :disabled="!selectedNode && !selectedEdge" type="error" @click="handleDelete">删除选中</n-button>
    <n-button @click="resetLayout">重新布局</n-button>
    <n-button type="primary" @click="showNodeModal = true">添加节点</n-button>
  </n-space>
</n-space>
```

## 6. Graph.vue (view shell)

```vue
<template>
  <GraphView />
</template>

<script setup lang="ts">
import GraphView from '../components/graph/GraphView.vue'
</script>
```

**Graph.vue 不持有任何 state**,只 import GraphView 并使用。所有模板 / state / API 加载 / cytoscape 逻辑全部在 GraphView 内。

## 7. ReviewingPanel.vue 嵌入更新

**Line 166**(import):
```diff
-import Graph from './Graph.vue'
+import EditableGraph from '../components/graph/EditableGraph.vue'
```

**Line 139**(template 使用):
```diff
-      <graph
-        :initial-graph-data="graphData"
-        :draft-mode="true"
-        @update:graph-data="onGraphUpdate"
-      />
+      <EditableGraph
+        :initial-graph-data="graphData"
+        @update:graphData="onGraphUpdate"
+      />
```

**注意**:
- 新组件**不**接受 `draftMode` prop(因为组件本身就是 editable 语义,无需外部声明)
- event 名称:原 kebab-case `@update:graph-data` → 新 camelCase `@update:graphData`(emit defineEmits 用 camelCase 声明,template 内 Vue 自动接受两种)
- 原 Graph.vue emit 是 `'update:graphData'`(camelCase),原 ReviewingPanel.vue line 142 用 kebab-case `@update:graph-data` — Vue 自动转换

## 8. composable 不动守门(承袭 P4 守门)

- ✅ `apps/web/src/composables/useChapterTree.ts` / `useChapterEditor.ts` / `useDraftManager.ts` / `usePromptManager.ts` 0 改动
- ✅ `apps/web/src/api/graph.ts` / `api/chapters.ts` 0 改动
- ✅ `apps/web/src/components/ChapterBranchTree.vue` 0 改动
- ✅ 0 新库

## 9. cytoscape null bug 修复保留

`destroyCytoscape` 函数在 hook 内实现,严格按 4def263 commit 修复路径:`removeAllListeners()` 在 `destroy()` 之前调用,防止 mouseover 在 in-flight 时 cytoscape 抛 `isHeadless null` 错。

实施时若发现 hook 内 destroy 路径与原 `destroyCytoscape` 行为有偏差,code review 抽看 + 手动测试 hover 时 unmount 场景。

## 10. commit 步骤

```bash
# 1. 新增 3 文件 + 改写 2 文件
git add apps/web/src/composables/graph/useCytoscapeLifecycle.ts \
        apps/web/src/components/graph/GraphView.vue \
        apps/web/src/components/graph/EditableGraph.vue \
        apps/web/src/views/Graph.vue \
        apps/web/src/views/ReviewingPanel.vue

# 2. verification gate
pnpm typecheck
pnpm --filter web typecheck
pnpm --filter web build

# 3. 单 commit
git commit -m "refactor(web): split Graph.vue into GraphView + EditableGraph + cytoscape hook (P5)

..."
```

## 11. 验收标准

| 项 | 期望 |
|---|---|
| `pnpm typecheck` | 8/8 Done |
| `pnpm --filter web typecheck` | Done,0 errors |
| `pnpm --filter web build` | 0 errors |
| `wc -l apps/web/src/views/Graph.vue` | < 100 |
| `wc -l apps/web/src/components/graph/*.vue` | 每个 < 300 |
| `wc -l apps/web/src/composables/graph/*.ts` | < 150 |
| composable 不动 | `git diff 2a0ca1a..HEAD -- apps/web/src/composables/use*.ts` 0 行 |
| 知识图谱页(/graph/:storyId) | 章节选择 + 视图切换 + diff 高亮 + resetLayout 全部正常 |
| ReviewingPanel.vue:138 嵌入 | 本章图谱 + 添加/编辑/删除节点 + 添加关系 全部正常 |
| cytoscape null bug | hover 时 unmount 不再报 `isHeadless null` |

## 12. 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| `useCytoscapeLifecycle` hook 的 tap callback 闭包陷阱(stale closure)| 中 | tap 时 selectedNode ref 不是最新 | callback 内部直接访问 ref(`onNodeTap: (node) => { selectedNode.value = ... }`),不用闭包变量捕获 |
| normalizeGraph 在 GraphView / EditableGraph 各调一次,行为可能漂移 | 低 | 类型规范化不一致 | normalizeGraph 是 pure function,导出后行为固定;code review 抽看调用方 |
| GraphView 在 display 模式下保留"添加节点"按钮(line 9)但 modal 不可用 | 低 | 用户点"添加节点"后 modal 弹出但不可见 | GraphView 内部实现 `handleCreateNode` 调 API(line 632-639),modal 可见且能用 |
| EditableGraph 不暴露 `draftMode` prop,ReviewingPanel 不再传 | 中 | ReviewingPanel.vue:141 移除 `:draft-mode='true'` 后行为不变 | 因为 EditableGraph 本身即 editable 语义;移除后行为一致 |
| event 名称 `@update:graph-data` → `@update:graphData` 改名 | 低 | ReviewingPanel 接收不到 emit | Vue 自动 kebab ↔ camel 转换;实施时严格用 camelCase emit + 测试 onGraphUpdate 仍触发 |
| hook 内部 onBeforeUnmount 与组件 unmount 时机冲突 | 低 | cy.destroy 被多次调用 | destroy 内部 cy 非空检查;多次调用安全 |
| EditableGraph 的 `watch initialGraphData` immediate 触发时 `cytoscape.init()` 失败(cyContainer ref 未挂载)| 中 | 初次 mount 时 cytoscape 没渲染 | `watch` + `nextTick` 兜底;若 nextTick 后 cyContainer.value 仍 undefined,init 内部 return(line 297 现有) |
| 共享 `cytoscape` import 多处 use | 中 | 包大小增大 | cytoscape 是大库,但本来就在前端单实例,共享后无变化 |
| `isDraftMode` 旧逻辑 `props.draftMode \|\| !!props.initialGraphData` 在新组件如何处理 | 中 | EditableGraph 总是 editable,不再需要 isDraftMode | EditableGraph 不接受 draftMode prop;GraphView 不接受 initialGraphData;彻底分离 |
| ReviewingPanel.vue 中 Graph 删除带来的 lint 警告(unused import)| 低 | build warning | line 166 import 替换为 EditableGraph,清除 dead import |

## 13. 不动的事(承袭 spec 守门)

- ✅ 0 新库(沿用 cytoscape + Vue 3 + Naive UI)
- ✅ API contract 不变(graphApi / chaptersApi)
- ✅ prisma schema / data schema 不动
- ✅ ChapterBranchTree.vue / ReviewingPanel.vue 主体逻辑 不动(只改 2 行 import + 组件名 + event 名称)
- ✅ 4 composable(useChapterX / useDraftX / usePromptX)0 改动
- ✅ UI 行为 / 视觉效果 / 交互流程不变
- ✅ cytoscape null bug 修复保留

## 14. 与既有 spec / memory 关系

- 路线图 spec `docs/superpowers/specs/2026-06-18-decoupling-roadmap-design.md` 第 263-291 行已定 Phase 5 目标,本次 spec 是其实施细化
- 用户决策 `memory/planned-graph-split.md`: "display(GraphView 只读) + editable(EditableGraph)" + "cytoscape 实例生命周期共享 + onBeforeUnmount 清理 + node/edge 数据格式 + layout 算法"
- 不破 ISSUES.md 库选型守门
- 不破 AGENTS.md / CLAUDE.md 既有约定

---

## Self-Review

### 1. Placeholder scan

全文 grep "TBD / TODO / 待定 / 暂时 / 之后再说 / 待讨论":
- ✅ 无 hit(每个 props / emits / 函数名 / 行号 / 文件路径都已落)

### 2. Internal consistency

- §3 hook 接口 ↔ §4 GraphView 调用 ↔ §5 EditableGraph 调用:参数 / 返回一致 ✓
- §6 Graph.vue view shell ↔ §4 GraphView 自治:Graph.vue 不持有 state ✓
- §7 ReviewingPanel.vue 嵌入更新 ↔ §5 EditableGraph props/emits:接口一致 ✓
- §9 cytoscape null bug ↔ §3.2 hook destroy():行为保留 ✓
- §11 验收 ↔ §10 commit 步骤:5 文件一致 ✓

### 3. Scope check

单 phase 范围:1 commit / 5 文件(3 new + 2 改写)/ 0 测试改动 / 0 API 改动。范围聚焦,可被单个 implementation task 拆解。

### 4. Ambiguity check

- "约 / 大约 / 预计"等模糊词扫一遍:
  - §2 "预计行数"已加 ~前缀,review 时按 ±20% 浮动合理
- "至少 1 个" / "不少于 N 个":无
- 可能二义解读:
  - "GraphView 不持有 props" — §4.1 明确
  - "EditableGraph 不接受 draftMode prop" — §5.1 + §7 明确
  - "normalizeGraph 导出位置" — §3.3 明确
  - "GraphView 保留添加节点按钮" — §4.7 明确
  - "event 名称改名" — §7 明确

无歧义。

### 5. 与 P4 spec 一致性

- P4 已建立"view shell + 子组件 + props 下传 + emit 回传 + 共享 composable"模式
- P5 沿用同样的模式 + 新增"共享 hook"抽象层,一致性 ✓
- 命名约定 kebab-case in template / camelCase in script 一致