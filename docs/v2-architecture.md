# V2 架构文档

> 给未来 Claude session 用的"动手前必读"。
> 范围：`apps/server/src/routes-v2/` + `services-v2/` + `apps/web/src/{views-v2,composables-v2,api-v2}/` + V2 前缀 Prisma 模型。
> 写于 2026-07-03，分支 `novel-design-in-v2`，Phase 0-5 已完成、Phase 6（配置面板）进行中。

---

## 1. 定位：V2 是什么

V2 是**小说设计页的并行重写**。它不是 V1 的补丁，而是在 `/novel-design-v2/:storyId/...` 下重新实现一套章节设计闭环。

**与 V1 的根本区别**：

| 维度 | V1 | V2 |
|---|---|---|
| 业务目标 | 长篇稳定生成的完整 runtime | "作者手动掌控每次生成的上下文"的工具化重写 |
| 章节状态机 | 8 态（draft/generating/generated/selecting/selected/select_failed/developing/reviewing/archived） | **4 态**（draft/generating/analyzing/archived） |
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
├── chapters.ts                    (569) CRUD + config + SSE 生成 + 级联 delete
├── chapters-generate.ts           (7)   纯桩（'/generate-stream' 返回 'V2 开发中'）
├── chapters-analysis.ts           (174) 5 路并行分析 + pendingAnalysis CRUD
├── chapters-archive.ts            (206) pre-archive 校验 + archive 事务 + 中断检测
├── characters.ts                  (97)  角色 CRUD（5 字段 JSON String）
├── characters-analysis.ts         (4)   纯桩（注释："已合并到 chapters-analysis.ts"）
├── graph.ts                       (102) 图谱查询/提取/合并/保存
├── lore.ts                        (60)  世界观 CRUD（**复用 V1 loreItem 表**）
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
├── character-extractor.ts         (147) 1 次 AI 调，截断 8000 字
├── config-defaults.ts             (172) 4 类数据源默认勾选 + 大模型无关的语义搜索
├── graph-extractor.ts             (126) 1 次 AI 调，截断 8000 字
├── graph-organizer.ts             (159) AI 合并 / codeMerge 兜底
├── graph-types.ts                 (30)  类型 + 颜色表
├── hash.ts                        (7)   sha256
├── memory-extractor.ts            (181) 2 次 AI 调（抽取 + 合并全局），截断 8000 字
├── memory-merger.ts               (15)  纯桩（mergeMemories 抛 NotImplemented）
├── plot-arc-extractor.ts          (115) 1 次 AI 调，截断 8000 字
├── plot-arc-interrupt.ts          (31)  硬编码 5 章阈值
├── plot-arc-merger.ts             (33)  纯函数无 AI，但 0 caller
├── prompt-assembler.ts            (255) system 走 V1 / user 自建 7 层 + 字符级截断
└── timeline-extractor.ts          (114) 1 次 AI 调，截断 8000 字
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
├── V2ChapterDesign.vue            (1193) **核心**：完整 5 步设计流
├── V2ChapterReader.vue            (317)  左 archived 列表 + 右正文分段
├── V2Characters.vue               (216)  角色列表（5 字段 DynamicTags）
├── V2CharacterDetail.vue          (238)  角色详情 + 快照按章节号切换
├── V2LoreBook.vue                 (172)  世界观 6 分类
├── V2Memory.vue                   (236)  4 类型 tab + 临时记忆 CRUD
├── V2PlotArcs.vue                 (171)  4 状态 tab
├── V2Graph.vue                    (411)  双视图 Cytoscape + 章节导航
├── V2Timeline.vue                 (69)   极简：列表 anchor + events — **见 §6.1 已知 bug**
├── V2StoryWorkerTask.vue          (158)  任务模板管理
└── V2PromptLogs.vue               (330)  调用日志分页

composables-v2/
├── useChapterConfig.ts            (199)  4 类数据源状态 + 加载 + 语义搜索
└── useDraftStream.ts              (138)  SSE 候选流管理（最多 3 并发）

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
| 章节 number | Int | **Float**（计划支持 1.01 侧线，但 V2Chapters.vue:25-26 UI 只支持整数） | `schema.prisma:533` |
| Prompt user 装配 | V1 `packages/prompt-runtime` 9 层 | V2 自建 7 层（character/lore/scene/style/memory/plotArc/output） | `services-v2/prompt-assembler.ts:38-153` |
| Token 预算 | 详细 BudgetConfig + `countTokens` | 简单字符估算 `Math.floor(contextLength * 0.85) * 2` | `services-v2/prompt-assembler.ts:156` |

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

- **状态机 4 态 vs spec 8 态**：`scored / selected / reviewing / rejected` 在 V2 全部消失。Spec 没解释为什么压缩（可能因为"不做评分、不做选最佳"）。需要确认是"有意"还是"漏做"。
- **Prompt 装配 token 公式**：`Math.floor(contextLength * 0.85) * 2` 把字符数当 token，对长 prompt 严重超限。contextLength=64000 → maxChars=108800 字符 ≈ 54000 token（OK），但如果 contextLength=32000 → maxChars=54400 字符 ≈ 27200 token（OK），对 prompt 实际是 char/2.5~3 的中英文混合文本可能仍偏紧。
- **5 路分析并发数**：`chapters-analysis.ts:92-93` `Promise.all` 5 路并发，**没有总 timeout**，最坏情况 5 个 AI 同时挂 5 分钟。

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

### 6.5 🔇 静默兜底清单（按文件:行）

> 用户已要求"避免无效兜底"。V2 有 50+ 处 `} catch { ... }` / `} catch (e) { app.log.error(...) }` / `try { JSON.parse(...) } catch { return {} }`。
>
> **这些不能由 AI 静默修**。需用户决定每类的处理策略。

按性质分 5 类（详见附表）：

| 类别 | 数量 | 典型位置 | 风险 |
|---|---|---|---|
| A. JSON 解析失败 → 空对象 | ~12 | `prompt-assembler.ts:234/242`, `chapters.ts:245/319`, `chapters-analysis.ts:12/42` | 低 |
| B. AI 调用失败 → 空结果 | 5 | `character/memory/plot-arc/timeline/graph-extractor` | **高**（见 §6.2） |
| C. SSE/网络层失败 | 6 | `chapters.ts:457/477/483/495/498`, `useDraftStream.ts:88` | 中（错误信息丢失） |
| D. 运行时加载失败 → FALLBACK_SYSTEM | 1 | `prompt-assembler.ts:28` | **高**（写作人格丢失） |
| E. 业务级静默 | ~26 | `useChapterConfig.ts:57/137`, `V2ChapterDesign.vue:970/989/1011/1084/1102`, `V2ChapterReader.vue:109-110/122-124` | 中（用户看不到错误） |

### 6.6 📏 大文件

- `apps/server/src/routes-v2/chapters.ts` (569 行) — CRUD + config + memory-search + drafts + preview + SSE generate + 级联 delete（**6 个职责**）
- `apps/server/src/services-v2/prompt-assembler.ts` (255 行) — system compile + 7 段 user + token 预算 + safeParse × 2
- `apps/web/src/views-v2/V2ChapterDesign.vue` (1193 行) — 5 步骤 + 5 路分析 tab + 图谱编辑器 + 归档弹窗 + SSE 候选管理（**整个工作流**）
- `apps/web/src/views-v2/V2Graph.vue` (411 行) — 双视图 + diff + Cytoscape + 章节导航

### 6.7 🔁 与 V1 服务的近似重复

6 个 V2 extractor 与 V1 对应文件的 prompt 模板和 AI 调用结构**几乎平行**：

- `services-v2/character-extractor.ts` ≈ V1 `services/character-extractor.ts`
- `services-v2/memory-extractor.ts` ≈ V1 `services/memory-extractor.ts`
- `services-v2/plot-arc-extractor.ts` ≈ V1 `services/plot-arc-extractor.ts`
- `services-v2/timeline-extractor.ts` ≈ V1 `services/timeline-extractor.ts`
- `services-v2/graph-extractor.ts` ≈ V1 `services/graph-extractor.ts`
- `services-v2/ai-call-logger.ts` ≈ V1 `services/ai-call-logger.ts`（**写同一张表**）

Spec 声明"零引用 V1 业务代码"（`2026-06-29-v2-overall-design.md:19`），但实际是**重写而非复用**——可考虑把 V1 services 抽公共包（`packages/`），让 V1/V2 都从公共包继承。

### 6.8 🪒 V1 P0 #2 bug 在 V2 复现

V1 的 P0 #2（`content.slice(0, 8000)` 粗截断）已在 V1 主路径修复（`truncateByParagraph`），但 V2 5 个 extractor **全部用同样的 8000 字硬截断**：

- `services-v2/character-extractor.ts:34`
- `services-v2/memory-extractor.ts:105`
- `services-v2/plot-arc-extractor.ts:67`
- `services-v2/timeline-extractor.ts:28`
- `services-v2/graph-extractor.ts:13`

加 `prompt-assembler.ts:222` 段落级硬截断 `p.slice(0, maxChars) + '...'`。

---

## 7. 待用户决策的开放问题

按"该不该现在做"分类。**AI 不应自作主张动这些，先问。**

### 7.1 必须修（线上 bug）

- [ ] **Q1**: V2Timeline.vue 崩溃（§6.1）— 修 `label` → `name`，删 `position` 引用

### 7.2 建议修（数据丢失风险）

- [ ] **Q2**: archive 路由在 memory-extractor 失败时仍 `updateMany isActive=false`（§6.2）— 加守卫（extract 失败 → 阻断 archive）
- [ ] **Q3**: prompt-assembler.ts:28 静默回退 FALLBACK_SYSTEM（§6.5 D 类）— 运行时加载失败应给前端提示

### 7.3 需用户拍板（设计决策）

- [ ] **Q4**: 死代码 / 死表清理（§6.4）— 6 个文件 + 3 张表：删除 vs 保留作 stub？
- [ ] **Q5**: 静默兜底策略（§6.5）— 5 类兜底分别怎么处理？
  - A 类（JSON 解析失败 → 空）：保留 / 升级为 warning / 阻断？
  - B 类（AI 失败 → 空）：保留 / 阻断 archive / 升级为重试？
  - C 类（SSE 错误）：保留 / 升级为 toast？
  - D 类（Runtime 加载失败）：保留 / 升级为阻断？
  - E 类（业务级）：保留 / 升级为 toast？
- [ ] **Q6**: 4 状态 vs 8 状态（§6.3）— V2 砍掉 scored/selected/reviewing/rejected 是有意还是漏做？
- [ ] **Q7**: 6 个 V2 extractor 与 V1 的近似重复（§6.7）— 抽公共包 / 接受重复 / 删 V1？
- [ ] **Q8**: 8000 字硬截断（§6.8）— 同样 bug 模式 5 处，是否统一按 token 截断？
- [ ] **Q9**: V2Chapters.vue UI 不支持 1.01 侧线（§5）— schema Float 但 UI 整数：是 stub 还是不需要？
- [ ] **Q10**: 5 路分析并发（§6.3）— 是否加总 timeout + 单路 timeout？

### 7.4 大文件拆分（结构性）

- [ ] **Q11**: V2ChapterDesign.vue 1193 行（§6.6）— 是否按 phase 拆 Step1~Step5 子组件？
- [ ] **Q12**: routes-v2/chapters.ts 569 行（§6.6）— CRUD / config / SSE / delete 是否分文件？

### 7.5 文档待补

- [ ] **Q13**: V2 业务 spec `2026-06-29-v2-overall-design.md` 是否已落盘到 docs/superpowers/specs/？（如未落盘建议迁入）

---

## 8. 重构建议（路线图草案，仅供参考）

按风险 / 收益分 3 批：

### 批 1（必做，低风险）
- 修 V2Timeline.vue 崩溃
- 清理 `chapters-generate.ts` 桩文件（或实现真端点）
- 删除 / 保留 `characters/memories/plot-arcs-analysis.ts` 桩文件

### 批 2（建议做，中风险）
- 加 archive 守卫（Q2）：extract 失败 → 阻断 archive + 前端 toast
- 抽公共包：6 个 extractor 公共逻辑（prompt 模板 / AI 调用 / JSON 解析）迁到 `packages/v2-extractors/`，让 V1/V2 共用
- V2ChapterDesign.vue 拆 Step1~Step5 子组件

### 批 3（设计决策，需用户拍板再做）
- 状态机 4→8（如果业务上需要）
- 静默兜底统一处理（Q5 决定策略后批量改）
- 死表 / 死代码清理（Q4 决定保留还是删）
- 8000 字截断换 token 截断（Q8 决定策略）

---

## 9. 附表：50 处静默兜底完整清单

按文件:行 + 性质。**这些都不是 AI 应该自作主张动的**。

| 文件:行 | 类别 | 兜底行为 |
|---|---|---|
| `services-v2/prompt-assembler.ts:28` | D | Runtime base 加载失败 → FALLBACK_SYSTEM 硬编码 |
| `services-v2/prompt-assembler.ts:234` | A | safeParseArr 失败 → `[]` |
| `services-v2/prompt-assembler.ts:242` | A | safeParseObj 失败 → `{}` |
| `services-v2/character-extractor.ts:78` | B | AI 失败 → `{characters:[]}` |
| `services-v2/character-extractor.ts:129` | A | JSON.parse 失败 |
| `services-v2/memory-extractor.ts:115-116` | B | AI 失败 → 空 memories |
| `services-v2/memory-extractor.ts:137-139` | B | 合并 AI 失败 → `mergeRaw=''` |
| `services-v2/memory-extractor.ts:177` | A | JSON.parse 失败 |
| `services-v2/plot-arc-extractor.ts:81-82` | B | AI 失败 → `{arcs:[]}` |
| `services-v2/plot-arc-extractor.ts:111` | A | JSON.parse 失败 |
| `services-v2/timeline-extractor.ts:69-71` | B | AI 失败 → `{events:[], defaultAnchorName:'主线'}` |
| `services-v2/timeline-extractor.ts:110` | A | JSON.parse 失败 |
| `services-v2/graph-extractor.ts:75-77` | B | AI 失败 → `{nodes:[], edges:[]}` |
| `services-v2/graph-extractor.ts:122` | A | JSON.parse 失败 |
| `services-v2/graph-organizer.ts:82-89` | B | AI 合并失败 → codeMerge 兜底 |
| `services-v2/graph-organizer.ts:93-95` | B | AI 输出格式错 → codeMerge 兜底 |
| `services-v2/graph-organizer.ts:155` | A | JSON.parse 失败 |
| `routes-v2/chapters-archive.ts:6` | A | pendingAnalysis 解析失败 → `{}` |
| `routes-v2/chapters.ts:245` | A | preview config 解析失败 |
| `routes-v2/chapters.ts:319` | A | generate config 解析失败 |
| `routes-v2/chapters.ts:336` | C | 写 chapter.config 失败 |
| `routes-v2/chapters.ts:457` | C | 写 promptLog 失败 |
| `routes-v2/chapters.ts:477` | C | 更新 promptLog 失败 |
| `routes-v2/chapters.ts:483` | C | 更新 v2Draft 失败 |
| `routes-v2/chapters.ts:495` | C | 写 error log 失败 |
| `routes-v2/chapters.ts:498` | C | SSE send 失败（连接已断） |
| `routes-v2/chapters.ts:542-544` | E | 删除章节级联清理失败（**继续删除**） |
| `routes-v2/chapters.ts:562-564` | E | 末章级联清理失败 |
| `routes-v2/chapters-analysis.ts:12` | A | pendingAnalysis 解析失败 |
| `routes-v2/chapters-analysis.ts:42` | A | prevMerged 解析失败 |
| `routes-v2/characters.ts:82-84` | E | update 失败 → 吞真实错误返回"不存在" |
| `routes-v2/characters.ts:93-95` | E | delete 失败同上 |
| `composables-v2/useDraftStream.ts:17` | E | loadDrafts 失败 |
| `composables-v2/useDraftStream.ts:36` | E | 错误响应体解析失败 |
| `composables-v2/useDraftStream.ts:88` | C | SSE 事件 JSON.parse 失败（跳过该段 delta） |
| `composables-v2/useChapterConfig.ts:57` | A | parsedConfig 解析失败 → null |
| `composables-v2/useChapterConfig.ts:137` | E | 自动生成默认配置失败 → 硬编码默认 |
| `views-v2/V2ChapterDesign.vue:806-807` | E | 用户 JSON 文本解析失败 → `{}`（**清空用户输入**） |
| `views-v2/V2ChapterDesign.vue:970` | E | 写回 _lastPrompt 失败 |
| `views-v2/V2ChapterDesign.vue:989` | A | 候选 config 解析失败 |
| `views-v2/V2ChapterDesign.vue:1011` | E | loadAnalysis 失败 |
| `views-v2/V2ChapterDesign.vue:1084` | E | preArchive 失败 |
| `views-v2/V2ChapterDesign.vue:1102` | E | confirmArchive 失败 |
| `views-v2/V2ChapterReader.vue:109-110` | E | loadChapters 失败 → `[]` |
| `views-v2/V2ChapterReader.vue:122-124` | E | selectChapter 失败 |
| `views-v2/V2Graph.vue:264-266` | E | selectChapter 失败 |
| `views-v2/V2Graph.vue:290-291` | E | loadPrevMerged 失败 |

---

## 10. 一句话总结

V2 是 V1 的**工具化重写**：4 态状态机、并行 5 路分析、3 步确认归档、配置面板作为核心交互入口。**当前卡点是 Phase 6 配置面板**。**最紧急的修复是 V2Timeline.vue 的运行时崩溃**。**最需要用户决策的是 50 处静默兜底如何分类处理**。
