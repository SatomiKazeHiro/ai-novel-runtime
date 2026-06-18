import { describe, it, expect } from 'vitest'
import { CompiledPromptSchema } from '../chapter-prompt.js'
import { CreateChapterRequestSchema, ChapterResponseSchema } from '../chapter.js'

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

describe('CreateChapterRequestSchema', () => {
  it('minimal valid { title } → parses', () => {
    const result = CreateChapterRequestSchema.safeParse({ title: 'Chapter 1' })
    expect(result.success).toBe(true)
  })

  it('empty title → fails', () => {
    const result = CreateChapterRequestSchema.safeParse({ title: '' })
    expect(result.success).toBe(false)
  })
})

describe('ChapterResponseSchema', () => {
  it('valid chapter object → parses', () => {
    const result = ChapterResponseSchema.safeParse({
      id: 'c1',
      storyId: 's1',
      number: 1,
      isSideStory: false,
      title: 'Chapter 1',
      status: 'draft'
    })
    expect(result.success).toBe(true)
  })

  it('missing required id → fails', () => {
    const result = ChapterResponseSchema.safeParse({
      storyId: 's1',
      number: 1,
      isSideStory: false,
      title: 'Chapter 1',
      status: 'draft'
    })
    expect(result.success).toBe(false)
  })
})
