// V2 弧线中断检测
// 归档后遍历所有 active 弧线，lastUpdateChapterNumber 与当前章节差 >5 → interrupted

export async function detectInterruptedArcs(
  prisma: any,
  storyId: string,
  currentChapterNumber: number
): Promise<string[]> {
  const activeArcs = await prisma.v2PlotArc.findMany({
    where: { storyId, status: 'active' },
    select: { id: true, lastUpdateChapterNumber: true }
  })

  const interruptedIds: string[] = []

  for (const arc of activeArcs) {
    const lastUpdate = arc.lastUpdateChapterNumber ?? 0
    if (currentChapterNumber - lastUpdate > 5) {
      interruptedIds.push(arc.id)
    }
  }

  if (interruptedIds.length > 0) {
    await prisma.v2PlotArc.updateMany({
      where: { id: { in: interruptedIds } },
      data: { status: 'interrupted' }
    })
  }

  return interruptedIds
}
