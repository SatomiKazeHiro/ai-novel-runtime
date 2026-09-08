import { describe, it, expect } from 'vitest'
import { fromV3, toV3, type V3PendingArchiveData } from '../../views/ReviewingPanel.adapter'

const sampleV3: V3PendingArchiveData = {
  version: 3,
  stages: {
    character: {
      status: 'success',
      result: {
        characterStates: [
          { characterId: 'c1', name: '张三', key: 'zhangsan',
            status: '{"location":"灵华宗"}',
            relationships: '{"李四":"朋友"}',
            isNew: false }
        ]
      }
    },
    memory: {
      status: 'success',
      result: {
        mainEvents: [
          { description: '主角觉醒', participants: ['张三'], importance: 8 }
        ],
        sideEvents: [
          { description: '路人走过', participants: [], importance: 5 }
        ],
        scenes: [{ location: '灵华宗', event: '大殿议事', importance: 7 }],
        summary: '主角觉醒',
        emotions: ['激动'],
        foreshadowing: ['上古残卷'],
        relationshipChanges: ['张三 ↔ 李四 加深']
      }
    },
    plotArc: {
      status: 'success',
      result: {
        plotArcs: [{ id: 'pa1', name: '时空裂隙', progress: 30, status: 'active' }]
      }
    },
    graph: {
      status: 'success',
      result: {
        chapterGraph: {
          nodes: [{ type: 'character', key: 'zhangsan', label: '张三', data: {} }],
          edges: [{ fromType: 'character', fromKey: 'zhangsan', toType: 'faction', toKey: 'mingjiao', relation: '隶属', weight: 1 }]
        }
      }
    }
  },
  meta: { extractedAt: '2026-07-26T00:00:00Z', chapterNumber: 7 }
}

describe('ReviewingPanel.adapter v3 ↔ v2', () => {
  it('fromV3: empty input → empty LocalData', () => {
    const local = fromV3(null)
    expect(local.summary).toBe('')
    expect(local.memories.memories).toEqual([])
    expect(local.memories.characterStates).toEqual([])
    expect(local.plotArcs).toEqual([])
    expect(local.graph.chapterGraph).toEqual({ nodes: [], edges: [] })
  })

  it('fromV3: full v3 payload → LocalData with all fields populated', () => {
    const local = fromV3(sampleV3)
    expect(local.summary).toBe('主角觉醒')
    expect(local.memories.memories).toHaveLength(2)
    expect(local.memories.memories[0].content).toBe('主角觉醒')
    expect(local.memories.memories[0].tags).toEqual(['main-plot'])
    expect(local.memories.memories[1].content).toBe('路人走过')
    expect(local.memories.memories[1].tags).toEqual(['side-plot'])
    expect(local.memories.characterStates).toHaveLength(1)
    expect(local.memories.characterStates[0].name).toBe('张三')
    expect(local.memories.emotions).toEqual(['激动'])
    expect(local.memories.foreshadowing).toEqual(['上古残卷'])
    expect(local.memories.relationshipChanges).toEqual(['张三 ↔ 李四 加深'])
    expect(local.plotArcs).toHaveLength(1)
    expect(local.plotArcs[0].name).toBe('时空裂隙')
    expect(local.graph.chapterGraph.nodes).toHaveLength(1)
    expect(local.graph.chapterGraph.edges).toHaveLength(1)
  })

  it('toV3: LocalData → back to v3 shape (counts preserved)', () => {
    const local = fromV3(sampleV3)
    const round = toV3(local, sampleV3)
    expect(round.version).toBe(3)
    expect(round.meta).toEqual(sampleV3.meta)
    expect(round.stages.character?.result?.characterStates).toHaveLength(1)
    expect(round.stages.memory?.result?.mainEvents).toHaveLength(1)
    expect(round.stages.memory?.result?.sideEvents).toHaveLength(1)
    expect(round.stages.memory?.result?.summary).toBe('主角觉醒')
    expect(round.stages.memory?.result?.emotions).toEqual(['激动'])
    expect(round.stages.plotArc?.result?.plotArcs).toHaveLength(1)
    expect(round.stages.graph?.result?.chapterGraph.nodes).toHaveLength(1)
    expect(round.stages.graph?.result?.chapterGraph.edges).toHaveLength(1)
  })

  it('toV3: preserves original version and meta even when missing', () => {
    const partial: V3PendingArchiveData = {
      version: 3, stages: {}, meta: { chapterNumber: 5 }
    }
    const local = fromV3(partial)
    const round = toV3(local, partial)
    expect(round.version).toBe(3)
    expect(round.meta.chapterNumber).toBe(5)
  })

  it('round-trip: LocalData edits flow back into v3 mainEvents', () => {
    const local = fromV3(sampleV3)
    local.memories.memories[0].content = '主角觉醒并突破'
    local.memories.memories[0].importance = 9
    const round = toV3(local, sampleV3)
    expect(round.stages.memory?.result?.mainEvents[0].description).toBe('主角觉醒并突破')
    expect(round.stages.memory?.result?.mainEvents[0].importance).toBe(9)
  })
})