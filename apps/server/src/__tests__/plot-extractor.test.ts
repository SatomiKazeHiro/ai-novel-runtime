import { describe, it, expect, vi, beforeEach } from 'vitest'
import { commitPlotArcWrites } from '../services/plot-extractor.js'
import type { PendingPlotArcWrite } from '@novel-runtime/shared'

/**
 * commitPlotArcWrites — Jaccard 兜底 + lastTouchedChapter 刷新 + stale 检测
 * (2026-06-27 P2 引入)
 *
 * 数据流: plot-consolidator → PendingPlotArcWrite[] → commitPlotArcWrites → DB
 *
 * 测试用 mock tx 而非真实 Prisma (Prisma SQLite 测试需要 schema generate + migrate,
 * 见 apps/server/vitest.config.ts 的现有测试惯例 — 优先 mock)。
 */

function buildTx(existingArcs: Array<{ id: string; name: string; summary?: string | null; status?: string; lastTouchedChapter?: number | null }> = []) {
  const allArcs: any[] = existingArcs.map((a, i) => ({
    id: a.id,
    name: a.name,
    summary: a.summary ?? '',
    status: a.status ?? 'active',
    lastTouchedChapter: a.lastTouchedChapter ?? null,
    createdAt: new Date(),
    updatedAt: new Date(),
    _idx: i
  }))

  const tx: any = {
    plotArc: {
      findMany: vi.fn().mockImplementation((args: any) => {
        // 第一次调用: Jaccard existing 列表 (select id/name/summary)
        // 第二次调用: stale 候选 (where status in [active, resolving])
        if (args?.select && Object.keys(args.select).every(k => ['id', 'name', 'summary'].includes(k))) {
          return Promise.resolve(allArcs.map(a => ({ id: a.id, name: a.name, summary: a.summary })))
        }
        // 复刻 Prisma where.status.in 过滤 (stale 扫描只查 active/resolving)
        const allowedStatuses: string[] | undefined = args?.where?.status?.in
        const filtered = allowedStatuses
          ? allArcs.filter(a => allowedStatuses.includes(a.status))
          : allArcs
        return Promise.resolve(filtered)
      }),
      create: vi.fn().mockImplementation((args: any) => {
        const created = {
          id: `new-${allArcs.length}`,
          createdAt: new Date(),
          updatedAt: new Date(),
          _idx: allArcs.length,
          ...args.data
        }
        allArcs.push(created)
        return Promise.resolve(created)
      }),
      update: vi.fn().mockImplementation((args: any) => {
        const target = allArcs.find(a => a.id === args.where.id)
        if (!target) throw new Error(`Mock: arc ${args.where.id} not found`)
        Object.assign(target, args.data)
        return Promise.resolve(target)
      })
    }
  }
  return { tx, allArcs }
}

function buildWrite(overrides: Partial<PendingPlotArcWrite> = {}): PendingPlotArcWrite {
  return {
    storyId: 's1',
    name: '新弧线',
    type: 'side',
    status: 'active',
    progress: 5,
    stages: '[]',
    currentStage: '初始',
    nextGoal: '待推进',
    unresolved: '[]',
    summary: '新弧线摘要',
    isNew: true,
    ...overrides
  }
}

// ============================================================================
// Jaccard 兜底: 相似 new arc 写入 similarToExistingIds
// ============================================================================

describe('commitPlotArcWrites — Jaccard 兜底 (new arc 相似度)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('new arc name 与 existing 高度相似 (Jaccard ≥ 0.7) → similarToExistingIds 写入 existing id', async () => {
    // 用长文本保证 BPE token 重叠率足够高 (cl100k_base 中文短串易触发 < 0.5,
    // 见 spec §11 风险表 "Jaccard 短字符串不稳定"; 此处用 > 30 token 稳定测)
    const existingSummary = 'The protagonist enters the ancient mountain temple to seek the lost cultivation manual and encounters the guardian spirit'
    const newSummary = 'The protagonist enters the ancient mountain temple to seek the lost cultivation manual and fights the guardian spirit in a fierce battle'
    const { tx, allArcs } = buildTx([
      { id: 'existing-1', name: 'Mountain Cultivation Journey', summary: existingSummary }
    ])

    await commitPlotArcWrites(tx, 10, [buildWrite({
      name: 'Mountain Cultivation Journey',
      summary: newSummary
    })])

    const created = allArcs.find(a => a.name === 'Mountain Cultivation Journey' && a._idx === 1)
    expect(created).toBeDefined()
    expect(JSON.parse(created!.similarToExistingIds)).toContain('existing-1')
  })

  it('new arc name 完全无关 → similarToExistingIds = []', async () => {
    const { tx, allArcs } = buildTx([
      { id: 'existing-1', name: 'Mountain Cultivation Journey', summary: 'The protagonist trains in the ancient temple' }
    ])

    await commitPlotArcWrites(tx, 10, [buildWrite({
      name: 'Hidden Demonic Cult Revival',
      summary: 'The villain sect resurfaces with a new dark lord who commands shadow armies'
    })])

    const created = allArcs[allArcs.length - 1]
    expect(JSON.parse(created.similarToExistingIds)).toEqual([])
  })

  it('new arc name 相似但 summary 完全不同 → Jaccard < 0.7 不命中', async () => {
    const { tx, allArcs } = buildTx([
      { id: 'existing-1', name: 'Mountain Cultivation Journey', summary: 'The protagonist trains in the ancient temple seeking the lost manual' }
    ])

    // name 同但 summary 几乎完全无关 → Jaccard 主要看 token 重合会 < 0.7
    await commitPlotArcWrites(tx, 10, [buildWrite({
      name: 'Mountain Cultivation Journey',
      summary: 'A completely different storyline about a wandering merchant selling exotic goods in the marketplace'
    })])

    const created = allArcs[allArcs.length - 1]
    expect(JSON.parse(created.similarToExistingIds)).toEqual([])
  })
})

// ============================================================================
// lastTouchedChapter 刷新: 仅 AI update 路径
// ============================================================================

describe('commitPlotArcWrites — lastTouchedChapter 刷新', () => {
  beforeEach(() => vi.clearAllMocks())

  it('existing arc + source=ai-update → update 路径刷 lastTouchedChapter=chapterNumber', async () => {
    const { tx, allArcs } = buildTx([
      { id: 'existing-1', name: '推进弧线', summary: 'x', lastTouchedChapter: 5 }
    ])

    await commitPlotArcWrites(tx, 10, [buildWrite({
      isNew: false,
      existingId: 'existing-1',
      name: '推进弧线',
      summary: '本章推进',
      source: 'ai-update'
    })])

    expect(allArcs.find(a => a.id === 'existing-1')!.lastTouchedChapter).toBe(10)
  })

  it('existing arc + source=carry-forward → update 路径不刷 lastTouchedChapter', async () => {
    const { tx, allArcs } = buildTx([
      { id: 'existing-1', name: '未推进', summary: 'x', lastTouchedChapter: 5 }
    ])

    await commitPlotArcWrites(tx, 10, [buildWrite({
      isNew: false,
      existingId: 'existing-1',
      name: '未推进',
      summary: 'x',
      source: 'carry-forward'
    })])

    expect(allArcs.find(a => a.id === 'existing-1')!.lastTouchedChapter).toBe(5)
  })

  it('new arc → 创建时 lastTouchedChapter = chapterNumber', async () => {
    const { tx, allArcs } = buildTx([])

    await commitPlotArcWrites(tx, 10, [buildWrite({
      isNew: true,
      name: '全新弧线'
    })])

    expect(allArcs[allArcs.length - 1].lastTouchedChapter).toBe(10)
  })
})

// ============================================================================
// stale 检测: 上次推进距今 > STALE_THRESHOLD 自动转 stale
// ============================================================================

describe('commitPlotArcWrites — stale 自动检测', () => {
  beforeEach(() => vi.clearAllMocks())

  it('active arc 上次推进在 chapter 5, 当前 11 → 转 stale (差 6 > 5)', async () => {
    const { tx, allArcs } = buildTx([
      { id: 'existing-1', name: '老弧线', status: 'active', lastTouchedChapter: 5 }
    ])

    await commitPlotArcWrites(tx, 11, [])

    expect(allArcs.find(a => a.id === 'existing-1')!.status).toBe('stale')
  })

  it('active arc 上次推进在 chapter 7, 当前 11 → 不转 stale (差 4 ≤ 5)', async () => {
    const { tx, allArcs } = buildTx([
      { id: 'existing-1', name: '活跃', status: 'active', lastTouchedChapter: 7 }
    ])

    await commitPlotArcWrites(tx, 11, [])

    expect(allArcs.find(a => a.id === 'existing-1')!.status).toBe('active')
  })

  it('completed arc 上次推进在 chapter 1, 当前 11 → 不转 stale (completed 不参与扫描)', async () => {
    const { tx, allArcs } = buildTx([
      { id: 'existing-1', name: '已完结', status: 'completed', lastTouchedChapter: 1 }
    ])

    await commitPlotArcWrites(tx, 11, [])

    expect(allArcs.find(a => a.id === 'existing-1')!.status).toBe('completed')
  })

  it('active arc lastTouchedChapter=null → 视为 0, chapter=11 > 5 → 转 stale', async () => {
    const { tx, allArcs } = buildTx([
      { id: 'existing-1', name: '未启动', status: 'active', lastTouchedChapter: null }
    ])

    await commitPlotArcWrites(tx, 11, [])

    expect(allArcs.find(a => a.id === 'existing-1')!.status).toBe('stale')
  })

  it('已是 stale → 不重复触发 (扫描 where status in [active, resolving])', async () => {
    const { tx, allArcs } = buildTx([
      { id: 'existing-1', name: '已沉寂', status: 'stale', lastTouchedChapter: 1 }
    ])

    await commitPlotArcWrites(tx, 11, [])

    // 已有 stale 不应被 update
    expect(tx.plotArc.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'existing-1' } })
    )
  })
})

// ============================================================================
// closed 字段透传
// ============================================================================

describe('commitPlotArcWrites — closed 字段透传', () => {
  beforeEach(() => vi.clearAllMocks())

  it('AI update status=closed + closedReason=duplicate + closedTargetArcId → 写入', async () => {
    const { tx, allArcs } = buildTx([
      { id: 'existing-target', name: '保留条', summary: 'x', status: 'active', lastTouchedChapter: 5 },
      { id: 'existing-closed', name: '重复条', summary: 'x', status: 'active', lastTouchedChapter: 5 }
    ])

    await commitPlotArcWrites(tx, 10, [buildWrite({
      isNew: false,
      existingId: 'existing-closed',
      name: '重复条',
      status: 'closed',
      closedReason: 'duplicate',
      closedTargetArcId: 'existing-target',
      source: 'ai-update'
    })])

    const closed = allArcs.find(a => a.id === 'existing-closed')!
    expect(closed.status).toBe('closed')
    expect(closed.closedReason).toBe('duplicate')
    expect(closed.closedTargetArcId).toBe('existing-target')
  })
})