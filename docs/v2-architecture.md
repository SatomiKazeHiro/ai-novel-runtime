# V2 架构文档

> 给未来 Claude session 用的"动手前必读"。
> 范围：`apps/server/src/routes-v2/` + `services-v2/` + `apps/web/src/{views-v2,composables-v2,api-v2}/` + V2 前缀 Prisma 模型。
> 写于 2026-07-03，分支 `novel-design-in-v2`，**Phase 0-6 全部完成**。
> 后续 session 改动：Q4（死表保留）、Q5-剩余（A/B 类文档校准 + graph-organizer warn）、Q8（5 extractor 动态 budget）、C/D/E 类静默兜底逐项讨论并落代码（2026-07-03，commits 753a1d1/a7eef1f/4d59081/2eab022/9613f34）。

---

## 1. 定位：V2 是什么

V2 是**小说设计页的并行重写**。它不是 V1 的补丁，而是在 `/novel-design-v2/:storyId/...` 下重新实现一套章节设计闭环。

**与 V1 的根本区别**：

| 维度 | V1 | V2 |
|---|---|---|
| 业务目标 | 长篇稳定生成的完整 runtime | "作者手动掌控每次生成的上下文"的工具化重写 |
| 章节状态机 | 8 态（draft/generating/generated/scored/selected/reviewing/archived/rejected）— 见 [§6.3](#63--设计偏离-spec) | **4 态**（draft/analyzing/archived；`generating` 只在 `V2Draft.status`，不到 chapter）— 见 [§6.3](#63--设计偏离-spec) |
| 章节生命周期 | 生成候选 → 选最佳 → 准备归档 → 人工审查 → 确认归档（5 phase） | **生成候选 → 保存正文 → 5 路分析 → 3 步确认归档** |
| 多候选评分 | 7 维度 AI 评分 | **不做**（spec 明确不做的） |
| 旧数据迁移 | — | **不做**（spec 明确不做的） |
| AI provider | V1 `services/ai-provider-init.ts` | **复用 V1**（`services-v2/ai-provider.ts` 抛 NotImplemented，0 caller） |
| prompt 系统层 | `RuntimePromptCompiler` 全套 | **复用 V1**（system 走 V1；user message V2 自建） |
| prompt user 层 | V1 `packages/prompt-runtime` 9 层 | V2 自建 7 层（character/lore/scene/style/memory/plotArc/output） |
| 数据表 | 14 张 | **新增 9 张 V2 前缀表** + 复用 V1 的 `loreItem` / `workerTask` / `storyWorkerBinding` / `promptLog` |
| 路由前缀 | `/api/...` | `/api/v2/...` |

**V2 明确不在范围**（来自 Phase 6 plan）：
- 旧数据迁移
- 评分系统
- 图谱/时间线 AI 提取的图谱/时间线之外的方向（实际 V2 都实现了，但 V1 那种 5 phase 完整审查流不在）
- 处处兜底（要逐个讨论）—— **见 §7**

---

## 2. V2 业务核心流程

```
新建章节 (draft)
  → [设计页] 写大纲 / 选角色 / 选记忆 / 选弧线 / 选世界观    [配置面板]
  → 生成 Prompt 预览（不调 AI）
  → [SSE] 并行生成 ≤ 3 个候选
  → 选择候选 / 直接手写正文  → 保存正文（写 contentHash）
  → [5 路并行 AI 分析]：角色 / 记忆 / 弧线 / 时间线 / 图谱
       ↓ 5 个 extractor 各自调 AI + 5 路 result 合并到 pendingAnalysis
  → [人工编辑] 关系 / 状态（两个 textarea）
  → [归档 3 步确认]：hash 警告 / 新角色列表 / 最终确认
       ↓ 事务内：角色快照 / 记忆 / 弧线 / 时间锚点+事件 / 状态
       ↓ 事务后：detectInterruptedArcs（硬编码 5 章阈值）
  → [阅读] 左 archived 列表 + 右正文分段
```

**关键业务不变量**：
- `chapter.contentHash` 是分析触发条件（hash 变了就要重新分析）
- `chapter.analysisId` = `contentHash`（5 路分析全成功时设）
- `pendingAnalysis` 持有 5 路 AI 提取结果（JSON String）
- `chapterGraph` / `mergedGraph` 是图谱的双视图（per-chapter / cumulative）

**业务闭环的所有权**：
- 后端：`apps/server/src/routes-v2/chapters.ts`（**569 行，单文件容纳 CRUD + config + SSE + 级联 delete**——见 §6.6）
- 前端：`apps/web/src/views-v2/V2ChapterDesign.vue`（**1193 行，单文件容纳 5 步骤 + 5 路分析 + 图谱编辑器 + 归档弹窗**——见 §6.6）

---

## 3. V2 模块结构

### 3.1 后端（routes-v2/ + services-v2/）

```
routes-v2/
├── index.ts                       (34)  路由聚合注册
├── chapters.ts                    (650) CRUD + config + SSE 生成 + 级联 delete
├── chapters-generate.ts           (7)   纯桩（'/generate-stream' 返回 'V2 开发中'）
├── chapters-analysis.ts           (239) 5 路并行分析 + pendingAnalysis CRUD + 动态 budget
├── chapters-archive.ts            (228) pre-archive 校验 + archive 事务 + 中断检测
├── characters.ts                  (111) 角色 CRUD（5 字段 JSON String）
├── characters-analysis.ts         (4)   纯桩（注释："已合并到 chapters-analysis.ts"）
├── graph.ts                       (141) 图谱查询/提取/合并/保存 + 动态 budget
├── lore.ts                        (81)  世界观 CRUD（**复用 V1 loreItem 表**）
├── memories.ts                    (78)  记忆查询 + 临时记忆 CRUD
├── memories-analysis.ts           (4)   纯桩
├── plot-arcs.ts                   (33)  弧线查询（只读）
├── plot-arcs-analysis.ts          (4)   纯桩
├── prompt-logs.ts                 (37)  调用日志（**复用 V1 promptLog 表**）
├── timeline.ts                    (21)  时间线查询（只读）
└── worker-tasks.ts                (41)  任务模板（**复用 V1 workerTask+storyWorkerBinding 表**）

services-v2/
├── ai-call-logger.ts              (48)  写 V1 promptLog 表
├── ai-provider.ts                 (20)  纯桩（aiCall 抛 NotImplemented）
├── character-extractor.ts         (150) 1 次 AI 调 + 动态 budget + `truncateByParagraph`
├── config-defaults.ts             (172) 4 类数据源默认勾选 + 大模型无关的语义搜索
├── content-budget.ts              (17)  **新** V2 wrapper，复用 V1 `computeContentCharBudget`
├── extractor-types.ts             (11)  ExtractorResult<T> 判别联合
├── graph-extractor.ts             (129) 1 次 AI 调 + 动态 budget + `truncateByParagraph`
├── graph-organizer.ts             (159) AI 合并 / codeMerge 兜底
├── graph-types.ts                 (30)  类型 + 颜色表
├── hash.ts                        (7)   sha256
├── memory-extractor.ts            (185) 2 次 AI 调（抽取 + 合并全局）+ 动态 budget
├── memory-merger.ts               (15)  纯桩（mergeMemories 抛 NotImplemented）
├── plot-arc-extractor.ts          (118) 1 次 AI 调 + 动态 budget + `truncateByParagraph`
├── plot-arc-interrupt.ts          (31)  硬编码 5 章阈值
├── plot-arc-merger.ts             (33)  纯函数无 AI，但 0 caller
├── prompt-assembler.ts            (278) system 走 V1 / user 自建 7 层 + `runtimeDegraded`
└── timeline-extractor.ts          (117) 1 次 AI 调 + 动态 budget + `truncateByParagraph`
```

**4 个桩文件**（无功能，0 caller）：
- `routes-v2/chapters-generate.ts`
- `routes-v2/characters-analysis.ts`
- `routes-v2/memories-analysis.ts`
- `routes-v2/plot-arcs-analysis.ts`
- `services-v2/ai-provider.ts`
- `services-v2/memory-merger.ts`

### 3.2 前端（views-v2/ + composables-v2/ + api-v2/）

```
views-v2/
├── NovelDesignV2Layout.vue        (194)  10 项左侧菜单 + NavBar
├── V2Chapters.vue                 (159)  章节列表 + 新建 + 删除 + 发展
├── V2ChapterDesign.vue            (1282) **核心**：完整 5 步设计流
├── V2ChapterReader.vue            (320)  左 archived 列表 + 右正文分段
├── V2Characters.vue               (216)  角色列表（5 字段 DynamicTags）
├── V2CharacterDetail.vue          (238)  角色详情 + 快照按章节号切换
├── V2LoreBook.vue                 (172)  世界观 6 分类
├── V2Memory.vue                   (236)  4 类型 tab + 临时记忆 CRUD
├── V2PlotArcs.vue                 (171)  4 状态 tab
├── V2Graph.vue                    (415)  双视图 Cytoscape + 章节导航
├── V2Timeline.vue                 (69)   极简：列表 anchor + events — **见 §6.1 已知 bug**
├── V2StoryWorkerTask.vue          (158)  任务模板管理
└── V2PromptLogs.vue               (330)  调用日志分页

composables-v2/
├── useChapterConfig.ts            (204)  4 类数据源状态 + 加载 + 语义搜索 + 失败 warn
└── useDraftStream.ts              (148)  SSE 候选流管理（最多 3 并发 + degraded 透传）

api-v2/
├── index.ts                       axios 封装，前缀 /api/v2
├── chapters.ts                    v2ChaptersApi（16 方法，含 generateStream 用裸 fetch）
├── characters.ts                  v2CharactersApi
├── memories.ts                    v2MemoriesApi
├── plotArcs.ts                    v2PlotArcsApi
├── lore.ts                        v2LoreApi
├── graph.ts                       v2GraphApi
├── timeline.ts                    v2TimelineApi
├── worker-tasks.ts                v2WorkerTasksApi
└── prompt-logs.ts                 v2PromptLogsApi
```

---

## 4. V2 数据模型

### 4.1 Prisma V2 表（schema.prisma:407-616）

| Model | 关键字段 | 替代/补充 V1 |
|---|---|---|
| `V2Character` | `id, storyId, slug, name, isProtagonist, identity/appearance/temperament/personality/speechStyle[]` | V1 `Character`（5 字段都 JSON String 存） |
| `V2CharacterSnapshot` | `characterId, chapterNumber, identity[], relationships, status` | V1 无对应（V2 新设计） |
| `V2Memory` | `type (enum), category (enum), content, importance, participants, originChapterNumber, isActive` | V1 `Memory`（无 type/category 概念） |
| `V2MemoryMergeLog` | `inputMemoryIds, outputMemoryIds` | **0 引用**（见 §6.4） |
| `V2PlotArc` | `status, isMainline, firstChapterNumber, lastUpdateChapterNumber` | V1 `PlotArc`（无 mainline 概念） |
| `V2PlotArcDraft` | `plotArcId?, chapterId, action, title, description, status, isMainline, mergeInfo` | **0 引用**（见 §6.4） |
| `V2Chapter` | `number Float, title, content, contentHash, status, outline, analysisId, config JSON, pendingAnalysis JSON, chapterGraph JSON, mergedGraph JSON` | V1 `Chapter`（无 4 个 JSON String，无 contentHash） |
| `V2Draft` | `chapterId, content, config JSON, status` | V1 `Draft`（无 status 字段） |
| `V2TimelineEvent` | `title, summary, participants (String), location, importance, timeExpression JSON, storyOrder?, narrativeOrder?, anchorId` | V1 `TimelineEvent`（**完全不同的字段语义**） |
| `V2TimelineAnchor` | `storyId, name, description` | V1 `TimelineEvent.position` (Y.DDDHH 编码) → **V2 抛弃 position 字段** |
| `V2TimelineRelation` | `fromEventId, toEventId, relation (before/after/simultaneous), timeExpression JSON` | V1 spec 有，V2 实际建表但 0 引用 |

### 4.2 4 个 V2 枚举

- `V2MemoryType`: `global / chapter / scene / temporary`（V1 4 层 + 多了临时层语义）
- `V2MemoryCategory`: `relationship_change / foreshadowing / emotional_change / event_memory`
- `V2PlotArcStatus`: `active / interrupted / completed / closed`
- `V2ChapterStatus`: `draft / generating / analyzing / archived`（**4 态**，V1 8 态）

### 4.3 V1/V2 共用表

V2 显式复用以下 V1 表（不在 V2 重新建表）：
- `loreItem`（`routes-v2/lore.ts:8-13`）
- `workerTask` + `storyWorkerBinding`（`routes-v2/worker-tasks.ts:9, 19`）
- `promptLog`（`services-v2/ai-call-logger.ts:25` 写入）

这是 spec §2 "业务层不复用" 的**有意例外**——避免双写日志、双写世界观、双写任务模板。

---

## 5. V2 与 V1 的关键设计偏离

| 维度 | V1 | V2 | 文件:行 |
|---|---|---|---|
| 状态机 | 8 态 | **4 态** | `schema.prisma:428-433` |
| 时间线 position | `Y.DDDHH` Float | **完全抛弃** | `schema.prisma:590-600` |
| 故事时间 vs 叙事时间 | spec 建议 | 字段加了 `storyOrder/narrativeOrder` 但前端 V2Timeline.vue:19 不用 | `schema.prisma:577-578` |
| 时间关系 | spec 期望"边" | 表建好 0 引用 | `schema.prisma:602-616` |
| 解析器分层 | "Extractor 抽取 / Resolver 关系" | timeline-extractor 直接给完整 result，**无独立 Resolver** | `services-v2/timeline-extractor.ts:9-13` |
| 记忆合并 | 跨章 latest-by-`originUid` | 同章内 `isActive=false` 软删 + 新版本共存 | `schema.prisma:473-489` |
| 角色描述 | 单字符串 | 5 字段 JSON String | `schema.prisma:441-445` |
| 角色快照 | 旧版 1 表 | 独立 `V2CharacterSnapshot` 表 | `schema.prisma:455-471` |
| 中断检测 | 软检测 | **硬编码 5 章阈值** | `services-v2/plot-arc-interrupt.ts:18` |
| 5 路分析 | 串行 | `Promise.all` 并行 | `routes-v2/chapters-analysis.ts:92-93` |
| 分析中可改内容 | 不允许 | 允许（只 archived 拒绝） | `routes-v2/chapters.ts:128-130` |
| 章节 number | Int | Float（schema 遗留—V2 无 isSideStory 字段 / 无 fromChapterNumber / 无侧线 UI / 无 route 处理；Q9 暂缓, 见 [§7.4](#74-需用户拍板设计决策)） | `schema.prisma:533` |
| Prompt user 装配 | V1 `packages/prompt-runtime` 9 层 | V2 自建 7 层（character/lore/scene/style/memory/plotArc/output） | `services-v2/prompt-assembler.ts:38-153` |
| Token 预算（生成） | 详细 BudgetConfig + `countTokens` | 简单字符估算 `Math.floor(contextLength * 0.85) * 2`（prompt-assembler） | `services-v2/prompt-assembler.ts:166` |
| Token 预算（分析） | 复用 V1 `computeContentCharBudget`（按段落切） | `truncateByParagraph` + `MIN_CHAR_BUDGET=2000` 下限（5 extractor） | `services-v2/content-budget.ts` (Q8) |

---

## 6. V2 已知问题

### 6.1 🐛 线上崩溃 bug

**`apps/web/src/views-v2/V2Timeline.vue:19`**

```vue
:title="`${anchor.label} (Y.${anchor.position.toString().padEnd(5, '0')})`"
```

- 访问 `anchor.position` 和 `anchor.label`
- Prisma `V2TimelineAnchor` 实际只有 `id, storyId, name, description, createdAt, updatedAt` — **无 position、无 label**
- 任何 anchor 行都会触发 `TypeError: Cannot read properties of undefined (reading 'toString')`
- **打开 `/novel-design-v2/:storyId/timeline` 页立即崩溃**

**修复（已应用）**：把 `anchor.label` 改成 `anchor.name`，把 `anchor.position.toString()` 整段删掉（schema 没这个字段；V2 抛弃了 Y.DDDHH 编码）。

### 6.2 🐛 数据丢失风险（需用户决策是否加守卫）

`routes-v2/chapters-archive.ts:117-120` 归档时**无条件**：

```typescript
await tx.v2Memory.updateMany({
  where: { storyId, type: 'global' },
  data: { isActive: false }
})
```

如果 5 路分析中 `memory-extractor` 因任何原因失败（AI 超时、JSON 解析错、网络断开），它返回 `{ chapterMemories:[], globalMemories:[], sceneMemories:[] }` —— 看起来"成功"，但实际**没抽出新记忆**。然后 archive 路由照样 `updateMany isActive=false`，**把现有全局记忆全灭掉**。

类似模式：
- `services-v2/character-extractor.ts:78` 失败返回 `{ characters: [] }` → archive 把它当"本章没新角色"处理
- `services-v2/timeline-extractor.ts:69-71` 失败返回 `{ events:[], defaultAnchorName:'主线' }` → archive 创建一个 "主线" 锚点但没事件
- `services-v2/plot-arc-extractor.ts:81-82` 失败返回 `{ arcs: [] }` → archive 跳过弧线更新
- `services-v2/graph-extractor.ts:75-77` 失败返回 `{ nodes:[], edges:[] }` → archive 写空 `mergedGraph`

### 6.3 📐 设计偏离 spec

**状态机：V2 砍成 4 态是有意偏离 V1 8 态**（Q6，2026-07-03 已落文档，未来 session 不必再问）

V2 4 态走法（`schema.prisma:428-433` + `V2Chapters.vue:48-52`）：

| 步骤 | 触发动作 | chapter.status | 备注 |
|------|---------|----------------|------|
| 1. 写作 | 设计页打字/编辑 | `draft` | 唯一可改正文的窗口 |
| 2. 生成候选 | 点"生成候选文章" | `draft` | `V2Draft.status='generating'` 携带进度；**chapter.status 不动** |
| 3. 分析 | 点"分析" → 5 路并行 AI | `analyzing` | 仅在 5 路全成功时翻状态（见 `chapters-analysis.ts:158-162`） |
| 4. 归档 | 点"归档" → 事务写入 | `archived` | 终态；事务后做中断检测 |

V2 chapter.status **从不写入 `generating`** —— `generating` 是草稿级状态（`V2Draft.status`）。V2 只有 1 个撤销路径（`revert-analysis`：`analyzing → draft`，`chapters-archive.ts:227-238`）；取消生成候选 = 物理 DELETE 草稿行（`chapters.ts:436`）。

V1 8 态上锁问题清单（`packages/shared/src/index.ts:3-12`），按问题排序：

| 问题 | 体现 | 文件:行 |
|------|------|---------|
| 死状态 `scored` | enum 存在但**无任何 route** 写入 `chapter.status='scored'`；`draftsApi.score`（`api/chapters.ts:49`）只写 `Draft.score` | — |
| 半死状态 `rejected` | 仅 `generate-processor.ts:45` 的 `SKIP_STATUSES` 出现；用户拒绝候选时 chapter 不动 | — |
| 4 套白名单分散维护 | GENERATE/SELECT/PREPARE/CONFIRM 各自维护 allowed status | `chapters-generate.ts:161-173, 325-334`，`chapters-archive.ts:30-35, 69-78, 138-143` |
| 原子锁无回退 | `updateMany` 抢锁后中间崩 → 卡在 `generating` 无清理路径 | `chapters-generate.ts:161-173` |
| reviewing 期间锁字段 | PUT 仅允许 `content`/`pendingArchiveData`，想改 `outline` 也得先取消 | `chapters-crud.ts:117-127, 146-148, 255-272` |
| 取消 review = 删章节 | "退回 selected"的路径不存在，退路是 DELETE | `views/Chapters.vue:306-319` |

V2 砍掉的 3 个实验性 feature（V1 把它们固化成必经步骤 = 锁问题的根源）：

| V1 必经 feature | V2 处理 | 砍掉的态 |
|-----------------|---------|----------|
| AI 7 维评分（`packages/scoring-engine`） | **不做**（spec 明确） | `scored` |
| 必经 selectDraft 选最佳候选 | 作者直接在 textarea 改最终正文 | `selected` |
| ReviewingPanel 必经归档审查 | analyzing 期间直接编辑 + `isStale` 软提示（`V2ChapterDesign.vue:616-622`） | `reviewing` |
| 拒绝候选的 reject 半成品态 | DELETE `V2Draft` 行 | `rejected` |

V2 不需要上锁 = 实际有效态只有 3 个（`draft` / `analyzing` / `archived`）；中间崩了回 `draft`、无数据丢失；用 PUT 字段白名单 + 各 API 状态前置检查代替 V1 的 `updateMany` 原子锁。

**给未来 session 的一句话**：如果业务方在 V2 上提"加个评分步骤"或"加个确认页"，先确认他们要的是 V2 5 路分析（`/api/v2/chapters/:id/analyze`）已经提供的，还是真的需要新增加锁的中间态——目前的设计哲学是**用工具代替必经状态**。

---

- **Prompt 装配 token 公式**：`Math.floor(contextLength * 0.85) * 2` 把字符数当 token，对长 prompt 严重超限。contextLength=64000 → maxChars=108800 字符 ≈ 54000 token（OK），但如果 contextLength=32000 → maxChars=54400 字符 ≈ 27200 token（OK），对 prompt 实际是 char/2.5~3 的中英文混合文本可能仍偏紧。
- **5 路分析并发数**：`chapters-analysis.ts:92-93` `Promise.all` 5 路并发。**实测 baseline 是 max-of ≈ 120s**（不是 5 分钟），原因：`packages/ai-provider/src/index.ts:241` `setTimeout(() => controller.abort(), options?.timeoutMs ?? 120000)` 给每路 AI 调用兜了 120s，5 路并发是 **max-of 而非 sum-of**。**前端再多加一层总兜底**：`apps/web/src/api-v2/chapters.ts:55-79` `analyzeFetch` helper 用 `AbortController` 强制 180s 上限（见 [§6.3](#63--设计偏离-spec) "5 路并发" 行 → Q10）—— 防止 server 端在异常路径（DB hang / 解析挂死）下永远不返回，前端用户可感知的"卡住"场景被截断成 `{success: false, error: '分析超时...'}`。

### 6.4 💀 死代码 / 死表

**0 引用的代码文件**：
- `services-v2/ai-provider.ts`（aiCall 抛 NotImplemented）
- `services-v2/memory-merger.ts`（mergeMemories 抛 NotImplemented，逻辑被内联在 `memory-extractor.ts:128-144`）
- `services-v2/plot-arc-merger.ts`（实现完整但 archive 路由不调）

**0 引用的 Prisma 表**：
- `V2MemoryMergeLog`（schema.prisma:491-500）
- `V2PlotArcDraft`（schema.prisma:517-528）
- `V2TimelineRelation`（schema.prisma:602-616）

**0 实际功能的桩路由**：
- `routes-v2/chapters-generate.ts`（`/generate-stream` 返回 'V2 开发中'，实际端点在 `chapters.ts:275`）
- `routes-v2/characters-analysis.ts`（空函数，注释 "已合并到 chapters-analysis.ts"）
- `routes-v2/memories-analysis.ts`（同上）
- `routes-v2/plot-arcs-analysis.ts`（同上）

**Q4 决策 (2026-07-03)**：**全部保留作 stub，暂不清理**。理由：未来扩展（如 AI 辅助角色属性更新、prompt 前显式输入、archived 后重抽）可能复用这些桩；删除成本高（要清 Prisma migration + 检查反向引用）但收益不确定。

### 6.5 🔇 静默兜底清单（按文件:行）

> 用户已要求"避免无效兜底"。V2 有 50+ 处 `} catch { ... }` / `} catch (e) { app.log.error(...) }` / `try { JSON.parse(...) } catch { return {} }`。
>
> 2026-07-03 用户决策：C/E/D 三类逐项讨论并已落代码（commit `753a1d1` / `a7eef1f` / `4d59081`），A/B 类暂未处理（见 §7.3 Q5）。

按性质分 5 类（详见附表 §9）：

| 类别 | 数量 | 典型位置 | 风险 | 处理 |
|---|---|---|---|---|
| A. JSON 解析失败 → 空对象 | ~12 | `prompt-assembler.ts:240/254`, `chapters.ts:245/319`, `chapters-analysis.ts:12/42` | 低 | **暂未动**（Q5 待定） |
| B. AI 调用失败 → 空结果 | 5 | `character/memory/plot-arc/timeline/graph-extractor` | **高**（见 §6.2） | **暂未动**（Q5 待定） |
| C. SSE/网络层失败 | 6 | `chapters.ts:504/524/537/559/565`, `useDraftStream.ts:97` | 中（错误信息丢失） | ✅ **A+B**：fire-and-forget 保留 + `app.log.warn`/`console.warn` 留痕 |
| D. 运行时加载失败 → FALLBACK_SYSTEM | 1 | `prompt-assembler.ts:28-37`（已加 `runtimeDegraded`） | **高**（写作人格丢失） | ✅ **degraded 标志**：assemblePrompt 返回 `runtimeDegraded: true` → 透传到 SSE `runtime-warning` 事件 → 前端 `onNotify` toast |
| E. 业务级静默 | ~26 | `useDraftStream.ts:21`, `useChapterConfig.ts:141`, `V2ChapterDesign.vue:849/1015/1058/1080`, `V2ChapterReader.vue:111/125`, `V2Graph.vue:267/294` | 中（用户看不到错误） | ✅ **B 方案**：前端 `message.error/warning` 或 `console.warn` 留痕 |

**处理方案解释**：
- **A+B（C 类）**：fire-and-forget 写法（`.catch` 不 rethrow）保留以免拖累主流程；但必须 log 留痕，方便调试。
- **B（E 类）**：默认升级为前端可见 toast；如不希望阻塞（写回非关键状态），用 `console.warn` 留痕即可。
- **D**：写作人格降级不能继续隐藏——加 `runtimeDegraded` 标志 → SSE `runtime-warning` 事件 → 前端 `onNotify(message, 'warning')`，作者立即看到提示。

### 6.6 📏 大文件

- `apps/server/src/routes-v2/chapters.ts` (208 行) — 纯 CRUD 骨架（list/create/detail/update/delete + 级联 delete 事务）；Q12 拆分后已不持有 config/memory-search/preview/drafts/generate 五类端点
- `apps/server/src/routes-v2/chapters-archive.ts` — archive / preArchive / savePending（既有）
- `apps/server/src/routes-v2/chapters-analysis.ts` — 5 路并行 AI analyze（既有）
- `apps/server/src/routes-v2/chapters-config.ts` (125 行) — POST config + memory-search + preview（Q12 新）
- `apps/server/src/routes-v2/chapters-drafts.ts` (36 行) — 候选 list + delete（Q12 新）
- `apps/server/src/routes-v2/chapters-generate.ts` (317 行) — SSE 流式生成（Q12 从 stub 替换为真实实现）
- `apps/server/src/routes-v2/provider-configs.ts` (26 行) — AI 模型列表（Q12 独立化）
- `apps/server/src/services-v2/prompt-assembler.ts` (278 行) — system compile + 7 段 user + `runtimeDegraded` 透传 + 字符级截断 + safeParse × 2
- `apps/web/src/views-v2/V2ChapterDesign.vue` (626 行) — 5 步骤壳 + 数据源 tab + 归档弹窗（**Step3 + Step4 已拆到 `_components/`**）
- `apps/web/src/views-v2/_components/V2Step3Panel.vue` (317 行) — AI 模型配置 + Prompt 预览 + SSE 候选生成 + 正文
- `apps/web/src/views-v2/_components/V2Step4Panel.vue` (478 行) — 5 路分析 tab + 角色/记忆/弧线/时间/图谱编辑器 + cytoscape 迷你画布
- `apps/web/src/views-v2/V2Graph.vue` (415 行) — 双视图 + diff + Cytoscape + 章节导航

### 6.7 🔁 与 V1 服务的近似重复

6 个 V2 extractor 与 V1 对应文件的 prompt 模板和 AI 调用结构**几乎平行**：

- `services-v2/character-extractor.ts` ≈ V1 `services/character-extractor.ts`
- `services-v2/memory-extractor.ts` ≈ V1 `services/memory-extractor.ts`
- `services-v2/plot-arc-extractor.ts` ≈ V1 `services/plot-arc-extractor.ts`
- `services-v2/timeline-extractor.ts` ≈ V1 `services/timeline-extractor.ts`
- `services-v2/graph-extractor.ts` ≈ V1 `services/graph-extractor.ts`
- `services-v2/ai-call-logger.ts` ≈ V1 `services/ai-call-logger.ts`（**写同一张表**）

Spec 声明"零引用 V1 业务代码"（`2026-06-29-v2-overall-design.md:19`），但实际是**重写而非复用**——可考虑把 V1 services 抽公共包（`packages/`），让 V1/V2 都从公共包继承。

### 6.8 🪒 V1 P0 #2 bug 在 V2 复现 → ✅ 已修复 (Q8)

V1 的 P0 #2（`content.slice(0, 8000)` 粗截断）已在 V1 主路径修复（`truncateByParagraph`），但 V2 5 个 extractor 全部用同样的 8000 字硬截断：

- `services-v2/character-extractor.ts:34`
- `services-v2/memory-extractor.ts:105`
- `services-v2/plot-arc-extractor.ts:67`
- `services-v2/timeline-extractor.ts:28`
- `services-v2/graph-extractor.ts:13`

加 `prompt-assembler.ts:222` 段落级硬截断 `p.slice(0, maxChars) + '...'`。

**Q8 决策 (2026-07-03)**：**深修**。不简单加最小 truncation，而是按 model contextLength 动态算预算。

**实现 (commit `2eab022`)**：
- 新增 `services-v2/content-budget.ts` — V2 wrapper，复用 V1 `computeContentCharBudget(contextLength, maxTokens)` 公式，加 `MIN_CHAR_BUDGET=2000` 下限避免小模型 AI 拿到空上下文
- 5 个 extractor 签名加 `contentCharBudget: number` 参数，改调 `truncateByParagraph(content, contentCharBudget)`
- `routes-v2/chapters-analysis.ts:runAnalyzer` 和 `routes-v2/graph.ts` POST `/graph/extract` 调用 `resolveProvider` 一次算 budget 传给 extractor；provider 解析失败时降级 8000 + `app.log.warn`
- V2 服务层 `substring(0, 8000)` 已 0 匹配

**效果**：默认模型（64k context × 4k maxTokens）→ charBudget ≈ 64608 字符（旧 8000），约 8 倍提升；段落级切段避免硬切句子中间。

---

## 7. 待用户决策的开放问题

按"该不该现在做"分类。**AI 不应自作主张动这些，先问。**

### 7.1 已决策 / 已修复（2026-07-03 之前完成）

- [x] **Q1**: V2Timeline.vue 崩溃（§6.1）— commit `7882b84`，改 `label` → `name` + 删 `position` 引用
- [x] **Q2**: archive 路由无守卫（§6.2）— commit `dccc734`，5 路 extractor 改用 `ExtractorResult<T>` 区分 success/failed；archive 失败 → 422 阻断 + 前端 toast
- [x] **Q3**: prompt-assembler 静默回退（§6.5 D 类）— commit `4d59081`，加 `runtimeDegraded` 标志 + SSE `runtime-warning` 事件 + 前端 toast
- [x] **Q4**: 死代码 / 死表清理（§6.4）— 决策：**全部保留**作 stub，未来扩展可能复用
- [x] **Q5 部分**: 静默兜底 C/E/D 类（§6.5）— 已落代码：A/B 暂不动（保留旧行为）
- [x] **Q8**: 8000 字硬截断（§6.8）— commit `2eab022`，深修：动态 budget + `truncateByParagraph`

### 7.2 必须修（线上 bug）

（暂无，Q1 已修）

### 7.3 建议修（数据丢失风险）

（暂无，Q2 已修）

### 7.4 需用户拍板（设计决策）

- [x] **Q5-剩余**: 静默兜底 A/B 类（§6.5）— commit 路径：graph-organizer:50-52 加 console.warn + §9 表全面校准。A 类（JSON 解析）已通过 `getConfigOrThrow`/`getPending`/`safeParseArr`/`safeParseObj` 抛错阻断；B 类（AI 失败）已通过 5-way ExtractorResult 阻断；仅余 3 处 ⏸️ 留痕（详见 §9 表注）
- [x] **Q6**: V2 4 状态 vs V1 8 状态（§6.3）— **有意偏离**，砍掉 4 个 V1 必经 feature（评分/选最佳/ReviewingPanel/reject）；调研结论落 [§6.3](#63--设计偏离-spec)。新会话不再问。
- [x] **Q7**: V1/V2 extractor 近似重复（§6.7）— **抽 V2 内部公共层**（方案 D）。`apps/server/src/services-v2/extractor-base.ts` (`runAiExtraction<T>` + `parseAIJson`) 替代 5 份复制粘贴；V1 不动（V1 是参考留档，最终会清除）。commit `1f69418`。
- [x] **Q9**: V2 1.01 侧线支持 — **暂缓** (2026-07-04)。调研发现 V2 没有 `isSideStory` 字段 / 没有 `fromChapterNumber` / 无侧线 UI / 无 route 处理；schema Float 是"留可能性"的非有意设计。**触发条件**：V2 章节生成流程（生成 → 分析 → 归档）端到端走通 + 持续运行无返工后重评；届时如确认不需要侧线则 schema 改 Int，如需要则走 §6 风格完整迁移（加 `isSideStory` + `fromChapterNumber` + UI）。
- [x] **Q10**: 5 路分析并发（§6.3）— **前端加 180s total deadline，不加 per-extractor timeout**。决策依据：provider 层 `setTimeout(() => controller.abort(), 120000)` 在 [§6.3](#63--设计偏离-spec) 已经兜住每路 AI 调用，per-extractor timeout 与之高度重叠几乎冗余；唯一用户可感知的"长时间无响应"是 server 异常路径（DB/parse hang），前端裸 fetch 用 AbortController 在 180s 截断为 `{success:false, error:'分析超时...'}` 让用户可关页 / 单路重抽 fail 项。落地：`apps/web/src/api-v2/chapters.ts` 新增 `ANALYZE_TIMEOUT_MS=180_000` + `analyzeFetch` helper，`analyze`/`analyzeSingle` 共用。

### 7.5 大文件拆分（结构性）

- [x] **Q11** (2026-07-04): V2ChapterDesign.vue 1193 → 626 行；Step3 (模型+Prompt+候选+正文, 317 行) + Step4 (5 路分析+cytoscape, 478 行) 抽到 `views-v2/_components/`。**决策**：Step1/Step5 太小不值得拆；Step3 + Step4 是真正高价值目标。**Composable 归属**：useDraftStream / useCytoscapeLifecycle 子组件内部调（避免双 SSE / 双 cytoscape 实例）；useChapterConfig 父级单一调用，打包成 `reactive()` 通过 `props.config` 共享给 Step3（避免双 ref 实例不同步）。**状态同步**：大 ref (`chapter`) props 直传；defineExpose 暴露子组件 ref 给父级 `updateStep()` 读；事件型操作 (runAnalyze / regenerateSingle / saveEdits 等) 走 emit，副作用集中父级。详见 `lexical-sprouting-sloth.md` 计划 + commit 落盘。
- [x] **Q12** (2026-07-04): routes-v2/chapters.ts 650 → 208 行；按职责拆 5 个新文件（+ provider-configs 独立 = 6 文件格局），跟现有 chapters-archive / chapters-analysis 完全对齐（5 兄弟：`chapters.ts` CRUD 骨架 5 端点 / `chapters-archive.ts` archive / `chapters-analysis.ts` 5 路 analyze / `chapters-config.ts` config+memory-search+preview 3 端点 / `chapters-drafts.ts` 候选 list+delete 2 端点 / `chapters-generate.ts` SSE generate 1 端点）+ `provider-configs.ts` 独立。**决策**：路由风格保持现状（hardcode `/chapters/...`），不借机改 prefix（KNOWN-ISSUES #7 留单独 PR）；`getConfigOrThrow` 5 行函数复制而非抽 utils，跟 archive/analysis 现有惯例对齐（4 份副本）；`chapters-generate.ts` 替换前 generate-stream stub 路径 grep 验证 0 调用方安全删除；前端零改动（API 路径全部不变）。详见 `2026-07-04-q12-routes-chapters-split-design.md` spec + 4 commit (Q12-1/2/3/4)。

### 7.6 文档待补

- [ ] **Q13**: V2 业务 spec `2026-06-29-v2-overall-design.md` 是否已落盘到 docs/superpowers/specs/？（已落盘但路径需确认）

---

## 8. 重构建议（路线图草案，仅供参考）

按风险 / 收益分 3 批。**2026-07-03 状态标注**：

### 批 1（必做，低风险）
- ✅ 修 V2Timeline.vue 崩溃（Q1，commit `7882b84`）
- ✅ 前端 analyze 180s total deadline（Q10，commit 见 §7.4）— 防止 server 异常路径 hang 时前端永久无响应
- ⏸️ 清理 `chapters-generate.ts` 桩文件 — **Q4 决定保留**
- ⏸️ 删除 / 保留 `characters/memories/plot-arcs-analysis.ts` 桩文件 — **Q4 决定保留**

### 批 2（建议做，中风险）
- ✅ 加 archive 守卫（Q2，commit `dccc734`）：5-way ExtractorResult + 422 阻断 + 前端 toast
- ⏸️ 抽公共包：6 个 extractor 公共逻辑（prompt 模板 / AI 调用 / JSON 解析）迁到 `packages/v2-extractors/`，让 V1/V2 共用（Q7 决策）
- ✅ V2ChapterDesign.vue 拆 Step3 + Step4 子组件（Q11，commit 见 §7.5）— Step1/Step5 太小不值得拆；Step3（模型+Prompt+候选+正文, 317 行）+ Step4（5 路分析+cytoscape, 478 行）抽到 `_components/`
- ✅ chapters.ts 拆 5 兄弟文件 + provider-configs 独立（Q12，commits 见 §7.5）— chapters.ts 650 → 208 行纯 CRUD 骨架；SSE generate 313 行独立；generate-stream stub 替换为真实实现

### 批 3（设计决策，需用户拍板再做）
- 🟡 静默兜底统一处理（Q5 部分）：C/E/D 已落代码（commit `753a1d1`/`a7eef1f`/`4d59081`），A/B 类待 Q5 决策
- ⏸️ 死表 / 死代码清理（Q4 已决策：**保留**）
- ✅ 8000 字截断换动态 budget（Q8，commit `2eab022`）
- ✅ V2 4 状态 vs V1 8 状态调研落文档（Q6，2026-07-03；§6.3）

---

## 9. 附表：50 处静默兜底完整清单

按文件:行 + 性质 + 处理状态。**处理状态说明**：
- ✅ **已 fail-loud**：路由层 `getConfigOrThrow`/`getPending` 抛错 → 422；extractor `parseAIJson` 返 null → `return fail(...)`；extractor AI 失败 → `return fail(...)`；Prisma 错误码翻译；C/E/D 类升级
- ⏸️ **暂未动**：保留 warn 但不阻断，或业务分支非错误场景
- 🎯 **设计意图**：非"错误兜底"，是结构分支（已加 console.warn 留痕）

**注意**：本表经过 2026-07-03 二次校准。之前版本误把 Prisma 错误码翻译（characters.ts）、extractor `return fail(...)`、graph-organizer `throw` 标为 ⏸️ 静默兜底，实际它们都已 fail-loud。详见 commit `2779edd`（JSON/AI 完整性）和 `dccc734`（5-way ExtractorResult）。

| 文件:行 | 类别 | 兜底行为 | 状态 |
|---|---|---|---|
| `services-v2/prompt-assembler.ts:28-37` | D | Runtime base 加载失败 → FALLBACK_SYSTEM + `runtimeDegraded: true` 透传 | ✅ |
| `services-v2/prompt-assembler.ts:242-254` | A | safeParseArr 失败 → throw `「X」的 Y 字段 JSON 解析失败`，调用方 catch → 422 | ✅ |
| `services-v2/prompt-assembler.ts:256-268` | A | safeParseObj 同上 | ✅ |
| `services-v2/character-extractor.ts:80-82` | B | AI 失败 → `return fail('AI 调用失败: ...')`（ExtractorResult） | ✅ |
| `services-v2/character-extractor.ts:128-134` | A | JSON.parse 失败 → try 抓首个 `[]` 数组；都失败 → return null；caller `return fail(...)` | ✅ |
| `services-v2/memory-extractor.ts:118-120` | B | AI 抽取失败 → `return fail(...)` | ✅ |
| `services-v2/memory-extractor.ts:140-141` | B | AI 合并全局失败 → `return fail(...)` | ✅ |
| `services-v2/memory-extractor.ts:178-181` | A | parseAIJson 二次 fallback → null → caller fail | ✅ |
| `services-v2/plot-arc-extractor.ts:84-86` | B | AI 失败 → `return fail(...)` | ✅ |
| `services-v2/plot-arc-extractor.ts:111-114` | A | parseAIJson 二次 fallback → null → caller fail | ✅ |
| `services-v2/timeline-extractor.ts:73-75` | B | AI 失败 → `return fail(...)` | ✅ |
| `services-v2/timeline-extractor.ts:110-113` | A | parseAIJson 二次 fallback → null → caller fail | ✅ |
| `services-v2/graph-extractor.ts:79-81` | B | AI 失败 → `return fail(...)` | ✅ |
| `services-v2/graph-extractor.ts:121-125` | A | parseAIJson 二次 fallback → null → caller fail | ✅ |
| `services-v2/graph-organizer.ts:50-52` | 🎯 | **结构分支** + 降级：无 AI provider → codeMerge + `console.warn`（留痕） | 🎯 |
| `services-v2/graph-organizer.ts:88-90` | B | AI 合并失败 → `throw new Error('AI 合并图谱失败: ...')`；catcher: chapters-analysis.ts:91 → status:failed / graph.ts:108 → Fastify 500 | ✅ |
| `services-v2/graph-organizer.ts:93-95` | B | AI 输出格式错 → `throw new Error(...)`；同上 | ✅ |
| `services-v2/graph-organizer.ts:152-155` | A | parseAIJson 二次 fallback → null → throw | ✅ |
| `routes-v2/chapters-archive.ts:6` | A | pendingAnalysis 解析失败 → throw，caller catch → 422 | ✅ |
| `routes-v2/chapters.ts:9-14` | A | getConfigOrThrow：JSON 坏 → throw with ctx，调用方 catch → 422 | ✅ |
| `routes-v2/chapters.ts:276-278` | A | preview assemblePrompt throw → 422 | ✅ |
| `routes-v2/chapters.ts:397-399` | A | generate assemblePrompt throw → 422 | ✅ |
| `routes-v2/chapters.ts:354-357` | C | 写 chapter.config 失败 → `app.log.warn` | ✅ |
| `routes-v2/chapters.ts:504` | C | 写 promptLog 失败 → `app.log.warn` | ✅ |
| `routes-v2/chapters.ts:524` | C | 更新 promptLog 失败 → `app.log.warn` | ✅ |
| `routes-v2/chapters.ts:537-545` | C | 更新 v2Draft 失败 → `app.log.warn` + 重试一次 | ✅ |
| `routes-v2/chapters.ts:559` | C | 写 error log 失败 → `app.log.warn` | ✅ |
| `routes-v2/chapters.ts:565` | C | SSE send 失败 → `app.log.warn`（连接已断） | ✅ |
| `routes-v2/chapters.ts:534` | E | 删除章节级联清理 → 整体包 `prisma.$transaction` | ✅ |
| `routes-v2/chapters.ts:580-582` | E | 末章级联清理 → 同 `$transaction` 内 | ✅ |
| `routes-v2/chapters-analysis.ts:12-17` | A | getPending：JSON 坏 → throw，caller catch → 422 | ✅ |
| `routes-v2/chapters-analysis.ts:73-77` | C | prevMerged 解析失败 → `app.log.warn` + warnings push | ✅ |
| `routes-v2/graph.ts:9-19` | A | parseOrEmpty：JSON 坏 → inline 422 | ✅ |
| `routes-v2/characters.ts:82-91` | ✅ | **Prisma 错误码翻译**：P2025→404 / P2002→409 / 其他→500 + `app.log.error` | ✅ |
| `routes-v2/characters.ts:100-109` | ✅ | **Prisma 错误码翻译**：P2025→404 / P2003→409 / 其他→500 + `app.log.error` | ✅ |
| `composables-v2/useDraftStream.ts:21` | E | loadDrafts 失败 → `onNotify('error')` | ✅ |
| `composables-v2/useDraftStream.ts:42` | E | 错误响应体解析失败 → `onNotify('warning')` | ✅ |
| `composables-v2/useDraftStream.ts:97` | C | SSE 事件 JSON.parse 失败 → `console.warn` | ✅ |
| `composables-v2/useDraftStream.ts:94` | D | Runtime degraded SSE 事件 → `onNotify('warning')` | ✅ |
| `composables-v2/useChapterConfig.ts:58` | A | parsedConfig 解析失败 → null + `console.warn` | ⏸️（保留 warn，非阻断） |
| `composables-v2/useChapterConfig.ts:141` | E | 自动生成默认配置失败 → 硬编码默认 + `console.warn` | ⏸️（设计意图：兜底可工作，留痕） |
| `views-v2/V2ChapterDesign.vue:840` | E | 用户 JSON 文本解析失败 → `showToast('error')`（**保留输入**） | ✅ |
| `views-v2/V2ChapterDesign.vue:1010` | E | 写回 _lastPrompt 失败 → `console.warn` | ✅ |
| `views-v2/V2ChapterDesign.vue:1033` | A | 候选 config 解析失败 → `console.warn`（保留 warn） | ⏸️ |
| `views-v2/V2ChapterDesign.vue:1015` | E | 写大纲失败 → `showToast('error')` | ✅ |
| `views-v2/V2ChapterDesign.vue:1058` | E | loadAnalysis 失败 → `showToast('error')` | ✅ |
| `views-v2/V2ChapterDesign.vue:1080` | E | preArchive 失败 → `showToast('error')` | ✅ |
| `views-v2/V2ChapterDesign.vue:1093` | E | confirmArchive 失败 → `showToast('error')` | ✅ |
| `views-v2/V2ChapterReader.vue:111` | E | loadChapters 失败 → `message.error('error')` | ✅ |
| `views-v2/V2ChapterReader.vue:125` | E | selectChapter 失败 → `message.error('error')` | ✅ |
| `views-v2/V2Graph.vue:267` | E | selectChapter 失败 → `message.error('error')` | ✅ |
| `views-v2/V2Graph.vue:294` | E | loadPrevMerged 失败 → `console.warn`（diff 标记不可用） | ✅ |

---

## 10. 一句话总结

V2 是 V1 的**工具化重写**：4 态状态机（故意偏离 V1 8 态以绕开锁定）、并行 5 路分析、3 步确认归档、配置面板作为核心交互入口。**Phase 0-6 全部完成 (2026-07-03)**。**已落实**：Q1（崩溃修复）、Q2（archive 守卫）、Q3（runtime degraded 透传）、Q4（死表保留）、Q5（C/D/E + A/B 类静默兜底；仅 graph-organizer 无 provider 路径留 warn）、Q6（4 态 vs 8 状态：调研结论落 [§6.3](#63--设计偏离-spec)）、Q7（V2 内部 5 extractor 抽公共层 `extractor-base.ts`，commit `1f69418`；V1 不动 = 参考留档最终清除）、Q8（动态 budget）、Q10（前端 analyze 180s total deadline；per-extractor timeout 不加 = 与 provider 120s 高度重叠冗余；详见 [§6.3 "5 路分析并发数"](#63--设计偏离-spec)）、Q11（V2ChapterDesign 拆 Step3+Step4 子组件到 `views-v2/_components/`，1193 → 626 行；详见 [§7.5](#75-大文件拆分结构性)）、Q12（routes-v2/chapters.ts 650 → 208 行纯 CRUD 骨架；按职责拆 5 兄弟文件 + provider-configs 独立 = 6 文件格局；generate-stream stub 替换为真实 SSE 实现；详见 [§7.5](#75-大文件拆分结构性)）。**仍待决策**：Q9（暂缓, 触发条件见 §7.4）、Q13。
