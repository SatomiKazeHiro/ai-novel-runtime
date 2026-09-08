# 累计图谱引入审查工作台 · 设计稿

> 状态:草案  ·  范围:v3 prepare-archive 之后、archive 之前 · 日期:2026-07-27

## 1. 背景与目标

今天 v3 阶段的流程是:prepare-archive 自动抽章节图谱、记忆、剧情弧线;用户在 ReviewingPanel 里编辑;点"确认归档"时由后端在事务前再 `buildCumulativeGraph` 并写入 `Chapter.cumulativeGraph`。

这有两个不对:

1. **图谱抽卡的二阶段属性被埋掉**。AI 抽出来的"全局图谱"应当是用户可以反复 roll 的工作产物,不是归档时的 derived 字段。
2. **本章图谱和累计图谱耦合**。当前只能"修改本章图谱后再让后端合并",用户没有独立的累计图谱编辑权。

目标:把累计图谱提升为**用户在 ReviewingPanel 主动生成、独立编辑、首次自动入库、之后手动保存**的草稿;同时把归档时的"自动构建"换成"读取用户已维护的草稿 + 校验"。

## 2. 用户决策(已拍板)

| # | 决策点 | 选定 |
| --- | --- | --- |
| 1 | 命名 | **本章图谱** / **累计图谱** |
| 2 | 初始生成时机 | 用户主动(看到本章图谱差不多了才点"生成累计图谱") |
| 3 | 归档前校验 | 拦住,弹 toast 提示"先去生成累计图谱" |
| 4 | 重生成 | 不自动;手动点"重新生成";本章图谱改了累计图谱不被动重算 |
| 5 | 编辑独立性 | 本章图谱 = 本章图谱,累计图谱 = 累计图谱,互不干扰 |
| 6 | 累计图谱首次生成的持久化 | **首次入库自动写一次**,之后所有改动走"保存调整"手动按钮 |
| 7 | 累计图谱语义 | 累计图谱 = merge(本章图谱 + 上一章的累计图谱) + AI 去重,与现有 `buildCumulativeGraph` 等价 |
| 8 | 累计图谱抽卡属性 | 用户可重新生成,与"图谱也是抽卡属性来的"一致 |

## 3. 非目标

- 不动 `TimelineEvent`(v3 已标记删除,符合 CLAUDE.md)。
- 不改现有 `buildCumulativeGraph` 算法逻辑(只迁移调用点)。
- 不重做章节图谱抽取(`graph-extract-stage`)与记忆/剧情弧线抽取。
- 不动归档时其他 stage 的提交路径。

## 4. 数据模型改动

### 4.1 现有列沿用

`Chapter.cumulativeGraph String?` (JSON `GraphSnapshot`) 当前在 archive endpoint 里由 `buildCumulativeGraph` 覆写。**语义改造为"用户维护的累计图谱草稿"**,由新增的 build/save 路径写入,归档时直接消费。

### 4.2 新增列

```prisma
model Chapter {
  // ...
  cumulativeGraph              String?   // JSON: 用户维护的累计图谱草稿 (v3 起由前端写入)
  cumulativeGraphGeneratedAt   DateTime? // 用户首次主动生成的最新时间; null = 未生成
  // ...
}
```

- 归档校验:**`cumulativeGraphGeneratedAt IS NULL` 视为未生成,拦下归档。**
- 唯一改动语义:`cumulativeGraphGeneratedAt` 由新增 build endpoint 写入。手动保存编辑(`PATCH`)不更新此列。

### 4.3 旧列语义切分

| 阶段 | `Chapter.cumulativeGraph` | `cumulativeGraphGeneratedAt` |
| --- | --- | --- |
| 未进 reviewing | null | null |
| 用户已 generate(尚未编辑) | AI 返回的累计图谱 | GENERATE 时间戳 |
| 用户已 generate + 编辑 | 用户最新草稿 | 不变(只表示"是否生成过") |
| 归档提交后 | 同上(归档只是消费,不重新生成) | 不变 |
| 用户再次进 reviewing | 同上 | 不变 |

## 5. 后端设计

### 5.1 新增端点

| 路径 | 方法 | 作用 |
| --- | --- | --- |
| `/api/chapters/:chapterId/cumulative-graph` | `GET` | 拉取累计图谱草稿 + `generatedAt`。未生成时返回 `{ generatedAt: null, graph: null }`。 |
| `/api/chapters/:chapterId/cumulative-graph/build` | `POST` | 调 `buildCumulativeGraph`,写 `cumulativeGraph` + `cumulativeGraphGeneratedAt`。**首次自动入库就是这个调用触发的持久化。** |
| `/api/chapters/:chapterId/cumulative-graph` | `PATCH` | 保存用户编辑后的累计图谱(纯 JSON 写入)。要求 `cumulativeGraphGeneratedAt IS NOT NULL`。 |

#### 5.1.1 GET 响应

```ts
type CumulativeGraphGetResp = {
  success: true
  data: {
    generatedAt: string | null          // ISO; null = 未生成
    graph: GraphSnapshot | null         // null = 未生成
  }
}
```

#### 5.1.2 POST /build 语义

入参:
```ts
{ chapterGraph: GraphSnapshot }
```

前端将用户在屏上编辑的最新本章图谱携带上来;后端只信这个值,不再自己从 pendingArchiveData / chapter 列回查。这样让来源唯一、调试一致。

服务函数:
```ts
async function buildAndSaveCumulativeGraph(
  app: FastifyInstance,
  chapterId: string,
  chapterGraph: GraphSnapshot
): Promise<{ graph: GraphSnapshot; generatedAt: string; aiCalled: boolean }>
```

调用 `buildCumulativeGraph(app, input)`,其中:
- `chapterGraph` ← 入参
- `prevCumulativeGraph` = 取章节的 parentChapter(若有)或上一主线的 `Chapter.cumulativeGraph`

成功:写入两列,响应 `{ success: true, data: { graph, generatedAt, aiCalled } }`。
失败:返回 `{ success: false, error: <msg> }`,**不修改两列**。

权限:仅当章节状态 ∈ {`draft`, `reviewing`} 允许调用,其他返回 400。

#### 5.1.3 PATCH 语义

入参: `{ graph: GraphSnapshot }`(纯 JSON)。

校验:
- 章节存在。
- 章节状态 ∈ {`draft`, `reviewing`}。
- `cumulativeGraphGeneratedAt IS NOT NULL`(未生成必须先 build)。

落库:`cumulativeGraph = JSON.stringify(graph)`,**不**改 `cumulativeGraphGeneratedAt`。

### 5.2 archive endpoint 改动

文件:`apps/server/src/routes/chapters-archive.ts`(archive 部分)。

变更:
1. **移除** `buildCumulativeGraph` 调用块(行 409-437 的"v3 build cumulativeGraph" 注释段)。
2. 增加校验:若 `chapter.cumulativeGraphGeneratedAt == null` **或** `chapter.cumulativeGraph == null`,返回 `400 { success: false, error: 'cumulative-graph-not-generated' }`。
3. 在 phase 3 transaction 内,把 `chapter.cumulativeGraph` 解析为 `GraphSnapshot` 写入 `Chapter.cumulativeGraph` 字段(幂等)。

> 注意:`chapter.cumulativeGraph` 列在 phase 3 写后状态不变(因为本身已是最终值)。这一段的核心是"不再让后端二次构建",而不是"删掉这列的写入"。

### 5.3 retry-stage 'graph' 不变

`rebuild-cumulative-graph` 不需要走 retry-stage:累计图谱不归在 4-stage 抽取流水线(它是用户的产物,不归 AI 抽卡的结果)。

## 6. 前端设计

### 6.1 API 客户端新增

`apps/web/src/api/cumulative-graph.ts`:
```ts
import { api } from '../utils/api'

export const cumulativeGraphApi = {
  get:    (chapterId: string) => api.get(`/api/chapters/${chapterId}/cumulative-graph`),
  build:  (chapterId: string) => api.post(`/api/chapters/${chapterId}/cumulative-graph/build`, {}),
  save:   (chapterId: string, graph: GraphSnapshot) =>
            api.patch(`/api/chapters/${chapterId}/cumulative-graph`, { graph }),
}
```

`apps/web/src/api/chapters.ts` 暴露 `getCumulativeGraph / buildCumulativeGraph / saveCumulativeGraph` 转发别名,与现有导出风格一致。

### 6.2 ReviewingPanel 改造

文件:`apps/web/src/views/ReviewingPanel.vue`。

**结构变化**:把现有 graph 区块(行 360-380)替换为两段平铺 layout(同一 tab 内):

```
[n-card #1] 本章图谱
   [现有 EditableGraph ref=chapterGraphRef + 失败回放 + retry-stage 按钮]
[n-card #2] 累计图谱
   [若 generatedAt == null]
     + 引导文案:本章图谱编辑差不多后,点下面生成。
     [生成累计图谱] button
   [若 generatedAt != null]
     [重新生成] button  · [保存调整] button (内部走 cumulative-graph PATCH)
     [EditableGraph ref=cumulativeGraphRef, initialGraphData=cumulativeGraphData]
```

n-card #2 仍然在 "图谱" tab 内,不增加新 tab——和现有"图谱" 是同级分段(用户原话"放到下面,上下各加一个标题")。

**新增 props**:
```ts
const props = defineProps<{
  pending: V3PendingArchiveData
  retryingStages?: Partial<Record<StageName, boolean>>
  chapterId: string
}>()
```

**新增 state**:
```ts
const cumulativeGraphRef = ref<InstanceType<typeof EditableGraph> | null>(null)
const cumulativeGraphDraft = ref<GraphSnapshot>({ nodes: [], edges: [] })
const cumulativeGeneratedAt = ref<string | null>(null)
const buildingCumulative = ref(false)
const savingCumulative = ref(false)
```

**初始化流程**(`onMounted` 或 `watch pending` 后):
```ts
async function loadCumulativeGraph() {
  const res = await cumulativeGraphApi.get(props.chapterId)
  const { generatedAt, graph } = res.data?.data ?? {}
  cumulativeGeneratedAt.value = generatedAt ?? null
  cumulativeGraphDraft.value = graph ?? { nodes: [], edges: [] }
}
```

**生成按钮处理**:
```ts
async function handleBuildCumulative() {
  const chapterGraph = chapterGraphRef.value?.getData()
  if (!chapterGraph) return
  buildingCumulative.value = true
  try {
    const res = await cumulativeGraphApi.build(props.chapterId, chapterGraph)
    const data = res.data?.data
    cumulativeGraphDraft.value = data.graph
    cumulativeGeneratedAt.value = data.generatedAt
  } catch (err) {
    // 用 n-message-error 展示 err.message
  } finally {
    buildingCumulative.value = false
  }
}
```

**保存累计图谱**:
```ts
async function handleSaveCumulative() {
  if (!cumulativeGraphRef.value) return
  const graph = cumulativeGraphRef.value.getData()
  savingCumulative.value = true
  try {
    await cumulativeGraphApi.save(props.chapterId, graph)
  } finally {
    savingCumulative.value = false
  }
}
```

> 关键:此 PATCH 期间,**不**触发 `pullGraphDraftIntoLocalData` for `cumulativeGraphDraft`,因为它从来不属于 `localData.value.graph`——独立行。Edit and save 是独立的子流程。

**handleSave / handleConfirm 改动**:
- `pullGraphDraftIntoLocalData` 只拉 `chapterGraphRef`(累计图谱不参与 pendingArchiveData 流程)。
- 不在 toV3 写 `stages.graph.result.cumulativeGraph`。
- 移除 `handleConfirm` 内的 `setTimeout(..., 200)` finally;按钮 loading 改由父级 `archiveRunning` 控制(§6.4)。

### 6.3 adapter 改动

文件:`apps/web/src/views/ReviewingPanel.adapter.ts`。

- **`V3PendingArchiveData` 不变**(后端 `stages.graph.result` 仍然只有 `chapterGraph`)。
- **`LocalData.graph` 不变**:`cumulativeGraph` **不进 adapter**,它由 §6.2 单独 `cumulativeGraphDraft` ref 维护,不走 pendingArchiveData。
- `fromV3` / `toV3` 保持现状:只为 `stages.graph.result` 写 `chapterGraph`。

### 6.4 ChapterEditor / Chapters.vue 改动

文件:`apps/web/src/views/chapters/ChapterEditor.vue`(以及 `apps/web/src/views/Chapters.vue` 如有需要)。

`prepare-archive` 完成后,`editable-chapters` 状态切到 reviewing 时,`ChapterEditor` 调用 ReviewingPanel 的 mount 前需要 `chapterId` 就绪。`chapterId` 在 props 上已有,直接传 ReviewingPanel:

```vue
<ReviewingPanel
  v-if="currentChapter?.status === 'reviewing'"
  :pending="pendingData"
  :retrying-stages="retryingStages"
  :chapter-id="currentChapter.id"
  @save="handleSavePendingArchive"
  @confirm="handleConfirmArchiveWithData"
  ...
/>
```

**前端校验(软)**:在 `handleConfirm` emit 前,如果 ReviewingPanel 内部检测 `cumulativeGeneratedAt == null`,弹一个 `n-message-error` 并阻止 emit。

后端强校验在 5.2 已落地。

**归档 loading bug 修复(同步)**:`handleConfirm` 局部 `confirming` + `setTimeout(200)` 会让按钮"转圈后停",而 archive 实际需要数十秒。改为:
- 在 `Chapters.vue` 里新增 `archiving: Ref<boolean>`(与现有 `archiving` 区分,**改名**:`archiveRunning` 更清晰)。
- `handleConfirmArchiveWithData(data)` 前后切换 `archiveRunning.value`:
  ```ts
  archiveRunning.value = true
  try {
    const saved = await editor.savePendingArchiveData(data)
    if (!saved.success) return
    const result = await editor.archiveChapter()
    if (result.success) await handleBackToTree()
  } finally {
    archiveRunning.value = false
  }
  ```
- ReviewingPanel 接收 `:archive-running="archiveRunning"` prop,绑定到"确认归档"按钮的 `:loading`。ReviewingPanel 自己的 `confirming` 立即生效,不再 `setTimeout`。

> 顺带修复:此举让 ReviewingPanel 的归档按钮 loading 状态由父组件管理,符合 CLAUDE.md 的"父级持有状态"惯例。

## 7. 数据流总览

### 7.1 用户主动生成(首次入库 = 自动保存)

```
[User clicks "生成累计图谱"]
  ReviewingPanel.handleBuildCumulative()
    chapterGraph = chapterGraphRef.value.getData()
    POST /api/chapters/:id/cumulative-graph/build
      body = { chapterGraph }
      buildAndSaveCumulativeGraph(app, chapterId, chapterGraph)
        buildCumulativeGraph(...)  ← AI dedup
        Chapter.cumulativeGraph = JSON.stringify(result.graph)
        Chapter.cumulativeGraphGeneratedAt = ISO now
      return graph, generatedAt, aiCalled
    ReviewingPanel.cumulativeGraphDraft / cumulativeGeneratedAt ← updated
```

### 7.2 用户编辑累计图谱后手动保存

```
[User edits in EditableGraph → 自管]
[User clicks "保存调整" 在累计图谱区块]
  ReviewingPanel.handleSaveCumulative()
    cumulativeGraphRef.getData()
    PATCH /api/chapters/:id/cumulative-graph
      Chapter.cumulativeGraph = JSON.stringify(graph)
      // 不动 cumulativeGraphGeneratedAt
```

### 7.3 归档

```
[User clicks "确认归档"]
  ChapterEditor.handleConfirmArchiveWithData(data)
    savePendingArchiveData(data)         // 走原 prepare-archive/save-pending 流程
    archiveChapter()                     // POST /archive
      [Server] 检查 chapter.cumulativeGraphGeneratedAt != null
        ✗ → 400 cumulative-graph-not-generated
        ✓ → 在 transaction 内写 Chapter.cumulativeGraph = chapter.cumulativeGraph(幂等)
      → status='archived'
```

### 7.4 本章图谱改回退重抽 → 累计图谱是否重算?

不。保留独立性。用户想再 roll 一次累计图谱就点"重新生成"。

## 8. 测试

> apps/server 当前 Vitest 已就绪但**无测试文件**(KNOWN-ISSUES.md)。本次新增对应单测脚手架。

### 8.1 后端

文件:`apps/server/test/services/cumulative-graph-route.test.ts`(新建)。

覆盖:
1. **GET 未生成**:`cumulativeGraphGeneratedAt == null` → 返回 `{ generatedAt: null, graph: null }`。
2. **GET 已生成**:返回正确 graph。
3. **POST /build 首次成功**:写入两列。
4. **POST /build 不存在章节**:返回 400。
5. **PATCH 未生成时拒绝**:返回 400 cumulative-graph-not-generated。
6. **PATCH 已生成时正确写入**:`generatedAt` 不动。

需要 mocked Fastify instance + mocked prisma(用 vitest mock)。

### 8.2 前端

文件:暂不加 e2e。仅做编译期 / 类型检查。

## 9. 已知遗留 / 暂不解决

- **图谱重渲染抖动 bug**:`pullGraphDraftIntoLocalData` 触发 `localData.graph.chapterGraph` 变化,导致 EditableGraph 的 `initialGraphData` prop 引用变化 → cytoscape 重 init。**保留现有 fingerprint 行为可考虑,但本 spec 不解决。**
  - 触发路径与累计图谱引入无关(只涉及本章图谱),可以在累计图谱 UI 稳态后单独 PR 修复。
  - 用户已经同意:累计图谱引入后再回头看。

- **删除累计图谱**:不提供 DELETE 端点;若用户想重置,编辑成空即可。

## 10. 文档迁移

- `docs/LOGIC.md`:**累计图谱章节更新**——明确它是用户维护的草稿(不再是归档 derived)。
- `Process.md`:**归档章节附注**——"前置条件:累计图谱已生成"。
- 不必更新 `CLAUDE.md`,除非新增端点在路由表里。

## 11. 改动清单(供下游 plan 参考)

后端:
- `prisma/schema.prisma`:`Chapter.cumulativeGraphGeneratedAt DateTime?` 新增
- `prisma/migrations/<ts>_chapter_cumulative_graph_generated_at.sql`:AddColumn
- `apps/server/src/routes/chapters-archive.ts`:新增 GET/POST/PATCH 三端点、archive 移除 `buildCumulativeGraph` 块并加校验
- `apps/server/src/services/cumulative-graph.ts`:**不变**(继续被新端点复用)
- `apps/server/test/...`:新增测试(可选)

前端:
- `apps/web/src/api/cumulative-graph.ts`:新增
- `apps/web/src/api/chapters.ts`:导出转发
- `apps/web/src/views/ReviewingPanel.adapter.ts`:**不变**(已有 chapterGraph 路径已自洽;累计图谱不进 v3 payload)
- `apps/web/src/views/ReviewingPanel.vue`:拆分本章 / 累计两个 graph 区块、新增 3 个 handler、props 加 chapterId、修复 loading bug
- `apps/web/src/views/Chapters.vue` / `chapters/ChapterEditor.vue`:`archiveRunning` 父级管理、ReviewingPanel 接收该 prop
