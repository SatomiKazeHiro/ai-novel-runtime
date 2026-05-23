export interface ScoreResult {
  styleSimilarity: number
  outlineAdherence: number
  sceneMatch: number
  profileConsistency: number
  proseQuality: number
  emotionalTension: number
  pacing: number
  totalScore: number
  comment?: string
  details: Record<string, any>
}

export class RuleBasedScorer {
  score(text: string, rules: any): Partial<ScoreResult> {
    const forbiddenWords = rules.forbiddenWords || []
    const hasForbidden = forbiddenWords.some((w: string) => text.includes(w))
    // 简单的规则评分：基于文本长度和基本质量指标
    const length = text.length
    const wordCount = text.split(/\s+/).length
    const avgSentenceLength = length / (text.split(/[。！？.!?]/).length || 1)

    return {
      styleSimilarity: hasForbidden ? 60 : 80,
      outlineAdherence: length > 500 ? 80 : 50,
      sceneMatch: length > 200 ? 78 : 55,
      profileConsistency: avgSentenceLength > 10 ? 75 : 70,
      proseQuality: length > 1000 ? 82 : 65,
      emotionalTension: text.includes('？') || text.includes('！') ? 80 : 70,
      pacing: wordCount > 100 ? 78 : 60,
      totalScore: 75
    }
  }
}

export class AIScorer {
  async score(text: string, context: any): Promise<Partial<ScoreResult>> {
    // AI 评分逻辑已移至后端路由（scores.ts），通过调用 AI Provider 实现
    // 此处保留接口以便未来需要独立使用时调用
    throw new Error('AIScorer should be called via the score route with full context')
  }
}

export class ScoringEngine {
  private ruleScorer = new RuleBasedScorer()

  run(text: string, rules: any, _context?: any): ScoreResult {
    const ruleScores = this.ruleScorer.score(text, rules)
    const result: ScoreResult = {
      styleSimilarity: Math.round((ruleScores.styleSimilarity ?? 75) * 10) / 10,
      outlineAdherence: Math.round((ruleScores.outlineAdherence ?? 75) * 10) / 10,
      sceneMatch: Math.round((ruleScores.sceneMatch ?? 75) * 10) / 10,
      profileConsistency: Math.round((ruleScores.profileConsistency ?? 75) * 10) / 10,
      proseQuality: Math.round((ruleScores.proseQuality ?? 75) * 10) / 10,
      emotionalTension: Math.round((ruleScores.emotionalTension ?? 75) * 10) / 10,
      pacing: Math.round((ruleScores.pacing ?? 75) * 10) / 10,
      totalScore: 0,
      comment: '规则评分（AI 评分未启用）',
      details: { source: 'rule-based' }
    }
    result.totalScore = Math.round((
      result.styleSimilarity +
      result.outlineAdherence +
      result.sceneMatch +
      result.profileConsistency +
      result.proseQuality +
      result.emotionalTension +
      result.pacing
    ) / 7 * 10) / 10
    return result
  }
}
