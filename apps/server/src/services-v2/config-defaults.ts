// V2 Prompt 配置默认值 — 阶段 4b 落地硬编码，阶段 6 添加交互

export interface V2PromptConfig {
  characterIds: string[]
  memoryTypeIds: { type: string; category: string; id: string }[]
  plotArcIds: string[]
  loreIds: string[]
  outline?: string
  styleNotes?: string
}

export async function getDefaultConfig(prisma: any, storyId: string): Promise<V2PromptConfig> {
  const [characters, memories, plotArcs] = await Promise.all([
    prisma.v2Character.findMany({
      where: { storyId },
      select: { id: true }
    }),
    prisma.v2Memory.findMany({
      where: {
        storyId,
        type: { in: ['global', 'temporary'] },
        isActive: true
      },
      select: { id: true, type: true, category: true }
    }),
    prisma.v2PlotArc.findMany({
      where: {
        storyId,
        status: { in: ['active', 'interrupted'] }
      },
      select: { id: true }
    })
  ])

  return {
    characterIds: characters.map((c: { id: string }) => c.id),
    memoryTypeIds: memories.map((m: { id: string; type: string; category: string }) => ({
      type: m.type,
      category: m.category,
      id: m.id
    })),
    plotArcIds: plotArcs.map((a: { id: string }) => a.id),
    loreIds: [],
    outline: undefined,
    styleNotes: undefined
  }
}
