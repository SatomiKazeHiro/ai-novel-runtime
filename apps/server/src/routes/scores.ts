import type { FastifyInstance } from 'fastify'
import { ScoringEngine } from '@novel-runtime/scoring-engine'

export async function scoreRoutes(app: FastifyInstance) {
  const engine = new ScoringEngine()

  // POST /api/drafts/:draftId/score
  app.post('/api/drafts/:draftId/score', async (request, reply) => {
    const { draftId } = request.params as any
    const draft = await app.prisma.draft.findUnique({ where: { id: draftId }, include: { story: true } })
    if (!draft) return reply.status(404).send({ success: false, error: 'Draft not found' })

    const result = await engine.run(draft.content || '', {}, {})
    const score = await app.prisma.score.create({
      data: {
        storyId: draft.storyId,
        chapterId: draft.chapterId,
        draftId,
        styleSimilarity: result.styleSimilarity,
        loreConsistency: result.loreConsistency,
        characterConsistency: result.characterConsistency,
        emotionalTension: result.emotionalTension,
        pacing: result.pacing,
        proseQuality: result.proseQuality,
        forbiddenContentRisk: result.forbiddenContentRisk,
        totalScore: result.totalScore,
        details: JSON.stringify(result.details)
      }
    })
    return { success: true, data: { score: result, record: score } }
  })

  // GET /api/stories/:storyId/scores
  app.get('/api/stories/:storyId/scores', async (request, reply) => {
    const { storyId } = request.params as any
    const scores = await app.prisma.score.findMany({
      where: { storyId },
      orderBy: { createdAt: 'desc' }
    })
    return { success: true, data: scores }
  })
}
