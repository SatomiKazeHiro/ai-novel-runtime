# ReviewingPanel 4 内容块 → NTabs — Design Spec

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `apps/web/src/views/ReviewingPanel.vue` 当前 3-column grid 的"归档审查"布局(记忆+角色状态 / 时间线+剧情弧线 / 图谱)改成 4 个 NTabs,每个 tab 占满全宽,编辑空间更大,UI 行为 100% byte-equivalent。

**Architecture:** 模板顶层 3-column `<n-grid cols="3">` 整体替换为 `<n-tabs type="line" default-value="memories">`,4 个 `<n-tab-pane>` 包裹原内容块。script setup 0 改动,props / emits / data 状态 / functions 全保留,只是模板结构调整。

**Tech Stack:** Vue 3 `<script setup>` + Naive UI(`n-tabs` / `n-tab-pane`,已装)。0 新库。

---

## 1. 目标

用户 2026-06-19 反馈:"归档审查那个部分:提取的记忆、时间线事件、剧情弧线、本章图谱,能否做成 tabs?"

承袭 P4/P5 解耦成果(已完成 Chapters.vue / Graph.vue 拆分),本次 spec 是 UI 重组,不动业务逻辑。

- **改动文件**: 1 个(`apps/web/src/views/ReviewingPanel.vue`)
- **改动范围**: template line 10-145(原 3-column grid 整段)+ script line 159-163(import 增 2 行 `NTabs, NTabPane`)
- **行为**: 0 改动(所有 v-model 绑定 / emit / save 逻辑 / onGraphUpdate 行为完全保留)
- **数据流**: 0 改动(PendingArchiveData schema 不动,save / confirm / cancel 行为不动)

## 2. 设计决策

### 2.1 Tab 划分(用户已确认)

| Tab | key | 包含内容 |
|---|---|---|
| **记忆** | `memories` | 主/次要事件 + 情绪/伏笔/关系 + 本章摘要 + 角色状态(全部归入,因都属 memories.memories + characterStates) |
| **时间线** | `timeline` | 时间线事件编辑(原 line 83-93) |
| **剧情弧线** | `plotArcs` | 剧情弧线编辑(原 line 96-132) |
| **图谱** | `graph` | EditableGraph(原 line 138-143) |

### 2.2 角色状态归位(用户决策)

角色状态 / 摘要 / 情绪/伏笔/关系 → 全部归入"记忆" tab(它们数据上都是 memories 子结构)。理由:
- 数据 schema 一致(`memories.memories` + `memories.characterStates` 都属 `memories` 节点)
- 减少 tab 数量(4 而非 5),用户认知负担小
- 当前实现已和记忆编辑器紧耦合(同一左列)

### 2.3 渲染策略(用户决策)

**默认全部渲染**(不懒加载 / 不 v-if):
- v-model 双向绑定所有 ref(主记忆 / 次记忆 / 情绪 / 摘要 / 角色状态 / 时间线 / 弧线)
- 切换 tab 数据不丢,符合用户预期
- EditableGraph(via P5 hook)即使不显示也保持内存状态
- 性能:4 tab 同时渲染,Naive UI 内部用 `display: none` 隐藏非激活 tab,无重计算开销

## 3. 文件改动清单

| 文件 | 状态 | 改动 | 预计行数变化 |
|---|---|---|---|
| `apps/web/src/views/ReviewingPanel.vue` | **改 template + import** | line 10-145 3-column grid → NTabs,line 159-163 import +2 | 净 ±20 行(看 4 个 tab 标签的引入) |

**不动**:
- `apps/web/src/components/graph/EditableGraph.vue`(P5 实施已落地,0 改动)
- `apps/web/src/api/chapters.ts` / `api/graph.ts`(0 改动)
- `apps/web/src/composables/*` 0 改动
- PendingArchiveData schema / 后端路由 0 改动
- ReviewingPanel.vue 的 script setup 0 改动(只是 template)

## 4. 实施细节

### 4.1 模板结构(原 line 10-145)

**原结构**:
```vue
<n-grid cols="3" responsive="screen" x-gap="16" y-gap="16">
  <n-grid-item span="1">  <!-- 左: 记忆 + 角色状态 --> ... </n-grid-item>
  <n-grid-item span="1">  <!-- 中: 时间线 + 剧情弧线 --> ... </n-grid-item>
  <n-grid-item span="1">  <!-- 右: 图谱 --> ... </n-grid-item>
</n-grid>
```

**新结构**:
```vue
<n-tabs type="line" default-value="memories" :animated="true">
  <n-tab-pane name="memories" tab="记忆">
    <!-- 原左列内容: 记忆编辑器(line 14-59) + 角色状态(line 62-77) -->
  </n-tab-pane>
  <n-tab-pane name="timeline" tab="时间线">
    <!-- 原中列上: 时间线事件编辑(line 83-93) -->
  </n-tab-pane>
  <n-tab-pane name="plotArcs" tab="剧情弧线">
    <!-- 原中列下: 剧情弧线编辑(line 96-132) -->
  </n-tab-pane>
  <n-tab-pane name="graph" tab="图谱">
    <!-- 原右列: 图谱编辑器(line 138-143) -->
  </n-tab-pane>
</n-tabs>
```

### 4.2 内容块重组(详细)

**Tab "记忆"**(原 line 14-77 全部,左列两块合并):
- 主/次要事件 collapse(原 line 16-39)
- 情绪/伏笔/关系 collapse(原 line 41-50)
- 本章摘要(原 line 55-57)
- 角色状态编辑器(原 line 62-77)

**Tab "时间线"**(原 line 83-93):
- 时间线事件编辑(原 line 83-93)

**Tab "剧情弧线"**(原 line 96-132):
- 剧情弧线编辑(原 line 96-132)

**Tab "图谱"**(原 line 138-143):
- `<EditableGraph :initial-graph-data="graphData" @update:graphData="onGraphUpdate" />`

### 4.3 Import 调整

**原 line 159-163**:
```ts
import {
  NCard, NSpace, NAlert, NGrid, NGridItem, NCollapse, NCollapseItem,
  NInput, NInputNumber, NButton, NEmpty, NDivider, NFormItem, NText, NDynamicTags,
  NSelect, NSlider
} from 'naive-ui'
```

**新 import**:
```ts
import {
  NCard, NSpace, NAlert, NTabs, NTabPane, NCollapse, NCollapseItem,
  NInput, NInputNumber, NButton, NEmpty, NDivider, NFormItem, NText, NDynamicTags,
  NSelect, NSlider
} from 'naive-ui'
```

**变更**:
- 移除 `NGrid, NGridItem`(不再用 3-column grid)
- 增加 `NTabs, NTabPane`

**保留**:
- 其它全部组件
- `<n-card title="归档审查">` 外壳(line 2-3 + line 154-155)
- 顶部 n-alert 提示(line 5-7)
- 底部按钮组(line 147-152)
- 所有 v-model 绑定 / functions / emits / script setup

### 4.4 视觉差异(预期)

- 当前: 3-column 网格,每列 ~33% 宽度
- 改后: 单列 tabs,每个 tab 占满 100% 宽度
- 移动端: 当前 3-column 在小屏会纵向堆叠;tabs 改后保持单列 tab 切换,小屏体验一致
- 视觉重心: 顶部 tab 栏 + 1 个激活内容块,代替 3 个并列内容块

## 5. 守门(承袭 P4/P5 守门)

- ✅ 0 新库(沿用 naive-ui 已有 NTabs / NTabPane)
- ✅ API contract 不变(chaptersApi / graphApi 0 改动)
- ✅ prisma schema / data schema 不动
- ✅ composable / EditableGraph 0 改动
- ✅ UI 行为不变(编辑 / 保存 / 确认 / 取消 4 个操作完全保留)
- ✅ data flow 不变(PendingArchiveData 字段全保留,v-model 双向绑定全保留)
- ✅ save / confirm 行为不变(emit 触发流程不动)

## 6. commit 计划

```bash
# 1. 单文件改动
git add apps/web/src/views/ReviewingPanel.vue

# 2. verification gate
pnpm typecheck              # 期望 8/8 Done
pnpm --filter web typecheck # 期望 Done, 0 errors
pnpm --filter web build     # 期望 vite build success

# 3. 单 commit
git commit -m "refactor(web): convert ReviewingPanel 3-column grid to NTabs

按 docs/superpowers/specs/2026-06-19-reviewing-panel-tabs.md 实施:
- 记忆 / 时间线 / 剧情弧线 / 图谱 4 个 tab,每个占满全宽
- 角色状态 + 摘要 + 情绪伏笔关系 全部归入\"记忆\" tab
- 默认全部渲染(无 v-if / 无懒加载),tab 切换数据不丢

template + import 改动 1 文件,script setup 0 改动,data flow / v-model /
emit / save 行为 100% 保留。0 新库,UI 行为 100% byte-equivalent。

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
"
```

## 7. 验收标准

| 项 | 期望 | 验证命令 |
|---|---|---|
| `pnpm typecheck` | 8/8 Done | typecheck |
| `pnpm --filter web build` | 0 errors | build |
| `wc -l ReviewingPanel.vue` | 比原行数 ±30 | wc -l |
| 不动守门 | composable / api / schema 0 diff | `git diff 4434cb3..HEAD -- apps/web/src/composables apps/web/src/api` |
| tab 切换 | 4 tab 全部可点击,内容正确显示 | 手动 smoke |
| v-model 数据保留 | 切到其他 tab 再切回,输入内容不丢 | 手动 smoke |
| 编辑后保存 | save 仍能 emit 完整 PendingArchiveData | 手动 smoke |

## 8. 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| Naive UI `NTabs` / `NTabPane` API 用错(type / name / default-value) | 低 | tab 切换不工作 | typecheck 兜底;实施时严格按 Naive UI 文档 |
| 角色状态归入"记忆" tab,后端数据流错位 | 低 | characterStates 不被保存 | characterStates 是独立的 ref,归位不影响 emit,`buildData()` 仍序列化完整 localData |
| tab 切换时 EditableGraph 内存状态丢失 | 低 | 图谱编辑丢失 | P5 实施时 EditableGraph 用 `watch initialGraphData` 双向同步,且 `draftGraphData` 是 ref,默认全部渲染不触发 v-if unmount,状态保留 |
| 视觉重心改变(单列 vs 3-column)用户不适应 | 低 | 初次体验需要重新熟悉 | 默认 tab 是"记忆"(最常用),其他 tab 切换明显;`animated: true` 给视觉过渡 |

## 9. 不动的事

- ✅ PendingArchiveData schema / 后端 route 0 改动
- ✅ EditableGraph.vue / 4 个 chapter composable / graph composable 0 改动
- ✅ API 0 改动
- ✅ save / confirm / cancel 行为 0 改动
- ✅ v-model 双向绑定 0 改动
- ✅ script setup 函数 / computed / ref 0 改动
- ✅ EditableGraph 数据流 0 改动
- ✅ 0 新库

---

## Self-Review

### 1. Placeholder scan
全文 grep "TBD / TODO / 待定 / 暂时 / 之后再说 / 待讨论":
- ✅ 无 hit(每个 tab 命名 / 内容块 / 行号 / import 名称都已落)

### 2. Internal consistency
- §2.1 tab 划分 ↔ §4.1 模板结构 ↔ §4.2 内容块重组:命名一致(`memories` / `timeline` / `plotArcs` / `graph`)✓
- §4.3 import 调整 ↔ §3 0 新库守门:NTabs/NTabPane 是 naive-ui 自带 ✓
- §6 commit 计划 ↔ §7 验收标准:1 文件 / 1 commit ✓

### 3. Scope check
单 phase 范围:1 commit / 1 文件(template + import 共 ~20 行 diff)/ 0 测试改动 / 0 API 改动。范围聚焦。

### 4. Ambiguity check
- "tab 顺序" — §2.1 明确:记忆 → 时间线 → 剧情弧线 → 图谱
- "默认激活 tab" — §4.1 明确:`default-value="memories"`
- "tab 类型" — §4.1 明确:`type="line"`(Naive UI 默认 line,无 segment / card 装饰)
- "动画" — §4.1 明确:`:animated="true"`(tab 切换有过渡)
- "角色状态归位" — §2.2 明确:归入"记忆" tab
- "懒加载" — §2.3 明确:默认全部渲染

无歧义。
