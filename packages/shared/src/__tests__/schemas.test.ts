import { describe, it, expect } from 'vitest'
import { CompiledPromptSchema } from '../chapter-prompt.js'

describe('CompiledPromptSchema (P2a 验证)', () => {
  it('valid minimal prompt → parses', () => {
    const result = CompiledPromptSchema.safeParse({
      systemMessage: 'You are a writer',
      userMessage: 'Write chapter 1'
    })
    expect(result.success).toBe(true)
  })

  it('empty systemMessage → fails', () => {
    const result = CompiledPromptSchema.safeParse({
      systemMessage: '',
      userMessage: 'Write chapter 1'
    })
    expect(result.success).toBe(false)
  })
})
