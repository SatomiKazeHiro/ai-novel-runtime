import type { FastifyInstance } from 'fastify'
import { ScoringEngine } from '@novel-runtime/scoring-engine'
import { callAIWithLog } from '../services/ai-call-logger.js'
import { loadRuntimeBase } from '../services/runtime-loader.js'

export async function scoreRoutes(app: FastifyInstance) {
  const engine = new ScoringEngine()

  // POST /api/drafts/:draftId/score
  app.post('/api/drafts/:draftId/score', async (request, reply) => {
    const { draftId } = request.params as any
    const prisma = app.prisma

    // 1. 获取 draft 及关联信息
    const draft = await prisma.draft.findUnique({
      where: { id: draftId },
      include: { chapter: { include: { story: true, runtimeProfile: true } } }
    })
    if (!draft) return reply.status(404).send({ success: false, error: 'Draft not found' })

    const chapter = draft.chapter
    const story = chapter.story
    const storyId = story.id

    // 2. 获取最近 2-3 个 archived 章节作为文风参考
    const referenceChapters = await prisma.chapter.findMany({
      where: { storyId, status: 'archived' },
      orderBy: { number: 'desc' },
      take: 3,
      select: { title: true, content: true, number: true }
    })
    const referenceTexts = referenceChapters
      .sort((a, b) => a.number - b.number)
      .map(c => `【${c.title}】\n${(c.content || '').slice(0, 800)}`)
      .join('\n\n---\n\n')

    // 3. 获取写作人格
    let profileText = ''
    if (chapter.runtimeProfile) {
      profileText = `人格名称：${chapter.runtimeProfile.name}\n身份：${chapter.runtimeProfile.identity || '无'}`
    } else {
      const base = await loadRuntimeBase(storyId, prisma)
      profileText = `人格身份：${base.identity || '默认人格'}`
    }

    // 4. 组装评分 Prompt
    const scoringSystemMessage = `你是一个严厉且专业的小说编辑和文学评论家。请对给定的章节草稿进行多维度评分。

评分规则：
- 每项满分 100 分
- 评分必须有区分度，不允许所有维度得分集中在同一 10 分区间内
- 评分前先在心里列出该维度的 2 个优点和 2 个缺点（确保打分有依据）
- 参考锚点：
  * 95-100：无可挑剔，可作为范例级别
  * 80-94：优秀，有小瑕疵但不影响整体
  * 60-79：及格，有明显问题需要修改
  * 40-59：不合格，需要大幅重写
  * 0-39：严重偏离要求，几乎不可用

评分维度（请严格按此标准打分）：
1. styleSimilarity（文风接近度，0-100）：草稿的文风是否与前几章参考文本一致（句式结构、词汇偏好、叙述节奏等）。如果风格明显偏离，必须给低于 70 的分数。
2. outlineAdherence（大纲符合度，0-100）：草稿是否按照大纲要求展开情节，有无遗漏或偏离。如果情节偏离大纲，必须给低于 65 的分数。
3. sceneMatch（场景符合度，0-100）：地点、氛围、目标是否与场景设定匹配。如果不匹配，必须给低于 65 的分数。
4. profileConsistency（写作人格一致性，0-100）：是否符合绑定的写作人格风格（语气、视角、修辞习惯等）。如果不符合，必须给低于 65 的分数。
5. proseQuality（文笔质量，0-100）：语言流畅度、描写生动性、用词精准度。如果有语病、重复用词或描写干瘪，必须给低于 70 的分数。
6. emotionalTension（情感张力，0-100）：情感表达的深度、层次感和感染力。如果情感平淡或过度煽情，必须给低于 70 的分数。
7. pacing（节奏把控，0-100）：叙事节奏是否合理，有无拖沓或跳跃。如果有明显拖沓或节奏断裂，必须给低于 65 的分数。

输出格式（严格 JSON，无 markdown 代码块，不要输出任何其他内容）：
{
  "styleSimilarity": 85,
  "outlineAdherence": 90,
  "sceneMatch": 88,
  "profileConsistency": 82,
  "proseQuality": 87,
  "emotionalTension": 80,
  "pacing": 85,
  "totalScore": 85.3,
  "comment": "简要评语（50字以内）"
}

注意：
- 总分必须是 7 项的算术平均值
- 如果草稿在某些维度表现很差，允许给出 40-60 的低分
- 如果草稿在某维度表现极佳，允许给出 95 以上的高分
- 绝对禁止所有维度都打 75-85 之间的"安全分"`

    const scoringUserMessage = `【章节标题】${chapter.title}

【大纲】
${chapter.outline || '无'}

【场景设定】
地点：${chapter.sceneLocation || '未设定'}
氛围：${chapter.sceneMood || '未设定'}
目标：${chapter.sceneGoal || '未设定'}

【写作人格】
${profileText}

【前文参考（用于文风对比）】
${referenceTexts || '无前文参考'}

【待评分草稿】
${draft.content || ''}`

    // 5. 调用 AI 评分
    const compiled = {
      systemMessage: scoringSystemMessage,
      userMessage: scoringUserMessage,
      meta: { systemTokens: 0, userTokens: 0, totalTokens: 0 }
    }

    let aiResult: any = {}
    try {
      const aiResponse = await callAIWithLog(app, {
        storyId,
        chapterId: chapter.id,
        callType: 'score',
        compiled,
        temperature: 0.5,
        maxTokens: 1024
      })

      if (aiResponse) {
        // 尝试解析 JSON
        const cleaned = aiResponse.replace(/```json\s*|\s*```/g, '').trim()
        aiResult = JSON.parse(cleaned)
      }
    } catch (err: any) {
      app.log.error(`[Score] AI scoring failed: ${err.message}`)
    }

    // 6. 规则评分补充
    const ruleScores = engine.run(draft.content || '', {}, {})

    // 7. 合并结果（AI 评分优先，缺失项用规则评分或默认值）
    const result = {
      styleSimilarity: aiResult.styleSimilarity ?? ruleScores.styleSimilarity ?? 70,
      outlineAdherence: aiResult.outlineAdherence ?? ruleScores.outlineAdherence ?? 70,
      sceneMatch: aiResult.sceneMatch ?? ruleScores.sceneMatch ?? 70,
      profileConsistency: aiResult.profileConsistency ?? ruleScores.profileConsistency ?? 70,
      proseQuality: aiResult.proseQuality ?? ruleScores.proseQuality ?? 70,
      emotionalTension: aiResult.emotionalTension ?? ruleScores.emotionalTension ?? 70,
      pacing: aiResult.pacing ?? ruleScores.pacing ?? 70,
      totalScore: aiResult.totalScore ?? ruleScores.totalScore ?? 70,
      comment: aiResult.comment ?? '评分完成',
      details: { aiRaw: aiResult, ruleScores }
    }

    // 8. 保存到数据库
    const score = await prisma.score.create({
      data: {
        storyId,
        chapterId: chapter.id,
        draftId,
        styleSimilarity: result.styleSimilarity,
        outlineAdherence: result.outlineAdherence,
        sceneMatch: result.sceneMatch,
        profileConsistency: result.profileConsistency,
        proseQuality: result.proseQuality,
        emotionalTension: result.emotionalTension,
        pacing: result.pacing,
        totalScore: result.totalScore,
        comment: result.comment,
        details: JSON.stringify(result.details)
      }
    })

    // 9. 更新 draft 的 score 字段
    await prisma.draft.update({
      where: { id: draftId },
      data: { score: JSON.stringify(result) }
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
