import { describe, it, expect } from 'vitest'
import { countTokens } from '../token-counter.js'

describe('countTokens — pure helper (TDD anchor)', () => {
  it('empty string → 0', () => {
    expect(countTokens('')).toBe(0)
  })

  it('single ASCII char → 1 token (cl100k_base default)', () => {
    expect(countTokens('a')).toBe(1)
  })

  it('Chinese 1 char (mixed) → 1-3 tokens (cl100k_base multi-byte)', () => {
    const n = countTokens('中')
    expect(n).toBeGreaterThan(0)
    expect(n).toBeLessThanOrEqual(4)
  })

  it('English sentence → roughly word count (cl100k heuristic)', () => {
    expect(countTokens('hello world')).toBe(2)
  })

  it('returns same value for same input (pure / no side effects)', () => {
    const text = 'a b c d e f g h i j'
    expect(countTokens(text)).toBe(countTokens(text))
  })
})
