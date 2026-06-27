# PlotArc Redesign — 状态机扩展 + 软去重兜底

**Goal:** 把 plot-consolidator 当前的硬粒度约束 (main ≤ 1, side ≤ 2) 替换成 AI 主控 + 软约束 + 状态机扩展。AI 可推进 / 创建 / 关闭 (close) / 翻转类型 (main↔side); 代码层 Jaccard 兜底给相似新弧线打 tag; stale 自动检测让伏笔 / 一次性弧线在不丢失的前提下不污染 prompt。

> 范围：仅 PlotArc 状态机、plot-consolidator 行为、commit 末尾的 stale 检测 + Jaccard 兜底、ReviewingPanel 弧线卡片的 badge 展示。
> 不动：archive 主流程、PendingArchiveData 字段、user-close 路径（先 TODO 标记，后续管理页面再做）。

---

## 0. 业务背景 + 设计动机

### 0.1 当前硬粒度约束的痛点

`apps/server/src/services/plot-consolidator.ts:368-382` `validateGranularity` 在 AI 返回 updates + newArcs 后，校验 `main ≤ 1, side ≤ 2`，超出**直接抛错**，prepare-archive 整条失败。

用户 2026-06-27 反馈：
> "故事一大，后面的支线基本会很多，中间的一些支线也可能会有完成的时候的"

具体场景：
- 群像 / 多 POV 故事里，主角参与的事件线可能 > 1（每个 POV 一条 main）
- 伏笔弧线需要保留很久才能回收，不能因为不再推进就被丢弃
- AI 偶尔会"重复创建"已经存在的弧线（措辞不同但主题相同），需要代码兜底提示

### 0.2 设计意图（用户原话）

> "在准备归档后，应该是会将当前正文+以前的剧情弧线给AI分析吧，不让AI合并，只是更新剧情弧线的内容（相近的剧情），若正文中"剧情"没有对应到特定的弧线时，ai可以生成。"
> "故事章节一多时，如群像，很难分清什么是主线支线，但目前先定下主角参与的可以叫做主线吧，主线可能不知只有一个。"
> "剧情弧线多是避免不了的，有些剧情弧线可能是伏笔需要沉寂很久，有些可能就是后面真的一直用不到的没下文的但前期确实是提到的有用的，但还是要记录下来"

应用方式：

| 原则 | 落地点 |
|------|--------|
| **AI 主控** | AI 决定推进 / 创建 / 关闭 / 翻转类型，代码只在末尾做兜底 |
| **保留所有弧线** | 永久死（completed / closed）保留在 DB；stale 不在 prompt 但仍可见可被 AI 重新激活 |
| **软约束** | 去硬抛错，改 warn；Jaccard 命中软提示（badge）不阻塞 commit |
| **可扩展** | 状态机新增字段（closedReason / closedTargetArcId / lastTouchedChapter）只为后续功能奠基，不预先实现 UI |

### 0.3 当前实现摘要（先理解起点）

```
prisma/schema.prisma PlotArc {
  id, storyId, name, type, status, progress,
  stages (JSON), currentStage, nextGoal,
  unresolved (JSON), summary,
  createdAt, updatedAt
}

plot-consolidator.ts:
  consolidatePlotArcs() → AI 调用 → { updates, newArcs }
  ├─ 1. updates → mergeUpdateIntoExisting (isNew=false, existingId=<id>)
  ├─ 2. newArcs → newArcFromAI (isNew=true)
  ├─ 3. carry-forward (non-completed 未推进 existing, isNew=false)
  └─ 4. validateGranularity → main ≤ 1, side ≤ 2 (硬抛错)  ← 改成 warn

plot-extractor.ts:
  commitPlotArcWrites(tx, writes[])
  ├─ isNew=true → tx.plotArc.create
  └─ existingId → tx.plotArc.update

getActivePlotArcs(storyId) → 注入 prompt，filter status in [active, resolving, pending]
```

### 0.4 消费者链速查

| 消费者 | 文件 | 用法 |
|--------|------|------|
| 章节生成 prompt | `chapters-generate.ts` | `getActivePlotArcs` 注入 |
| archive 落库 | `chapters-archive.ts:200` | `commitPlotArcWrites(tx, pending.plotArcs)` |
| AI consolidate 输入 | `plot-consolidator.ts:231-233` | `existingList` 拼到 prompt |
| ReviewingPanel 编辑 | `ReviewingPanel.vue:103-154` | 用户改字段 + 删弧线 |
| Status badge 颜色 | `ChapterEditor.vue:484-497` | arcStatusType 映射 |

---

## 1. 状态机扩展

### 1.1 状态机演进

**旧 4 态**：pending / active / resolving / completed
**新 5 态**：active / resolving / completed / closed / stale

| 状态 | 语义 | 设置方 | carry-forward? | 注入 prompt? |
|------|------|--------|----------------|---------------|
| **active** | 进行中，主角参与 | AI update / 用户编辑 | ✓ | ✓ |
| **resolving** | 收尾中 | AI update / 用户编辑 | ✓ | ✓ |
| **completed** | 剧情自然完结（永久） | AI update / 用户编辑 | ✗ | ✗ |
| **closed** | AI 主动关闭（与其他弧线重复） | AI update（仅 AI 路径，本期不做 UI 手动 close） | ✗ | ✗ |
| **stale** | 长期未推进（5+ 章无 AI update） | 代码自动检测 | ✓ | ✓（AI 可重新激活）|

**去掉 pending**：新弧线创建时直接 `active`。状态机越短越好维护——"刚创建还没推进"这个语义跟 stale 没本质区别，省掉。

### 1.2 closed 与 completed 的关键差异

两者都退出 carry-forward / prompt 注入，但动机不同：
- `completed` = 剧情走完了，主线完结、副线收尾
- `closed` = AI 认为"这条与 X 重复，关闭这条以减少噪声"

UI 区分：
- completed badge：灰色（终态）
- closed badge：橙色 + 显示"被合并至: arc-X-name"（让用户知道去哪找）
- closed 弧线在 ReviewingPanel 显示一个"恢复"按钮（本期不做，TODO）

### 1.3 stale 检测

代码侧在 `commitPlotArcWrites` 末尾扫描：
```ts
const STALE_THRESHOLD_CHAPTERS = 5

for (const arc of allArcs where status in ['active', 'resolving']) {
  const lastTouched = arc.lastTouchedChapter ?? 0
  if (currentChapterNumber - lastTouched > STALE_THRESHOLD_CHAPTERS) {
    arc.status = 'stale'
    tx.plotArc.update({ where: { id: arc.id }, data: { status: 'stale' } })
  }
}
```

**关键：carry-forward 不刷新 `lastTouchedChapter`**
- 含义：lastTouchedChapter = "AI 上次实质提它的章节号"
- carry-forward（isNew=false, existingId=<id> 写回）只更新 updatedAt，不动 lastTouchedChapter
- AI update 路径显式刷新：`lastTouchedChapter = currentChapterNumber`

这样 stale 检测"顺手"做，逻辑单点，不需要额外扫描任务。

---

## 2. Schema 变更（prisma/schema.prisma）

### 2.1 PlotArc 字段新增

```prisma
model PlotArc {
  // 已有字段保持
  id, storyId, name, type, status, progress,
  stages, currentStage, nextGoal,
  unresolved, summary,
  createdAt, updatedAt

  // 新增字段
  closedReason       String?   // 'duplicate' / 其他 (status='closed' 时填)
  closedTargetArcId  String?   // 关闭时指向被合并到的 arc (status='closed' 时填)
  lastTouchedChapter Int?      // 上次被 AI update 推进的章节号 (stale 检测)
  similarToExistingIds String  @default("[]")  // JSON: ["arc-id-1", "arc-id-2"] (Jaccard tag)

  @@index([storyId, status])
}
```

### 2.2 migration

文件名：`prisma/migrations/20260627000000_plot_arc_soft_dedup/migration.sql`

内容：
1. 加 4 个新字段（nullable 或带 default）
2. 数据回填：
   - 现有 `status='pending'` → `'active'`
   - 现有所有 arc 的 `lastTouchedChapter` = 该故事最近 archived 章节号（无 archived 章节则 null）
3. 加 `@@index([storyId, status])`（如果原来没有；已存在则保留）

回填 SQL：
```sql
-- pending → active
UPDATE PlotArc SET status = 'active' WHERE status = 'pending';

-- lastTouchedChapter = 最近 archived 章节号 (按故事)
UPDATE PlotArc SET lastTouchedChapter = (
  SELECT MAX(number) FROM Chapter
  WHERE Chapter.storyId = PlotArc.storyId
    AND Chapter.status = 'archived'
) WHERE lastTouchedChapter IS NULL;
```

---

## 3. plot-consolidator.ts 变更

### 3.1 UpdateSchema 扩展（line 70-78）

```ts
const UpdateSchema = z.object({
  existingId: z.string(),
  type: z.enum(['main', 'side']).optional(),              // ← 新增：AI 可翻转 type
  progress: z.number().min(0).max(100).optional(),
  status: z.enum(['active', 'resolving', 'completed', 'closed', 'stale']).optional(),
  currentStage: z.string().optional(),
  nextGoal: z.string().optional(),
  unresolved: z.array(z.string()).optional(),
  summary: z.string().optional(),
  closedReason: z.enum(['duplicate']).optional(),          // ← 新增：status='closed' 时必填
  closedTargetArcId: z.string().optional(),                // ← 新增：被合并到的 arc id
})
```

### 3.2 NewArcSchema 不变

新弧线创建时 type 由 AI 在 newArcs 里直接给（已经是 enum），status 默认 'active'。

### 3.3 validateGranularity 改 soft warn（line 368-382）

```ts
// 旧：throw new Error(...)
// 新：app.log.warn + 通过
function validateGranularity(writes: ConsolidatedArcWrite[], app: FastifyInstance): void {
  const mainCount = writes.filter(w => w.type === 'main' && !['completed', 'closed'].includes(w.status)).length
  const sideCount = writes.filter(w => w.type === 'side' && !['completed', 'closed'].includes(w.status)).length
  if (mainCount > 5) {  // 软上限：5 条主线（远高于 1 但仍 warn）
    app.log.warn(`[PlotConsolidator] main arc count ${mainCount} exceeds soft cap 5`)
  }
  if (sideCount > 10) {  // 软上限：10 条支线
    app.log.warn(`[PlotConsolidator] side arc count ${sideCount} exceeds soft cap 10`)
  }
}
```

软上限 5/10 是保险丝——超过极端情况 log warn 提醒，不阻塞流程。日常情况远低于此。

### 3.4 getActivePlotArcs 过滤扩展（plot-extractor.ts:42-50）

```ts
const ACTIVE_STATUSES = ['active', 'resolving', 'stale']
// 旧：['active', 'resolving', 'pending']
// 新：['active', 'resolving', 'stale']
// closed / completed 不注入
```

### 3.5 carryForwardArc 不刷 lastTouchedChapter（plot-consolidator.ts:166-170 附近）

旧：carry-forward 走 update 路径，自动刷 updatedAt
新：carry-forward 仍走 update 路径刷 updatedAt，但**不动 lastTouchedChapter**——这个字段只在 AI update 路径刷新

实现：carryForwardArc 构造 write 时 status/progress/currentStage 等都不动（已有），保持 lastTouchedChapter 字段不变。Prisma update 不显式 set lastTouchedChapter 就不动它。

### 3.6 AI prompt 段调整（plot-consolidator.ts:258）

旧 prompt：
```
3. 【粒度约束】整个故事主线 (type=main) 最多 1 条, 支线 (type=side) 最多 2 条。
   已有弧线已经占用配额时, 新弧线必须替换/放弃, 不要硬凑。
```

新 prompt：
```
3. 【已有弧线管理】
   - 比对已有弧线 (含 status), 若主题/冲突/角色与已有高度重叠, 在 updates 里推进已有弧线,
     不要创建重复的 newArcs。
   - 若两条已有弧线中只有一条值得保留, 关闭另一条:
     在 updates 里写 status='closed' + closedReason='duplicate' + closedTargetArcId=<保留条id>。
   - 主线支线 (type) 跟章节 POV 绑定: 主角参与的剧情线可以标 main, 主角不参与的标 side。
     type 可随章节变化, 不用守"只能 1 条 main"。
   - 剧情自然收尾时, status='completed'; 与其他弧线重复时, status='closed'。
```

---

## 4. plot-extractor.ts 变更

### 4.1 commitPlotArcWrites 加 Jaccard 比对（line 14-33）

```ts
export async function commitPlotArcWrites(
  tx: any,
  chapterNumber: number,            // ← 新增：用于 lastTouchedChapter 刷新
  writes: PendingPlotArcWrite[]
): Promise<void> {
  // 1. 准备 existing arcs 列表 (Jaccard 比对 + lastTouchedChapter 刷新)
  const allArcs = await tx.plotArc.findMany({ select: { id: true, name: true, summary: true } })
  const existingForJaccard = allArcs.map(a => ({
    id: a.id,
    text: `${a.name} ${a.summary || ''}`,
    tokenSet: tokenSet(`${a.name} ${a.summary || ''}`)
  }))

  // 2. 遍历 writes
  for (const w of writes) {
    const data = { ... }

    if (w.isNew) {
      // Jaccard 兜底：相似 newArc 打 tag
      const similarIds: string[] = []
      for (const existing of existingForJaccard) {
        const candText = `${w.name} ${w.summary}`
        const sim = jaccardSimilarity(tokenSet(candText), existing.tokenSet)
        if (sim >= 0.7) similarIds.push(existing.id)
      }
      await tx.plotArc.create({
        data: {
          storyId: w.storyId, name: w.name, ...data,
          similarToExistingIds: JSON.stringify(similarIds)
        }
      })
    } else if (w.existingId) {
      await tx.plotArc.update({
        where: { id: w.existingId },
        data: { ...data, lastTouchedChapter: chapterNumber }
      })
    }
  }

  // 3. stale 检测：扫描所有 active/resolving arc
  const STALE_THRESHOLD = 5
  const candidates = await tx.plotArc.findMany({
    where: { status: { in: ['active', 'resolving'] } }
  })
  for (const arc of candidates) {
    const last = arc.lastTouchedChapter ?? 0
    if (chapterNumber - last > STALE_THRESHOLD) {
      await tx.plotArc.update({
        where: { id: arc.id },
        data: { status: 'stale' }
      })
    }
  }
}
```

**注意**：stale 检测**每章扫一次**所有 active/resolving 的 arc。如果某 arc 之前就是 stale（被 stale 状态卡住）且 lastTouchedChapter 一直没刷新，下一章 commit 后依然 stale（因为 lastTouchedChapter 仍是 5+ 章前的值）。这符合设计意图：stale 是稳定状态直到 AI 重新激活。

### 4.2 调用方更新（chapters-archive.ts:200）

```ts
// 旧：await commitPlotArcWrites(tx, pending.plotArcs)
// 新：
await commitPlotArcWrites(tx, chapter.number, pending.plotArcs)
```

---

## 5. 类型 / 接口变更

### 5.1 PendingPlotArcWrite（packages/shared/src/archive.ts:103-116）

加可选字段，**不破坏现有序列化**：

```ts
export interface PendingPlotArcWrite {
  storyId: string
  name: string
  type: string
  status: string
  progress: number
  stages: string
  currentStage: string
  nextGoal: string
  unresolved: string
  summary: string
  isNew: boolean
  existingId?: string
  // 新增（可选）：
  closedReason?: string            // 'duplicate' | 其他
  closedTargetArcId?: string       // 关闭时指向被合并到的 arc
}
```

### 5.2 PlotArcView 类型扩展

`plot-consolidator.ts:52-65` ExistingArcView 加 2 个字段：

```ts
export interface ExistingArcView {
  // 已有
  id, name, type, status, progress,
  currentStage, nextGoal,
  unresolved, summary,
  stages, createdAt, updatedAt
  // 新增（AI 决策用）
  closedReason: string | null
  closedTargetArcId: string | null
}
```

### 5.3 后端查 existing 时返回新字段

`consolidatePlotArcs` 调用方需要查多 2 个字段。修改点：
- `apps/server/src/services/plot-consolidator.ts` 的 existingArcs 来源（chapters-archive.ts 调用处）
- 加 `closedReason`, `closedTargetArcId` 到 select

---

## 6. UI 变更（apps/web/src/views/ReviewingPanel.vue）

### 6.1 arc 卡片顶部 badge

每个 `n-collapse-item` 头部（line 115 `:title="arc.name"` 之后）加：

```vue
<template #header-extra>
  <n-space size="small">
    <n-tag
      v-if="arc.similarToExistingIds && JSON.parse(arc.similarToExistingIds).length > 0"
      type="warning"
      size="small"
    >
      ⚠️ 相似: {{ formatSimilarArcNames(arc.similarToExistingIds) }}
    </n-tag>
    <n-tag
      v-else-if="arc.status === 'closed'"
      type="warning"
      size="small"
    >
      已关闭
    </n-tag>
  </n-space>
</template>
```

### 6.2 status 下拉选项扩展

```ts
const arcStatusOptions = [
  { label: '进行中', value: 'active' },
  { label: '收尾中', value: 'resolving' },
  { label: '已完成', value: 'completed' },
  { label: '已关闭', value: 'closed' },
  { label: '沉寂', value: 'stale' }
]
```

（去掉 "待开始" 因为 pending 已废除）

### 6.3 相似弧线名称解析

```ts
function formatSimilarArcNames(similarToJson: string): string {
  const ids = JSON.parse(similarToJson)
  return ids.map(id => {
    const a = plotArcs.value.find(a => a.existingId === id || a.id === id)
    return a?.name || id.slice(0, 8)
  }).join(', ')
}
```

UI 实现：
- pendingArchiveData 里 newArc 的 similarToExistingIds 已经是 string
- 对应的 existing arc 在 localData.plotArcs 里也能找到（同一批 pendingPlotArcWrite）
- 如果找不到对应 name 就退化成 id 前 8 位

### 6.4 不做的事（TODO 标记）

- ❌ ReviewingPanel 不加 "关闭此弧线" 按钮（user-close 路径，需要新增管理页面）
- ❌ 不加 "恢复 closed 弧线" 按钮（同上）
- ❌ 不加 similarTo 的去重操作（仅展示，不让用户直接合并）

注释里加 TODO：
```ts
// TODO(P2): 用户手动 close / 恢复弧线 / similarTo 一键合并
//  需要新建独立的"剧情弧线管理"页面，不在 ReviewingPanel 里堆功能
```

---

## 7. 测试

### 7.1 plot-consolidator.test.ts（已有）

扩展：
- UpdateSchema 接受 `type: 'main' | 'side'`（AI 翻转）
- UpdateSchema 接受 `status: 'closed'` + `closedReason: 'duplicate'` + `closedTargetArcId`
- UpdateSchema 拒绝 `status: 'pending'`（已废除）
- `validateGranularity` 不抛错（改 warn），超出软上限返回正常
- `getActivePlotArcs` 过滤掉 completed / closed

### 7.2 plot-extractor.test.ts（新建）

commitPlotArcWrites：
- isNew=true 时 Jaccard 命中 → similarToExistingIds 写入 existing ids
- isNew=true 时 Jaccard 不命中 → similarToExistingIds = []
- isNew=false 时 update 路径刷新 lastTouchedChapter
- carry-forward 路径不刷新 lastTouchedChapter
- stale 检测：currentChapterNumber - lastTouchedChapter > 5 → 转 stale
- stale 已是 stale → 不重复触发
- completed / closed 弧线不参与 stale 检测

Jaccard 边界：
- name 完全相同 + summary 完全相同 → Jaccard = 1.0 → 命中
- name 完全无关 → Jaccard < 0.3 → 不命中
- name 相似但 summary 完全不同 → Jaccard < 0.7 → 不命中

### 7.3 数据迁移测试

- 现有 pending arc → migration 后 status='active'
- 现有 arc → migration 后 lastTouchedChapter = 该故事最近 archived 章节号
- 没有 archived 章节的故事 → lastTouchedChapter = null（stale 检测会跳过）

---

## 8. 实施步骤（高层）

按依赖顺序拆成 2 个 PR：

**PR1: 状态机扩展**
1. schema.prisma 加 4 字段 + migration
2. UpdateSchema 加 type + closed 字段
3. validateGranularity 改 warn
4. getActivePlotArcs 过滤改 ['active', 'resolving', 'stale']
5. 测试：plot-consolidator.test.ts 扩展

**PR2: stale 检测 + Jaccard 兜底 + UI badge**
1. commitPlotArcWrites 改签名 (加 chapterNumber)
2. Jaccard 比对 + similarToExistingIds tag
3. stale 自动检测
4. chapters-archive.ts:200 调用方更新
5. ReviewingPanel.vue: badge + status 下拉扩展
6. PendingPlotArcWrite 加 closedReason / closedTargetArcId
7. 测试：plot-extractor.test.ts 新建

中间可穿插：types 同步、prisma generate、跑 typecheck。

---

## 9. 不动原则

| 不动 | 原因 |
|------|------|
| PendingArchiveData 顶层字段 | 已有 plotArcs 字段，schema 不变 |
| Archive 主流程 (chapters-archive.ts) | 只动 commitPlotArcWrites 调用，其他不变 |
| generate-processor / score / memory | 与 plot arc 无关 |
| User-close 路径（ReviewingPanel 关闭按钮） | TODO 标记，需要独立管理页面 |
| 类似 merge 操作（合并两条 arc 为一条 row） | 本期 soft tag 已够，merge 复杂度高 |
| chapters-archive 主事务结构 | commitPlotArcWrites 仍走 $transaction |

---

## 10. 验证清单

- [ ] `pnpm db:migrate` 成功 + 回填正确
- [ ] `pnpm db:generate` 重新生成 client 无 type error
- [ ] `pnpm typecheck` 干净
- [ ] `pnpm --filter server test plot-consolidator` 全部通过
- [ ] `pnpm --filter server test plot-extractor` 全部通过
- [ ] 现有 35 个 memory-extractor 测试仍过（回归）
- [ ] `pnpm test` 全量 227+ tests 通过
- [ ] 手动：1 个故事准备归档，含 2 条相似弧线 → 提交后 ReviewingPanel 看到 badge

---

## 11. 风险与边界

| 风险 | 缓解 |
|------|------|
| Migration 回填 lastTouchedChapter 用最近 archived 章节号，但 story 刚起步无 archived | null；stale 检测 `?? 0`，chapter - 0 > 5 → 立即全 stale。但无 archived 时也不会有 prepare-archive，所以实际不会触发 |
| Jaccard 误判（短字符串） | 阈值 0.7 + name + summary 合并。短字符串（< 5 token）Jaccard 不稳定，可能误判。考虑加长度下限（< 8 token 不参与比对），后续观察 |
| lastTouchedChapter = null 时 stale 检测逻辑 | `?? 0` 后 chapter - 0 = chapterNumber，远大于 5 → 立即转 stale。但这是合理的"还没推进过"语义 |
| soft warn 上限（5 main / 10 side）拍脑袋 | 后续根据实际日志调整；阈值放常量方便改 |
| similarToExistingIds JSON 解析错误 | 用 `safeJsonParse` helper 兜底（@novel-runtime/shared 已有） |
| 大量 carry-forward 时 stale 扫描开销 | 1 次 findMany + N 次 update，N 通常 ≤ 20，开销可接受；后续可优化批量 update |

---

## 12. 后续 TODO（本次不做）

- 用户手动 close / 恢复弧线 UI（需独立管理页面）
- similarTo 一键合并操作（仅展示不操作）
- 软上限阈值根据日志调优
- Jaccard 短字符串边界优化
- 批量标记 completed（ReviewingPanel 当前只支持单条操作）