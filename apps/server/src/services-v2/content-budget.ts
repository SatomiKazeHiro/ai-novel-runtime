import { computeContentCharBudget } from '../services/combined-extractor.js'

/** V2 extractor 章节正文下限。即使模型 contextLength 极小也保证 AI 至少看到
 *  2000 字符，避免 charBudget 算出 0 时 AI 拿到空上下文。 */
const MIN_CHAR_BUDGET = 2000

/**
 * 给定模型 contextLength 与 maxTokens, 返回章节正文可塞入的最大字符预算。
 * 复用 V1 `computeContentCharBudget` 公式:
 *   tokenBudget = max(0, floor(contextLength * 0.6) - maxTokens - 2000)
 *   charBudget  = floor(tokenBudget * 2.0)
 * 返回值保证 >= MIN_CHAR_BUDGET, 由调用方再调 `truncateByParagraph` 切。
 */
export function computeExtractorCharBudget(contextLength: number, maxTokens: number): number {
  const { charBudget } = computeContentCharBudget(contextLength, maxTokens)
  return Math.max(charBudget, MIN_CHAR_BUDGET)
}
