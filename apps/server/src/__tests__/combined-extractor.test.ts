import { describe, it, expect } from 'vitest'
import { truncateByParagraph } from '@novel-runtime/prompt-runtime'

describe('truncateByParagraph', () => {
  it('keeps content under budget, prefers paragraph boundaries', () => {
    const content = Array(100).fill(0).map((_, i) => `段落${i}：${'x'.repeat(100)}`).join('\n\n')
    // Each paragraph is ~106 chars. With budget 600, expect ~5 paragraphs.
    const result = truncateByParagraph(content, 600)
    expect(result.length).toBeLessThan(content.length)
    expect(result).toMatch(/段落0/) // First paragraph should be kept
    expect(result).toMatch(/段落4/) // ~5th paragraph should be kept (at least roughly)
    expect(result).not.toMatch(/段落50/) // 50th paragraph should NOT be kept
  })

  it('returns full content when under budget', () => {
    const content = 'short content'
    expect(truncateByParagraph(content, 1000)).toBe(content)
  })

  it('handles single huge paragraph by character truncation', () => {
    const content = 'x'.repeat(10000)
    const result = truncateByParagraph(content, 100)
    expect(result.length).toBeLessThanOrEqual(100)
  })
})
