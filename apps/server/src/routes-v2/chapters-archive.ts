import type { FastifyInstance } from 'fastify'
import { detectInterruptedArcs } from '../services-v2/plot-arc-interrupt.js'

function getPending(raw: string | null): any {
  if (!raw) return {}
  try { return JSON.parse(raw) } catch { return {} }
}

export async function v2ChapterArchiveRoutes(app: FastifyInstance) {
  // GET /api/v2/chapters/:chapterId/pre-archive — 归档前校验
  app.get('/chapters/:chapterId/pre-archive', async (request) => {
    const { chapterId } = request.params as { chapterId: string }
    const chapter = await app.prisma.v2Chapter.findUnique({ where: { id: chapterId } })
    if (!chapter) return { success: false, error: '章节不存在' }
    if (chapter.status === 'archived') return { success: false, error: '该章节已归档' }
    if (!chapter.pendingAnalysis) return { success: false, error: '请先执行分析' }

    const hashMismatch = chapter.analysisId !== chapter.contentHash
    const analysis = getPending(chapter.pendingAnalysis)
    const newCharacters = (analysis.characters?.items || []).filter((c: any) => c.isNew)

    return {
      success: true,
      data: {
        hashMismatch,
        analysisId: chapter.analysisId,
        contentHash: chapter.contentHash,
        newCharacters: newCharacters.map((c: any) => ({
          name: c.name,
          slug: c.slug,
          identity: c.identity
        })),
        hasAnalysis: {
          characters: !!analysis.characters,
          memories: !!analysis.memories,
          plotArcs: !!analysis.plotArcs,
          timeline: !!analysis.timeline,
          graph: !!analysis.graph
        }
      }
    }
  })

  // POST /api/v2/chapters/:chapterId/archive — 执行归档
  app.post('/chapters/:chapterId/archive', async (request) => {
    const { chapterId } = request.params as { chapterId: string }
    const chapter = await app.prisma.v2Chapter.findUnique({ where: { id: chapterId } })
    if (!chapter) return { success: false, error: '章节不存在' }
    if (chapter.status === 'archived') return { success: false, error: '该章节已归档' }
    if (!chapter.pendingAnalysis) return { success: false, error: '请先执行分析并保存' }

    const analysis = getPending(chapter.pendingAnalysis)

    await app.prisma.$transaction(async (tx: any) => {
      // 1. 角色：创建新角色 + 创建快照
      if (analysis.characters?.items) {
        for (const item of analysis.characters.items) {
          if (item.isNew) {
            await tx.v2Character.create({
              data: {
                storyId: chapter.storyId,
                slug: item.slug,
                name: item.name,
                isProtagonist: false,
                identity: JSON.stringify(item.identity || []),
                appearance: JSON.stringify(item.appearance || []),
                temperament: JSON.stringify(item.temperament || []),
                personality: JSON.stringify(item.personality || []),
                speechStyle: JSON.stringify(item.speechStyle || [])
              }
            })
          } else if (item.matchedCharacterId) {
            // 为已匹配角色创建快照
            await tx.v2CharacterSnapshot.create({
              data: {
                characterId: item.matchedCharacterId,
                chapterNumber: chapter.number,
                identity: JSON.stringify(item.identity || []),
                appearance: JSON.stringify(item.appearance || []),
                temperament: JSON.stringify(item.temperament || []),
                personality: JSON.stringify(item.personality || []),
                speechStyle: JSON.stringify(item.speechStyle || []),
                relationships: JSON.stringify(item.relationships || {}),
                status: JSON.stringify(item.status || {})
              }
            })
          }
        }
      }

      // 2. 记忆：写入章节记忆 + 更新/替换全局记忆
      if (analysis.memories) {
        const { chapterMemories, globalMemories, sceneMemories } = analysis.memories
        const allMemories = [
          ...(chapterMemories || []).map((m: any) => ({ ...m, type: 'chapter' })),
          ...(sceneMemories || []).map((m: any) => ({ ...m, type: 'scene' })),
          ...(globalMemories || []).map((m: any) => ({ ...m, type: 'global' }))
        ]

        for (const mem of allMemories) {
          await tx.v2Memory.create({
            data: {
              storyId: chapter.storyId,
              type: mem.type,
              category: mem.category,
              content: mem.content,
              importance: mem.importance || 4,
              participants: mem.participants || '',
              isActive: true,
              originChapterNumber: chapter.number,
              source: 'ai'
            }
          })
        }

        // 全局记忆：先将旧的全局记忆设为 inactive，再写入新的
        if (globalMemories.length > 0) {
          await tx.v2Memory.updateMany({
            where: { storyId: chapter.storyId, type: 'global', isActive: true },
            data: { isActive: false }
          })
        }
      }

      // 3. 剧情弧线
      if (analysis.plotArcs?.arcs) {
        for (const arc of analysis.plotArcs.arcs) {
          if (arc.action === 'create') {
            await tx.v2PlotArc.create({
              data: {
                storyId: chapter.storyId,
                title: arc.title,
                description: arc.description,
                status: arc.status,
                isMainline: arc.isMainline,
                firstChapterNumber: chapter.number,
                lastUpdateChapterNumber: chapter.number
              }
            })
          } else if (arc.action === 'update' && arc.plotArcId) {
            await tx.v2PlotArc.update({
              where: { id: arc.plotArcId },
              data: {
                description: arc.description,
                status: arc.status,
                lastUpdateChapterNumber: chapter.number
              }
            })
          } else if (arc.action === 'close' && arc.plotArcId) {
            await tx.v2PlotArc.update({
              where: { id: arc.plotArcId },
              data: { status: 'closed', lastUpdateChapterNumber: chapter.number }
            })
          }
        }
      }

      // 4. 更新章节状态
      await tx.v2Chapter.update({
        where: { id: chapterId },
        data: { status: 'archived' }
      })
    })

    // 事务后：弧线中断检测
    const interrupted = await detectInterruptedArcs(app.prisma, chapter.storyId, chapter.number)

    return { success: true, data: { archived: true, interruptedArcs: interrupted } }
  })
}
