# Phase 4: Chapters.vue 拆 view shell + 4 子组件 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 `docs/superpowers/specs/2026-06-18-p4-chapters-view-split.md` 把 Chapters.vue(1169 行)拆为 view shell + 4 子组件,1 个 atomic commit。

**Architecture:** 1 步写完所有 4 子组件 + view shell(顺序按依赖:独立子组件 → 嵌入子组件 → view shell),1 步 typecheck/build 验证,1 步 commit。前端无 vitest 覆盖,跳过写测试步骤;依赖 typecheck + build + manual smoke check 兜底。

**Tech Stack:** Vue 3 `<script setup>` + Naive UI(已装)。0 新库。

---

## Task 1: 写 4 子组件 + 改写 view shell (1 atomic commit)

**Files:**
- Create: `apps/web/src/views/chapters/ChapterTree.vue` (~150 行)
- Create: `apps/web/src/views/chapters/ChapterPreview.vue` (~110 行)
- Create: `apps/web/src/views/chapters/DraftList.vue` (~360 行)
- Create: `apps/web/src/views/chapters/ChapterEditor.vue` (~310 行)
- Modify: `apps/web/src/views/Chapters.vue` (1169 → < 200 行, view shell)

**Reference**: 严格按 `docs/superpowers/specs/2026-06-18-p4-chapters-view-split.md` §3 props/emits 接口 + §6 路径映射 + §7 view shell 形态实施。每个子组件的模板内容从现有 `apps/web/src/views/Chapters.vue` 现有 line 行号段复制(见 spec §6 路径映射表)。

---

### Step 1: 写 ChapterTree.vue

**输入参考**: spec §3.1 props/emits 接口 + §6 path mapping(模板 line 4-38 + line 618-660 + line 663-713)。

**实施要点**:
- `<script setup lang="ts">` + `defineProps` + `defineEmits`(严格按 spec §3.1 类型)
- 模板分 3 块:
  1. 顶部:章节工作台 + 新建根章节按钮(line 4-17 现有)
  2. 树状态:loading skeleton / empty / `<ChapterBranchTree>` 嵌入(line 19-37 现有)
  3. 2 个 modal:createRoot (line 618-660 现有) + develop (line 663-713 现有)
- 嵌入 `<ChapterBranchTree>` 时,emit 转发: `@select="(node: any) => emit('select', node)"` 等 5 个
- modal 关闭用 `@update:show="(v: boolean) => !v && emit('close-create-modal')"`(createRoot) / `@update:show="(v: boolean) => !v && emit('close-develop-modal')"`(develop)
- 顶部"新建根章节"按钮 `@click="emit('open-create-root')"`(由 view shell 调用 `tree.openCreateRoot`)
- createRoot / develop modal 的 footer 按钮:
  - createRoot: `@click="emit('create-root')"` (主按钮) / `@click="emit('close-create-modal')"` (取消)
  - develop: `@click="emit('create-develop')"` (主按钮,带 `:disabled="!developForm.title.trim()"`) / `@click="emit('close-develop-modal')"` (取消)
- imports: `NModal, NForm, NFormItem, NInput, NCheckbox, NCard, NSpace, NButton, NEmpty, NSkeleton, NH1` from naive-ui
- 不在 ChapterTree 内调用 `useChapterTree()` (spec §4 守门)
- style scoped 不需要(模板内未用 scoped style;原 Chapters.vue 也无 style block)

**验证**: Read 完整文件,确认 props/emits 类型与 spec §3.1 一字不差,确认不调用 composable。

### Step 2: 写 ChapterPreview.vue

**输入参考**: spec §3.3 props/emits 接口 + §6 path mapping(模板 line 240-339)。

**实施要点**:
- props 接收 `prompt: any`(整个 usePromptManager 实例)
- emit `generate-prompt`(子组件顶部按钮触发,view shell 调 handleGeneratePrompt)
- 模板复制原 line 240-339:Prompt textarea + 生成/复制按钮 + Token 预算卡片
- 嵌入位置:ChapterEditor 会在 Step 2 处嵌入 `<ChapterPreview :prompt="prompt" @generate-prompt="emit('generate-prompt')" />`
- 不在 ChapterPreview 内调用 `usePromptManager()` (spec §4 守门)
- imports: `NCard, NFormItem, NInput, NButton, NSpace, NText, NTag, NProgress` from naive-ui

**验证**: Read 完整文件,确认 template 与 line 240-339 byte-equivalent(除 prop/emit 包装外)。

### Step 3: 写 DraftList.vue

**输入参考**: spec §3.4 props/emits 接口 + §6 path mapping(模板 line 342-499 左侧 + line 716-815 弹窗)。

**实施要点**:
- props 接收 `drafts: any` / `chapter: any` / `prompt: any`
- emit `generate-default` / `generate-custom` / `adopt-draft`(含 draft 参数)
- 模板分 2 大块:
  1. 候选区(line 342-499 左侧):顶部按钮 + 候选摘要 + 候选 tabs + 空状态
  2. 弹窗(line 716-754 + line 756-815):customModal + scoreModal
- 顶部按钮 `@click="emit('generate-default')"` / `@click="drafts.showCustomModal = true"`
- 候选 tab 内"采用此版本"按钮 `@click="emit('adopt-draft', draft)"`
- "评分" / "删除" 按钮直接调 `drafts.scoreDraft(draft.id)` / `drafts.confirmDeleteDraft(draft.id, draft.version)`
- customModal 内 footer 主按钮 `@click="emit('generate-custom')"`,取消按钮 `@click="drafts.showCustomModal = false"`
- scoreModal 内部用 `scoreLabels` (从原 Chapters.vue line 1112-1120 搬过来) + `formatParams` (line 1122-1128 搬过来)
- 关闭 modal:`@update:show="(v: boolean) => !v && (drafts.showCustomModal = false)"`
- 嵌入位置:ChapterEditor 会在 Step 3 左侧嵌入 `<DraftList :drafts="drafts" :chapter="chapter" :prompt="prompt" @generate-default="emit('generate-default')" @generate-custom="emit('generate-custom')" @adopt-draft="(d: any) => emit('adopt-draft', d)" />`
- 不在 DraftList 内调用 `useDraftManager()` (spec §4 守门)
- imports: `NTabs, NTabPane, NSpace, NButton, NText, NDivider, NScrollbar, NSpin, NP, NEmpty, NModal, NForm, NFormItem, NSlider, NInputNumber, NProgress, NCard` from naive-ui

**验证**: Read 完整文件,确认 template 与 line 342-499 左侧 + 716-815 byte-equivalent,确认 scoreLabels/formatParams 内部定义。

### Step 4: 写 ChapterEditor.vue

**输入参考**: spec §3.2 props/emits 接口 + §6 path mapping(模板 line 43-68 + 71-238 + 342-498 右侧 + 503-511 + 514-538 + 541-559 + 562-613)。

**实施要点**:
- props 接收所有 editor state + `archiving` + `repreparingArchive` + `prompt: any` + `drafts: any`(后两个传给子组件)
- emit 全集按 spec §3.2 14 个
- 模板分 7 块:
  1. 顶部导航(line 43-68 现有):返回 / title input / isSideStory tag / status tag / readonly tag
  2. Step 1 配置(line 71-238 现有):profile / model / plotArcs / outline / scene 3 输入 / 保存配置按钮
  3. 嵌入 `<ChapterPreview :prompt="prompt" @generate-prompt="emit('generate-prompt')" v-if="!isReadonly" />`
  4. Step 3 卡片外壳 + n-grid (line 342-499 现有):
     - 左 grid-item: `<DraftList :drafts="drafts" :chapter="chapter" :prompt="prompt" @generate-default="emit('generate-default')" @generate-custom="emit('generate-custom')" @adopt-draft="(d: any) => emit('adopt-draft', d)" />`
     - 右 grid-item: 正文 textarea(line 482-498)+ 保存正文 / 准备归档按钮
  5. Step 3.5 嵌入 `<ReviewingPanel>` (line 503-511 现有)
  6. reviewing 重试入口(line 514-538 现有)
  7. Step 3 只读(line 541-559 现有,isReadonly 时)+ Step 4 图谱(line 562-613 现有)
- script 内:
  - `const reviewingPanelRef = ref<InstanceType<typeof ReviewingPanel> | null>(null)`
  - `function startConfirm() { reviewingPanelRef.value?.startConfirm() }` / `function stopConfirm() { reviewingPanelRef.value?.stopConfirm() }`
  - `defineExpose({ startConfirm, stopConfirm })`
  - `statusTagType(status?: string) { ... }` (从原 Chapters.vue line 1130-1151 搬过来)
  - `arcStatusType(status?: string) { ... }` (line 1153-1166 搬过来)
  - 不调 composable
- imports: `NSpace, NButton, NDivider, NIcon, NCard, NGrid, NGridItem, NForm, NFormItem, NInput, NSelect, NTag, NText, NProgress, NModal, NAlert, NCollapse, NCollapseItem` from naive-ui; `ArrowBackOutline` from `@vicons/ionicons5`; `ReviewingPanel` from `'../ReviewingPanel.vue'`; `ChapterPreview` from `'./ChapterPreview.vue'`; `DraftList` from `'./DraftList.vue'`

**验证**: Read 完整文件,确认 prop/emit 类型与 spec §3.2 一致,确认 `defineExpose` 暴露 `startConfirm` / `stopConfirm`,确认不调用 composable。

### Step 5: 改写 Chapters.vue 为 view shell

**输入参考**: spec §7 view shell 形态 + §6 path mapping(script 全部 line 819-1169)。

**实施要点**:
- 模板只 2 个子组件:
  ```vue
  <ChapterTree v-if="!editor.editMode" ...所有 props + emits... />
  <ChapterEditor v-else ref="chapterEditorRef" ...所有 props + emits... />
  ```
  props / emits 严格按 spec §3.1 / §3.2 全集,具体见 spec §7 模板示例。
- script 内:
  - 4 个 composable 实例装配(line 868-872 现有,不变)
  - `debouncedSaveConfig = useDebounceFn(editor.saveConfig, 500)` (line 875 现有)
  - `archiving` / `repreparingArchive` / `isReadonly` / `dialog` / `message` 局部 ref(line 878-883 现有,不变)
  - 移除 `reviewingPanelRef`,改为 `const chapterEditorRef = ref<InstanceType<typeof ChapterEditor> | null>(null)`
  - onMounted(line 887-892 现有,不变)
  - watch route.params.storyId(line 894-900 现有,不变)
  - 14 个 handle 函数(全部从原 Chapters.vue script 搬过来,不变更业务逻辑):
    - `handleOpenEdit` / `handleOpenView` / `handleBackToTree`
    - `handleCreateRoot` / `handleDevelop`
    - `handleGeneratePrompt` / `handleGenerateDefault` / `handleGenerateCustom`
    - `handleAdoptDraft`
    - `handlePrepareArchive` / `handleSavePendingArchiveData` / `handleConfirmArchive`
    - `handleReprepareArchive` / `handleCancelReviewing`
  - **`handleConfirmArchive` 改写**: 用 `chapterEditorRef.value?.startConfirm()` 代替原 `reviewingPanelRef.value?.startConfirm()`,用 `chapterEditorRef.value?.stopConfirm()` 代替 `reviewingPanelRef.value?.stopConfirm()`(业务逻辑其余不变)
  - 移除 `scoreLabels` / `formatParams` / `statusTagType` / `arcStatusType`(已搬到子组件)
- imports:
  - `ref, computed, onMounted, watch` from 'vue'
  - `useRoute` from 'vue-router'
  - `useDebounceFn` from '@vueuse/core'
  - `useDialog, useMessage` from 'naive-ui'
  - `chaptersApi` from '../api/chapters'
  - 4 composables from '../composables/...'
  - `ChapterTree` from './chapters/ChapterTree.vue'
  - `ChapterEditor` from './chapters/ChapterEditor.vue'

**验证**: `wc -l apps/web/src/views/Chapters.vue` < 200。

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

**如 typecheck 报错**: 按错误位置修复(常见: prop type 不匹配 / import 缺失 / 模板内 field 不存在)。重新跑直到全绿。

**如 build 报错**: 通常是 import path 错误(检查 `@/` alias 或相对路径 `./chapters/...`)。修复后重跑。

### Step 7: 验收 grep 检查

```bash
cd "D:/MGit-Projects/ai-novel-runtime"
wc -l apps/web/src/views/Chapters.vue apps/web/src/views/chapters/*.vue
```
**期望**:
- Chapters.vue: < 200
- ChapterTree.vue: < 380
- ChapterEditor.vue: < 380
- ChapterPreview.vue: < 380
- DraftList.vue: < 380

```bash
grep -l "useChapterTree\|useChapterEditor\|useDraftManager\|usePromptManager" apps/web/src/views/chapters/*.vue
```
**期望**: 无输出(子组件禁止调用 composable,见 spec §4)。

```bash
grep -c "useChapterTree\|useChapterEditor\|useDraftManager\|usePromptManager" apps/web/src/views/Chapters.vue
```
**期望**: 4(view shell 调用 4 个 composable)。

```bash
git status
```
**期望**: 5 个文件改动(4 新 + 1 改写),scope 干净。

### Step 8: commit

```bash
cd "D:/MGit-Projects/ai-novel-runtime"
git add apps/web/src/views/chapters/ChapterTree.vue \
        apps/web/src/views/chapters/ChapterEditor.vue \
        apps/web/src/views/chapters/ChapterPreview.vue \
        apps/web/src/views/chapters/DraftList.vue \
        apps/web/src/views/Chapters.vue
git status
git commit -m "$(cat <<'EOF'
refactor(web): split Chapters.vue into view shell + 4 sub-components (P4)

按 docs/superpowers/specs/2026-06-18-p4-chapters-view-split.md 拆分:
- ChapterTree.vue: 分支树视图 + createRoot/develop modal
- ChapterEditor.vue: 顶部导航 + Step 1 配置 + Step 4 图谱 + ReviewingPanel 嵌入
- ChapterPreview.vue: Step 2 Prompt 面板
- DraftList.vue: Step 3 候选 + customModal/scoreModal
- Chapters.vue: view shell (< 200 行), mode 切换 + 跨 composable 协调

view shell 持有 4 个 composable 实例,所有 state 通过 props 下传子组件,
子组件 emit 事件回 view shell 协调。composable / ChapterBranchTree /
ReviewingPanel 0 改动,UI 行为 100% byte-equivalent。

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
| `wc -l Chapters.vue` | < 200 | Step 7 |
| `wc -l chapters/*.vue` | 每个 < 380 | Step 7 |
| 子组件不调 composable | 0 hit | Step 7 grep |
| view shell 调用 4 composable | 4 hit | Step 7 grep |
| git status | 5 文件改动 | Step 7 |
| 1 commit | new HEAD | Step 8 |

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| 子组件误调 composable 创建独立实例 | Step 7 grep 强制检查 |
| prop `any` 类型丢失保护 | code review 抽看 + spec §3.1/§3.2 类型注释 |
| `chapterEditorRef` 异步调用时机 | Step 4 实施时加 `if (!chapterEditorRef.value) return` 兜底(spec §11 风险) |
| modal 双向绑定写法不一致 | Step 1/3 统一用 `:show` + `@update:show` 模式 |
| vue-tsc 报错 prop 类型不匹配 | Step 6 typecheck 兜底,实施时严格按 spec §3 类型 |

## 不动的事

- 4 个 composable 文件 0 改动
- ChapterBranchTree.vue / ReviewingPanel.vue 0 改动
- API contract / prisma schema / data schema 不动
- 0 新库
- UI 行为 / 视觉效果 / 交互流程不变

---

## Self-Review

1. **Spec coverage**: spec §3 子组件 props/emits / §4 composable 装配 / §5 handle 函数归属 / §6 路径映射 / §7 view shell 形态 / §8 UI 不变性 / §10 验收 — Plan 全部覆盖 ✓
2. **Placeholder scan**: 无 "TBD / TODO / 临时" 模糊词 ✓
3. **Type consistency**: Step 1-5 子组件 props/emits 命名与 spec §3 一字一致 ✓
4. **Scope check**: 单 phase 1 commit / 5 文件改动 / 0 测试改动 / 0 API 改动,聚焦 ✓
5. **Ambiguity check**: Step 1-5 实施要点具体到 import / template 行号 / 函数体,无歧义 ✓