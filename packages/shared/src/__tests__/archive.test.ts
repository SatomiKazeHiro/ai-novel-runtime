import { describe, it, expect } from 'vitest'
import { PendingArchiveDataV4Schema, RetryStageNameSchema } from '../archive.js'

describe('PendingArchiveDataV4', () => {
  it('accepts 5 stages with memoryExtract/memoryOptimize split', () => {
    const result = PendingArchiveDataV4Schema.safeParse({
      version: 4,
      stages: {
        character: { status: 'success', result: { characterStates: [] } },
        memoryExtract: {
          status: 'success',
          result: {
            mainEvents: [],
            sideEvents: [],
            emotions: [],
            foreshadowing: [],
            relationshipChanges: [],
            scenes: [],
            summary: ''
          }
        },
        memoryOptimize: { status: 'success', result: { memories: [] } },
        plotArc: { status: 'success', result: { plotArcs: [] } },
        graph: {
          status: 'success',
          result: { chapterGraph: { nodes: [], edges: [], timestamp: '' } }
        }
      },
      meta: { extractedAt: '2026-07-31T00:00:00Z', chapterNumber: 1 }
    })
    expect(result.success).toBe(true)
  })

  it('rejects v3 shape (missing memoryExtract/memoryOptimize)', () => {
    const result = PendingArchiveDataV4Schema.safeParse({
      version: 4,
      stages: {
        character: { status: 'success' },
        memory: { status: 'success' },
        plotArc: { status: 'success' },
        graph: { status: 'success' }
      },
      meta: { extractedAt: '', chapterNumber: 1 }
    })
    expect(result.success).toBe(false)
  })

  it('rejects version 3', () => {
    const result = PendingArchiveDataV4Schema.safeParse({
      version: 3,
      stages: { character: {}, memory: {}, plotArc: {}, graph: {} },
      meta: { extractedAt: '', chapterNumber: 1 }
    })
    expect(result.success).toBe(false)
  })
})

describe('RetryStageName', () => {
  it('accepts v4 stage names', () => {
    expect(RetryStageNameSchema.safeParse('memoryExtract').success).toBe(true)
    expect(RetryStageNameSchema.safeParse('memoryOptimize').success).toBe(true)
    expect(RetryStageNameSchema.safeParse('character').success).toBe(true)
    expect(RetryStageNameSchema.safeParse('plotArc').success).toBe(true)
    expect(RetryStageNameSchema.safeParse('graph').success).toBe(true)
  })

  it('rejects legacy memory name', () => {
    expect(RetryStageNameSchema.safeParse('memory').success).toBe(false)
  })
})
