# 剧情弧线重构（PlotArc Redesign）设计

日期：2026-08-14
状态：设计已与用户确认，待实现

## 背景与动机

现状的剧情弧线（`plot-consolidator` v2）存在几处结构性问题：

1. **字段繁多且多为「覆盖式快照」**：`progress` / `stages` / `currentStage` / `nextGoal` / `unresolved` / `summary` 六个字段要么是 AI 每次覆盖的状态快照、要么是无限增长的 JSON，删除章节时无法回退。
2. **「完成」不可逆**：`status='completed'` 由 AI 直接拍板，是独立、不依附章节的状态，删除章节后不会回退。
3. **进度是噪音**：`progress`（0-100）数值本身可能误导 AI 判断（看到「80%」就认为快结束了）。
4. **状态机语义模糊**：5 态中 `resolving`（收尾中）与 `active` 注入时无区别；`stale` 与 `active` 注入 prompt 时也无法区分。

用户决策：**另起炉灶**——剧情弧线依附章节，状态由代码推导，AI 只给「事实」（推进点 + isEnd 标记 + 关闭）。

## 核心设计理念

1. **事实 + 派生状态**：AI 输出「推进点」（append-only 事实记录），代码推导「状态」（激活/待激活/完成/关闭）。
2. **完成可逆化**：`isEnd` 是 AI 的软判断（参考标记），真正的「完成」是「最新推进点 isEnd 且之后 5 章无更新」（代码验证）。删除章节 → 推进点删除 → isEnd 消失 → 完成自然回退。
3. **依附章节**：弧线有 `firstChapterNumber`，推进点有 `chapterNumber`，删除章节的级联自然成立。

## 数据模型

### PlotArc（弧线表）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | String @id | |
| storyId | String | |
| name | String | 弧线标题 |
| isMainline | Boolean | 主线/支线（替代原 `type: main/side`）|
| status | String | 激活/待激活/完成/关闭，**代码推导** |
| firstChapterNumber | Int | 弧线来源章节号 |
| closedBy | String? | `user` / `ai-similar`，关闭时填 |
| closedTargetArcId | String? | AI 相似关闭时指向合并目标 |
| createdAt / updatedAt | DateTime | |

### PlotArcProgressPoint（推进点表，独立表）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | String @id | |
| arcId | String | 关联弧线 |
| chapterNumber | Int | 本章号码 |
| content | String | 推进内容（核心简练）|
| isEnd | Boolean @default(false) | 是否「完成」标志（AI 软判断）|
| createdAt | DateTime | |

- 每弧线每章**最多一条**推进点（一章内多个进展合并进 `content`）。
- 索引：`@@index([arcId, chapterNumber])`、`@@index([chapterNumber])`（删章节用）。

## 状态机（4 态，代码推导）

状态推导在**每章归档后**跑（纯函数，可单测）：

```
if closedBy != null                → 关闭（closed）
latest = 最新推进点（chapterNumber 最大）
if latest.isEnd && (当前章 - latest.chapterNumber > 5)  → 完成（completed）
if 当前章 - latest.chapterNumber > 5                     → 待激活（inactive）
否则                                                      → 激活（active）
```

- **「完成」与「待激活」都是「5 章无更新」，唯一区别是「最新推进点有没有 isEnd」**。
- `isEnd` 是 AI 的软判断：AI 第 10 章打 isEnd、第 12 章又推进了 → isEnd 失效（历史标记保留，但不影响推导），弧线继续「激活」。
- 无推进点的边界：用 `firstChapterNumber` 代替 `latest.chapterNumber` 参与「5 章」判断（弧线创建时必有首个推进点，此为健壮性兜底）。

## 生命周期

### 1. AI 分析（analyze）

- 送「激活 + 待激活」的弧线（**完成、关闭不送**）。
- AI 先分析**相似弧线**，把重要性低的标记关闭（`closedBy='ai-similar'` + `closedTargetArcId`）。
- AI 给出**本章的推进点**（每弧线每章最多一条）。
- AI **不直接打「完成」**，而是给推进点打 `isEnd` 标记（软判断）。

### 2. 章节归档（archive）

- 落库推进点（新增推进点行）。
- 落库关闭（标记 closedBy / closedTargetArcId）。
- 事务后跑**状态推导**，刷新各弧线 status。

### 3. 删除章节（delete）

- 先看弧线 `firstChapterNumber === 被删章节号` → 整条弧线删除（级联推进点）。
- 否则 `deleteMany` 推进点 where `chapterNumber === 被删章节号`。
- 删除后**重新推导状态**（删了 isEnd 推进点 → 完成回退为激活/待激活）。

### 4. 弧线管理页（专门页面）

- 展示/管理所有弧线（含完成/关闭/待激活）。
- 用户可**手动关闭**（`closedBy='user'`），区别于 AI 相似关闭。
- 待激活的弧线明确展示「已无下文」，用户可决定关闭或保留。

## Prompt 注入（生成正文）

- 只注入「激活」的弧线。
- 弧线以「标题 + 推进点集合」注入，推进点**全部注入**（`content` 核心简练）。
- **TODO(优化)**：未来推进点多、token 吃紧时再做截断（最近 K + isEnd + 首点），现在先全量。

## 字段去留

| 现状字段 | 新设计 |
|---------|--------|
| name | ✅ 保留 |
| type（main/side）| → `isMainline`（Boolean 简化）|
| status（5 态）| → 4 态，代码推导 |
| progress | ❌ 删除（噪音）|
| stages | ❌ 删除（被推进点集合取代）|
| currentStage | ❌ 删除（融入推进点 content）|
| nextGoal | ❌ 删除（AI 下次自己判断）|
| unresolved | ❌ 删除（悬念/伏笔归记忆系统 foreshadowing）|
| summary | ❌ 删除（推进点集合即脉络）|
| closedReason | → `closedBy`（user / ai-similar）|
| closedTargetArcId | ✅ 保留（AI 相似关闭时填）|
| lastTouchedChapter | ❌ 删除（被「最新推进点章节号」取代）|
| similarToExistingIds | ❌ 删除（相似判断由 AI 负责，Jaccard 兜底暂不保留，TODO 观察 AI 漏判）|

## 边界

- **isEnd 误判**：AI 打 isEnd 后若又推进，isEnd 自动失效（历史保留、推导不生效）。
- **删 isEnd 回退**：删除带 isEnd 的推进点 → 完成回退为激活/待激活，AI 可重新打 isEnd。
- **AI 相似关闭 vs 用户关闭**：`closedBy` 区分来源，弧线管理页分别展示。
- **完成/关闭不送 AI 分析、不注入 prompt**（终态）。
- **待激活不注入 prompt**（只是给用户看的标签），但**送 AI 分析**（让 AI 有机会重新激活）。

## 测试策略

- **状态推导**（纯函数，TDD 重点）：四种状态 + isEnd 误判 + 删 isEnd 回退 + 无推进点边界。
- **推进点落库**：每弧线每章最多一条、create/update。
- **删除章节**：firstChapterNumber 相同 → 整条删；否则删对应推进点 + 重推导状态。
- **AI 分析**：prompt 只送激活/待激活，不送完成/关闭。

## 数据流

```
已归档章节数据 → 生成本章正文
  → analyze：送激活+待激活弧线 → AI 给推进点（可打 isEnd）+ 相似关闭
  → archive：落库推进点/关闭 → 事务后推导状态（激活/待激活/完成/关闭）
  → 供后续章节生成（注入「激活」弧线的推进点集合）
删除章节 → 级联删弧线（firstChapterNumber 相等）或推进点 → 重推导状态
```
