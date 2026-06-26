import type { PendingPlotArcWrite } from '@novel-runtime/shared'
import { safeJsonParse } from '@novel-runtime/shared'

/**
 * 在事务中提交剧情弧线写入 (P1 bug fix: plot arc 不增长)
 *
 * 数据来源: plot-consolidator v2 直接读章节 + existing arcs,
 * AI 做语义级判断后输出 ConsolidatedArcWrite[] (结构 = PendingPlotArcWrite[]).
 *
 * 这里只负责把 writes 落到数据库:
 * - isNew=true → create 新 arc
 * - existingId 已存在 → update
 */
export async function commitPlotArcWrites(tx: any, writes: PendingPlotArcWrite[]): Promise<void> {
  for (const w of writes) {
    const data = {
      type: w.type,
      status: w.status,
      progress: w.progress,
      stages: w.stages,
      currentStage: w.currentStage,
      nextGoal: w.nextGoal,
      unresolved: w.unresolved,
      summary: w.summary
    }

    if (w.isNew) {
      await tx.plotArc.create({ data: { storyId: w.storyId, name: w.name, ...data } })
    } else if (w.existingId) {
      await tx.plotArc.update({ where: { id: w.existingId }, data })
    }
  }
}

/**
 * 获取当前活跃（进行中/待收尾）的剧情弧线，用于注入 Prompt
 */
export async function getActivePlotArcs(
  prisma: any,
  storyId: string
): Promise<string> {
  const arcs = await prisma.plotArc.findMany({
    where: {
      storyId,
      status: { in: ['active', 'resolving', 'pending'] }
    },
    orderBy: [
      { type: 'asc' }, // main 在前
      { progress: 'desc' }
    ]
  })

  if (arcs.length === 0) return ''

  const lines = arcs.map((a: any) => {
    const unresolved = safeJsonParse(a.unresolved, [])
    let text = `[${a.type === 'main' ? '主线' : '支线'}] ${a.name}（进度${a.progress}%）\n  当前：${a.currentStage || '未知'}\n  目标：${a.nextGoal || '待定'}`
    if (unresolved.length > 0) {
      text += `\n  悬念：${unresolved.join('、')}`
    }
    return text
  })

  return lines.join('\n\n')
}