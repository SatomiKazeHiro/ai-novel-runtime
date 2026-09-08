import type { PlotArcWriteRow } from './plot-consolidator.js'
import { derivePlotArcStatus, RECENT_END_WINDOW } from './plot-arc-status.js'

/**
 * 在事务中提交剧情弧线写入（推进点落库 + 关闭落库 + 状态推导）。
 *
 * 数据来源: plot-consolidator v3 输出的 PlotArcWriteRow[]（action: create/update/close）。
 * 落库后统一跑状态推导（derivePlotArcStatus），刷新所有非终态弧线的 status。
 */
export async function commitPlotArcWrites(
  tx: any,
  storyId: string,
  chapterNumber: number,
  writes: PlotArcWriteRow[]
): Promise<void> {
  for (const w of writes) {
    if (w.action === 'create') {
      const arc = await tx.plotArc.create({
        data: {
          storyId,
          name: w.name,
          isMainline: w.isMainline,
          status: 'active',
          firstChapterNumber: chapterNumber
        }
      })
      await tx.plotArcProgressPoint.create({
        data: { arcId: arc.id, chapterNumber, content: w.content, isEnd: w.isEnd }
      })
    } else if (w.action === 'update' && w.arcId) {
      await tx.plotArcProgressPoint.create({
        data: { arcId: w.arcId, chapterNumber, content: w.content, isEnd: w.isEnd }
      })
    } else if (w.action === 'close' && w.arcId) {
      await tx.plotArc.update({
        where: { id: w.arcId },
        data: { status: 'closed', closedBy: 'ai-similar', closedTargetArcId: w.targetArcId ?? null }
      })
    }
  }

  // 状态推导：刷新所有非终态弧线
  const allArcs = await tx.plotArc.findMany({
    where: { storyId },
    include: { progressPoints: { orderBy: { chapterNumber: 'desc' } } }
  })
  for (const arc of allArcs) {
    if (arc.closedBy) continue // closed 终态
    const latest = arc.progressPoints[0]
    const status = derivePlotArcStatus({
      closedBy: arc.closedBy,
      latestPoint: latest ? { chapterNumber: latest.chapterNumber, isEnd: latest.isEnd } : null,
      recentIsEnd: arc.progressPoints.slice(0, RECENT_END_WINDOW).some((p: any) => p.isEnd),
      firstChapterNumber: arc.firstChapterNumber,
      currentChapter: chapterNumber
    })
    if (status !== arc.status) {
      await tx.plotArc.update({ where: { id: arc.id }, data: { status } })
    }
  }
}

/**
 * 获取当前「激活」的剧情弧线，用于注入 Prompt。
 *
 * 只注入 status='active' 的弧线（inactive 是给用户看的标签，不注入；completed/closed 终态不注入）。
 * 弧线以「标题 + 推进点集合」注入，推进点全量（content 核心简练）。
 * TODO(优化): 未来推进点多、token 吃紧时再做截断（最近 K + isEnd + 首点），现在先全量。
 */
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
