# 记忆管理重构（Memory Redesign）设计

日期：2026-08-14
状态：设计已与用户确认，待实现

## 背景与动机

现状记忆系统（v3）存在几处结构性问题：

1. **语义分类丢失**：`memory-stage` 抽取时有语义分类（mainEvents/emotions/foreshadowing/relationshipChanges），但落库时扁平化成 `layer='chapter'` + 机械 tags（auto-extracted/main-plot），「这是伏笔还是关系变化」这个语义在落库那一刻丢了。
2. **无角色维度**：记忆没有 `participants`，无法按角色过滤/召回。
3. **layer 无约束**：`Memory.layer` 是裸 String，可能存进非法值。
4. **temporary 层是「死层」**：不参与 searchRelevant 召回、不参与 archive 写入，用户手动建的临时记忆没有任何消费路径。
5. **tags 语义混乱**：`tags` 混了「来源标记」（auto-extracted/main-plot/scene-memory）和「记忆类型」（event/state）两类语义。

参考 V2 记忆设计（`.reference/ai-novel-runtime-novel-design-in-v2`）后，决定引入**语义分类 `category`** 和**参与者 `participants`**，layer 转 enum，并明确 temporary 的定位。

## 核心设计决策

1. **`category` 语义分类**：把抽取时的语义分类保留成数据模型一等字段，取代 tags 里混装的「记忆类型」。
2. **`participants` 参与者**：按角色维度过滤/召回记忆。
3. **layer 转 enum**：消灭非法值。
4. **保留 `originUid` 累加**（不引入 V2 的 isActive 软删除）：`originUid` 累加是「删章节回退 global 记忆」的唯一机制，用户明确要保留。
5. **temporary 定位明确**：用户给「当前章节生成」加的临时上下文，绑定章节、只当前章生效、不跨章。

## 数据模型

```prisma
enum MemoryLayer {
  global
  chapter
  scene
  temporary
}

enum MemoryCategory {
  relationship_change   // 关系变化
  foreshadowing         // 伏笔
  emotional_change      // 情绪变化
  event_memory          // 事件记忆
  state                 // 状态快照（global 层专用）
}

model Memory {
  id                String          @id @default(uuid())
  storyId           String
  chapterId         String?
  fromChapterNumber Float?
  originUid         String?          // 保留：global 跨章版本链，删章节回退靠它
  layer             MemoryLayer
  category          MemoryCategory
  content           String
  tags              String          @default("[]")  // 只留来源标记（auto-extracted / scene-memory）
  importance        Int             @default(5)
  participants      String?          // 参与者姓名，逗号分隔
  createdAt         DateTime        @default(now())
  updatedAt         DateTime        @updatedAt

  @@index([storyId, layer])
  @@index([storyId, category])
  @@index([storyId, fromChapterNumber])
  @@index([storyId, originUid])
}
```

## category 映射

| 来源（memory-stage 字段 / optimizer type）| category |
|---|---|
| mainEvents / sideEvents | `event_memory` |
| emotions | `emotional_change` |
| foreshadowing | `foreshadowing` |
| relationshipChanges | `relationship_change` |
| scenes | `event_memory`（layer=scene）|
| optimizer type='event' | `event_memory`（layer=global）|
| optimizer type='state' | `state`（layer=global）|

- 引入 category 后，optimizer 的 `type`（event/state）归并进 category，不再需要单独的 type 字段。
- `tags` 只保留来源标记（auto-extracted / scene-memory）；`main-plot` 标签废弃（当前「只打不加成」，无消费方）。

## temporary 层（明确定位）

- **创建**：用户手动创建，可选择章节（含未归档的正在创建的章节，`chapterId` 可指向 draft 章节）。
- **生效范围**：只用于「该章节」AI 生成候选文章时注入 prompt。
- **不跨章**：下一章生成时拿不到（按 `chapterId` 精确查，不参与语义召回）。
- **TODO(后续)**：章节工作台 prompt 可视化——把当前代码逻辑里组合 prompt 的参数（角色/记忆/剧情弧线等）可视化出来，让用户在软件默认选项上调整选择。当前先接上「生成时注入本章 temporary」的最小路径。

## participants

- **可选**：有明确参与者的记忆才填（关系变化 / 情绪变化 / 事件通常有；纯伏笔 / 纯状态可能无），无则留空。
- **纯文本姓名**：逗号分隔，不关联角色表——本章新增、尚未建档的角色也直接填名字（后续若要按角色关联，用名字匹配角色表，匹配不到保留纯文本）。
- **抽取时**：`memory-stage` 让 AI 从正文识别参与者姓名（参考 `characterNames` 但不限于此）。
- **落库后**：Memory.vue 允许手动编辑。

## originUid 累加（保留，不引入 isActive）

- global 层每章归档对同 UID 产生新版本行（累加，不覆盖）。
- `searchRelevant` 对 global 按 originUid 分组取最新（fromChapterNumber 最大）。
- 删章节回退：`delete fromChapterNumber=N`，前 N-1 章同 UID 版本自然顶上。
- 代价：global 历史版本随章节累积（长篇小说下存储增长），但当前可接受，用户明确要保留回退能力。

## 召回（生成时注入）

- **global + chapter**：`searchRelevant` 语义召回（现有逻辑，originUid 分组取最新 + 语义打分 + Jaccard 去重）。
- **temporary**：生成时显式查「当前章节」的 temporary 记忆（`layer='temporary' AND chapterId=当前章节`），不经过语义召回。

## 边界

- **scene 不进 prompt**：维持现状（scene 仅 Memory.vue 展示，生成场景信息走 chapter.sceneLocation / mainEvents）。
- **删章节回退**：chapter/scene/global 按 `fromChapterNumber` 删除；temporary 按 `chapterId` 级联删除。
- **category 是 enum**：抽取/落库时归一化到 5 值之一，非法值 fallback `event_memory`。

## 测试策略

- **category 映射**：memory-stage 字段 → category 的映射正确。
- **participants**：抽取时从 characterNames 输出、落库写 participants。
- **temporary 注入**：生成时只注入当前章节的 temporary，不注入其他章。
- **originUid 累加**：global 同 UID 多版本，searchRelevant 取最新（现有测试保留）。
- **enum 约束**：layer/category 非法值被拒绝。

## 数据流

```
归档抽取（memory-stage 输出 raw + category + participants）
  → 融合（memory-optimizer 输出 global，type 归并为 category）
  → 落库（archive confirm 写三层，带 category/participants）
  → 生成召回（global+chapter 语义召回 + 本章 temporary 显式注入）
  → 注入 prompt（formatForPrompt 按 category/participants 组织）
删除章节 → chapter/scene/global 按 fromChapterNumber 删（global 回退到前版本）；temporary 按 chapterId 删
```
