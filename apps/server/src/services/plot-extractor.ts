import type { PendingPlotArcWrite } from '@novel-runtime/shared'
import { safeJsonParse, tokenSet, jaccardSimilarity } from '@novel-runtime/shared'

/** Jaccard 兜底阈值: 相似度 ≥ 此值的 new arc 写入 similarToExistingIds tag */
const SIMILAR_JACCARD_THRESHOLD = 0.7
/** Stale 阈值: 上次 AI update 距今多少章未推进则转 stale */
const STALE_THRESHOLD_CHAPTERS = 5

/**
 * 在事务中提交剧情弧线写入 (P1 bug fix: plot arc 不增长)
 *
 * 数据来源: plot-consolidator v2 直接读章节 + existing arcs,
 * AI 做语义级判断后输出 ConsolidatedArcWrite[] (结构 = PendingPlotArcWrite[]).
 *
 * 这里只负责把 writes 落到数据库:
 * - isNew=true → create 新 arc, 同时按 Jaccard 与已有 arc 比对, 相似度 ≥ 阈值的 existing id 写入 similarToExistingIds
 * - existingId 已存在 → update; 仅 source='ai-update' 推进时刷新 lastTouchedChapter, carry-forward 不刷
 *
 * 末尾扫描 active/resolving arc, 距 lastTouchedChapter > STALE_THRESHOLD_CHAPTERS 自动转 stale。
 */
export async function commitPlotArcWrites(
  tx: any,
  chapterNumber: number,
  writes: PendingPlotArcWrite[]
): Promise<void> {
  // 1. 准备 existing arcs 列表 (Jaccard 比对)
  const existingRows: Array<{ id: string; name: string; summary: string | null }> = await tx.plotArc.findMany({
    select: { id: true, name: true, summary: true }
  })
  const existingForJaccard = existingRows.map(a => ({
    id: a.id,
    text: `${a.name} ${a.summary || ''}`,
    tokenSet: tokenSet(`${a.name} ${a.summary || ''}`)
  }))

  // 2. 遍历 writes
  for (const w of writes) {
    const data = {
      type: w.type,
      status: w.status,
      progress: w.progress,
      stages: w.stages,
      currentStage: w.currentStage,
      nextGoal: w.nextGoal,
      unresolved: w.unresolved,
      summary: w.summary,
      closedReason: w.closedReason ?? null,
      closedTargetArcId: w.closedTargetArcId ?? null
    }

    if (w.isNew) {
      // Jaccard 兜底: 相似 newArc 打 tag
      const similarIds: string[] = []
      const candText = `${w.name} ${w.summary}`
      const candSet = tokenSet(candText)
      for (const existing of existingForJaccard) {
        const sim = jaccardSimilarity(candSet, existing.tokenSet)
        if (sim >= SIMILAR_JACCARD_THRESHOLD) similarIds.push(existing.id)
      }
      await tx.plotArc.create({
        data: {
          storyId: w.storyId,
          name: w.name,
          ...data,
          similarToExistingIds: JSON.stringify(similarIds),
          lastTouchedChapter: chapterNumber
        }
      })
    } else if (w.existingId) {
      // 仅 AI 主动推进时刷新 lastTouchedChapter, carry-forward 不刷
      const updateData = w.source === 'ai-update'
        ? { ...data, lastTouchedChapter: chapterNumber }
        : data
      await tx.plotArc.update({
        where: { id: w.existingId },
        data: updateData
      })
    }
  }

  // 3. stale 检测: 扫描所有 active/resolving arc
  const candidates = await tx.plotArc.findMany({
    where: { status: { in: ['active', 'resolving'] } }
  })
  for (const arc of candidates) {
    const last = arc.lastTouchedChapter ?? 0
    if (chapterNumber - last > STALE_THRESHOLD_CHAPTERS) {
      await tx.plotArc.update({
        where: { id: arc.id },
        data: { status: 'stale' }
      })
    }
  }
}

/**
 * 获取当前活跃（进行中/待收尾）的剧情弧线，用于注入 Prompt
 *
 * active + resolving + stale 注入 prompt；completed / closed 不注入。
 * stale 视作"活跃"是因为 AI 可能在新章节重新激活它（spec §1.1）。
 */
export async function getActivePlotArcs(
  prisma: any,
  storyId: string
): Promise<string> {
  const arcs = await prisma.plotArc.findMany({
    where: {
      storyId,
      status: { in: ['active', 'resolving', 'stale'] }
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