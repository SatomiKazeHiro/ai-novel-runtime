# 知识图谱审计 (v3 后) — 死代码 / 业务不清 / 歧义点

> **目的**：v2 死代码清理（commit `277fba2` / `be68314` / `03211f7`）之后，再次审计 server + web 两端的图谱相关代码，识别**还残留的死代码与可疑点**。本 spec 仅为调查报告，**不动代码**。
>
> **用户原始要求**：「赶紧深入调查，看看图谱相关联的还有哪些是死代码，业务不清晰的，有歧义的地方」。
>
> **调查方式**：codegraph 静态扫描 + 文件 source 验证 + 业务流追踪。每条结论附 file:line 与 reference evidence。

---

## 0. TL;DR — 三类问题一览

| # | 类别 | 位置 | 严重度 | 处理 |
|---|------|------|--------|------|
| 1 | **硬死代码** | `combined-extractor.ts` / `graph-extractor.ts` / `graph-organizer.ts` / `memory-extractor.ts` / `stages/cumulative-graph-build-service.ts` | 高 | **2026-07-29 spec 漏删** — 立即可删 |
| 2 | **行为死代码** | `memory-stage.ts` → `timelinePosition`/`timelineEvents` 字段 | 中 | 删字段 + 删 prompt 段落 |
| 3 | **行为死代码** | `chapters-archive.ts:544` archive 响应 `cumulativeGraph: null, optimizedCount: 0` | 高 | 删 + 改成 `archiveSuccess` 之类 |
| 4 | **行为死代码** | `memory-optimizer.ts` `optimizeMemories` 函数 | 高 | **已拍板 2026-07-30**：接入 prepare-archive，非 post-commit |
| 5 | **DRY 违反** | `chapters-archive.ts:218-352` retry-stage 复制 prepare-archive 的 pre-stage 数据加载 | 中 | 抽公共 helper |
| 6 | **歧义点（潜在 bug）** | `character-stage.ts:69` `loadWorkerTask('memory')` 而非 'character' | 中 | 与用户确认语义 |
| 7 | **业务不清** | TimelineEvent 表被读不被写（prompt 注入空数据） | 中 | 与用户确认意图 |
| 8 | **死测试 / 死 check 脚本** | `apps/server/src/__tests__/combined-extractor-*.test.ts` (3 文件) / `check-timeline.mjs` | 低 | 跟随硬死代码删 |

---

## 1. 死代码

### 1.1 硬死代码（无生产调用方）— 2026-07-29 spec 漏删

#### 1.1.1 `apps/server/src/services/combined-extractor.ts` (377 行)

**调用图**：
- 自身 import 之外，**只有 3 个测试文件 import**：
  - `apps/server/src/__tests__/services/combined-extractor-extractAll.test.ts`
  - `apps/server/src/__tests__/services/combined-extractor-truncate.test.ts`
  - `apps/server/src/__tests__/services/combined-extractor-prompt.test.ts`
- 无任何生产代码 import。

**证据**：

| 检查 | 结果 |
|------|------|
| `grep -r "combined-extractor" apps/ packages/ --include="*.ts"` | 只命中 `combined-extractor.ts` 自身 + 3 个测试 |
| `grep -r "from.*combined-extractor"` | 同上 |
| `apps/server/src/routes/chapters-archive.ts` 是否 import | 否 — 用 `stages/*-stage.ts` 替代 |
| `apps/server/src/services/generate-processor.ts` 是否 import | 否 |

**自报「v2 死」证据**：
- L30 注释："剧情弧线不再由 extractAll 提取 — plot-consolidator v2 (worker) 自己读"
- L1-35 头部注释明示 v2 设计，被 v3 stage 体系替代

**v3 实际替代**：
- `runCharacterStage` (character-stage.ts)
- `runMemoryStage` (memory-stage.ts)
- `runPlotArcStage` (plot-arc-stage.ts)
- `runGraphExtractStage` (graph-extract-stage.ts)
- 4 个 stage 在 `chapters-archive.ts:147-166` `Promise.all` 并行

**结论**：硬死。可立即删文件 + 3 个测试文件。

---

#### 1.1.2 `apps/server/src/services/graph-extractor.ts` (25 行)

**调用图**：
- 自身 + `combined-extractor.ts` (死) + `__tests__/services/graph-extractor.test.ts`（**1 个测试**）
- 无生产 import。

**证据**：
- 2026-07-29 spec (`2026-07-29-graph-v2-deadcode-cleanup-design.md`) 设计意图是「保留 3 个 type export，删 2 个孤儿函数」
- **但 3 个 type export 的唯一 consumer 是死文件 combined-extractor.ts**
- type export 本身没有被任何 active code import

| type | import 方 |
|------|----------|
| `ExtractedNode` | combined-extractor.ts (死) |
| `ExtractedEdge` | combined-extractor.ts (死) |
| `GraphExtractionResult` | combined-extractor.ts (死) |

**结论**：硬死（连 type 出口也死）。可整文件删。

---

#### 1.1.3 `apps/server/src/services/graph-organizer.ts` (243 行)

**调用图**：
- 自身 + `combined-extractor.ts` (死) + `__tests__/services/graph-organizer.test.ts` (1 个测试)
- 无生产 import。

**结论**：硬死。可整文件删 + 1 个测试。

---

#### 1.1.4 `apps/server/src/services/memory-extractor.ts` (576+ 行)

**调用图**：
- 自身 + `combined-extractor.ts` (死) + `__tests__/services/memory-extractor.test.ts`
- 无生产 import。

**结论**：硬死。可整文件删 + 测试。

---

#### 1.1.5 `apps/server/src/services/stages/cumulative-graph-build-service.ts` (37 行)

**调用图**：
- 仅自我引用 + 1 处测试中注释提及"unused"
- 无生产 import。

**证据**：
- 注释 "Note: This wrapper is intentionally not used by the archive route (see chapters-archive.ts)"
- 实际生产代码用 `cumulative-graph.ts` 直接导出 `buildCumulativeGraph`

**结论**：硬死（设计期遗留 wrapper）。可整文件删。

---

### 1.2 行为死代码（在 active 文件中，行为已无 effect）

#### 1.2.1 `memory-stage.ts` 返回 `timelinePosition` + `timelineEvents` 字段 — 永不被消费

**位置**：`apps/server/src/services/stages/memory-stage.ts`

```ts
// L23, L25
timelinePosition: number | null
timelineEvents?: Array<{ position: number | null; description: string }>

// L42-50 prompt 让 AI 输出这两个字段
// L80-82 解析后塞进 result
```

**消费方调研**：

| 检查 | 结果 |
|------|------|
| `grep -r "timelinePosition" apps/server/src/services apps/server/src/routes --include="*.ts"` | 只在 memory-stage.ts 自身 |
| `grep -r "timelineEvents" apps/server/src/services apps/server/src/routes --include="*.ts"` | 只在 memory-stage.ts 自身 + check-timeline.mjs 旧脚本 |
| `grep -r "PendingArchiveDataV3.*timeline"` | 无 — schema 类型定义不含 timelinePosition/timelineEvents |
| `chapters-archive.ts` archive 端点 | **不读**这两个字段 |
| `chapters-archive.ts` 写入 Chapter 三列时 | 不拷这两个字段 |
| `useChapterEditor.ts` savePendingArchiveData | 不读 |

**为什么死**：
- CLAUDE.md 已声明 "TimelineEvent 在 v3 删除"（实际指 TimelineEvent 表，未删字段）
- v3 archive route 不写 TimelineEvent（见 §3.1）
- `pendingArchiveData` JSON schema 不含这两个字段，所以即使 memory-stage 返回，ReviewingPanel 也看不到

**结论**：删 `MemoryStageResult.timelinePosition` + `MemoryStageResult.timelineEvents` + prompt 中对应段落（约 8 行）。

---

#### 1.2.2 `chapters-archive.ts:544` archive 响应 `cumulativeGraph: null, optimizedCount: 0`

**位置**：`apps/server/src/routes/chapters-archive.ts:544`

```ts
return { success: true, data: { cumulativeGraph: null, optimizedCount: 0 } }
```

**问题**：
- `cumulativeGraph: null` 是 v2 残留 — v2 端点返回刚生成的累计图谱供前端立即使用
- v3 设计已变：累计图谱通过 `pendingArchiveData` 走 review，archive confirm 只 commit 不再返图
- `optimizedCount: 0` 是 v2 残留 — v2 端点调用 `optimizeMemories` 后返回「融合了几条记忆」
- v3 archive route **根本不调 optimizeMemories**（见 §1.2.3）

**消费方调研**：
- `apps/web/src/composables/useChapterEditor.ts` `archiveChapter()` 调用方
- 看 `archiveChapter` 实际只判断 `result.success`，不读 `data.cumulativeGraph` 或 `data.optimizedCount`

**结论**：
- 两个字段都是死数据 + 误导前端开发者
- 改成 `{ success: true, data: { archived: true } }` 或类似

---

#### 1.2.3 `memory-optimizer.ts` `optimizeMemories` 函数 — 全工程零调用方

**位置**：`apps/server/src/services/memory-optimizer.ts:24-191`

**调用图**：

| 检查 | 结果 |
|------|------|
| `grep -r "optimizeMemories" apps/ packages/ --include="*.ts"` | 命中 2 处：memory-optimizer.ts 自身 + 无 caller |
| `grep -r "memory-optimizer"` | 同上 |
| `chapters-archive.ts` archive route (L472-545) 是否调用 | 否 — archive confirm 直接 commit，无 post-commit step |
| `generate-processor.ts` 是否调用 | 否 |
| `stages/*-stage.ts` 是否调用 | 否 |

**为什么是死代码**：
- 函数体完整可执行（载入 runtime、call AI、prisma.memory.create 全套）
- 但**全工程没有任何 caller** —— 设计期期望放在 archive 流程的 post-commit 步骤，但 v3 重构 archive 时未接入

**证据**：
- `chapters-archive.ts:533-542` archive confirm 的 prisma update 后**无任何后续代码**调用 optimizeMemories
- `chapters-archive.ts:544` 的 `optimizedCount: 0` 应该是这个函数的返回值，但函数根本没被调

**已拍板（2026-07-30）**：采用接入方案，但触发点调整为 `prepare-archive` 的 4 stage `Promise.all` 完成后，而不是 archive post-commit。optimizer 输出覆盖 `pendingArchiveData.stages.memory.result.memories`；archive confirm 保持 commit-only，不调用 AI。详见 `docs/superpowers/specs/2026-07-30-v3-memory-system-design.md` D7-D10。

**结论**：该调用缺口已完成设计收口，等待按 v3 记忆系统 spec 实施。

---

### 1.3 DRY 违反（不算死，但属「行为死代码的可消除重复」）

#### 1.3.1 `chapters-archive.ts` retry-stage 复制 prepare-archive pre-stage 数据加载

**位置**：
- `chapters-archive.ts:89-144` (prepare-archive) — 56 行 pre-stage 数据加载
- `chapters-archive.ts:250-298` (retry-stage) — 49 行**几乎逐行复制**

**复制的内容**：

| 数据 | prepare-archive 行号 | retry-stage 行号 | 差异 |
|------|---------------------|-----------------|------|
| `allCharacters.findMany` | L90-93 | L250-253 | 一致 |
| `matchedCharacters` 过滤 | L94-102 | L254-262 | 一致 |
| `characterNames/Keys` | L103-104 | L263-264 | 一致 |
| `latestBranchStates.findMany` | L107-112 | L266-271 | 一致 |
| `dedupedBranchStates` 去重 | L114-118 | L272-276 | 一致 |
| `allExistingArcs.findMany` | L121 | L278 | 一致 |
| `prevCumulativeGraphNodes` (parent + 主线回退) | L124-144 | L280-299 | 一致 |

**问题**：
- ~50 行逐字复制，未来若加新数据源（如 characterBranchState 加新字段），要改两处
- retry-stage 用同一份数据是合理的（用户说"重跑这个 stage"），但应该抽公共函数

**结论**：抽公共 helper `loadStageInputs(prisma, chapter)` 返回 `{matchedCharacters, characterNames, characterKeys, dedupedBranchStates, allExistingArcs, prevCumulativeGraphNodes}`，两处都用。

---

### 1.4 死测试 / 死 check 脚本

| 文件 | 状态 |
|------|------|
| `apps/server/src/__tests__/services/combined-extractor-extractAll.test.ts` | 跟随 combined-extractor.ts 删 |
| `apps/server/src/__tests__/services/combined-extractor-truncate.test.ts` | 跟随删 |
| `apps/server/src/__tests__/services/combined-extractor-prompt.test.ts` | 跟随删 |
| `apps/server/src/__tests__/services/graph-extractor.test.ts` | 跟随 graph-extractor.ts 删（如果决定删 type export） |
| `apps/server/src/__tests__/services/graph-organizer.test.ts` | 跟随 graph-organizer.ts 删 |
| `apps/server/src/__tests__/services/memory-extractor.test.ts` | 跟随 memory-extractor.ts 删 |
| `check-timeline.mjs` | 项目根 check 脚本 — 读 GraphNode / graphSnapshot / graphDelta 等 v3 已删字段。**整个脚本是过时的** — 应删 |

---

## 2. 业务不清 — 需要用户拍板的语义问题

### 2.1 `character-stage.ts:69` `loadWorkerTask('memory')` 而非 'character'

**位置**：`apps/server/src/services/stages/character-stage.ts:69`

```ts
const task = await loadWorkerTask(input.storyId, 'memory', prisma)
```

**WorkerType 枚举**（`packages/ai-provider/src/runtime-compiler.ts:17`）：

```ts
workerType: 'generation' | 'scoring' | 'memory' | 'graph' | 'timeline' | 'rewrite' | 'memory_organize'
```

**WorkerTask 调用现状**：

| 文件:行 | 调用的 workerType |
|---------|-------------------|
| `memory-stage.ts:60` | `'memory'` |
| `character-stage.ts:69` | `'memory'` ← **唯一一处可疑** |
| `graph-extract-stage.ts:141` | `'graph'` |
| `plot-consolidator.ts:211` | `'memory'` (consolidate plot arc) |
| `memory-optimizer.ts:125` | `'memory'` |
| `chapters-generate.ts:88` | `'generation'` |
| `chapters-generate.ts:177` | `'generation'` |

**两种可能解释**：

- **解释 A（语义复用 — 可能是正确的）**：character-stage 是 v3 新加的 stage，复用 memory worker task（共享 system prompt 风格）。WorkerType 枚举缺 'character' 是设计意图，因为 character extraction 跟 memory extraction 共享 prompt 模板族。
- **解释 B（typo bug — 应该是错的）**：应该是 `'character'` 或新增枚举值。代码作者复制 memory-stage 时忘了改 workerType。

**判断依据不足**：
- 没有 spec / 注释解释为什么是 'memory'
- WorkerTask 表的 `workerType` 列允许字符串任意值（不是 enum），所以 schema 层不会拦
- 行为差异（如果 system task prompt 不存在）：会回退到 `hardcodedFallback('memory')` —— 与 'character' 回退文案不同

**问用户**：
1. 是设计意图（复用 memory worker task），还是 typo？
2. 如果是设计意图，是否应该把 'character' 加到 WorkerType 枚举里以便区分？
3. 如果是 typo，要不要新增 'character' worker task + 数据库补一条 system default？

---

### 2.2 TimelineEvent 表 — 读不被写

**位置**：
- 读：`apps/server/src/routes/chapters-generate.ts:74` + `apps/server/src/routes/chapters-generate.ts:164` (`prisma.timelineEvent.findMany`)
- 写：`apps/server/src/routes/timeline.ts` POST/PUT/DELETE —— **只能由用户在 Timeline.vue 手动创建**
- v3 archive 不写：`chapters-archive.ts` 全文 `grep -n "timelineEvent" → 0 hit`

**行为**：
- 用户启动新故事 → 归档若干章节 → 这些章节**不会**自动产生 TimelineEvent 行
- 章节归档后下一次预览/生成时，`timelineEvent.findMany` 返回空数组
- `timeline` prompt layer 永远为空
- 用户必须手动进 Timeline.vue 加事件 → 才能让 prompt 注入时间线上下文

**这是 bug 还是 design**：
- **CLAUDE.md** 写 "TimelineEvent 在 v3 删除"（v3 删除的是 TimelineEvent 表的使用场景？还是表本身？）
- 表**没删**（`prisma/schema.prisma` 还在）
- `routes/timeline.ts` 还注册了完整 CRUD
- `Timeline.vue` 还有完整 UI
- 只有 **v3 archive 流程不自动写入** 这一环断了

**问用户**：
1. v3 归档后是否应该自动创建 TimelineEvent 行（基于 memory-stage 的 timelinePosition）？
2. 如果是 — memory-stage 当前已经返回 timelinePosition 字段（见 §1.2.1），删还是恢复消费？
3. 如果否 — `routes/timeline.ts` + `Timeline.vue` + `prisma.timelineEvent` 表是否应该整组删？

---

### 2.3 `memory-stage.ts` 输出的 fields 语义对 ReviewingPanel 是否可见

**位置**：`apps/server/src/services/stages/memory-stage.ts:16-26`

```ts
export interface MemoryStageResult {
  mainEvents: ...
  sideEvents: ...
  emotions: ...
  foreshadowing: ...
  relationshipChanges: ...
  scenes: ...
  timelinePosition: number | null
  summary: string
  timelineEvents?: ...
}
```

**调研**：

| 字段 | 是否进 PendingArchiveDataV3 | ReviewingPanel 是否展示 |
|------|---------------------------|-------------------------|
| mainEvents | 是 (JSON.stringify) | 待确认 |
| sideEvents | 是 | 待确认 |
| emotions | 是 | 待确认 |
| foreshadowing | 是 | 待确认 |
| relationshipChanges | 是 | 待确认 |
| scenes | 是 | 待确认 |
| timelinePosition | 是（写进 JSON） | **不展示**（前端没读） |
| summary | 是 | 待确认 |
| timelineEvents | 是 | **不展示** |

**问用户**：
- memory-stage 8+ 字段全部进 pendingArchiveData JSON，但 ReviewingPanel 只展示部分字段
- 是不是应该全展示？还是这些字段仅作 archive 内部消费、ReviewingPanel 只看最终 commit？

---

## 3. 歧义点（代码内自相矛盾 / 文档与代码不一致）

### 3.1 CLAUDE.md vs 代码实现 — TimelineEvent

**CLAUDE.md**（节选）：
> TimelineEvent 在 v3 删除（2026-07-24 标记）

**代码实现**：
- `apps/server/src/routes/timeline.ts` — 完整 CRUD 仍注册
- `apps/web/src/views/Timeline.vue` — 完整 UI
- `apps/server/src/routes/chapters-generate.ts:74, 164` — 仍读 `timelineEvent.findMany`
- `prisma/schema.prisma` TimelineEvent model 仍存在
- `apps/server/src/routes/chapters-archive.ts` — **不写** TimelineEvent

**矛盾**：
- "v3 删除"指的是删除某个使用场景（archive 自动写入），还是删除整张表 + UI + API？
- 当前状态 = 表/UI/API 全留，但 archive 写入路径没了 —— 既不完整删，也不完整留

**问用户**：
1. 文档指「删除使用场景」（≠删表），那当前实现是预期的？
2. 还是文档指「删除整个 TimelineEvent 子系统」，但代码没删完（计划未完成）？

---

### 3.2 chapters-archive.ts:544 响应数据是 v2 字段还是 v3 字段

**位置**：`apps/server/src/routes/chapters-archive.ts:544`

```ts
return { success: true, data: { cumulativeGraph: null, optimizedCount: 0 } }
```

**v2 语义**（推断）：
- `cumulativeGraph` 是 v2 端点返回刚生成的累计图谱给前端立即渲染
- `optimizedCount` 是 v2 端点调用 optimizeMemories 后返回「融合记忆数」

**v3 语义**：
- v3 archive confirm 是 commit-only，不重算累计图谱（已在 review 阶段生成好）
- v3 archive confirm 没有 memory 融合步骤
- v3 响应前端不需要这两个字段

**当前代码** = 强行保留 v2 字段名但写死 null/0 → 既是 v2 残留也是误导

**结论（已记在 §1.2.2）**：直接删字段、改成 `{archived: true}` 或类似。

---

### 3.3 character-stage 与 memory-stage 共享 prompt 模板族 — WorkerType 设计歧义

详见 §2.1。
两个可能解释的歧义点：'memory' workerType 被复用到 character-stage 是设计还是 typo。

---

## 4. 不在本审计范围

| 模块 | 不审原因 |
|------|---------|
| `EditableGraph.vue` | 2026-07-29 spec 已审，本地草稿自管，复用方 ReviewingPanel 已审 |
| `useCytoscapeLifecycle.ts` | 2026-07-29 commit `be68314` 已审 + 测试覆盖 |
| `useGraphData.ts` | commit `4ee4f4f` 已审 + `__tests__/useGraphData.spec.ts` 已审 |
| `GraphView.vue` | commit `4ee4f4f` Bug 修复 + `__tests__/GraphView.spec.ts` 已审 |
| `cumulative-graph.ts` (181 行) | v3 active，3 个分支逻辑有 spec 描述 |
| `plot-consolidator.ts` | v3 active，被 plot-arc-stage.ts 调用 |
| `plot-extractor.ts` | **active** — `commitPlotArcWrites` 被 archive 调用，`getActivePlotArcs` 被 generate 调用，2 个 caller 是不同流程 |
| `stages/*-stage.ts` 4 个文件 | v3 active，全有测试 |
| `graph-snapshot.ts` | v3 active，被 cumulative-graph.ts / stages/*.prompt.ts / stages/graph-extract-stage.ts 等使用 |

---

## 5. 验证 — 调查的可信度自检

| 检查 | 结果 |
|------|------|
| 所有死代码结论是否用 codegraph_explore 实际查过 import 链 | ✅ |
| 是否区分「硬死」（无 caller）和「行为死」（caller 存在但路径无效） | ✅ |
| 是否区分「主动删」与「等用户拍板」 | ✅ |
| 是否识别 DRY 违反 | ✅ |
| 是否对照 CLAUDE.md 检查文档/代码不一致 | ✅ |
| 是否避免在没 spec/注释证据时给死代码归因 | ✅（character-stage L69 标为「歧义」不标为 bug） |

---

## 6. 推荐处置（待用户确认）

**立即可删**（无需用户拍板）：

1. §1.1.1 combined-extractor.ts + 3 测试
2. §1.1.2 graph-extractor.ts + 1 测试
3. §1.1.3 graph-organizer.ts + 1 测试
4. §1.1.4 memory-extractor.ts + 1 测试
5. §1.1.5 stages/cumulative-graph-build-service.ts
6. §1.4 check-timeline.mjs
7. §1.2.1 memory-stage.ts timelinePosition/timelineEvents 字段 + prompt 段落
8. §1.2.2 archive 响应 `cumulativeGraph: null, optimizedCount: 0` → `{archived: true}`

**已拍板（2026-07-30）**：

9. §1.2.3 memory-optimizer.ts `optimizeMemories` 接入 `prepare-archive`（4 stage 完成后），archive confirm 保持 commit-only。详见 `docs/superpowers/specs/2026-07-30-v3-memory-system-design.md`。

**仍需用户拍板**：

10. §2.1 character-stage L69 'memory' workerType 复用 — 设计 vs typo
11. §2.2 TimelineEvent 表 — 删子系统 vs 接回 v3 archive 自动写
12. §2.3 memory-stage fields — ReviewingPanel 是否展示全部

**DRY 改进**（可与 8 一起做）：

13. §1.3.1 chapters-archive.ts retry-stage 抽公共 helper
