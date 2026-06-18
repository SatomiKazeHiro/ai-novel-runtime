# Phase 4: Chapters.vue 按职责拆 view + 4 子组件

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `apps/web/src/views/Chapters.vue`(1169 行)按职责拆为 view shell(< 200 行)+ 4 子组件(每个 < 380 行),API / composable / UI 行为 100% 不变。

**Architecture:** 用"view shell 协调 + 子组件自治"两层结构。view shell 持有 4 个 composable 实例,通过 props 把 state 下传给子组件,子组件通过 emit 把交互回传。4 子组件粒度对齐 template 实际分块(树视图 / 编辑子页 / Prompt 面板 / 候选列表)。ReviewingPanel 保持独立文件。ChapterBranchTree(已独立,emit 风格)直接复用,不动。

**Tech Stack:** Vue 3 Composition API + `<script setup>` + Naive UI(已装)。0 新库。

---

## 1. 目标

承袭 `docs/superpowers/specs/2026-06-18-decoupling-roadmap-design.md` Phase 4(2026-06-18 路线图)第 233-261 行。本次实施细化为:

- **行数**:Chapters.vue 1169 行 → 1 view shell(< 200)+ 4 子组件(各 < 380)
- **文件数**:净增 4 个(4 子组件)+ 1 改写(Chapters.vue 变 view shell)
- **行为**:UI 行为 / 视觉效果 / 交互流程 100% 不变
- **composables**:4 个 composable(`useChapterTree` / `useChapterEditor` / `useDraftManager` / `usePromptManager`)**0 改动**
- **ChapterBranchTree.vue** (480 行):独立组件,emit select/develop/edit/view/delete,**直接复用不重写**
- **ReviewingPanel.vue**:独立组件,**0 改动**
- **API**:无 API 改动,无新增 endpoint

## 2. 文件改动清单

| 文件 | 状态 | 职责 | 预计行数 |
|---|---|---|---|
| `apps/web/src/views/Chapters.vue` | **改写** | view shell(mode 切换 + 子组件嵌入 + 跨 composable 协调 + 生命周期) | < 200 |
| `apps/web/src/views/chapters/ChapterTree.vue` | 新建 | 分支树视图 + createRoot modal + develop modal | ~150 |
| `apps/web/src/views/chapters/ChapterEditor.vue` | 新建 | 顶部导航 + Step 1 配置 + Step 4 图谱 + ReviewingPanel 嵌入 + reviewing 重试入口 | ~310 |
| `apps/web/src/views/chapters/ChapterPreview.vue` | 新建 | Step 2 Prompt 面板 + token 预算 + 复制按钮 | ~110 |
| `apps/web/src/views/chapters/DraftList.vue` | 新建 | Step 3 候选 tabs + customModal + scoreModal | ~360 |
| `apps/web/src/views/ReviewingPanel.vue` | **不动** | 已独立,直接嵌入 | 0 |
| `apps/web/src/components/ChapterBranchTree.vue` | **不动** | 已独立,emit 风格,ChapterTree 内嵌入 | 0 |
| `apps/web/src/composables/*.ts` | **不动** | 4 个 composable 0 改动 | 0 |

注:PlanTask #59 已完成 P4 4 子组件拆分的"移到 view shell"准备工作(view shell 的 `v-if editMode` 切分已经在 Chapters.vue 现有代码 line 4 / 41 体现),本次仅是把 template 内容按职责搬到子组件,不动切分逻辑。

## 3. 子组件 props / emits 接口

### 3.1 `ChapterTree.vue`

**职责**:tree 模式下渲染分支树 + 创建/发展章节的 2 个 modal。

```ts
defineProps<{
  treeData: any[]                          // 来自 tree.chapterTree
  loading: boolean                         // 来自 tree.loading
  selectedId: string                       // 来自 tree.selectedChapterId
  showCreateModal: boolean                 // 来自 tree.showCreateModal
  createForm: { title: string; outline: string; isSideStory: boolean }  // 来自 tree.createForm
  showDevelopModal: boolean                // 来自 tree.showDevelopModal
  developForm: { title: string; outline: string; isSideStory: boolean }  // 来自 tree.developForm
  developForceSideStory: boolean           // 来自 tree.developForceSideStory
}>()

defineEmits<{
  (e: 'select', node: any): void           // → tree.onNodeSelect
  (e: 'develop', node: any): void          // → tree.onDevelop
  (e: 'edit', node: any): void             // → handleOpenEdit (view shell)
  (e: 'view', node: any): void             // → handleOpenView (view shell)
  (e: 'delete', node: any): void           // → tree.onDelete
  (e: 'open-create-root'): void            // → tree.openCreateRoot
  (e: 'create-root'): void                 // → handleCreateRoot (view shell)
  (e: 'create-develop'): void              // → handleDevelop (view shell)
  (e: 'close-create-modal'): void          // → tree.showCreateModal = false
  (e: 'close-develop-modal'): void         // → tree.showDevelopModal = false
}>()
```

**内部**:嵌入 `<ChapterBranchTree>`(复用现有组件)+ 2 个 `<n-modal>`(createRoot / develop)。

**说明**:develop modal 包含 `developForceSideStory` 锁定逻辑(line 680-691),与 `onDevelop(node)` 在 view shell 触发后 `tree.showDevelopModal = true` 一致。

### 3.2 `ChapterEditor.vue`

**职责**:edit 模式下渲染顶部导航 + Step 1 配置 + Step 4 图谱 + ReviewingPanel 嵌入 + reviewing 重试入口。Step 2 / Step 3 通过嵌入 `<ChapterPreview>` / `<DraftList>`。

```ts
defineProps<{
  chapter: any                             // editor.currentChapter
  editTitle: string                        // editor.editTitle
  editForm: { outline: string; content: string; sceneLocation: string; sceneMood: string; sceneGoal: string }
  selectedProfileId: string | null         // editor.selectedProfileId
  profileOptions: any[]                    // editor.profileOptions
  selectedModelId: string | null           // editor.selectedModelId
  modelOptions: any[]                      // editor.modelOptions
  plotArcs: any[]                          // editor.plotArcs
  graphDelta: any                          // editor.graphDelta
  pendingArchiveData: any                  // editor.pendingArchiveData
  savingContent: boolean                   // editor.savingContent
  isReadonly: boolean                      // editor.currentChapter?.status === 'archived'
  archiving: boolean                       // view shell 局部 ref
  repreparingArchive: boolean              // view shell 局部 ref
  prompt: any                              // 完整 prompt 实例 (usePromptManager reactive),传给 ChapterPreview
  drafts: any                              // 完整 drafts 实例 (useDraftManager reactive),传给 DraftList
}>()

defineEmits<{
  (e: 'back'): void                        // → handleBackToTree
  (e: 'save-config'): void                 // → debouncedSaveConfig
  (e: 'save-content'): void                // → editor.saveContent
  (e: 'generate-prompt'): void             // → handleGeneratePrompt
  (e: 'generate-default'): void            // → handleGenerateDefault
  (e: 'generate-custom'): void             // → handleGenerateCustom
  (e: 'adopt-draft', draft: any): void     // → handleAdoptDraft
  (e: 'prepare-archive'): void             // → handlePrepareArchive
  (e: 'save-pending-archive', data: any): void   // → handleSavePendingArchiveData
  (e: 'confirm-archive', data: any): void        // → handleConfirmArchive
  (e: 'reprepare-archive'): void           // → handleReprepareArchive
  (e: 'cancel-reviewing'): void            // → handleCancelReviewing
}>()
```

**内部**:
- 顶部导航(line 43-68 现有):返回按钮 + title input + isSideStory tag + status tag + readonly tag
- Step 1 配置(line 71-238 现有):profile select + model select + plotArcs 卡片网格 + outline textarea + scene 3 输入 + 保存配置按钮
- `<ChapterPreview>` 嵌入(Step 2)
- `<DraftList>` 嵌入(Step 3 左)+ 右侧正文编辑(line 482-498 现有)
- `<ReviewingPanel>` 嵌入(Step 3.5)
- reviewing 但无数据(line 514-538 现有):reprepareArchive + cancelReviewing 按钮
- Step 3 只读(line 541-559 现有):isReadonly 时显示 textarea readonly
- Step 4 本章范围图谱(line 562-613 现有):graphDelta nodes + edges

**reviewingPanelRef**: 保持在 ChapterEditor 内部(`ref<InstanceType<typeof ReviewingPanel> | null>`)。`handleConfirmArchive` 由 view shell 处理时,view shell 不知道 reviewingPanelRef,所以改为:**emit('confirm-archive', data) 到 view shell 之前,ChapterEditor 内部先调 `reviewingPanelRef.value?.startConfirm()`**,把"启动 spinner"步骤留在子组件,事务性 confirm 步骤在 view shell。

**修正方案**:confirm 流程拆为 2 步:
1. 子组件 emit 'confirm-archive'(含 data)+ 同时调 startConfirm
2. view shell 处理:savePendingArchiveData → archiveChapter → stopConfirm

但这要求子组件在 emit 之前 startConfirm,emit 之后 view shell 调 stopConfirm。这会让"启动 spinner"的视觉延迟。

**简化方案**:view shell 直接 `chapterEditorRef.value?.reviewingPanelRef.value?.startConfirm()`,然后调用 emit 后的事务逻辑,最后 stopConfirm。但这样 view shell 又要暴露 chapterEditorRef 引用。

**最简方案**:让 view shell 自己持有 reviewingPanelRef,但要求它在 view shell 渲染 ReviewingPanel,而不是 ChapterEditor 嵌入。但这破坏了"Step 3.5 在 ChapterEditor 内"的布局。

**最终方案**:**view shell 通过 `:ref` 引用 ChapterEditor,然后调用 `chapterEditorRef.value?.startConfirm()` / `stopConfirm()`**。ChapterEditor 暴露这两个方法(`defineExpose`)。

```ts
// ChapterEditor.vue
const reviewingPanelRef = ref<InstanceType<typeof ReviewingPanel> | null>(null)
function startConfirm() { reviewingPanelRef.value?.startConfirm() }
function stopConfirm() { reviewingPanelRef.value?.stopConfirm() }
defineExpose({ startConfirm, stopConfirm })

// Chapters.vue
const chapterEditorRef = ref<InstanceType<typeof ChapterEditor> | null>(null)

async function handleConfirmArchive(data: any) {
  chapterEditorRef.value?.startConfirm()
  try {
    const saveResult = await editor.savePendingArchiveData(data)
    if (!saveResult.success) return
    const result = await editor.archiveChapter()
    if (result.success) await handleBackToTree()
  } finally {
    chapterEditorRef.value?.stopConfirm()
  }
}
```

### 3.3 `ChapterPreview.vue`

**职责**:Step 2 Prompt 面板(独立子组件,嵌入 ChapterEditor)。

```ts
defineProps<{
  prompt: any                              // usePromptManager 实例 (reactive)
}>()

defineEmits<{
  (e: 'generate-prompt'): void             // → handleGeneratePrompt
}>()
```

**内部**:
- Prompt textarea (line 246-254 现有,`prompt.editablePrompt`)
- 生成 / 复制按钮 (line 256-268)
- Token 预算卡片 + 进度条 (line 270-338)

### 3.4 `DraftList.vue`

**职责**:Step 3 候选 tabs + customModal + scoreModal。

```ts
defineProps<{
  drafts: any                              // useDraftManager 实例
  chapter: any                             // editor.currentChapter
  prompt: any                              // usePromptManager 实例,for formatCompiledPrompt
}>()

defineEmits<{
  (e: 'generate-default'): void            // → handleGenerateDefault
  (e: 'generate-custom'): void             // → handleGenerateCustom
  (e: 'adopt-draft', draft: any): void     // → handleAdoptDraft
}>()
```

**内部**:
- 顶部按钮 (line 350-370 现有):默认 / 自定义 / loading text
- 候选摘要 (line 372-384)
- 候选 tabs (line 387-467):每个 draft 含 content/prompt/params 3 sub-tab + 采用/评分/删除按钮
- 空状态 (line 470-478)
- customModal (line 715-754 现有):temperature slider + maxTokens input
- scoreModal (line 756-815 现有):totalScore + 7 维度 progress + comment

**说明**:scoreLabels / formatParams 函数搬到这里(原 Chapters.vue line 1112-1128)。

### 3.5 `Chapters.vue` (view shell)

**职责**:mode 切换 + 4 子组件嵌入 + composable 装配 + 跨 composable 协调 + 生命周期。

**模板结构**(估计 ~100 行):
```vue
<template>
  <ChapterTree
    v-if="!editor.editMode"
    :tree-data="tree.chapterTree"
    :loading="tree.loading"
    :selected-id="tree.selectedChapterId"
    :show-create-modal="tree.showCreateModal"
    :create-form="tree.createForm"
    :show-develop-modal="tree.showDevelopModal"
    :develop-form="tree.developForm"
    :develop-force-side-story="tree.developForceSideStory"
    @select="tree.onNodeSelect"
    @develop="tree.onDevelop"
    @edit="handleOpenEdit"
    @view="handleOpenView"
    @delete="tree.onDelete"
    @open-create-root="tree.openCreateRoot"
    @create-root="handleCreateRoot"
    @create-develop="handleDevelop"
    @close-create-modal="tree.showCreateModal = false"
    @close-develop-modal="tree.showDevelopModal = false"
  />
  <ChapterEditor
    v-else
    ref="chapterEditorRef"
    :chapter="editor.currentChapter"
    :edit-title="editor.editTitle"
    :edit-form="editor.editForm"
    :selected-profile-id="editor.selectedProfileId"
    :profile-options="editor.profileOptions"
    :selected-model-id="editor.selectedModelId"
    :model-options="editor.modelOptions"
    :plot-arcs="editor.plotArcs"
    :graph-delta="editor.graphDelta"
    :pending-archive-data="editor.pendingArchiveData"
    :saving-content="editor.savingContent"
    :is-readonly="isReadonly"
    :archiving="archiving"
    :repreparing-archive="repreparingArchive"
    :prompt="prompt"
    :drafts="drafts"
    @back="handleBackToTree"
    @save-config="debouncedSaveConfig"
    @save-content="editor.saveContent"
    @generate-prompt="handleGeneratePrompt"
    @generate-default="handleGenerateDefault"
    @generate-custom="handleGenerateCustom"
    @adopt-draft="handleAdoptDraft"
    @prepare-archive="handlePrepareArchive"
    @save-pending-archive="handleSavePendingArchiveData"
    @confirm-archive="handleConfirmArchive"
    @reprepare-archive="handleReprepareArchive"
    @cancel-reviewing="handleCancelReviewing"
  />
</template>
```

**script setup**(估计 ~120 行):
- 4 个 composable 实例 (line 868-872 现有)
- `debouncedSaveConfig` (line 875 现有)
- `archiving` / `repreparingArchive` / `isReadonly` 局部 ref (line 878-884 现有,但 `reviewingPanelRef` 移除)
- `chapterEditorRef` (新增,用于 confirm 流程)
- onMounted (line 887-892 现有)
- watch route.params.storyId (line 894-900 现有)
- 协调函数(从 Chapters.vue 现有 script 搬过来,但移除 handleCancelReviewing / handlePrepareArchive 等已搬到子组件的):
  - handleOpenEdit / handleOpenView / handleBackToTree
  - handleCreateRoot / handleDevelop
  - handleGeneratePrompt / handleGenerateDefault / handleGenerateCustom
  - handleAdoptDraft
  - handlePrepareArchive / handleSavePendingArchiveData / handleConfirmArchive / handleReprepareArchive / handleCancelReviewing
- 移除:scoreLabels / formatParams / statusTagType / arcStatusType(搬到对应子组件)

## 4. composable 装配策略

view shell 持有 4 个 composable 实例(`tree` / `editor` / `drafts` / `prompt`),所有 reactive state 通过 props 下传给子组件。子组件 emit 交互事件回 view shell,view shell 协调多个 composable。

**响应性保留**:
- composable 返回 `reactive({...})`,作为 prop 整体传给子组件
- 子组件 `props.prompt.editablePrompt` 在 setup 内访问需要 `props.prompt.editablePrompt`,但 template 自动解包
- 跨组件响应性:Vue 3 `<script setup>` 中 `defineProps` 的 prop 默认是 reactive,嵌套 reactive 自动追踪

**禁止在子组件内调用 composable**:子组件不调用 `useChapterTree()` 等。否则会创建独立实例,状态不同步。

## 5. handle 函数归属决策

| 函数 | 归属 | 理由 |
|---|---|---|
| `handleOpenEdit` | view shell | 跨 editor + drafts + prompt 协调 |
| `handleOpenView` | view shell | 跨 editor + prompt.reset |
| `handleBackToTree` | view shell | 跨 drafts + prompt + editor + tree 4 个 |
| `handleCreateRoot` | view shell | 跨 tree.handleCreateRoot + handleOpenEdit |
| `handleDevelop` | view shell | 跨 tree.handleDevelop + handleOpenEdit |
| `handleGeneratePrompt` | view shell | 跨 editor + prompt.generatePreview |
| `handleGenerateDefault` | view shell | 跨 dialog 确认对话框 + drafts.generate + prompt stats |
| `handleGenerateCustom` | view shell | 跨 drafts.generate + drafts.showCustomModal |
| `handleAdoptDraft` | view shell | 跨 drafts.selectDraft + editor.currentChapter 状态更新 + dialog 确认覆盖 |
| `handlePrepareArchive` | view shell | 跨 dialog 校验 + editor.saveContent + editor.prepareArchive + archiving ref |
| `handleSavePendingArchiveData` | view shell | editor.savePendingArchiveData 直接调用(单 composable,可放子组件;但保持一致放 view shell)|
| `handleConfirmArchive` | view shell | 跨 chapterEditorRef startConfirm + editor.savePendingArchiveData + editor.archiveChapter + chapterEditorRef stopConfirm |
| `handleReprepareArchive` | view shell | 跨 repreparingArchive ref + editor.prepareArchive |
| `handleCancelReviewing` | view shell | 跨 dialog 确认 + chaptersApi.remove + handleBackToTree |

**判定原则**:
- 单 composable 调用 → 可放子组件(但统一放 view shell 保持协调集中)
- 跨 composable / dialog / 局部 ref → 必须 view shell
- emit 出去由 view shell 协调,统一逻辑入口

## 6. 路径映射表(原 file → 新 file)

| 旧(Chapters.vue 行号) | 新归属 |
|---|---|
| template 4-38 (tree view) | chapters/ChapterTree.vue |
| template 43-68 (顶部导航) | chapters/ChapterEditor.vue |
| template 71-238 (Step 1 配置) | chapters/ChapterEditor.vue |
| template 240-339 (Step 2 Prompt) | chapters/ChapterPreview.vue |
| template 342-499 (Step 3 编辑) | chapters/ChapterEditor.vue(外壳 + 右 textarea)+ chapters/DraftList.vue(左侧候选) |
| template 503-511 (Step 3.5 审查嵌入) | chapters/ChapterEditor.vue |
| template 514-538 (reviewing 重试入口) | chapters/ChapterEditor.vue |
| template 541-559 (Step 3 只读) | chapters/ChapterEditor.vue |
| template 562-613 (Step 4 图谱) | chapters/ChapterEditor.vue |
| template 618-660 (createRoot modal) | chapters/ChapterTree.vue |
| template 663-713 (develop modal) | chapters/ChapterTree.vue |
| template 716-754 (customModal) | chapters/DraftList.vue |
| template 756-815 (scoreModal) | chapters/DraftList.vue |
| script 868-872 (composable 装配) | views/Chapters.vue(view shell) |
| script 875 (debouncedSaveConfig) | views/Chapters.vue(view shell) |
| script 878-884 (局部 ref) | views/Chapters.vue(view shell,移除 reviewingPanelRef,新增 chapterEditorRef) |
| script 887-900 (生命周期) | views/Chapters.vue(view shell) |
| script 902-1109 (handle 函数) | views/Chapters.vue(view shell,集中协调) |
| script 1112-1120 (scoreLabels) | chapters/DraftList.vue |
| script 1122-1128 (formatParams) | chapters/DraftList.vue |
| script 1130-1151 (statusTagType) | chapters/ChapterEditor.vue |
| script 1153-1166 (arcStatusType) | chapters/ChapterEditor.vue |

## 7. Chapters.vue 改写形态(view shell)

```vue
<template>
  <ChapterTree v-if="!editor.editMode" ... />
  <ChapterEditor v-else ref="chapterEditorRef" ... />
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { useRoute } from "vue-router";
import { useDebounceFn } from "@vueuse/core";
import { useDialog, useMessage } from "naive-ui";
import { chaptersApi } from "../api/chapters";
import { useChapterTree } from "../composables/useChapterTree";
import { useChapterEditor } from "../composables/useChapterEditor";
import { useDraftManager } from "../composables/useDraftManager";
import { usePromptManager } from "../composables/usePromptManager";
import ChapterTree from "./chapters/ChapterTree.vue";
import ChapterEditor from "./chapters/ChapterEditor.vue";

const route = useRoute();
const storyId = () => route.params.storyId as string | undefined;

const tree = useChapterTree(storyId);
const editor = useChapterEditor(storyId);
const drafts = useDraftManager();
const prompt = usePromptManager(storyId);

const debouncedSaveConfig = useDebounceFn(editor.saveConfig, 500);
const archiving = ref(false);
const repreparingArchive = ref(false);
const isReadonly = computed(() => editor.currentChapter?.status === 'archived');
const dialog = useDialog();
const message = useMessage();
const chapterEditorRef = ref<InstanceType<typeof ChapterEditor> | null>(null);

onMounted(() => {
  prompt.loadDefaultModel();
  editor.loadProfiles();
  editor.loadModels();
  if (route.params.storyId) tree.loadChapterTree();
});

watch(() => route.params.storyId, () => {
  handleBackToTree();
  tree.loadChapterTree();
});

// 协调函数(全部从原 Chapters.vue script 搬过来,不变更业务逻辑)
async function handleOpenEdit(row: any) { ... }
async function handleOpenView(row: any) { ... }
async function handleBackToTree() { ... }
async function handleCreateRoot() { ... }
async function handleDevelop() { ... }
async function handleGeneratePrompt() { ... }
async function handleGenerateDefault() { ... }
async function handleGenerateCustom() { ... }
async function handleAdoptDraft(draft: any) { ... }
function handlePrepareArchive() { ... }
async function handleSavePendingArchiveData(data: any) { ... }
async function handleConfirmArchive(data: any) {
  chapterEditorRef.value?.startConfirm();
  try {
    const saveResult = await editor.savePendingArchiveData(data);
    if (!saveResult.success) return;
    const result = await editor.archiveChapter();
    if (result.success) await handleBackToTree();
  } finally {
    chapterEditorRef.value?.stopConfirm();
  }
}
async function handleReprepareArchive() { ... }
function handleCancelReviewing() { ... }
</script>
```

## 8. UI 行为不变性

- 所有 `<n-*>` 组件 prop / event 名称不变
- 所有 modal open/close 触发条件不变
- 所有 button label / 提示文本不变
- 所有 size / type / disabled 条件不变
- 模板内 `<n-card title="...">` / `<n-tag type="...">` / `<n-space>` 等布局结构不变
- 章节工作台模式切换逻辑不变:`v-if="!editor.editMode"` / `v-else`

## 9. commit 步骤

```bash
# 1. 创建新章节子组件 + 改写 Chapters.vue
git add apps/web/src/views/chapters/ChapterTree.vue \
        apps/web/src/views/chapters/ChapterEditor.vue \
        apps/web/src/views/chapters/ChapterPreview.vue \
        apps/web/src/views/chapters/DraftList.vue \
        apps/web/src/views/Chapters.vue

# 2. verification gate
pnpm typecheck
pnpm --filter web typecheck
pnpm build

# 3. 单 commit
git commit -m "refactor(web): split Chapters.vue into view shell + 4 sub-components (P4)

..."
```

## 10. 验收标准

| 项 | 期望 |
|---|---|
| `pnpm typecheck` | 8/8 Done |
| `pnpm build` | 0 错误 |
| `wc -l apps/web/src/views/Chapters.vue` | < 200 |
| `wc -l apps/web/src/views/chapters/*.vue` | 每个 < 380 |
| 4 子组件文件存在 | ChapterTree / ChapterEditor / ChapterPreview / DraftList |
| ReviewingPanel.vue | 0 改动(纯引用) |
| ChapterBranchTree.vue | 0 改动 |
| 4 composable 文件 | 0 改动 |
| 模板 prop / event 命名 | 严格按本文 §3 |
| UI 行为 | 100% byte-equivalent(目视检查 tree / editor / preview / draft 4 个子页) |

## 11. 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| composable 实例在子组件内被误调用(`useChapterTree()`),状态分裂 | 中 | 跨组件状态不同步,bug 难定位 | §4 明确"禁止在子组件内调用 composable";code review 抽看;Vue DevTools 检查 |
| 子组件 prop 类型 `any` 失去类型保护 | 中 | 字段拼写错误静默失效 | 实施时在 script 内加 `// eslint-disable-next-line` 备注 + 用 JSDoc 注释 prop shape |
| `chapterEditorRef.value?.startConfirm()` 调用时机不对,spinner 不显示或卡住 | 低 | 用户体验回归 | 实施后手动测试 confirm 流程;Plan 任务包含 1 个 manual smoke check |
| 子组件内 modal `show` prop 双向绑定写法不一致 | 低 | modal 无法关闭 | 用 `:show` + `@update:show` 显式双向;code review 检查 |
| `drafts.showCustomModal` / `drafts.showScoreModal` 由 composable 内部 ref 持有,emit 'close' 后 view shell 设 false 时机不对 | 低 | modal 闪烁 | emit 'close' 后 view shell 同步设 `drafts.showCustomModal = false` |
| handleAdoptDraft 在 view shell 内同步设 `editor.editForm.content = content`,但 editor 是 reactive,跨组件 props 写回需要响应式追踪 | 低 | 编辑器 textarea 不刷新 | Vue 3 reactive 嵌套自动追踪,props.editor.editForm.content 双向绑定 template `<n-input>` 仍响应 |
| `chapterEditorRef.value?.startConfirm()` 在异步事务之前同步调用,但子组件内 ref 是 null(初始化未完成) | 低 | spinner 不显示 | 加 `?.` optional chaining + `if (!chapterEditorRef.value) return` 兜底 |

## 12. 不动的事(承袭 spec 守门)

- ✅ 0 新库(沿用 Vue 3 + Naive UI)
- ✅ 4 个 composable 文件 0 改动
- ✅ ChapterBranchTree.vue 0 改动
- ✅ ReviewingPanel.vue 0 改动
- ✅ API contract 不变(URL / method / body / resp)
- ✅ prisma schema / data schema 不动
- ✅ UI 行为 / 视觉效果 / 交互流程不变
- ✅ 模板 prop / event 命名遵循现有约定(kebab-case in template, camelCase in script)
- ✅ 不引入 Pinia / Vuex(本次不引入新状态管理库,composable 已够用)
- ✅ 不动 Step 4 本章范围图谱的实际渲染(planned-graph-split.md 提到 Chapters.vue:561 是 editable,但实际只是 n-tag/n-text 显示,与 Graph.vue 解耦无关,留作未来 P5 决策)

## 13. 与既有 spec 关系

- 路线图 spec `docs/superpowers/specs/2026-06-18-decoupling-roadmap-design.md` 第 233-261 行已定 Phase 4 目标,本次 spec 是其实施细化
- 不冲突路线图守门(0 新库 / 不动 API / 不动 UI / composable 不动)
- 不冲突 planned-graph-split.md (Chapters.vue Step 4 不嵌入 cytoscape,本次不引入 EditableGraph)
- 不破 AGENTS.md / CLAUDE.md 既有约定(中文回复 / commit 前 status / 不 amend)

---

## Self-Review

### 1. Placeholder scan

全文 grep "TBD / TODO / 待定 / 暂时 / 之后再说 / 待讨论":
- ✅ 无 hit(每个 props / emits / 函数名 / 行号都明确)

### 2. Internal consistency

- §3 子组件 props 命名 ↔ §7 view shell 模板 prop 绑定:命名一致 ✓
- §5 handle 函数归属 ↔ §7 view shell script:14 个 handle 函数全在 view shell ✓
- §6 路径映射 ↔ §2 文件清单:8 个 modal/区块 全部归属明确 ✓
- §10 验收 wc 期望 ↔ §2 预计行数:`< 200` 对应 view shell,`< 380` 对应 4 子组件(其中 DraftList ~360 接近上限,ChapterEditor ~310 < 380)✓

### 3. Scope check

单 phase 范围:1 commit / 5 文件(4 新 + 1 改写)/ 0 测试改动 / 0 API 改动 / 0 composable 改动。范围聚焦,可被单个 implementation task 拆解。

### 4. Ambiguity check

- "约 / 大约 / 预计"等模糊词扫一遍:
  - §2 "预计行数"已加 ~前缀,review 时按 ±20% 浮动合理
- "至少 1 个" / "不少于 N 个":无,所有数字都是确切值
- 可能二义解读:
  - "view shell 持有 composable"——§4 明确禁止子组件调用 composable
  - "handle 函数归属"——§5 表 + 判定原则
  - "Step 4 不引入 EditableGraph"——§12 备注,与 planned-graph-split 边界划清

无歧义。

### 5. 与 P3 spec 一致性

- P3 已建立 barrel + helper 抽取 + 单文件按职责拆的三层结构
- P4 沿用同样的"按职责拆 + 单 commit"模式,一致性 ✓
- P3 测试 129/129 通过,P4 无新增测试(前端无 vitest 覆盖),依赖手动 smoke check