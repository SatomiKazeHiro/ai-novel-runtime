# Phase 5: Graph.vue 拆 display + editable — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 `docs/superpowers/specs/2026-06-18-p5-graph-display-editable-split.md` 把 Graph.vue(793 行)拆为 view shell(< 100)+ GraphView + EditableGraph + 共享 `useCytoscapeLifecycle` hook,1 个 atomic commit。

**Architecture:** "共享 hook + 双组件 + view shell" 三层。`useCytoscapeLifecycle` 抽 cytoscape 实例生命周期 + normalizeGraph + elements/style/layout + tap 回调 + onBeforeUnmount 清理,GraphView 与 EditableGraph 各自调用 hook 获得 display / editable 语义。Graph.vue 重写为 view shell(< 100 行),只 import + 使用 `<GraphView>`。ReviewingPanel.vue:138 的 `<graph>` 嵌入改为 `<EditableGraph>`。

**Tech Stack:** Vue 3 `<script setup>` + cytoscape(已装) + Naive UI(已装)。0 新库。

---

## Task 1: 写 useCytoscapeLifecycle hook + GraphView + EditableGraph + 改写 Graph.vue + 改 ReviewingPanel.vue (1 atomic commit)

**Files:**
- Create: `apps/web/src/composables/graph/useCytoscapeLifecycle.ts` (~140 行)
- Create: `apps/web/src/components/graph/GraphView.vue` (~280 行)
- Create: `apps/web/src/components/graph/EditableGraph.vue` (~290 行)
- Rewrite: `apps/web/src/views/Graph.vue` (793 → < 100 行, view shell)
- Modify: `apps/web/src/views/ReviewingPanel.vue` (line 166 import + line 139 tag 改 2 行)

**Reference**: 严格按 `docs/superpowers/specs/2026-06-18-p5-graph-display-editable-split.md` §3 hook API + §4 GraphView 接口 + §5 EditableGraph 接口 + §6 view shell 形态 + §7 ReviewingPanel 嵌入更新 实施。每个子组件/hook 的源代码从现有 `apps/web/src/views/Graph.vue` 行号段复制(见 spec §4.4-§4.5 / §5.4 / §5.6 path mapping)。

---

### Step 1: 写 useCytoscapeLifecycle.ts

**输入参考**: spec §3 hook API(签名 + 契约 + normalizeGraph 导出) + 原 Graph.vue line 262-268(destroyCytoscape) + line 296-435(initCytoscape) + line 480-492(TYPE_NORMALIZE_MAP) + line 498-519(normalizeGraph)。

**实施要点**:
- `<script setup lang="ts">` 已不适用(纯 TS composable 文件,无 `<template>`)
- export 接口:`GraphNode` / `GraphEdge` / `GraphData` / `CytoscapeLifecycleOptions` / `CytoscapeLifecycle` / `useCytoscapeLifecycle`(全部按 spec §3.1 签名)
- export 工具:`TYPE_NORMALIZE_MAP` / `normalizeType` / `normalizeGraph`(spec §3.3)
- `useCytoscapeLifecycle` 内部:
  - `let cy: cytoscape.Core | null = null`(闭包内,实例化仅一次)
  - `function init()`(spec §3.2 契约):
    - 守卫: `!cyContainer.value || !getDisplayData()` → return
    - 先 `destroy()`(4def263 修复点统一)
    - 守卫: `getDisplayData().nodes.length === 0` → return
    - 调 `getNewIds?.()` 计算 newIds(draft 模式无回调,默认空 Set)
    - 构造 elements + style + layout(从原 Graph.vue line 308-396 直接复制,逻辑不变)
    - 注册 tap 监听器(spec §3.2):
      - `'tap', 'node'`: `onNodeTap?.(...)`,从 `evt.target` 提取 id/label/key/type
      - `'tap', 'edge'`: `onEdgeTap?.(...)`,从 `evt.target` 提取 id/source/target/relation(relation = data('label'))
      - `'tap'`: `evt.target === cy` 时 `onBackgroundTap?.()`
  - `function destroy()`(spec §3.2 严格按 4def263 修复路径):
    - `if (cy) { cy.removeAllListeners(); cy.destroy(); cy = null }`
  - `function resetLayout()`:
    - `if (cy) { cy.layout({ name: 'cose', ... }).run() }`(layout 配置从原 line 380-395 复制)
  - `function getInstance() { return cy }`
  - **hook 内部 `onBeforeUnmount(destroy)`** — 不需要外部手动管理
- import cytoscape 与 type
- **normalizeGraph 行为**:line 498-519 现有逻辑,过滤无 type 节点 / 收敛 type / 过滤 source/target 不存在的边,无变更

**验证**: Read 完整文件,确认 export 命名、init/destroy/resetLayout/getInstance 4 方法、`onBeforeUnmount` hook 内注册、cytoscape 4def263 修复点保留。

### Step 2: 写 GraphView.vue (display)

**输入参考**: spec §4 GraphView 接口 + 原 Graph.vue line 1-143(template 全部)+ line 145-786(除 editable 相关)。

**实施要点**:
- `<script setup lang="ts">` + 无 props + `const route = useRoute()`(从 `vue-router`)
- state(refs): `chapters` / `selectedChapterId` / `viewMode: 'snapshot' | 'delta'` / `currentSnapshot` / `currentDelta` / `prevSnapshot` / `cyContainer`(原 line 156-176 现有,不含 draft 相关 ref)
- computed:
  - `effectiveStoryId = computed(() => route.params.storyId as string || '')`(原 line 174,无 props 版)
  - `displayGraphData = computed(() => viewMode === 'delta' ? currentDelta : currentSnapshot)`(原 line ~221)
  - `diffStats = computed(...)`(原 line 233-251,新增节点/边统计)
- hook 调用(spec §4.4):
  ```ts
  const cytoscape = useCytoscapeLifecycle({
    containerRef: cyContainer,
    getDisplayData: () => displayGraphData.value,
    getNewIds: () => {
      if (viewMode.value !== 'snapshot' || !currentSnapshot.value || !prevSnapshot.value) {
        return { newNodes: new Set(), newEdges: new Set() }
      }
      return computeNewIds()  // 原 line 270-294 逻辑
    }
    // 不传 tap callback(只读)
  })
  ```
- functions(全部从原 Graph.vue line 458-619 复制,去掉 isDraftMode 分支):
  - `loadChapters` (line 458-473)
  - `selectChapter` (line 475-478)
  - `loadChapterGraph` (line 544-589)
  - `loadPrevSnapshot` (line 591-609)
  - `handleCreateNode` API 分支(line 632-639,无 draft 分支)
  - `getNodeColor` (line ~270-294 附近)
  - `resetLayout() { cytoscape.resetLayout() }`(委托)
- lifecycle:
  - `watch(() => route.params.storyId, loadChapters)`
  - `watch(viewMode, () => nextTick(() => cytoscape.init()))`
  - `onMounted(() => { if (route.params.storyId) loadChapters() })`
- template:复制原 Graph.vue line 1-143 全部
  - 顶部按钮组(line 4-10):章节选择器 + 视图切换 + 重置布局 + 添加节点(line 9 保留)
  - 图例(line 60-73)
  - cytoscape 画布(line 76) + empty(line 78)
  - **添加节点 modal (line 81-141 的 showNodeModal 部分)保留** — display 模式可创建节点(API),但不显示编辑/删除节点 modal、添加关系 modal(这些只 EditableGraph 用)
- imports: `ref, computed, watch, onMounted, nextTick` from 'vue'; `useRoute` from 'vue-router'; cytoscape from 'cytoscape'; `NH1, NSpace, NButton, NSelect, NModal, NForm, NFormItem, NInput, NCard, NText, NTag` from naive-ui; `useCytoscapeLifecycle, normalizeGraph, type GraphData` from `'@/composables/graph/useCytoscapeLifecycle'`; `graphApi` from `'@/api/graph'`

**验证**: Read 完整文件,确认不传 tap callback、确认 showEditNodeModal / showEdgeModal 不在 template 中、确认 handleCreateNode 只走 API 分支。

### Step 3: 写 EditableGraph.vue (editable)

**输入参考**: spec §5 EditableGraph 接口 + 原 Graph.vue draft 分支(原 line 521-542 / 611-629 / 642-648 / 650-674 / 690-699 / 701-741 / 743-767)+ 原 Graph.vue template line 81-141(3 modal 全部)。

**实施要点**:
- `<script setup lang="ts">` + props(spec §5.1):
  ```ts
  const props = defineProps<{ initialGraphData?: GraphData | null }>()
  const emit = defineEmits<{ 'update:graphData': [data: GraphData] }>()
  ```
- state(refs): `draftGraphData` / `showNodeModal` / `showEdgeModal` / `showEditNodeModal` / `selectedNode` / `selectedEdge` / `nodeForm` / `edgeForm` / `editNodeForm` / `cyContainer`(原 Graph.vue line 158-160 / 178-200 现有)
- hook 调用(spec §5.3):
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
- functions(全部从原 Graph.vue 复制 draft 分支,无 isDraftMode 守卫):
  - `loadDraftGraph(raw?: GraphData | null)` (原 line 521-542,加 normalizeGraph)
  - `handleCreateNode` draft 分支 (原 line 611-629,emit `update:graphData` + initCytoscape)
  - `cancelEdge` (原 line 642-648)
  - `handleCreateEdge` draft 分支 (原 line 650-674)
  - `openEditNode` (原 line 690-699)
  - `handleUpdateNode` (原 line 701-741)
  - `handleDelete` (原 line 743-767)
  - `resetLayout() { cytoscape.resetLayout() }`
- lifecycle:
  - `watch(() => props.initialGraphData, (val) => { loadDraftGraph(val); nextTick(() => cytoscape.init()) }, { immediate: true, deep: true })`
- template(原 Graph.vue template line 4-11 + line 76 + line 78 + **line 81-141 全部 3 个 modal**):
  - 顶部按钮组:本章图谱 + 编辑节点 + 删除选中 + 重新布局 + 添加节点(spec §5.6)
  - cytoscape 画布 + empty
  - 3 modal:showNodeModal(添加节点) / showEditNodeModal(编辑节点) / showEdgeModal(添加关系)
- **不要**:不接受 `draftMode` prop(组件本身就是 editable 语义)
- imports: `ref, watch, nextTick` from 'vue'; cytoscape from 'cytoscape'; naive-ui 同 GraphView 但不加 `useRoute`; `useCytoscapeLifecycle, normalizeGraph, type GraphData` from `'@/composables/graph/useCytoscapeLifecycle'`

**验证**: Read 完整文件,确认 props/emits 与 spec §5.1 一致,确认 handleCreateNode/handleCreateEdge/handleUpdateNode/handleDelete 只走 draft 分支,确认 3 modal 全部存在。

### Step 4: 改写 Graph.vue 为 view shell

**输入参考**: spec §6 view shell 形态。

**实施要点**:
- 模板只 1 个子组件:
  ```vue
  <template>
    <GraphView />
  </template>
  ```
- script:
  ```ts
  <script setup lang="ts">
  import GraphView from '../components/graph/GraphView.vue'
  </script>
  ```
- 不持有任何 state,不调 composable,不调 API

**验证**: `wc -l apps/web/src/views/Graph.vue` < 100。

### Step 5: 改 ReviewingPanel.vue 2 行

**输入参考**: spec §7 嵌入更新。

**实施要点**:
- **Line 166**(import):`import Graph from './Graph.vue'` → `import EditableGraph from '../components/graph/EditableGraph.vue'`
- **Line 139**(template tag):`<graph :initial-graph-data="graphData" :draft-mode="true" @update:graph-data="onGraphUpdate" />` → `<EditableGraph :initial-graph-data="graphData" @update:graphData="onGraphUpdate" />`
- **注意**:
  - 移除 `:draft-mode="true"` prop(EditableGraph 不接受)
  - event 名称 `@update:graph-data` → `@update:graphData`(camelCase,Vue 自动转换 kebab ↔ camel)
  - 组件标签 `<graph>` (小写 Vue 解析) → `<EditableGraph>` (PascalCase 显式,因 import 默认导出的 component 名是 EditableGraph)

**验证**: `git diff apps/web/src/views/ReviewingPanel.vue` 应只有 line 139 + line 166 两行 diff。

### Step 6: typecheck + build 验证

```bash
cd "D:/MGit-Projects/ai-novel-runtime" && pnpm typecheck 2>&1 | tail -30
```
**期望**: 8/8 Done,0 errors。

```bash
cd "D:/MGit-Projects/ai-novel-runtime" && pnpm --filter web typecheck 2>&1 | tail -10
```
**期望**: Done,0 errors(vue-tsc 比 tsc 严格,捕获 SFC type 错误)。

```bash
cd "D:/MGit-Projects/ai-novel-runtime" && pnpm --filter web build 2>&1 | tail -20
```
**期望**: vite build success,0 errors。

**如 typecheck 报错**: 按错误位置修复(常见: hook 类型不匹配 / prop type 错 / import 缺失)。重新跑直到全绿。

**如 build 报错**: 通常是 import path 错误(检查 `@/` alias 或相对路径 `./graph/...`)。修复后重跑。

### Step 7: 验收 grep 检查

```bash
cd "D:/MGit-Projects/ai-novel-runtime"
wc -l apps/web/src/views/Graph.vue \
      apps/web/src/components/graph/GraphView.vue \
      apps/web/src/components/graph/EditableGraph.vue \
      apps/web/src/composables/graph/useCytoscapeLifecycle.ts
```
**期望**:
- Graph.vue: < 100
- GraphView.vue: < 320
- EditableGraph.vue: < 320
- useCytoscapeLifecycle.ts: < 160

```bash
grep -l "useChapterTree\|useChapterEditor\|useDraftManager\|usePromptManager" \
  apps/web/src/components/graph/*.vue \
  apps/web/src/composables/graph/*.ts \
  apps/web/src/views/Graph.vue
```
**期望**: 无输出(P5 不调用 chapter 相关 composable)。

```bash
grep -l "removeAllListeners" apps/web/src/composables/graph/useCytoscapeLifecycle.ts
```
**期望**: 1 hit(cytoscape null bug 4def263 修复保留)。

```bash
git diff 2a0ca1a..HEAD -- apps/web/src/composables/use*.ts apps/web/src/api/graph.ts apps/web/src/api/chapters.ts apps/web/src/components/ChapterBranchTree.vue
```
**期望**: 无 diff(P5 不动 chapter composable / API / ChapterBranchTree)。

```bash
git status
```
**期望**: 5 个文件改动(3 new + 2 modified),scope 干净。

### Step 8: commit

```bash
cd "D:/MGit-Projects/ai-novel-runtime"
git add apps/web/src/composables/graph/useCytoscapeLifecycle.ts \
        apps/web/src/components/graph/GraphView.vue \
        apps/web/src/components/graph/EditableGraph.vue \
        apps/web/src/views/Graph.vue \
        apps/web/src/views/ReviewingPanel.vue
git status
git commit -m "$(cat <<'EOF'
refactor(web): split Graph.vue into GraphView + EditableGraph + cytoscape hook (P5)

按 docs/superpowers/specs/2026-06-18-p5-graph-display-editable-split.md 拆分:
- useCytoscapeLifecycle.ts: 共享 cytoscape 实例 + normalizeGraph + elements/style/layout + tap callback + onBeforeUnmount 清理
- GraphView.vue: /graph/:storyId 路由只读视图(API 加载 + 章节选择 + 视图切换 + diff 高亮 + resetLayout)
- EditableGraph.vue: ReviewingPanel 嵌入的草稿编辑视图(draftGraphData + add/edit/delete node/edge + emit update:graphData)
- Graph.vue: view shell (< 100 行), 仅 import + 使用 GraphView
- ReviewingPanel.vue: 2 行改动(import 替换 + component name + event name)

view shell 不持有 state,所有状态由 GraphView / EditableGraph 自治。
hook 内部统一 cytoscape 4def263 null bug 修复路径(removeAllListeners 在 destroy 前)。
composable / API / ChapterBranchTree 0 改动,UI 行为 100% byte-equivalent。

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
git log --oneline -1
```
**期望**: 1 个 commit, message 清晰。

---

## 验证总览

| 项 | 期望 | 验证命令 |
|---|---|---|
| `pnpm typecheck` | 8/8 Done | Step 6 |
| `pnpm --filter web build` | 0 errors | Step 6 |
| `wc -l Graph.vue` | < 100 | Step 7 |
| `wc -l GraphView.vue / EditableGraph.vue` | 每个 < 320 | Step 7 |
| `wc -l useCytoscapeLifecycle.ts` | < 160 | Step 7 |
| `removeAllListeners` in hook | 1 hit | Step 7 |
| chapter composable 不被 graph 组件调用 | 0 hit | Step 7 |
| composable / API / ChapterBranchTree 0 改动 | 0 diff | Step 7 |
| git status | 5 文件改动 | Step 7 |
| 1 commit | new HEAD | Step 8 |

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| hook tap callback 闭包陷阱(stale closure)| callback 内部直接访问 ref(`onNodeTap: (node) => { selectedNode.value = ... }`),不用闭包变量捕获 |
| normalizeGraph 在 GraphView / EditableGraph 各调一次 | normalizeGraph 是 pure function,导出后行为固定;code review 抽看调用方 |
| EditableGraph 初次 mount 时 cyContainer ref 未挂载 | `watch initialGraphData` + `nextTick(cytoscape.init)`,init 内部守卫 |
| cytoscape null bug 漏掉 | Step 7 grep `removeAllListeners` 强制检查 1 hit |
| event 名称 `@update:graph-data` → `@update:graphData` 改名 | Vue 自动 kebab ↔ camel 转换;实施时严格用 camelCase emit |
| ReviewingPanel.vue 中 Graph dead import | Step 5 import 替换后无 dead import |
| hook 内部 onBeforeUnmount 与组件 unmount 时机冲突 | destroy 内部 cy 非空检查,多次调用安全 |

## 不动的事

- 4 个 chapter composable(`useChapterTree` / `useChapterEditor` / `useDraftManager` / `usePromptManager`)0 改动
- `ChapterBranchTree.vue` 0 改动
- `api/graph.ts` / `api/chapters.ts` 0 改动
- prisma schema / data schema 不动
- 0 新库
- UI 行为 / 视觉效果 / 交互流程不变
- cytoscape null bug 4def263 修复保留

---

## Self-Review

1. **Spec coverage**: spec §3 hook API / §4 GraphView / §5 EditableGraph / §6 view shell / §7 ReviewingPanel 嵌入更新 / §8 守门 / §9 cytoscape null bug / §10 commit / §11 验收 — Plan 全部覆盖 ✓
2. **Placeholder scan**: 无 "TBD / TODO / 临时" 模糊词 ✓
3. **Type consistency**: Step 1-5 接口命名与 spec §3-§7 一字一致 ✓
4. **Scope check**: 单 phase 1 commit / 5 文件改动 / 0 测试改动 / 0 API 改动,聚焦 ✓
5. **Ambiguity check**: Step 1-5 实施要点具体到 import / 行号 / 函数体,无歧义 ✓