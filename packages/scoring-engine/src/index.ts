export interface ScoreResult {
  styleSimilarity: number
  loreConsistency: number
  characterConsistency: number
  emotionalTension: number
  pacing: number
  proseQuality: number
  forbiddenContentRisk: number
  totalScore: number
  details: Record<string, any>
}

export class RuleBasedScorer {
  score(text: string, rules: any): Partial<ScoreResult> {
    const forbiddenWords = rules.forbiddenWords || []
    const hasForbidden = forbiddenWords.some((w: string) => text.includes(w))
    return {
      forbiddenContentRisk: hasForbidden ? 0 : 100,
      loreConsistency: 80,
      characterConsistency: 80
    }
  }
}

export class AIScorer {
  async score(text: string, context: any): Promise<Partial<ScoreResult>> {
    // TODO: integrate AI provider for real scoring
    throw new Error('AIScorer not yet implemented')
  }
}

export class ScoringEngine {
  private ruleScorer = new RuleBasedScorer()
  private aiScorer = new AIScorer()

  async run(text: string, rules: any, context: any): Promise<ScoreResult> {
    const ruleScores = this.ruleScorer.score(text, rules)
    const aiScores = await this.aiScorer.score(text, context)
    const result: ScoreResult = {
      styleSimilarity: Math.round((ruleScores.styleSimilarity ?? 80) * 10) / 10,
      loreConsistency: Math.round((ruleScores.loreConsistency ?? 80) * 10) / 10,
      characterConsistency: Math.round((ruleScores.characterConsistency ?? 80) * 10) / 10,
      emotionalTension: Math.round((aiScores.emotionalTension ?? 80) * 10) / 10,
      pacing: Math.round((aiScores.pacing ?? 80) * 10) / 10,
      proseQuality: Math.round((aiScores.proseQuality ?? 80) * 10) / 10,
      forbiddenContentRisk: Math.round((ruleScores.forbiddenContentRisk ?? 100) * 10) / 10,
      totalScore: 0,
      details: {}
    }
    result.totalScore = Math.round((
      result.styleSimilarity +
      result.loreConsistency +
      result.characterConsistency +
      result.emotionalTension +
      result.pacing +
      result.proseQuality +
      result.forbiddenContentRisk
    ) / 7 * 10) / 10
    return result
  }
}
