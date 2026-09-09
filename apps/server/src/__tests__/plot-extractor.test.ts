import { describe, it, expect, vi } from 'vitest'
import { commitPlotArcWrites, getActivePlotArcs } from '../services/plot-extractor.js'
import type { PlotArcWriteRow } from '../services/plot-consolidator.js'

function makeTx(arcs: any[] = []) {
  return {
    plotArc: {
      create: vi.fn().mockResolvedValue({ id: 'new-arc-id' }),
      update: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue(arcs)
    },
    plotArcProgressPoint: { create: vi.fn().mockResolvedValue({}) }
  } as any
}

describe('commitPlotArcWrites', () => {
  it('create → 建弧线 + 建推进点', async () => {
    const tx = makeTx()
    const writes: PlotArcWriteRow[] = [
      { storyId: 's1', arcId: null, name: 'X', isMainline: true, content: 'c', isEnd: false, action: 'create' }
    ]
    await commitPlotArcWrites(tx, 's1', 3, writes)
    expect(tx.plotArc.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ firstChapterNumber: 3, status: 'active', name: 'X', isMainline: true })
    })
    expect(tx.plotArcProgressPoint.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ arcId: 'new-arc-id', chapterNumber: 3, content: 'c', isEnd: false })
    })
  })

  it('update → 建推进点（不建弧线）', async () => {
    const tx = makeTx()
    const writes: PlotArcWriteRow[] = [
      { storyId: 's1', arcId: 'a1', name: 'X', isMainline: true, content: '推进', isEnd: false, action: 'update' }
    ]
    await commitPlotArcWrites(tx, 's1', 5, writes)
    expect(tx.plotArc.create).not.toHaveBeenCalled()
    expect(tx.plotArcProgressPoint.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ arcId: 'a1', chapterNumber: 5, content: '推进' })
    })
  })

  it('close → 标记关闭 + closedBy=ai-similar', async () => {
    const tx = makeTx()
    const writes: PlotArcWriteRow[] = [
      { storyId: 's1', arcId: 'a1', name: '', isMainline: false, content: '', isEnd: false, action: 'close', targetArcId: 'a2' }
    ]
    await commitPlotArcWrites(tx, 's1', 5, writes)
    expect(tx.plotArc.update).toHaveBeenCalledWith({
      where: { id: 'a1' },
      data: { status: 'closed', closedBy: 'ai-similar', closedTargetArcId: 'a2' }
    })
  })

  it('isEnd 且 >5 章无更新 → 状态推导为 completed', async () => {
    const tx = makeTx([
      { id: 'a1', closedBy: null, firstChapterNumber: 1, status: 'active', progressPoints: [{ chapterNumber: 3, isEnd: true }] }
    ])
    await commitPlotArcWrites(tx, 's1', 10, [])
    expect(tx.plotArc.update).toHaveBeenCalledWith({ where: { id: 'a1' }, data: { status: 'completed' } })
  })

  it('无 isEnd 且 >5 章无更新 → 状态推导为 inactive', async () => {
    const tx = makeTx([
      { id: 'a1', closedBy: null, firstChapterNumber: 1, status: 'active', progressPoints: [{ chapterNumber: 3, isEnd: false }] }
    ])
    await commitPlotArcWrites(tx, 's1', 10, [])
    expect(tx.plotArc.update).toHaveBeenCalledWith({ where: { id: 'a1' }, data: { status: 'inactive' } })
  })

  it('closedBy 有值 → 跳过状态推导（终态）', async () => {
    const tx = makeTx([
      { id: 'a1', closedBy: 'user', firstChapterNumber: 1, status: 'closed', progressPoints: [] }
    ])
    await commitPlotArcWrites(tx, 's1', 10, [])
    expect(tx.plotArc.update).not.toHaveBeenCalled()
  })
})

describe('getActivePlotArcs', () => {
  it('只注入 active 弧线，含推进点集合', async () => {
    const prisma = {
      plotArc: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'a1', name: '李凡修仙', isMainline: true,
            progressPoints: [
              { chapterNumber: 1, content: '拜入玄天宗', isEnd: false },
              { chapterNumber: 5, content: '突破练气', isEnd: false }
            ]
          }
        ])
      }
    }
    const text = await getActivePlotArcs(prisma, 's1')
    expect(prisma.plotArc.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { storyId: 's1', status: 'active' } }))
    expect(text).toContain('[主线] 李凡修仙')
    expect(text).toContain('第1章: 拜入玄天宗')
    expect(text).toContain('第5章: 突破练气')
  })

  it('isEnd 推进点标注「可能到尾声」', async () => {
    const prisma = {
      plotArc: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'a1', name: 'X', isMainline: false, progressPoints: [{ chapterNumber: 3, content: '收尾', isEnd: true }] }
        ])
      }
    }
    const text = await getActivePlotArcs(prisma, 's1')
    expect(text).toContain('（可能到尾声）')
  })
})
