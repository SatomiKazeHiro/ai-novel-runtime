# v3 记忆系统总设计 — 抽取 / 操作 / 合并 / 存储 / 检索

> **目的**：把 2026-07-30 会话讨论的 v3 记忆体系多个零散决策汇总成可审阅 spec。覆盖 `memory-stage` prompt / `ReviewingPanel` 操作 / `optimizer` 触发点 / archive commit 写库 / layer 规则 / `searchRelevant` 取最新版本。
>
> **不在本 spec 范围**：CharacterBranchState / PlotArc 写入（用户明确"单独做"）/ TimelineEvent（v3 audit 已删）

---

## 0. 一句话总结

```
抽取 (memory-stage) → 详细 prompt
                            ↓
融合 (optimizer)    → prepare-archive 阶段跑, 覆盖 raw output 为统一 memories[]
                            ↓
用户审 (ReviewingPanel memory tab) → 单卡片, 可编辑/重新生成
                            ↓
存储 (archive commit) → commit-only, 不调 AI, 写三层 + Chapter.summary + Chapter 三列
                            ↓
检索 (searchRelevant) → originUid 取最新版本, 自动处理删章节回退
```

---

## 1. 已确认决策

| # | 议题 | 决策 | 备注 |
|---|------|------|------|
| D1 | `memory-stage` prompt | 用 `packages/shared/src/extract-prompt.ts` 的 `buildExtractPrompt` `memory-only` mode（v3 新增 mode：保留 full 的跨章上下文 `previousEntitiesBlock`，但删任务2） | 沿用 v2 详细 prompt 约束（节点质量、字符转义、importance 1-10、JSON 严格格式），去掉实体关系任务 |
| D2 | `memory-stage` 删除「任务2：实体与关系提取」 | 整段删除 | 节点/边提取由 `graph-extract-stage` 专责 |
| D3 | `memory-stage` output schema | `{ mainEvents, sideEvents, emotions, foreshadowing, relationshipChanges, scenes, summary }` | 砍 `characterStatusChanges` / `timelinePosition` / `timelineEvents`（audit §1.2.1 已删）|
| D4 | `ReviewingPanel` memory tab | **单卡片显示** | 不分子 tab（main / side / emotion / scene / foreshadow / relation）|
| D5 | `ReviewingPanel` 操作 | 用户可编辑或重新生成 | 编辑后走现有 `chaptersApi.update({pendingArchiveData})` 路径 |
| D6 | `user-edited` tag 特殊分支 | **删除** | v2 `memory-optimizer.ts` L59-66 user-edited 分叉全部删；归档后数据平等进入 AI 融合 |
| D7 | `optimizer` 触发点 | prepare-archive 阶段（4 stage `Promise.all` 完成后）| 不再是 post-commit |
| D8 | `optimizer` 输出格式 | 统一 `memories[]` 数组，每条 `{content, originUid, importance, type: 'event'\|'state'}` | tag 由后端加 `'auto-extracted'` 前缀，AI 不输出 tag |
| D9 | `optimizer` 输出写入点 | **覆盖** `stages.memory.result.memories` | user review 时看到的是融合结果 |
| D10 | archive commit 行为 | commit-only，**不调 AI 不调 optimizer** | 写库即收尾 |
| D11 | archive commit 写 Memory 层数 | 三层 + layer='scene' 单独 | 见 §3 规则表 |
| D12 | `summary` 字段 | 写 `Chapter.summary` 列 | **不进 Memory 表** |
| D13 | 章节删除级联 | 沿用 `chapters-crud.ts:179-194` — `deleteMany where fromChapterNumber=N` | 不动 |
| D14 | `searchRelevant` UID 处理 | 加 originUid 分组取最新版本（仅 layer='global'） | layer='chapter' 不参与 |

---

## 2. 业务约束

### 2.1 三层语义不互相替代

- `layer='chapter'` = 单章 raw 提取，按章节距离衰减进入 prompt
- `layer='scene'` = 关键地点记忆，**不进 prompt 注入**（仅 Memory.vue UI 显示）
- `layer='global'` = 跨章融合结果，每次 generate 必读

### 2.2 `summary` 是章节摘要，非记忆

存 `Chapter.summary`。reason：searchRelevant 不读 summary 字段，且"本章概要"是章节元数据，应回归 Chapter 表。

### 2.3 角色状态已归 character-stage

v3 不再有"characterStatusChanges → Memory 表"路线。角色历史链 = `CharacterBranchState` 表（**另文档**）。

### 2.4 optimizer 累加 + searchRelevant 取最新

- `optimizer` 每章归档都对同 UID 产生新行 layer='global'（**累加**，不是 update by UID）
- 删除章节只 delete where fromChapterNumber=N
- 前 N-1 章同 UID 版本保留 → 删章节后版本自然"回退"到 N-1，无需特殊代码

### 2.5 user-edited 不再特殊

- 编辑后的记忆与 AI 输出**平等进入** optimizer 融合
- 不再走"原样保留为 global"分支

---

## 3. layer 规则（archive commit 写库时）

| 数据来源 | layer | tags | importance |
|---|---|---|---|
| memory-stage `mainEvents[]` | `chapter` | `['auto-extracted','main-plot']` | AI 给（4~7+1）|
| memory-stage `sideEvents[]` | `chapter` | `['auto-extracted']` | AI 给 |
| memory-stage `emotions[]` | `chapter` | `['auto-extracted']` | 写死 5 |
| memory-stage `foreshadowing[]` | `chapter` | `['auto-extracted']` | 写死 5 |
| memory-stage `relationshipChanges[]` | `chapter` | `['auto-extracted']` | 写死 5 |
| memory-stage `scenes[]` | `scene` | `['auto-extracted','scene-memory']` | AI 给 |
| optimizer 融合 `memories[]` | `global` | `['auto-extracted', 'event'\|'state']` | AI 给 |
| `stages.memory.result.summary` | — | — | **写 `Chapter.summary` 列**，不进 Memory |

---

## 4. 改动清单（按文件 / 函数）

### 4.1 `apps/server/src/services/stages/memory-stage.ts`
- prompt: 替换为 `buildExtractPrompt(input, {mode: 'memory-only'})`（v3 新增 mode：保留 `full` 的跨章上下文（previousEntitiesBlock），但删除「任务2：实体与关系提取」段及对应 schema 字段）
- 删除「任务2：实体与关系提取」prompt 段
- output schema 收缩为 §D3 字段
- AI 输出仍按分类字段（mainEvents / sideEvents / ...），**不输出统一 `memories[]`**（融合由 optimizer 做）

### 4.2 `apps/server/src/services/memory-optimizer.ts`
- 触发点：`prepare-archive` 端点调（非 archive confirm）
- 输入：当前 layer='global' + 当前 memory-stage output（v3 commit 启用前，layer='global' 为空）
- 输出：覆盖 `pendingArchiveData.stages.memory.result.memories`
- 砍掉 user-edited 分支（L59-66 + L169-183）
- 写入 layer='global'，tags=`['auto-extracted','event'|'state']`
- 写完后**不**调任何后续 step

### 4.3 `apps/server/src/routes/chapters-archive.ts` `prepare-archive`
- 现有 4 stage 并行（character / memory / plot-arc / graph-extract）顺序不变
- 4 stage `Promise.all` 完成后，**追加** optimizer 跑
- optimizer 输出写入 `pendingArchiveData.stages.memory.result.memories`
- 整个 prepare-archive 仍是同步阻塞，status 翻 'reviewing'

### 4.4 `apps/server/src/routes/chapters-archive.ts` `archive confirm`
- 在翻 status='archived' 之前，`prisma.$transaction` 内依次：
  1. `tx.memory.create` 每条 mainEvent / sideEvent / emotion / foreshadowing / relationshipChange / scene 写入（layer 见 §3）
  2. `tx.memory.create` 每条 optimizer 融合记忆（layer='global'）
  3. `tx.chapter.update({summary})` 写 summary 列
  4. `tx.chapter.update({chapterGraph, cumulativeGraph, cumulativeGraphGeneratedAt, status: 'archived', pendingArchiveData: null})`
- **不**追加 CharacterBranchState / PlotArc 写入（用户单独做）
- 不调 AI / 不调 optimizer

### 4.5 `packages/memory-engine/src/index.ts` `searchRelevant`
- L103-177 在 `allMemories` 拿到后，加 originUid 分组取 latest（**仅 layer='global'**）
- layer='chapter' 不参与 UID 分组
- score 排序 / content 文本去重保留，**只在源头收缩** layer='global' 多版本
- 章节 checkpoint 过滤 + 番外排除逻辑保留

### 4.6 不动的部分
- `Memory` schema（layer / originUid / fromChapterNumber / content / tags / importance）
- `Chapter` schema（含新增的 `cumulativeGraphGeneratedAt`）
- `chapters-crud.ts` 删章节端点级联清理
- `Memory.vue` UI（layerOptions 4 项保留）
- `packages/prompt-runtime` 装配
- `TimelineEvent`（v3 不写）

---

## 5. 测试要求

| 文件 / 测试 | 验证目标 |
|---|---|
| `memory-stage.test.ts` | prompt 切到 buildExtractPrompt `memory-only` mode；output schema 收缩；删除 timelinePosition 等死字段后单测不引用 |
| `memory-optimizer.test.ts` | 输入 chapter raw + 现有 global → 输出覆盖 result.memories；无 user-edited 分支 |
| `archive confirm` 集成测 | 三层 Memory 行 + Chapter.summary 写入；不调 AI；事务成功 |
| `searchRelevant` 单测 | mock prisma 同 UID 3 版本 → 仅 latest 进 prompt |
| `searchRelevant` 单测 | mock chapter layer 同 content 不同章 → 全部保留 |
| `searchRelevant` 单测 | 删章节后（剩 v1/v5）→ 喂 v5 |

---

## 6. 不在本 spec 范围

- **CharacterBranchState 写入语义** — 用户单独做（"不在本章 summary / 剧情弧线一起做"）
- **PlotArc commit 接 `commitPlotArcWrites`** — 用户单独做
- **TimelineEvent 处理** — v3 audit 决定不写

---

## 7. 用户决策时间表（2026-07-30）

| 子议题 | 决策 |
|---|---|
| layer='chapter' 写不写 | 写 — searchRelevant 需要做章节距离衰减 |
| summary 去哪 | `Chapter.summary` 列，不进 Memory |
| 跨章融合机制 | originUid 链，optimizer 累加不覆盖；searchRelevant 取 latest |
| 删章节时全局记忆 | 自动回退到前 N-1 版本，无需特殊代码 |
| searchRelevant 是否按 UID 取最新 | 是 |
