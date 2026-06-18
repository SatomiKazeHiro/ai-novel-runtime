# ReviewingPanel 4 内容块 → NTabs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 `docs/superpowers/specs/2026-06-19-reviewing-panel-tabs.md` 把 ReviewingPanel.vue 当前 3-column grid 改成 4 个 NTabs,1 atomic commit。

**Architecture:** 模板顶层 `<n-grid cols="3">` 整体替换为 `<n-tabs>` + 4 个 `<n-tab-pane>`。script setup 0 改动,props / emits / data / functions 全保留,只是 template 重组 + import 调整。0 新库(沿用 naive-ui `NTabs` / `NTabPane`)。

**Tech Stack:** Vue 3 `<script setup>` + Naive UI(已装)。0 新库。

---

## Task 1: 改 ReviewingPanel.vue template + import (1 atomic commit)

**Files:**
- Modify: `apps/web/src/views/ReviewingPanel.vue`(template line 10-145 + import line 159-163)

**Reference**: 严格按 `docs/superpowers/specs/2026-06-19-reviewing-panel-tabs.md` §4.1-§4.3 模板 + import 实施。

---

### Step 1: 改 import(line 159-163)

**输入参考**: spec §4.3 import 调整。

**实施要点**:
- Read ReviewingPanel.vue line 159-163 现有 import
- 移除:`NGrid, NGridItem`(3-column grid 整体去掉,不再用)
- 增加:`NTabs, NTabPane`
- 其它组件全保留(NCard, NSpace, NAlert, NCollapse, NCollapseItem, NInput, NInputNumber, NButton, NEmpty, NDivider, NFormItem, NText, NDynamicTags, NSelect, NSlider)
- 保持 import 排序一致(按字母序,Naive UI 组件 import 习惯)

**验证**: `git diff apps/web/src/views/ReviewingPanel.vue` import 段只有 2 处变更(移除 NGrid/NGridItem,新增 NTabs/NTabPane)。

### Step 2: 改 template line 10-145

**输入参考**: spec §4.1 模板结构 + §4.2 内容块重组。

**实施要点**:
- Read ReviewingPanel.vue line 10-145 现有 3-column grid 整段
- 替换为:
  ```vue
  <n-tabs type="line" default-value="memories" :animated="true">
    <n-tab-pane name="memories" tab="记忆">
      <!-- 原 line 14-77 左列内容全包:记忆编辑器(14-59) + 角色状态(62-77) -->
    </n-tab-pane>
    <n-tab-pane name="timeline" tab="时间线">
      <!-- 原 line 83-93 时间线事件编辑 -->
    </n-tab-pane>
    <n-tab-pane name="plotArcs" tab="剧情弧线">
      <!-- 原 line 96-132 剧情弧线编辑 -->
    </n-tab-pane>
    <n-tab-pane name="graph" tab="图谱">
      <!-- 原 line 138-143 EditableGraph 嵌入 -->
    </n-tab-pane>
  </n-tabs>
  ```
- 保留:
  - `<n-card title="归档审查" size="small" style="margin-top: 16px">` 外壳(line 2-3 + 154-155)
  - 顶部 `<n-alert>` 提示(line 5-7)
  - 底部按钮组 `<n-space justify="end">` line 147-152
  - 4 个 tab 内原 `<n-card title="..." size="small" style="margin-bottom: 16px">` 保留(它们定义了内容块的视觉边界)
- 调整:
  - 原"角色状态" `<n-card>` (line 62-77) 在"记忆" tab 内,style 去掉 `margin-bottom`(因为已是 tab 内最底)
  - 原"图谱" `<n-card>` (line 138-143) 在"图谱" tab 内,size 仍 small,style 不变
  - 原 3 个 `<n-card>` 在 3-column grid 内有 `margin-bottom: 16px` 间隔;改 tabs 后,tab pane 内 `<n-card>` 之间可能不需要 margin-bottom(spec §4.2 决定)
- 不改:
  - 任何 v-model 绑定(mem.content / mem.importance / summary / characterStates / te.day / te.events / arc.* / graphData)
  - 任何 functions(addMainMemory / addSideMemory / removeMemory / setSpecialMemories / addCharacterState / removeCharacterState / addTimelineEvent / removeTimelineEvent / addPlotArc / removePlotArc / onGraphUpdate / buildData / handleSave / handleConfirm)
  - script setup 0 改动

**注意 tab 嵌套层级**:
- tab 1 ("记忆") 包含 2 个原 `<n-card>`(记忆编辑器 + 角色状态),tab 1 内用 `<n-space vertical size="large">` 包
- tab 2 ("时间线") 1 个 `<n-card>`
- tab 3 ("剧情弧线") 1 个 `<n-card>`
- tab 4 ("图谱") 1 个 `<n-card>`

具体参考原 line 14-78 嵌套结构(line 14 `<n-card>` 内 `<n-space vertical style="width: 100%">`)。

**验证**: Read 完整 template,确认 4 个 tab pane 全部存在,内容块完整(v-model 数量与原 line 10-145 一致),底部按钮组保留。

### Step 3: typecheck + build 验证

```bash
cd "D:/MGit-Projects/ai-novel-runtime" && pnpm typecheck 2>&1 | tail -20
```
**期望**: 8/8 Done,0 errors。

```bash
cd "D:/MGit-Projects/ai-novel-runtime" && pnpm --filter web typecheck 2>&1 | tail -10
```
**期望**: Done,0 errors(vue-tsc 比 tsc 严格,捕获 SFC 模板错误)。

```bash
cd "D:/MGit-Projects/ai-novel-runtime" && pnpm --filter web build 2>&1 | tail -10
```
**期望**: vite build success,0 errors。

**如 typecheck 报错**: 检查:
- `NTabs` / `NTabPane` 是否在 import(Step 1 改错)
- `NGrid` / `NGridItem` 是否还在 template 中(Step 2 漏删)
- v-model 引用是否完整(Step 2 内容块漏复制某行)
- 修复后重跑。

### Step 4: 验收 grep 检查

```bash
cd "D:/MGit-Projects/ai-novel-runtime"
wc -l apps/web/src/views/ReviewingPanel.vue
```
**期望**: 比原行数 ±30(原 472 行,期望 460-490)。

```bash
grep -c "<n-tab-pane" apps/web/src/views/ReviewingPanel.vue
```
**期望**: 4 hit(4 个 tab pane)。

```bash
grep -c "<n-grid\|<n-grid-item" apps/web/src/views/ReviewingPanel.vue
```
**期望**: 0 hit(3-column grid 整体去掉)。

```bash
grep -c "<n-tabs" apps/web/src/views/ReviewingPanel.vue
```
**期望**: 1 hit(顶层 n-tabs 1 个)。

```bash
git diff 4434cb3..HEAD -- apps/web/src/composables apps/web/src/api apps/web/src/components apps/web/src/views/Chapters.vue apps/web/src/views/Graph.vue
```
**期望**: 无 diff(spec §3 不动守门:composable / api / EditableGraph / ChapterEditor 等 0 改动)。

```bash
git status
```
**期望**: 1 个文件改动(ReviewingPanel.vue),scope 干净。

### Step 5: commit

```bash
cd "D:/MGit-Projects/ai-novel-runtime"
git add apps/web/src/views/ReviewingPanel.vue
git status
git commit -m "$(cat <<'EOF'
refactor(web): convert ReviewingPanel 3-column grid to NTabs

按 docs/superpowers/specs/2026-06-19-reviewing-panel-tabs.md 实施:
- 记忆 / 时间线 / 剧情弧线 / 图谱 4 个 tab,每个占满全宽
- 角色状态 + 摘要 + 情绪伏笔关系 全部归入"记忆" tab
- 默认全部渲染(无 v-if / 无懒加载),tab 切换数据不丢

template + import 改动 1 文件,script setup 0 改动,data flow / v-model /
emit / save 行为 100% 保留。0 新库,UI 行为 100% byte-equivalent。

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
| `pnpm typecheck` | 8/8 Done | Step 3 |
| `pnpm --filter web build` | 0 errors | Step 3 |
| `wc -l ReviewingPanel.vue` | 460-490 | Step 4 |
| `<n-tab-pane>` count | 4 | Step 4 |
| `<n-grid` / `<n-grid-item` count | 0 | Step 4 |
| `<n-tabs` count | 1 | Step 4 |
| composable / api / 其他 view 0 diff | 0 line | Step 4 |
| git status | 1 文件改动 | Step 4 |
| 1 commit | new HEAD | Step 5 |

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| 角色状态归入"记忆" tab 后,buildData() 序列化错位 | characterStates 是独立 ref,`buildData()` 序列化完整 localData 不变 |
| EditableGraph tab 切换数据丢失 | P5 实施时 EditableGraph 用 `watch initialGraphData` 双向同步 + draftGraphData ref,默认渲染不触发 v-if unmount |
| 原 3-column `margin-bottom: 16px` 在 tab pane 内不需要 | Step 2 改 tab pane 内样式清理,line 62 角色状态 style 去掉 `margin-bottom` |
| 视觉重心改变用户不适应 | 默认 tab 是"记忆"(最常用),animated 过渡平滑 |

## 不动的事

- script setup 0 改动(props / emits / refs / functions / computed / onGraphUpdate / buildData 全保留)
- EditableGraph 嵌入 0 改动
- PendingArchiveData schema 0 改动
- composable / api / 其他 view 0 改动
- 0 新库
- v-model 双向绑定 0 改动
- save / confirm / cancel emit 0 改动

---

## Self-Review

1. **Spec coverage**: spec §2 设计决策 / §3 文件改动 / §4 实施细节 / §5 守门 / §6 commit / §7 验收 — Plan 全部覆盖 ✓
2. **Placeholder scan**: 无 "TBD / TODO / 临时" 模糊词 ✓
3. **Type consistency**: tab 命名 `memories` / `timeline` / `plotArcs` / `graph` 与 spec §2.1 一字一致 ✓
4. **Scope check**: 单 phase 1 commit / 1 文件改动 / 0 测试改动 / 0 API 改动,聚焦 ✓
5. **Ambiguity check**: Step 1-2 实施要点具体到 import 名称 / 行号 / 嵌套结构,无歧义 ✓
