import { getEncoding } from 'js-tiktoken'

const enc = getEncoding('cl100k_base')

/**
 * 计算文本的 token 数。cl100k_base 模型(deepseek 默认)。
 * 这是项目里 token 计数的唯一入口 —— 不要在别处 import js-tiktoken。
 *
 * @param text 任意文本
 * @returns token 数
 */
export function countTokens(text: string): number {
  return enc.encode(text).length
}
