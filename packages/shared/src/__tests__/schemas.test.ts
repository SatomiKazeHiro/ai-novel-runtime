import { describe, it, expect } from 'vitest'
import { CompiledPromptSchema } from '../chapter-prompt.js'
import { CreateChapterRequestSchema, ChapterResponseSchema } from '../chapter.js'
import {
  UpdateChapterRequestSchema,
  ChapterTreeNodeSchema,
  PreviewRequestSchema,
  GenerateRequestSchema
} from '../chapter.js'

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

describe('UpdateChapterRequestSchema', () => {
  it('empty object → parses (all fields optional)', () => {
    const result = UpdateChapterRequestSchema.safeParse({})
    expect(result.success).toBe(true)
  })

  it('partial update { content } → parses', () => {
    const result = UpdateChapterRequestSchema.safeParse({ content: 'new content' })
    expect(result.success).toBe(true)
  })
})

describe('ChapterTreeNodeSchema', () => {
  it('leaf node without children → parses', () => {
    const result = ChapterTreeNodeSchema.safeParse({
      id: 'c1',
      storyId: 's1',
      number: 1,
      isSideStory: false,
      title: 'Chapter 1',
      status: 'archived',
      children: []
    })
    expect(result.success).toBe(true)
  })

  it('nested tree (root with child) → parses', () => {
    const result = ChapterTreeNodeSchema.safeParse({
      id: 'c1',
      storyId: 's1',
      number: 1,
      isSideStory: false,
      title: 'Chapter 1',
      status: 'archived',
      children: [
        {
          id: 'c1.1',
          storyId: 's1',
          number: 1.01,
          isSideStory: true,
          title: 'Side story',
          status: 'archived',
          children: []
        }
      ]
    })
    expect(result.success).toBe(true)
  })
})

describe('PreviewRequestSchema', () => {
  it('valid { storyId } → parses', () => {
    const result = PreviewRequestSchema.safeParse({ storyId: 's1' })
    expect(result.success).toBe(true)
  })

  it('empty object → fails (storyId required)', () => {
    const result = PreviewRequestSchema.safeParse({})
    expect(result.success).toBe(false)
  })
})

describe('GenerateRequestSchema', () => {
  it('minimal { storyId } → parses', () => {
    const result = GenerateRequestSchema.safeParse({ storyId: 's1' })
    expect(result.success).toBe(true)
  })

  it('with optional candidateCount + temperatures + maxTokens → parses', () => {
    const result = GenerateRequestSchema.safeParse({
      storyId: 's1',
      candidateCount: 3,
      temperatures: [0.6, 0.75, 0.9],
      maxTokens: 4096
    })
    expect(result.success).toBe(true)
  })

  it('with compiledPrompt → parses (validates nested schema)', () => {
    const result = GenerateRequestSchema.safeParse({
      storyId: 's1',
      compiledPrompt: {
        systemMessage: 'You are a writer',
        userMessage: 'Write chapter 1'
      }
    })
    expect(result.success).toBe(true)
  })

  it('accepts missing storyId (route derives it from chapterId via prisma)', () => {
    const result = GenerateRequestSchema.safeParse({})
    expect(result.success).toBe(true)
  })

  it('rejects storyId="" (still validates type when provided)', () => {
    const result = GenerateRequestSchema.safeParse({ storyId: '' })
    expect(result.success).toBe(false)
  })
})

import { SelectDraftRequestSchema } from '../select-draft.js'

describe('SelectDraftRequestSchema', () => {
  it('valid { draftId } → parses', () => {
    const result = SelectDraftRequestSchema.safeParse({ draftId: 'd1' })
    expect(result.success).toBe(true)
  })

  it('empty draftId → fails', () => {
    const result = SelectDraftRequestSchema.safeParse({ draftId: '' })
    expect(result.success).toBe(false)
  })
})

import { PrepareArchiveRequestSchema } from '../prepare-archive.js'

describe('PrepareArchiveRequestSchema', () => {
  it('empty object → parses (no body required)', () => {
    const result = PrepareArchiveRequestSchema.safeParse({})
    expect(result.success).toBe(true)
  })

  it('extra field → fails (strict mode)', () => {
    const result = PrepareArchiveRequestSchema.safeParse({ foo: 'bar' })
    expect(result.success).toBe(false)
  })
})

import { DevelopRequestSchema } from '../develop.js'

describe('DevelopRequestSchema', () => {
  it('empty object → parses (all fields optional)', () => {
    const result = DevelopRequestSchema.safeParse({})
    expect(result.success).toBe(true)
  })

  it('isSideStory: true + number → parses (番外指定 number)', () => {
    const result = DevelopRequestSchema.safeParse({
      isSideStory: true,
      number: 1.05
    })
    expect(result.success).toBe(true)
  })

  it('runtimeProfileId: null → fails (schema 要求 string 或 undefined)', () => {
    const result = DevelopRequestSchema.safeParse({
      runtimeProfileId: null
    })
    expect(result.success).toBe(false)
  })
})

import { PendingArchiveDataSchema } from '../archive.js'

describe('PendingArchiveDataSchema', () => {
  const validPayload = {
    memories: {
      memories: [
        {
          storyId: 's1',
          chapterId: 'c1',
          fromChapterNumber: 1,
          layer: 'chapter',
          content: 'A memory',
          tags: '[]',
          importance: 0.8
        }
      ],
      characterStates: [],
      timelineEvents: [],
      summary: 'chapter summary'
    },
    graph: {
      mergedGraph: { nodes: [], edges: [], timestamp: '2026-06-18T00:00:00Z' },
      chapterGraph: { nodes: [], edges: [], timestamp: '2026-06-18T00:00:00Z' }
    },
    plotArcs: [],
    meta: { extractedAt: '2026-06-18T00:00:00Z', chapterNumber: 1 }
  }

  it('valid full payload → parses', () => {
    const result = PendingArchiveDataSchema.safeParse(validPayload)
    expect(result.success).toBe(true)
  })

  it('missing meta → fails (required)', () => {
    const { meta, ...withoutMeta } = validPayload
    const result = PendingArchiveDataSchema.safeParse(withoutMeta)
    expect(result.success).toBe(false)
  })

  it('extra field at top level → passes (passthrough for user-editable payload)', () => {
    const withExtra = { ...validPayload, _userNote: 'edited by reviewer' }
    const result = PendingArchiveDataSchema.safeParse(withExtra)
    expect(result.success).toBe(true)
  })
})
