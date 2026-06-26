# Timeline Position Encoding Completion — Design Spec

**Goal:** 推完 timeline-encoding 半成品改动：让 server-side write path (memory-extractor / combined-extractor / chapters-archive) 与 read path (chapters-generate / stories / timeline route / web) 在 `position` 字段上对齐，重新生成 Prisma client，修复数据迁移遗留的语义损坏，让 preview / archive / 章节生成 prompt 实际可用。

> 范围：仅时间线相关代码 + 数据清空 + 测试。**不动** memory / graph / plot arc / 角色 / 世界观等其他模块。
> 当前 working tree 的 timeline 半成品改动不再回滚，全部 commit 进这一版。

---

## 0. 业务背景 + 设计动机（先理解为什么）

### 0.1 旧设计 `day` 整数的局限

旧 schema 用 `TimelineEvent.day: Int` 表示"故事开始第几天"。这只能 cover 极简场景：
- **故事不能跨年**：D=400 之后跟 D=1 谁先谁后？
- **前史不可表达**："主角穿越前 10 年"怎么写？-10？还是 year 0？
- **小时段不可定位**：AI 说"李凡傍晚到达"和"李凡清晨到达"，day 字段区分不开
- **跨章连续性靠人工**：AI 容易写出"第 5 章 day=100，第 6 章 day=50"这种回退

### 0.2 新设计 `Y.DDDHH` 实数的动机

`TimelineEvent.position: Float` 用单小数点编码 **年.天.时**：
- 整数位 `Y` = 故事第 N 年（负数 = 前史）
- 小数位 `DDDHH` = 3 位天 + 2 位时，恰好 5 位
- 例：`1.00106` = 第 1 年第 1 天 06 时；`-2.05018` = 前 2 年第 50 天 18 时
- 排序就是数字 asc（`orderBy: { position: 'asc' }`），跨年/前史都自然有序
- **跨章连续性靠编码本身**：第 6 章 position > 第 5 章 position 是物理约束（数据库排），不是 prompt 约束

### 0.3 数据流（端到端）

```
┌─ AI 提取 (memory-extractor)
│   MemoryExtractionResult {
│     timelinePosition: number | null   ← 本章开篇时间锚点
│     timelineEvents: {position, description}[]   ← 章内多个时间点
│   }
│
├─ 数据准备 (prepareMemoryWrites)
│   归一化 timelineEvents[]
│   sanitizeTimelinePosition 兜底
│
├─ 事务写入 (chapters-archive.ts archive 端点)
│   ┌─ prisma.$transaction
│   │   ├─ commitMemoryWrites(tx, ...)
│   │   │   └─ upsert TimelineEvent (按 storyId_position 复合键)
│   │   └─ tx.chapter.update  ← 本期新增:
│   │       data: { timelinePosition, summary }
│   └─
│
├─ 读取消费
│   ├─ chapters-generate.ts → PromptPipeline.timeline layer → AI 章节生成 prompt
│   ├─ stories.ts → Story 详情接口 timelineEvents[] 字段
│   ├─ timeline.ts → Timeline CRUD (用户手动管理)
│   └─ web views → Timeline.vue / ReviewingPanel.vue (UI 渲染 + 编辑)
│
└─ 级联删除 (chapters-crud.ts 删章节)
    deleteMany timelineEvent where storyId=?, fromChapterNumber=?
```

### 0.4 Consumer 链速查

| 消费者 | 文件 | 用的字段 |
|--------|------|---------|
| 章节生成 prompt 第 7 层 | `chapters-generate.ts:119, 246` | `timelineEvents[].position` + `events` 渲染成 `[第1年第1天 06时] 事件1；事件2` |
| Story 详情接口 | `stories.ts:90` | `timelineEvents[]`（按 position asc） |
| Timeline 页 CRUD | `apps/web/src/views/Timeline.vue` | `position`, `events[]` |
| ReviewingPanel 时间线 tab | `apps/web/src/views/ReviewingPanel.vue:87-99` | `te.position`, `te.events`（用户在 archive 阶段编辑）|
| Worker task 模板选择 | `apps/web/src/views/StoryWorkerTask.vue:87, 96` | timeline worker（setting.ts 已删 default，但 UI 仍可选）|
| 章节删除级联 | `chapters-crud.ts:176` | `deleteMany where storyId, fromChapterNumber` |

### 0.5 设计原则（用户原话）

> "治本的稳健的，代码是优化解耦的、易读的可扩展的"

应用方式：

| 原则 | 在 timeline 工作里的落地点 |
|------|---------------------------|
| **治本** | 不 patch symptom（preview 500），而是 fix root cause：schema + data + prompt + client + code 全部对齐 Y.DDDHH 编码。一次到位，避免下次又半成品。|
| **稳健** | (1) `sanitizeTimelinePosition` 兜底（AI 返回 1.5 这种不合法值不写库，记 warning）；(2) `isValidPosition` 检测 + 渲染降级（`位置无效: <值>`），不抛 500；(3) 数据清空是显式 destructive 操作，可回滚（备份）|
| **解耦** | Y.DDDHH 编解码抽到 `packages/shared/src/timeline-encoding.ts` 单点真源；server 用 TS import；前端先复制实现（避免改 vite workspace 配置）。Memory / timeline / graph / plot 各 worker 数据流清晰分工|
| **易读** | 每个模块单一职责：encode / decode / sanitize / isValid / formatSafe 各一个纯函数；命名直白（`decodeTimelinePosition` 不叫 `parsePos`）；关键决策有注释|
| **可扩展** | (1) `TimelineEventExtraction` 接口预留 `events: string[]`（chapter 内多时间点）；(2) `Chapter.timelinePosition` 字段已就位，未来跨章冲突检测只需加 worker；(3) 编码是 Real（不是 String），未来支持查询"两个事件之间多少时间"无需 schema 改 |

---

## 1. 现状（坑汇总）

### 1.1 cross-file 不一致矩阵

| 文件 | 当前 working tree 状态 | 字段 |
|------|----------------------|------|
| `prisma/schema.prisma` | ✅ timeline-encoding | `position` (Float) |
| `prisma/migrations/20260626000000_*/migration.sql` | ✅ new | `position` |
| `node_modules/.prisma/client/index.d.ts` | ❌ HEAD | `day` (regen 失败 EPERM) |
| `packages/shared/src/archive.ts` + `dist` | ✅ timeline-encoding | `position` |
| `apps/server/src/services/memory-extractor.ts` | ❌ HEAD + importance | `day` |
| `apps/server/src/services/combined-extractor.ts` | ❌ HEAD | `day`（借 memory-extractor 类型）|
| `apps/server/src/routes/chapters-archive.ts` | ❌ HEAD | `day`（借 memory-extractor 类型）|
| `apps/server/src/routes/chapters-generate.ts` | ✅ timeline-encoding | `position`（只读排序）|
| `apps/server/src/routes/timeline.ts` | ✅ timeline-encoding | `position` |
| `apps/server/src/routes/stories.ts` | ✅ timeline-encoding | `position` |
| `apps/server/src/setting.ts` | ✅ 删 `timeline` worker default | — |
| `apps/web/src/views/Timeline.vue` | ✅ timeline-encoding | `position` |
| `apps/web/src/views/ReviewingPanel.vue` | ✅ timeline-encoding | `position` |
| `apps/web/src/api/timeline.ts` | ✅ timeline-encoding | `position` |
| 测试文件 | 一半一半 | 混 |

### 1.2 数据语义损坏（已被 §3.1 清空决策覆盖）

迁移 SQL 把 `TimelineEvent.day` (Int) → `position` (Float)，**position 值还是整数日**（dev.db 现在 9f5c 故事的 6 行：position = 0.0, 0.5, 1.0）。

迁移 SQL 自带注释："旧 day 数据按整数搬到 position（语义暂保留，待手动修正成 YYYY.MMDD.HH 编码）" —— **写代码的人知道这事没做完**。

**用户决策**：不修，直接清空（详见 §3.1）。

### 1.3 AI prompt vs schema 断层

- memory-extractor.ts prompt 让 AI 返回 `timelineDay`（整数）
- 新 schema 期望 Y.DDDHH 编码
- 即便修代码层，prompt 不改 AI 仍会输出整数

### 1.4 Chapter.timelinePosition 列存在但没人写

- migration 加了 `Chapter.timelinePosition` REAL 列
- 但 archive 事务里**没有任何代码写它**
- AI 返回的 `timelinePosition` 进了 `PendingMemories.timelinePosition` 但丢在 payload 里

### 1.5 setting.ts 删 `timeline` worker default 但未审计 consumer

需要 grep 确认没有别的代码依赖这个 task key。

### 1.6 测试覆盖一半

- `combined-extractor-prompt.test` / `truncate.test` / `extractAll.test` / `routes/chapters-zod-validation.test` / `routes/prepare-archive.test` 已改 timeline-encoding 接口
- `memory-extractor.test`（之前我新加的）还是 HEAD 接口（`timelineDay` 字段名）
- 缺 Y.DDDHH 编解码单测 + timeline API CRUD 集成测试

### 1.7 跨章时间连贯性无约束

- 旧设计：`day` 整数，新章 day 应 ≥ 旧章 day（隐含）
- 新设计：`position` Y.DDDHH，新章应 ≥ checkpoint chapter position
- schema 没有 CHECK 约束，靠 prompt 兜底

### 1.8 preview 500 根因

`chapters-generate.ts:90` 用 `position: 'asc'` 排序，但 Prisma client 还是 HEAD（只认识 `day`）→ `Unknown argument 'position'`。

---

## 2. 目标

1. **跨模块对齐**：server write path + read path + Prisma client + DB schema + AI prompt 全部 timeline-encoding 一致
2. **数据语义恢复**：现有 TimelineEvent 行的 position 值重新解释为合法 Y.DDDHH（见 §3.1 数据迁移策略）
3. **Archive 端到端工作**：章节归档后 TimelineEvent 写入合法 position，Chapter.timelinePosition 同步写库，preview / generate 读 timeline 不再 500
4. **测试覆盖完整**：Y.DDDHH 编解码 / memory-extractor 改动 / timeline API CRUD / archive 集成测试全过
5. **回滚可逆**：commit 失败可回到 `d0fb8de`，数据可从 backup 还原

---

## 3. 设计决策

### 3.1 数据清空策略（**用户决定**）

**用户决策**：TimelineEvent 旧数据**直接清空**，不做任何迁移。

**理由**：
- 用户故事大部分是测试数据
- TimelineEvent 没有跨表外键引用（Chapter 不引用 TimelineEvent.id，Memory 不引用）
- 唯一关联是 `TimelineEvent.fromChapterNumber = Chapter.number`，但 Chapter 表保留
- 清空后用户重新跑 archive 时会重建 timeline 上下文

**清空范围**：
- `prisma.dev.db` 里所有 `TimelineEvent` 行
- `Chapter.timelinePosition` 列：清 NULL（保留列，不删字段——用户后续还是会写）
- 不动其他表（Memory / CharacterBranchState / PlotArc / GraphNode / Chapter 等）

**清空步骤**：
1. `cp prisma/dev.db prisma/dev.db.pre-timeline-clean.bak`（备份，回滚用）
2. `pnpm prisma db execute --schema prisma/schema.prisma --stdin <<EOF`
   ```sql
   DELETE FROM TimelineEvent;
   UPDATE Chapter SET timelinePosition = NULL;
   ```
3. 验证：`SELECT count(*) FROM TimelineEvent` → 0；`SELECT count(*) FROM Chapter WHERE timelinePosition IS NOT NULL` → 0

**渲染层仍保留 `isValidPosition` 容错**：用户手动新增 timeline event 时万一输错（虽然 Timeline.vue 是 `<n-input-number :step="0.0001">` 引导，但极端边界仍要容错），渲染降级到 `位置无效: <值>`，不抛 500。

### 3.2 Y.DDDHH 编码常量（单点真源）

抽到 `packages/shared/src/timeline-encoding.ts`：

```typescript
export const TIMELINE_POSITION = {
  HOUR_PER_DAY: 24,
  DAY_PER_YEAR: 365,
  DECIMAL_PLACES: 5,           // DDDHH = 3+2
  DECIMAL_DIVISOR: 100000,     // 10^5
  DEFAULT_DAY_FALLBACK: 12,    // 默认中午（无明确时间时）
  YEAR_FLOOR: -9999,           // 允许的最早年份（前史）
  YEAR_CEIL: 9999,
} as const

export function encodeTimelinePosition(year: number, day: number, hour: number): number
export function decodeTimelinePosition(position: number): { year: number; day: number; hour: number; sign: '' | '前' }
export function isValidPosition(p: number): boolean
export function sanitizeTimelinePosition(raw: unknown): number | null  // null = skip write
```

**单点真源**：chapters-generate.ts 的 `formatTimelinePosition` 和 Timeline.vue 的同款函数都改用 `decodeTimelinePosition`，不再各自解析。

**前端复用**：Timeline.vue / ReviewingPanel.vue 都 import 这个工具（前端通过 `packages/shared` 子路径或复制实现，先选复制实现，避免跨包 vite 配置改 — 后续 P+ 优化方向）

### 3.3 Server write path 改动

| 文件 | 改动 |
|------|------|
| `apps/server/src/services/memory-extractor.ts` | `MemoryExtractionResult.timelineDay: number \| null` → `timelinePosition: number \| null`；新增 `timelineEvents: TimelineEventExtraction[]`（章节内多个时间点）；prompt 教 Y.DDDHH；`TimelineEventWrite.day` → `position`；`storyId_day` 复合键 → `storyId_position`；commit 时调 `sanitizeTimelinePosition` 兜底 |
| `apps/server/src/services/combined-extractor.ts` | 无直接 timeline 逻辑（借 memory-extractor 类型），但 `CombinedExtractionData` / `prepareArchiveData` 要透传 `timelinePosition` 和 `timelineEvents` 到 `PendingMemories` |
| `apps/server/src/routes/chapters-archive.ts` | archive 事务里**新增**：写 `Chapter.timelinePosition = data.memories.timelinePosition`（如果非 null）；现有 `commitMemoryWrites` 调用保持（commitMemoryWrites 内部已用 `day`，改后用 `position`）|

### 3.4 AI prompt 改写方向

memory-extractor.ts prompt 当前让 AI 返回 `timelineDay`（整数）。新 prompt：

```
- timelinePosition: 本章开篇时间锚点 (**单小数点浮点数, 编码 Y.DDDHH**)
  - 整数位 Y = 故事第 N 年 (故事开始 = 第 1 年, 前史/穿越用负数年)
  - 小数位必须**恰好 5 位** = DDDHH (3 位天 + 2 位小时)
  - 1 年固定 365 天, 不区分大小月/闰年
  - 例: 故事第 1 年第 1 天 06 时 → 1.00106; 第 1 年第 100 天 12 时 → 1.10012;
        第 1 年第 365 天 22 时 → 1.36522; 前史 2 年前第 50 天 18 时 → -2.05018
  - **返回值约定**: 能确定时间 → 返回该 Y.DDDHH 数字; 完全无法判断 → 返回 null
  - 小时段兜底: 早晨=06, 中午=12, 傍晚=18, 夜里=22, 凌晨=00
- timelineEvents: 本章内发生在不同时间点的事件 (数组)
  - 元素: { position: number (Y.DDDHH), description: string }
  - 至少 1 个 = 章首事件; 章内跨多个明确时间点的情节应分别记录
  - 例: [{ "position": 1.00106, "description": "李凡清晨重伤醒来" }, ...]
```

**字段约束**：
- `timelinePosition` 和 `timelineEvents` 都是**可选**：能确定时间才填；完全无法判断 → `null` 和 `[]`
- `timelineEvents` 不是 `timelinePosition` 的展开：章首事件必有 `timelineEvents[0].position === timelinePosition`

### 3.5 Chapter.timelinePosition 写库位置

archive 事务里（`chapters-archive.ts` 的 `prisma.$transaction` 内）：

```typescript
// 新增: 写 Chapter.timelinePosition
if (pending.memories.timelinePosition != null && typeof pending.memories.timelinePosition === 'number') {
  await tx.chapter.update({
    where: { id: chapterId },
    data: { timelinePosition: sanitizeTimelinePosition(pending.memories.timelinePosition) ?? undefined }
  })
}
```

注意：`tx.chapter.update` 和现有 `commitMemoryWrites` 在**同一事务**里写，确保要么都成功要么都回滚。

### 3.6 setting.ts 删 `timeline` worker default 的审计

`grep -rn "loadWorkerTask.*timeline\|\"timeline\"" apps/server/src`：确认无 consumer。
- 无 consumer → 保持删（合并进 memory worker 已是定局）
- 有 consumer → 从 setting.ts 恢复 default，并记录为何删除的判断是错的

### 3.7 测试策略

**新增单测**：

| 文件 | 测试内容 |
|------|---------|
| `packages/shared/src/__tests__/timeline-encoding.test.ts` | encode / decode / isValid / sanitize 边界 (YEAR_FLOOR/CEIL, 跨年, 负数, NaN, null) |
| `apps/server/src/__tests__/services/memory-extractor.test.ts`（重写）| 改 `timelinePosition` + `timelineEvents` 字段；clamp 测试保持 |
| `apps/server/src/__tests__/routes/timeline-api.test.ts`（新增）| GET/POST/PUT/DELETE timeline 路由 |
| `apps/server/src/__tests__/routes/prepare-archive-timeline.test.ts`（扩展现有）| archive 事务写 Chapter.timelinePosition + TimelineEvent.position + Chapter.timelinePosition 路径都走通 |

**集成验证**（不写测试，手动）：
- 用 `pnpm dev` 跑起来
- archive 一章 9f5c → 看 TimelineEvent 表新行 position 是不是合法 Y.DDDHH
- 看 Chapter.timelinePosition 是不是同步写库
- preview / generate 不再 500
- Timeline.vue / ReviewingPanel.vue 编辑时间事件正常

### 3.8 Prisma client regen 策略

`pnpm db:generate` 失败 EPERM 是 Windows 文件占用。步骤：
1. 停 `pnpm dev`（如果跑了）
2. 关 IDE（VSCode 可能占用 .prisma 文件夹做索引）
3. 重试 `pnpm db:generate`
4. 如果还失败：`pnpm db:generate --force` 或 `rm -rf node_modules/.prisma && pnpm db:generate`

---

## 4. 实施步骤（按依赖顺序）

> 每步独立可验证，typecheck + 测试在每步后跑。

**Step 1：抽 Y.DDDHH 工具（单点真源）**
- 新建 `packages/shared/src/timeline-encoding.ts` + 测试
- `pnpm --filter shared build`
- ✅ 验证：单测全过

**Step 2：修 memory-extractor.ts**
- `MemoryExtractionResult.timelineDay → timelinePosition`，新增 `timelineEvents: TimelineEventExtraction[]`
- `TimelineEventWrite.day → position`
- `storyId_day 复合键 → storyId_position`
- prompt 改写教 Y.DDDHH
- `commitMemoryWrites` / `saveExtractedMemory` 用 `sanitizeTimelinePosition` 兜底
- 重写 `memory-extractor.test.ts`（字段对齐新接口）
- ✅ 验证：typecheck + 27 文件测试全过

**Step 3：修 combined-extractor.ts**
- `CombinedExtractResultSchema` / `CombinedExtractionData` 加 `timelinePosition` + `timelineEvents` 字段透传
- `prepareArchiveData` 把 `extraction.memories.timelinePosition` 拷到 `memoryData`（经 `prepareMemoryWrites` 已经产出）
- ✅ 验证：typecheck

**Step 4：修 chapters-archive.ts**
- archive 事务里加 `Chapter.timelinePosition` 写库
- ✅ 验证：typecheck + 集成测试

**Step 5：regen Prisma client**
- 停 dev server / 关 IDE
- `pnpm db:generate`
- ✅ 验证：`node_modules/.prisma/client/index.d.ts` 出现 `storyId_position` 而非 `storyId_day`

**Step 6：跑全套 typecheck + 测试**
- `pnpm typecheck`
- `pnpm --filter server exec vitest run`
- ✅ 验证：0 error，185+ 测试全过

**Step 7：数据清空**
- `cp prisma/dev.db prisma/dev.db.pre-timeline-clean.bak`
- `pnpm prisma db execute --schema prisma/schema.prisma --stdin` 跑 `DELETE FROM TimelineEvent; UPDATE Chapter SET timelinePosition = NULL;`
- ✅ 验证：`SELECT count(*) FROM TimelineEvent` = 0；`Chapter.timelinePosition` 全部 NULL

**Step 8：手动 e2e 验证**
- `pnpm dev`
- archive 一章 → 检查 TimelineEvent 新行 / Chapter.timelinePosition
- preview / generate 不再 500
- Timeline.vue 编辑正常

**Step 9：审计 setting.ts timeline worker key**
- `grep -rn '"timeline"' apps/server/src`
- ✅ 验证：无 dangling reference

**Step 10：git status 确认范围 + commit**
- 确认 working tree 只含 timeline-encoding 相关文件
- commit message 详述

---

## 5. 风险 + 缓解

| 风险 | 缓解 |
|------|------|
| AI 仍输出非 Y.DDDHH（如 1.5 这种）| prompt 显式约束 + 代码层 `sanitizeTimelinePosition`（null → skip write，不入库脏数据）|
| 数据清空后用户故事无 timeline 上下文 | 用户重新跑 archive 流程会重建 TimelineEvent（新写入合法 Y.DDDHH）；旧 prompt 依赖 timeline layer 现在为空，章节生成仍能跑（空 string layer）|
| Prisma client regen 文件占用 | 停 dev server / 关 IDE / `--force` |
| typecheck 改了又出新 error | 每次 Step 1-4 跑 typecheck，逐步 commit 比 big-bang 易回滚 |
| 数据清空操作不可逆 | `dev.db.pre-timeline-clean.bak` 备份；commit 前用户确认 |
| 已有 chapter.timelinePosition 是 null，archive 后不写 | Step 4 显式 `if != null` 写；写 null（明确无时间）vs 不写（保留前值）— 不写保持现状 |
| 测试覆盖半边状态 | Step 6 全跑；新增 timeline-encoding + timeline-api + prepare-archive-timeline 测试 |
| 推完发现 AI prompt 写 Y.DDDHH 太难 | 后续可加 worker task 微调或回退到 `timelineDay` 整数 + 后续计算 |
| setting.ts 删 timeline worker default 后 StoryWorkerTask.vue 仍可选 | UI 选择后写入 DB 的 WorkerTask 表，setting.ts 只影响硬编码 fallback；功能不破坏 |

---

## 6. 回滚方案

**代码回滚**：`git reset --hard 9efde51`（spec commit 之前的 HEAD）或 `d0fb8de`（importance commit 之前的 HEAD，更彻底）。

**数据回滚**：`cp prisma/dev.db.pre-timeline-clean.bak prisma/dev.db`。

**Prisma client 回滚**：`pnpm db:generate` 重生成（schema 还是 timeline-encoding，所以重生成还是 timeline-encoding）。

**Stash 清理**：commit 前 `git stash drop stash@{0}`。

---

## 7. 非目标（本期不做）

- 跨章时间冲突检测（"新章 position < checkpoint position"报错）
- Chapter.timelinePosition 可视化（web UI 展示"第 X 年第 Y 天 Z 时"）
- TimelineEvent CRUD 添加审计日志
- Timeline.vue 拖拽排序
- Y.DDDHH 编码 i18n（"第 1 年" → "Year 1"）
- 前端 timeline-encoding 工具包复用（先复制实现，跨包 vite 配置是 P+）

---

## 8. 验收标准

- [ ] `pnpm typecheck` 8/8 packages 0 error
- [ ] `pnpm --filter server exec vitest run` 全过（185+ 测试）
- [ ] 新增 timeline-encoding.test.ts + memory-extractor 重写 + timeline-api.test + prepare-archive-timeline 扩展全过
- [ ] `pnpm db:generate` 成功（Prisma client 识别 `position` 字段，识别 `storyId_position` 复合键）
- [ ] dev.db 数据清空：TimelineEvent 行数 = 0，Chapter.timelinePosition 全部 NULL；备份在 `prisma/dev.db.pre-timeline-clean.bak`
- [ ] `pnpm dev` 起来后，preview / generate 接口不再 500
- [ ] archive 一章：TimelineEvent 新行 position 是合法 Y.DDDHH，Chapter.timelinePosition 同步写库
- [ ] Timeline.vue / ReviewingPanel.vue 显示时间格式正确（旧脏数据如有残留显示 `位置无效: <值>`，不报错）
- [ ] setting.ts 删 `timeline` worker default 已审计无 dangling consumer
- [ ] git status 确认 scope 干净后 commit