# 剧情弧线重构（PlotArc Redesign）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把剧情弧线重构为「事实（推进点）+ 派生状态」模型——推进点独立表、isEnd 双保险判完成、状态代码推导、删除章节可回退。

**Architecture:** PlotArc 表精简为身份字段，推进历史移到独立表 `PlotArcProgressPoint`；AI 分析只输出「推进点 + isEnd + 相似关闭」；状态由纯函数 `derivePlotArcStatus` 在归档后推导；删除章节按 `firstChapterNumber` / `chapterNumber` 级联。

**Tech Stack:** TypeScript、Prisma（SQLite）、Fastify、Vitest（server）、Vue 3 + Naive UI（web）

**Spec:** `docs/superpowers/specs/2026-08-14-plot-arc-redesign-design.md`

**注意：** 用户明确「不考虑数据迁移」——dev 库数据不多，直接重建。migration 只需删旧字段 + 建新表，不需要回填。

---

## 文件结构

- 修改 `prisma/schema.prisma` — PlotArc 精简 + 新增 PlotArcProgressPoint
- 新增 `apps/server/src/services/plot-arc-status.ts` — 状态推导纯函数
- 修改 `apps/server/src/services/plot-consolidator.ts` — AI 分析 prompt 重写（推进点 + isEnd + 相似关闭）
- 修改 `apps/server/src/services/plot-extractor.ts` — 落库（推进点/关闭）+ getActivePlotArcs 重写
- 修改 `apps/server/src/routes/chapters-archive.ts` — prepare-archive + archive 落库 + 状态推导
- 修改 `apps/server/src/routes/chapters-crud.ts` — 删除章节级联
- 新增 `apps/server/src/routes/plot-arcs.ts` — 弧线查询路由（管理页用）
- 新增 `apps/web/src/views/PlotArcs.vue` — 弧线管理页
- 修改 `apps/web/src/views/ReviewingPanel.vue` — plotArcs tab 改成推进点展示
- 新增 `apps/web/src/api/plot-arc.ts` — 前端 API
- 测试：`plot-arc-status.test.ts`（新）、`plot-consolidator.test.ts`（改）、`plot-extractor.test.ts`（改）

---

## Task 1: Schema 变更

**Files:**
- Modify: `prisma/schema.prisma`（PlotArc 模型 + 新增 PlotArcProgressPoint）

### Step 1: 替换 PlotArc 模型 + 新增 PlotArcProgressPoint

在 `prisma/schema.prisma` 中，把现有 `model PlotArc`（约 273-296 行）整体替换为：

```prisma
// 剧情弧线（v2 重构：事实 + 派生状态）
model PlotArc {
  id                 String   @id @default(uuid())
  storyId            String
  name               String
  isMainline         Boolean  @default(false) // 主线/支线
  status             String   @default("active") // active | inactive | completed | closed（代码推导）
  firstChapterNumber Int      // 弧线来源章节号
  closedBy           String?  // user | ai-similar（关闭时填）
  closedTargetArcId  String?  // AI 相似关闭时指向合并目标
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt

  story          Story                 @relation(fields: [storyId], references: [id], onDelete: Cascade)
  progressPoints PlotArcProgressPoint[]

  @@index([storyId, status])
}

// 剧情推进点（独立表，每弧线每章最多一条）
model PlotArcProgressPoint {
  id            String   @id @default(uuid())
  arcId         String
  chapterNumber Int
  content       String   // 推进内容（核心简练）
  isEnd         Boolean  @default(false) // 是否「完成」标志（AI 软判断）
  createdAt     DateTime @default(now())

  arc PlotArc @relation(fields: [arcId], references: [id], onDelete: Cascade)

  @@index([arcId, chapterNumber])
  @@index([chapterNumber])
}
```

### Step 2: 生成 migration

Run: `pnpm db:migrate --name plot_arc_redesign`

Expected: 生成 migration SQL（删旧字段、建新表）。因为是 dev 库、数据少，旧数据直接丢弃，不需要回填。

### Step 3: 重新生成 Prisma client

Run: `pnpm db:generate`

Expected: 无错误。

### Step 4: 确认 typecheck 通过（此时旧代码会报错，属预期）

Run: `pnpm --filter server typecheck`

Expected: 报错（旧代码引用了 `progress` / `stages` / `type` 等已删字段）——这是预期，后续 Task 3/4/6 会逐个修。

### Step 5: Commit

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "refactor(plot-arc): schema — fact + derived state"
```

---

## Task 2: 状态推导纯函数（TDD）

**Files:**
- Create: `apps/server/src/services/plot-arc-status.ts`
- Test: `apps/server/src/__tests__/services/plot-arc-status.test.ts`

### Step 1: 写失败测试

```typescript
import { describe, it, expect } from 'vitest'
import { derivePlotArcStatus } from '../../services/plot-arc-status.js'

describe('derivePlotArcStatus', () => {
  it('closedBy 有值 → closed（优先）', () => {
    const s = derivePlotArcStatus({
      closedBy: 'user', latestPoint: { chapterNumber: 3, isEnd: false },
      firstChapterNumber: 1, currentChapter: 10
    })
    expect(s).toBe('closed')
  })

  it('最新推进点 isEnd 且 >5 章无更新 → completed', () => {
    const s = derivePlotArcStatus({
      closedBy: null, latestPoint: { chapterNumber: 3, isEnd: true },
      firstChapterNumber: 1, currentChapter: 10
    })
    expect(s).toBe('completed')
  })

  it('无 isEnd 且 >5 章无更新 → inactive', () => {
    const s = derivePlotArcStatus({
      closedBy: null, latestPoint: { chapterNumber: 3, isEnd: false },
      firstChapterNumber: 1, currentChapter: 10
    })
    expect(s).toBe('inactive')
  })

  it('5 章内有更新 → active', () => {
    const s = derivePlotArcStatus({
      closedBy: null, latestPoint: { chapterNumber: 8, isEnd: false },
      firstChapterNumber: 1, currentChapter: 10
    })
    expect(s).toBe('active')
  })

  it('isEnd 但 5 章内又有更新（AI 误判）→ 仍 active', () => {
    const s = derivePlotArcStatus({
      closedBy: null, latestPoint: { chapterNumber: 8, isEnd: true },
      firstChapterNumber: 1, currentChapter: 10
    })
    expect(s).toBe('active')
  })

  it('无推进点 → 用 firstChapterNumber 兜底', () => {
    const s = derivePlotArcStatus({
      closedBy: null, latestPoint: null,
      firstChapterNumber: 2, currentChapter: 10
    })
    expect(s).toBe('inactive')
  })
})
```

### Step 2: 运行确认失败

Run: `pnpm --filter server exec vitest run src/__tests__/services/plot-arc-status.test.ts`

Expected: FAIL（`derivePlotArcStatus` 未定义）。

### Step 3: 实现

```typescript
export type PlotArcStatus = 'active' | 'inactive' | 'completed' | 'closed'

export interface PlotArcStatusInput {
  closedBy: string | null
  /** 最新推进点（chapterNumber 最大）*/
  latestPoint: { chapterNumber: number; isEnd: boolean } | null
  firstChapterNumber: number
  currentChapter: number
}

export function derivePlotArcStatus(input: PlotArcStatusInput): PlotArcStatus {
  if (input.closedBy) return 'closed'
  const refChapter = input.latestPoint?.chapterNumber ?? input.firstChapterNumber
  const isEnd = input.latestPoint?.isEnd ?? false
  if (isEnd && input.currentChapter - refChapter > 5) return 'completed'
  if (input.currentChapter - refChapter > 5) return 'inactive'
  return 'active'
}
```

### Step 4: 运行确认通过

Run: `pnpm --filter server exec vitest run src/__tests__/services/plot-arc-status.test.ts`

Expected: PASS（6 个用例全过）。

### Step 5: Commit

```bash
git add apps/server/src/services/plot-arc-status.ts apps/server/src/__tests__/services/plot-arc-status.test.ts
git commit -m "feat(plot-arc): derive status pure function"
```

---

## Task 3: AI 分析 prompt 重写（plot-consolidator）

**Files:**
- Modify: `apps/server/src/services/plot-consolidator.ts`

目标：AI 不再输出 progress/stages/currentStage/nextGoal/unresolved/summary，改成输出「推进点 + isEnd + 相似关闭」。送「激活 + 待激活」的弧线，不送「完成 + 关闭」。

### Step 1: 替换 Zod schema

把 `plot-consolidator.ts` 顶部的 `UpdateSchema` / `NewArcSchema` / `ConsolidateResponseSchema` 替换为：

```typescript
const ArcUpdateSchema = z.object({
  arcId: z.string(),
  content: z.string().min(1),
  isEnd: z.boolean().default(false)
})

const NewArcSchema = z.object({
  name: z.string().min(1),
  isMainline: z.boolean(),
  content: z.string().min(1),
  isEnd: z.boolean().default(false)
})

const CloseSchema = z.object({
  arcId: z.string(),
  targetArcId: z.string()
})

const ConsolidateResponseSchema = z.object({
  arcUpdates: z.array(ArcUpdateSchema),
  newArcs: z.array(NewArcSchema),
  closes: z.array(CloseSchema)
})
```

### Step 2: 替换 prompt

把 `buildConsolidatePrompt` 里的返回格式段替换为：

```
【返回格式】严格 JSON, 不要 markdown 代码块:
{
  "arcUpdates": [
    { "arcId": "<已有弧线 id>", "content": "本章该弧线的推进内容(一句话, 核心简练)", "isEnd": false }
  ],
  "newArcs": [
    { "name": "新弧线标题", "isMainline": true, "content": "本章开启该弧线的推进内容", "isEnd": false }
  ],
  "closes": [
    { "arcId": "<要关闭的弧线 id>", "targetArcId": "<合并到的目标弧线 id>" }
  ]
}
```

并在任务说明中加规则：
- 每条弧线每章最多一条推进点；一章内多个进展合并进 `content`。
- 若该弧线本章到尾声，`isEnd` 设为 true（这是「可能结束」的参考标记，不是终态）。
- 若两条弧线主题高度重叠、重要性较低的一条可关，用 `closes` 关闭它并指向保留的那条。

### Step 3: 替换 consolidatePlotArcs 主流程

把 `consolidatePlotArcs` 里「处理 updates + newArcs + carry-forward」的段落替换为：

```typescript
  const existingById = new Map(existingArcs.map(e => [e.id, e]))
  const writes: ConsolidatedArcWrite[] = []

  for (const u of response.arcUpdates) {
    const existing = existingById.get(u.arcId)
    if (!existing) continue // AI 幻觉 id，忽略
    writes.push({
      storyId,
      arcId: existing.id,
      name: existing.name,
      isMainline: existing.isMainline,
      content: u.content,
      isEnd: u.isEnd,
      action: 'update'
    })
  }

  for (const n of response.newArcs) {
    writes.push({
      storyId,
      arcId: null,
      name: n.name,
      isMainline: n.isMainline,
      content: n.content,
      isEnd: n.isEnd,
      action: 'create'
    })
  }

  for (const c of response.closes) {
    if (!existingById.has(c.arcId)) continue
    writes.push({ storyId, arcId: c.arcId, name: '', isMainline: false, content: '', isEnd: false, action: 'close', targetArcId: c.targetArcId })
  }
```

（`ConsolidatedArcWrite` 类型同步改为上述字段，去掉 progress/stages/currentStage/nextGoal/unresolved/summary/type/status/closedReason/closedTargetArcId/source。）

### Step 4: 移除 carry-forward 和 validateGranularity

删除 `carryForwardArc`、`mergeUpdateIntoExisting`、`mergeStages`、`monotonicMax`、`validateGranularity` 这些函数（不再需要）。

### Step 5: 更新现有测试后运行

Run: `pnpm --filter server exec vitest run src/__tests__/plot-consolidator.test.ts`

Expected: 现有测试因类型变化 FAIL → 按新输出格式重写该测试文件的 fixture 与断言（arcUpdates/newArcs/closes 结构）。

### Step 6: Commit

```bash
git add apps/server/src/services/plot-consolidator.ts apps/server/src/__tests__/plot-consolidator.test.ts
git commit -m "refactor(plot-arc): consolidate → progress points + isEnd + closes"
```

---

## Task 4: 归档落库 + 状态推导（plot-extractor + archive route）

**Files:**
- Modify: `apps/server/src/services/plot-extractor.ts`
- Modify: `apps/server/src/routes/chapters-archive.ts`

### Step 1: 重写 commitPlotArcWrites

把 `commitPlotArcWrites` 替换为（推进点落库 + 关闭落库 + 状态推导）：

```typescript
import { derivePlotArcStatus } from './plot-arc-status.js'

export interface PlotArcWriteRow {
  storyId: string
  arcId: string | null
  name: string
  isMainline: boolean
  content: string
  isEnd: boolean
  action: 'create' | 'update' | 'close'
  targetArcId?: string
}

export async function commitPlotArcWrites(
  tx: any,
  storyId: string,
  chapterNumber: number,
  writes: PlotArcWriteRow[]
): Promise<void> {
  const touchedArcIds: string[] = []

  for (const w of writes) {
    if (w.action === 'create') {
      const arc = await tx.plotArc.create({
        data: {
          storyId, name: w.name, isMainline: w.isMainline,
          status: 'active', firstChapterNumber: chapterNumber
        }
      })
      await tx.plotArcProgressPoint.create({
        data: { arcId: arc.id, chapterNumber, content: w.content, isEnd: w.isEnd }
      })
      touchedArcIds.push(arc.id)
    } else if (w.action === 'update' && w.arcId) {
      await tx.plotArcProgressPoint.create({
        data: { arcId: w.arcId, chapterNumber, content: w.content, isEnd: w.isEnd }
      })
      touchedArcIds.push(w.arcId)
    } else if (w.action === 'close' && w.arcId) {
      await tx.plotArc.update({
        where: { id: w.arcId },
        data: { closedBy: 'ai-similar', closedTargetArcId: w.targetArcId ?? null }
      })
      touchedArcIds.push(w.arcId)
    }
  }

  // 状态推导：刷新所有「被本章影响 + 仍非终态」的弧线
  const allArcs = await tx.plotArc.findMany({ where: { storyId }, include: { progressPoints: { orderBy: { chapterNumber: 'desc' } } } })
  for (const arc of allArcs) {
    if (arc.closedBy) continue // closed 终态
    const latest = arc.progressPoints[0]
    const status = derivePlotArcStatus({
      closedBy: arc.closedBy,
      latestPoint: latest ? { chapterNumber: latest.chapterNumber, isEnd: latest.isEnd } : null,
      firstChapterNumber: arc.firstChapterNumber,
      currentChapter: chapterNumber
    })
    if (status !== arc.status) {
      await tx.plotArc.update({ where: { id: arc.id }, data: { status } })
    }
  }
}
```

### Step 2: 更新 archive route 调用

在 `chapters-archive.ts` archive route 的 `$transaction` 内，把 `commitPlotArcWrites(tx, chapter.number, plotArcs)` 改为 `commitPlotArcWrites(tx, chapter.storyId, chapter.number, plotArcs)`（签名加 storyId）。

### Step 3: 更新 prepare-archive 的 plotArcs 来源

`prepare-archive` 里调 `runPlotArcStage` 时传入的 `existingArcs` 改为查新字段（`select: { id, name, isMainline, status, firstChapterNumber, closedBy, closedTargetArcId }`），并把 `consolidatePlotArcs` 的 `existingArcs` 过滤为 `status in ['active','inactive']`（不送 completed/closed）。

### Step 4: 写 plot-extractor 测试

新建/更新 `apps/server/src/__tests__/plot-extractor.test.ts`：

```typescript
it('create → 建弧线 + 建推进点', async () => {
  // tx mock: plotArc.create 返回 { id: 'a1' }
  await commitPlotArcWrites(tx, 's1', 3, [{ storyId: 's1', arcId: null, name: 'X', isMainline: true, content: 'c', isEnd: false, action: 'create' }])
  expect(tx.plotArc.create).toHaveBeenCalledWith({ data: expect.objectContaining({ firstChapterNumber: 3, status: 'active' }) })
  expect(tx.plotArcProgressPoint.create).toHaveBeenCalledWith({ data: expect.objectContaining({ chapterNumber: 3, content: 'c' }) })
})

it('isEnd 且 >5 章无更新 → status 刷新为 completed', async () => {
  // tx.plotArc.findMany 返回 [{ id:'a1', closedBy:null, firstChapterNumber:1, status:'active', progressPoints:[{ chapterNumber:3, isEnd:true }] }]
  await commitPlotArcWrites(tx, 's1', 10, [])
  expect(tx.plotArc.update).toHaveBeenCalledWith({ where: { id: 'a1' }, data: { status: 'completed' } })
})
```

### Step 5: 运行确认通过 + 全量测试

Run: `pnpm --filter server exec vitest run src/__tests__/plot-extractor.test.ts`
Run: `pnpm --filter server exec vitest run`

Expected: 全过。

### Step 6: Commit

```bash
git add apps/server/src/services/plot-extractor.ts apps/server/src/routes/chapters-archive.ts apps/server/src/__tests__/plot-extractor.test.ts
git commit -m "refactor(plot-arc): commit progress points + derive status"
```

---

## Task 5: 删除章节级联

**Files:**
- Modify: `apps/server/src/routes/chapters-crud.ts`

### Step 1: 在删除章节逻辑中加弧线级联

在删除章节的既有派生数据清理处（`chapters-crud.ts` 删除 `Memory` / `CharacterBranchState` 的同一事务/同一位置），加：

```typescript
// 剧情弧线级联：firstChapterNumber 相等 → 整条删；否则删该章的推进点
await prisma.plotArc.deleteMany({ where: { storyId, firstChapterNumber: chapterNumber } })
await prisma.plotArcProgressPoint.deleteMany({ where: { arc: { storyId }, chapterNumber } })
```

（若删除逻辑在 `$transaction` 内则用 `tx.`，否则用 `prisma.`。）

### Step 2: 删除后重推导受影响弧线的状态

删除推进点后，重新推导「同 story 下、非终态」弧线的状态：

```typescript
const arcs = await prisma.plotArc.findMany({ where: { storyId }, include: { progressPoints: { orderBy: { chapterNumber: 'desc' } } } })
for (const arc of arcs) {
  if (arc.closedBy) continue
  const latest = arc.progressPoints[0]
  const status = derivePlotArcStatus({
    closedBy: arc.closedBy,
    latestPoint: latest ? { chapterNumber: latest.chapterNumber, isEnd: latest.isEnd } : null,
    firstChapterNumber: arc.firstChapterNumber,
    currentChapter: chapterNumber
  })
  if (status !== arc.status) {
    await prisma.plotArc.update({ where: { id: arc.id }, data: { status } })
  }
}
```

（`currentChapter` 用被删章节号，语义为「删到这一章为止的最新状态」。）

### Step 3: 写测试（可选，若 crud 已有测试则加断言）

新增测试：删除 firstChapterNumber 相等的章节 → 弧线 + 推进点都被删；删除有推进点的章节 → 只删该章推进点、弧线保留且状态重推导。

### Step 4: 运行全量测试

Run: `pnpm --filter server exec vitest run`

Expected: 全过。

### Step 5: Commit

```bash
git add apps/server/src/routes/chapters-crud.ts
git commit -m "fix(plot-arc): cascade delete on chapter removal"
```

---

## Task 6: 注入 prompt 改写（getActivePlotArcs）

**Files:**
- Modify: `apps/server/src/services/plot-extractor.ts`（getActivePlotArcs）

### Step 1: 重写 getActivePlotArcs

替换 `getActivePlotArcs` 为：只查 `status='active'` 的弧线，注入「标题 + 推进点集合（全量，带 TODO 优化）」：

```typescript
export async function getActivePlotArcs(prisma: any, storyId: string): Promise<string> {
  const arcs = await prisma.plotArc.findMany({
    where: { storyId, status: 'active' },
    include: { progressPoints: { orderBy: { chapterNumber: 'asc' } } },
    orderBy: { firstChapterNumber: 'asc' }
  })
  if (arcs.length === 0) return ''

  const lines = arcs.map((a: any) => {
    const points = a.progressPoints.map((p: any) =>
      `  第${p.chapterNumber}章: ${p.content}${p.isEnd ? '（可能到尾声）' : ''}`
    ).join('\n')
    return `[${a.isMainline ? '主线' : '支线'}] ${a.name}\n${points}`
  })
  return lines.join('\n\n')
}
```

加 TODO 注释（注入全量推进点，未来多了再截断）。

### Step 2: 运行 typecheck + 相关测试

Run: `pnpm --filter server exec vitest run src/__tests__/routes/chapters-generate-character-fallback.test.ts`

Expected: 通过（该测试不涉及 plot arc，仅回归检查）。

### Step 3: Commit

```bash
git add apps/server/src/services/plot-extractor.ts
git commit -m "refactor(plot-arc): inject active arcs with progress points"
```

---

## Task 7: 弧线管理页 + 前端

**Files:**
- Create: `apps/server/src/routes/plot-arcs.ts`
- Create: `apps/web/src/api/plot-arc.ts`
- Create: `apps/web/src/views/PlotArcs.vue`
- Modify: `apps/web/src/router/index.ts`
- Modify: `apps/web/src/views/ReviewingPanel.vue`

### Step 1: 后端弧线查询路由

`apps/server/src/routes/plot-arcs.ts`：

```typescript
import type { FastifyInstance } from 'fastify'

export async function plotArcRoutes(app: FastifyInstance) {
  app.get('/api/stories/:storyId/plot-arcs', async (request) => {
    const { storyId } = request.params as any
    const arcs = await app.prisma.plotArc.findMany({
      where: { storyId },
      include: { progressPoints: { orderBy: { chapterNumber: 'asc' } } },
      orderBy: [{ status: 'asc' }, { firstChapterNumber: 'asc' }]
    })
    return { success: true, data: arcs }
  })

  app.put('/api/plot-arcs/:arcId/close', async (request) => {
    const { arcId } = request.params as any
    const arc = await app.prisma.plotArc.findUnique({ where: { id: arcId } })
    if (!arc) return { success: false, error: '弧线不存在' }
    await app.prisma.plotArc.update({
      where: { id: arcId },
      data: { status: 'closed', closedBy: 'user', closedTargetArcId: null }
    })
    return { success: true }
  })
}
```

在 `apps/server/src/app.ts` 注册：`await app.register(plotArcRoutes)`。

### Step 2: 前端 API

`apps/web/src/api/plot-arc.ts`：

```typescript
import { api } from '../utils/api'

export const plotArcApi = {
  list: (storyId: string) => api.get(`/api/stories/${storyId}/plot-arcs`),
  close: (arcId: string) => api.put(`/api/plot-arcs/${arcId}/close`)
}
```

### Step 3: 弧线管理页

`apps/web/src/views/PlotArcs.vue`：卡片列表展示所有弧线（标题、主线/支线、状态 chip、推进点时间线），激活/待激活弧线有「关闭」按钮（调 `plotArcApi.close`）。状态 chip 颜色映射：active=绿、inactive=灰、completed=蓝、closed=橙。

### Step 4: 路由注册

在 `router/index.ts` 加路由 `/novel-design/:storyId/plot-arcs`，指向 `PlotArcs.vue`。

### Step 5: ReviewingPanel 改造

把 `ReviewingPanel.vue` 的 plotArcs tab 从「progress/currentStage/nextGoal/summary/unresolved/stages 卡片」改成「本章推进点列表」：展示 `localData.plotArcs`（arcUpdates + newArcs + closes）的 name / content / isEnd，去掉已删字段的编辑器。

### Step 6: typecheck + 浏览器验证

Run: `pnpm typecheck`

Expected: 全仓通过。

浏览器手工验证：新建故事 → 写一章 → 分析 → 归档 → 弧线页看到弧线 + 推进点；关闭一条弧线 → 状态变「关闭」。

### Step 7: Commit

```bash
git add apps/server/src/routes/plot-arcs.ts apps/server/src/app.ts apps/web/src/api/plot-arc.ts apps/web/src/views/PlotArcs.vue apps/web/src/router/index.ts apps/web/src/views/ReviewingPanel.vue
git commit -m "feat(plot-arc): management page + reviewing panel"
```

---

## 完成验证

所有 Task 完成后：

1. `pnpm --filter server test` 全量通过。
2. `pnpm typecheck` 全仓通过。
3. 浏览器走通：分析 → 归档 → 弧线页展示 → 关闭 → 删除章节回退。
