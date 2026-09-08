# ReviewingPanel Restore + Extraction Quality Fix — Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the v2 ReviewingPanel UI/交互(form-driven tabs with full edit affordance) on top of v3's 4-stage parallel extraction pipeline, and tighten the graph extraction prompt so the chapter graph stops dumping trivial nodes.

**Architecture:** Revert `apps/web/src/views/ReviewingPanel.vue` to its v2 source (commit `397bb19^`), drop the timeline tab (v3 deprecation), rewire data binding through a v3↔v2 adapter pair so the panel accepts v3 `pendingArchiveData` and emits v3-shaped save events. Backend's 4-stage pipeline stays intact; only `graph-extract-stage.ts` gets a prompt tune.

**Tech Stack:** Vue 3 + Naive UI (`n-tabs`/`n-tab-pane`/`n-input`/`n-input-number`/`n-select`/`n-slider`/`n-collapse`), existing components `EditableGraph.vue` / `DynamicTags.vue`.

---

## Background — Why this is a regression fix, not a redesign

v2 of `ReviewingPanel` was a tabbed form with full inline edit:

- 5 tabs: 角色 / 记忆 / 时间线 / 剧情弧线 / 图谱
- Each tab = `n-card` + `n-grid cols="2"` of editable cards
- Each card = `n-input type="textarea"` / `n-input-number` / `n-select` / `n-slider`, with explicit 删除 button + 添加 button
- 常驻顶部:本章摘要 (editable)
- 底部三按钮:取消 / 保存调整 / 确认归档
- Graph tab 走 `EditableGraph.vue` 完整编辑(节点拖拽、关系编辑)

v3 refactor (`397bb19 refactor(v3): restructure ReviewingPanel into 4 stage cards` + 后续 5 commits) 把这层 UI 砍到只剩 4-column 只读网格 + × 删除。用户反馈"详细编辑没了 / Tabs 没了",这属于 v3 的回归。

后端 v3 没问题:4 stage 并行抽取(character / memory / plotArc / graph)已经在 `apps/server/src/routes/chapters-archive.ts` 跑通,只是前端没接住。

## 6 个用户反馈对应

| 用户反馈 | 本 spec 解决方案 |
|---|---|
| 1. 难看 | 还原 v2 设计语言(`cap-card` / `cap-character-card` / `cap-arc-card` / N° 序号 / 字段编号) |
| 2. 只能删,不能详细编辑 | 还原 v2 全部 n-input / n-input-number / n-select / n-slider + 增删按钮 |
| 3. 信息拥挤,字体压缩 | v2 已用 `cap-rise` + N° + 字段分块,密度合理;本次按 v2 原样还原 |
| 4. 图谱阿猫阿狗都上 | `graph-extract-stage.ts` prompt:importance 阈值 6→8、type 严格收紧到 4 类、relation 给固定词表 |
| 5. RELATIONS 弱智(type:key 显示) | v2 graph tab 用 `EditableGraph.vue` 直接显示节点 label 与人类可读关系词(不再用 `type:key` 代码)。本次还原 |
| 6. 删除无效 | v2 删除走 `n-button @click="removeXxx"` 通过 `confirmRemove` 弹窗,完整链路通。本次还原 |

## 范围 — IN / OUT

**IN**:
- `apps/web/src/views/ReviewingPanel.vue` 还原 v2 + 适配 v3 数据形状
- `apps/server/src/services/stages/graph-extract-stage.ts` prompt 收紧
- `apps/web/src/views/Chapters.vue` `handleSave` 适配 v3 数据形状
- `apps/web/src/views/chapters/ChapterEditor.vue` 重新挂载 ReviewingPanel,emit 改名为 v2 的 `save` / `confirm` / `cancel`

**OUT**(后续 spec 处理):
- memory-stage / character-stage / plot-arc-stage 的 prompt 质量
- TimelineEvent 时间线 tab(v3 已废弃)
- CumulativeGraph 编辑(`buildCumulativeGraph` 仍由后端在 `archive` 端点独占,前端不可编辑)
- 在 review panel 内重新抽取单 stage 的"再校单 stage" UI(v3 后端支持重跑 prepare-archive,但前端没有 stage 级别 retry 入口——本次保持 status='failed' 时只显示错误 + 一键再校整章)

---

## Design — 四个组件

### 1. `apps/web/src/views/ReviewingPanel.vue` (前端主战场)

**模板**:照搬 `397bb19^` 的 ReviewingPanel.vue 模板。tabs 顺序:角色 / 记忆 / 剧情弧线 / 图谱。**移除 timeline tab**(`n-tab-pane name="timeline"` 整段删掉,连带 `TimelinePositionInput` 引用删掉;`memories.timelineEvents` 数据也不读)。

**Props**:
```ts
defineProps<{
  pending: { version: 3, stages: { character, memory, plotArc, graph }, meta: {...} }
}>()
```

**Emits**:
```ts
defineEmits<{
  (e: 'save', data: { version: 3, stages: {...}, meta: {...} }): void  // 持久化(v3 形状)
  (e: 'confirm', data: { version: 3, stages: {...}, meta: {...} }): void  // 归档
  (e: 'cancel'): void  // 撤销审查
  (e: 'reprepare'): void  // 整章重抽
}>()
```

**内部数据形状**(v2 形态,纯内部):
```ts
interface LocalData {
  summary: string                                    // ← memory.result.summary
  memories: {                                        // ← memory.result
    memories: Array<{                                //   把 mainEvents + sideEvents 拍平到此数组
      content: string
      tags: string[]                                 //   'main-plot' | 'side-plot'
      importance: number
      fromChapterNumber: number
    }>
    characterStates: Array<{                         // ← character.result.characterStates
      characterId: string | null
      name: string
      key: string
      status: string                                 // JSON 字符串
      relationships: string                          // JSON 字符串
      isNew: boolean
    }>
    emotions: string[]                               // ← memory.result.emotions
    foreshadowing: string[]                          // ← memory.result.foreshadowing
    relationshipChanges: string[]                    // ← memory.result.relationshipChanges
  }
  plotArcs: Array<any>                               // ← plotArc.result.plotArcs
  graph: {
    chapterGraph: { nodes: any[], edges: any[] }     // ← graph.result.chapterGraph
  }
}
```

**Adapter 函数**(在 script setup 顶部):
```ts
function fromV3(pending: any): LocalData {
  const stages = pending?.stages || {}
  const mem = stages.memory?.result || {}
  const chr = stages.character?.result || {}
  const plot = stages.plotArc?.result || {}
  const graph = stages.graph?.result || {}

  const chNum = pending?.meta?.chapterNumber ?? 0
  const toMemory = (ev: any, tags: string[]) => ({
    content: ev.description || '',
    tags,
    importance: ev.importance ?? 5,
    fromChapterNumber: chNum
  })

  return {
    summary: mem.summary || '',
    memories: {
      memories: [
        ...(mem.mainEvents || []).map((e: any) => toMemory(e, ['main-plot'])),
        ...(mem.sideEvents || []).map((e: any) => toMemory(e, ['side-plot']))
      ],
      characterStates: chr.characterStates || [],
      emotions: mem.emotions || [],
      foreshadowing: mem.foreshadowing || [],
      relationshipChanges: mem.relationshipChanges || []
    },
    plotArcs: plot.plotArcs || [],
    graph: {
      chapterGraph: graph.chapterGraph || { nodes: [], edges: [] }
    }
  }
}

function toV3(local: LocalData, original: any): any {
  // 保留 original.version / original.meta,重写 stages 各 .result
  const stages = JSON.parse(JSON.stringify(original.stages || {}))
  const chNum = original?.meta?.chapterNumber ?? 0

  // memory stage
  const mem = local.memories
  const mainEvents = mem.memories
    .filter((m: any) => m.tags?.includes('main-plot'))
    .map((m: any) => ({
      description: m.content,
      participants: [],
      importance: m.importance
    }))
  const sideEvents = mem.memories
    .filter((m: any) => !m.tags?.includes('main-plot'))
    .map((m: any) => ({
      description: m.content,
      participants: [],
      importance: m.importance
    }))
  stages.memory = stages.memory || { status: 'success' }
  stages.memory.result = {
    ...stages.memory.result,
    summary: local.summary,
    mainEvents,
    sideEvents,
    emotions: mem.emotions,
    foreshadowing: mem.foreshadowing,
    relationshipChanges: mem.relationshipChanges
  }

  // character stage
  stages.character = stages.character || { status: 'success' }
  stages.character.result = {
    characterStates: mem.characterStates
  }

  // plotArc stage
  stages.plotArc = stages.plotArc || { status: 'success' }
  stages.plotArc.result = {
    plotArcs: local.plotArcs
  }

  // graph stage
  stages.graph = stages.graph || { status: 'success' }
  stages.graph.result = {
    chapterGraph: local.graph.chapterGraph
  }

  return {
    version: 3,
    stages,
    meta: original.meta || {}
  }
}
```

**watcher**:任何 `localData` 变化 → 防抖 800ms → `emit('save', toV3(localData, props.pending))`。debounce 用 lodash debounce 或手写 setTimeout。

**底部三按钮**:
- 取消 → `emit('cancel')` (走 v3 prepare-archive-cancel 端点,保留草稿)
- 保存调整 → `emit('save', toV3(localData, props.pending))`(同步触发,不等防抖)
- 确认归档 → `emit('confirm', toV3(localData, props.pending))` (走 archive 端点)

**状态徽标**:每个 tab 顶部加状态点(沿用 v3 的 status dot 设计):
- success → 绿点,正常显示
- failed → 红点 + tab 标题加粗 + tab 顶部一行红色错误信息(来自 `state.errorMessage`)
- running → 橘点 + tab 内容显示 n-spin
- pending → 灰点 + tab 内容显示"等待开始"

> 注:既然 v3 prepare-archive 是 4 stage 并行,reviewing 状态下 4 stage 要么全 success 要么全 failed(因为 `Promise.all` 一起返回)。但用户能看到单个 stage 失败的红点。

**v2 删掉的细节**(本次不进):
- 顶部"常驻区"(摘要卡)— 移到 记忆 tab 顶部,作为 `n-card title="本章摘要"` 的一个 textarea
- `cap-rise` 进场动画类保留

### 2. `EditableGraph.vue` (已存在,直接复用)

文件 `apps/web/src/components/graph/EditableGraph.vue` 已存在,v3 没动它。v2 graph tab 直接用它即可。

**Props**(沿用现有):`initialGraphData: { nodes, edges }`
**Emits**:`update:graphData`

内部接受 v3 的 `chapterGraph` shape (`{nodes: [{type,key,label,data}], edges: [{fromType,fromKey,toType,toKey,relation,weight}], timestamp}`),UI 上展示 label 而非 key,编辑后 emit 新的 graphData。

> 不需要改 `EditableGraph.vue` 本身——它读什么 shape 就喂什么 shape,v3 的 chapterGraph 形态它能直接吃。

### 3. `graph-extract-stage.ts` — prompt 收紧

**当前 prompt**(节选):
```
4. importance >= 6 才提取(过滤路人/环境)
5. relation 简洁(2-6 字),如 隶属 / 对抗 / 师徒 / 配偶 / 兄弟
```

**改成**:
```
【严格过滤】
4. importance >= 8 才提取(过滤路人/环境/场景/物品);任何只出现一次且无具体关系链的实体跳过
5. type 必须是以下 4 类之一,其他一律丢弃:
   - character(角色,有名字或代词指代)
   - faction(组织/门派/阵营)
   - event(本章发生的可命名事件)
   - item(关键物品/法器/秘笈,**只保留对剧情有直接作用的**)
6. relation 必须从以下词表选,不允许自由发挥:
   隶属 / 对抗 / 师徒 / 配偶 / 兄弟 / 朋友 / 敌对 / 亲属 / 师门 / 同门 / 敌师 / 盟友
7. 同名实体必须复用已有 graph key,不允许另起 key
```

代码侧同步改:`nodes.filter((n: any) => (n.importance ?? 0) >= 8)`(原 >= 6),新增 relation 词表校验。

### 4. `apps/web/src/views/Chapters.vue` + `ChapterEditor.vue` — emit 改名

**ChapterEditor.vue**(现 `update-stage` / `reprepare-archive` / `cancel-reviewing` / `confirm-archive`):
```vue
<ReviewingPanel
  v-if="chapter?.status === 'reviewing' && pendingArchiveData?.version === 3"
  :pending="pendingArchiveData"
  @save="(data) => emit('save-pending-archive', data)"
  @confirm="(data) => emit('confirm-archive-with-data', data)"
  @cancel="emit('prepare-archive-cancel')"
  @reprepare="emit('reprepare-archive')"
/>
```

**Chapters.vue**:
- `handleSavePendingArchive(data)` → `editor.savePendingArchiveData(data)`(已存在)
- `handleConfirmArchiveWithData(data)` → 先 `editor.savePendingArchiveData(data)` 再 `editor.archiveChapter()`
- `handlePrepareArchiveCancel` / `handleReprepareArchive` 保留

---

## 实施路径(commit 序列)

| # | Commit | 范围 |
|---|---|---|
| 1 | `refactor(v3): tighten graph-extract-stage prompt and importance threshold` | `graph-extract-stage.ts` prompt + 代码 |
| 2 | `refactor(v3): restore v2 ReviewingPanel.vue template with v3 data adapter` | 整个 `ReviewingPanel.vue` 文件(还原 + adapter + watcher + 防抖) |
| 3 | `refactor(v3): rewire ChapterEditor + Chapters emits to v2 save/confirm/cancel` | `ChapterEditor.vue` + `Chapters.vue` 4 处 emit 名改 |
| 4 | `test(v3): integration test for v3↔v2 adapter round-trip` | vitest,验证 fromV3/toV3 来回无丢失字段 |

总:4 commit,每个独立可 revert。

---

## 数据流(端到端)

```
[用户点"准备归档"]
  → POST /api/chapters/:id/prepare-archive
  → 4 stage 并行,写入 Chapter.pendingArchiveData = JSON.stringify({version:3, stages:{...}, meta})
  → Chapter.status = 'reviewing'
  → 前端 loadChapter → pendingArchiveData 解析成 v3 shape
  → 渲染 ReviewingPanel,内部 fromV3 转为 LocalData
  → 用户编辑 LocalData(角色/记忆/剧情弧线/图谱 任一 tab)
  → 防抖 800ms → emit('save', toV3(local, original))
  → Chapters.handleSavePendingArchive → editor.savePendingArchiveData → PATCH Chapter.pendingArchiveData
  → 用户点"确认归档"
  → emit('confirm', toV3(local, original))
  → Chapters.handleConfirmArchiveWithData → savePendingArchiveData → archiveChapter
  → POST /api/chapters/:id/archive
  → 后端读 Chapter.pendingArchiveData,转 v3 各 stage result,buildCumulativeGraph,事务写入
```

---

## 测试

**单元测试**(`apps/web/src/__tests__/views/ReviewingPanel.adapter.test.ts` 新增):
- `fromV3` 把 v3 shape 正确转为 LocalData
- `toV3(fromV3(x)) === x`(字段无损往返)
- main/side 事件 tag 正确分流
- 空 stages(全部 missing)不崩,产生空 LocalData

**手动测试**(开发环境):
1. 准备归档一个 chapter,看到 4 tab 全部出现
2. 在 角色 tab 编辑某角色 status(JSON),点"保存调整",刷新页面看 DB 字段已变
3. 在 剧情弧线 tab 改某 arc progress 滑块,保存,刷新看
4. 在 图谱 tab 用 EditableGraph 删一条边,保存,刷新看 graph.chapterGraph 边少了
5. 点"确认归档",归档成功,DB.pendingArchiveData 已清空,Chapter.status='archived'

**回归测试**:
- `pnpm --filter web typecheck` 通过
- `pnpm --filter server test` 现有 vitest 不挂(只动 graph-extract-stage.ts prompt 和一行 filter 阈值)

---

## Risk / 不做的事

- **不**恢复 timeline tab(v3 决定废弃 TimelineEvent,前端没有时间线模型;`memories.timelineEvents` 字段保留在 schema 里但 UI 不渲染)
- **不**改 memory / character / plot-arc 的抽取 prompt(用户反馈集中在图谱,这三块留作下一轮)
- **不**在 ReviewingPanel 内做"再校单 stage" UI(v3 后端可重跑 prepare-archive 整章,但前端 UI 没分 stage 入口);保留"再校整章"按钮
- **不**改 EditableGraph.vue 本身——v3 chapterGraph shape 与它吃的 shape 兼容
- **不**改 cumulativeGraph 的前端展示——`buildCumulativeGraph` 由后端 archive 端点独占

---

## Self-Review(写完 spec 后自查)

1. **占位符扫描**:无 TBD/TODO/留待后补。每节都给具体 commit、文件、函数。
2. **内部一致**:fromV3/toV3 字段映射对称(characterStates、mainEvents、sideEvents、plotArcs、chapterGraph、summary、emotions、foreshadowing、relationshipChanges 都双向流通)。
3. **范围**:聚焦 UI 还原 + 一处 prompt 微调,不牵扯其他子系统。
4. **歧义**:debounce 时长 800ms 写死;importance 阈值 8 写死;relation 词表 12 个写死。实施时无需再决策。