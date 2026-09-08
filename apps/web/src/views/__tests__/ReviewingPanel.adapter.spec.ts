import { describe, expect, it } from 'vitest'
import { fromV4, toV4 } from '../ReviewingPanel.adapter'

describe('ReviewingPanel.adapter v4 ↔ LocalData', () => {
  it('fromV4 reads mainEvents from memoryExtract (not memoryOptimize)', () => {
    const local = fromV4({
      version: 4,
      stages: {
        memoryExtract: {
          status: 'success',
          result: {
            mainEvents: [{ description: 'A', importance: 7 }],
            sideEvents: [],
            emotions: [],
            foreshadowing: [],
            relationshipChanges: [],
            summary: ''
          }
        },
        memoryOptimize: {
          status: 'success',
          result: {
            memories: [{ content: 'B', originUid: 'NEW', importance: 5, type: 'event' }]
          }
        }
      },
      meta: { chapterNumber: 1 }
    } as any)

    expect(local.memories.memories[0].content).toBe('A')
    expect(local.memories.memories[0].tags).toContain('main-plot')
  })

  it('toV4 writes mainEvents to memoryExtract and skips memoryOptimize', () => {
    const result = toV4({
      summary: 'x',
      memories: {
        memories: [
          { content: 'A', tags: ['main-plot'], importance: 7, fromChapterNumber: 1 },
          { content: 'B', tags: ['side-plot'], importance: 4, fromChapterNumber: 1 }
        ],
        characterStates: [],
        emotions: [],
        foreshadowing: [],
        relationshipChanges: []
      },
      plotArcs: [],
      graph: { chapterGraph: { nodes: [], edges: [] } }
    }, { version: 4, stages: {}, meta: {} } as any)

    expect(result.stages.memoryExtract?.result.mainEvents).toHaveLength(1)
    expect(result.stages.memoryExtract?.result.mainEvents[0].description).toBe('A')
    expect(result.stages.memoryExtract?.result.sideEvents).toHaveLength(1)
    expect(result.stages.memoryOptimize).toBeUndefined()
  })
})
