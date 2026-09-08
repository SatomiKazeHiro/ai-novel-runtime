import { describe, it, expect, vi } from 'vitest'

vi.mock('../../services/ai-call-logger.js', () => ({
  callAIWithLog: vi.fn()
}))
vi.mock('../../services/runtime-loader.js', () => ({
  loadRuntimeBase: vi.fn().mockResolvedValue({ identity: '', settings: {}, behavior: '' }),
  loadWorkerTask: vi.fn().mockResolvedValue({ workerType: 'graph', taskPrompt: '' })
}))
vi.mock('@novel-runtime/ai-provider', () => {
  class RuntimePromptCompiler {
    compile(_base: unknown, _task: unknown, userMessage: string) {
      return { systemMessage: '', userMessage, meta: { totalTokens: 0 } }
    }
  }
  return { RuntimePromptCompiler }
})

import { runGraphExtractStage } from '../../services/stages/graph-extract-stage.js'
import { callAIWithLog } from '../../services/ai-call-logger.js'

const mockApp: any = { prisma: {}, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }

const baseInput = {
  storyId: 's1', chapterId: 'c1', content: 'x', outline: '', chapterNumber: 1,
  characterNames: ['张三'],
  prevCumulativeGraphKeys: [],
  latestBranchStates: []
}

describe('graph-extract-stage filter (importance >= 8, type whitelist)', () => {
  it('drops nodes with importance below 8', async () => {
    const ai = {
      nodes: [
        { type: 'character', key: 'zhangsan', label: '张三', importance: 7 },   // dropped
        { type: 'character', key: 'lisi',     label: '李四', importance: 8 }    // kept
      ],
      edges: []
    }
    ;(callAIWithLog as any).mockResolvedValueOnce(JSON.stringify(ai))

    const state = await runGraphExtractStage(mockApp, baseInput)
    expect(state.status).toBe('success')
    expect(state.result?.chapterGraph.nodes).toHaveLength(1)
    expect(state.result?.chapterGraph.nodes[0].key).toBe('lisi')
  })

  it('coerces non-whitelisted type to item', async () => {
    const ai = {
      nodes: [
        { type: 'weapon',   key: 'jian',  label: '宝剑', importance: 9 },   // → item
        { type: 'location', key: 'shan',  label: '山中', importance: 9 },   // → item
        { type: 'character', key: 'zs',   label: '张三', importance: 9 }   // → character
      ],
      edges: []
    }
    ;(callAIWithLog as any).mockResolvedValueOnce(JSON.stringify(ai))

    const state = await runGraphExtractStage(mockApp, baseInput)
    const types = state.result?.chapterGraph.nodes.map((n: any) => n.type).sort()
    expect(types).toEqual(['character', 'item', 'item'])
  })

  it('keeps nodes at importance === 8', async () => {
    const ai = {
      nodes: [{ type: 'character', key: 'a', label: '甲', importance: 8 }],
      edges: []
    }
    ;(callAIWithLog as any).mockResolvedValueOnce(JSON.stringify(ai))

    const state = await runGraphExtractStage(mockApp, baseInput)
    expect(state.result?.chapterGraph.nodes).toHaveLength(1)
  })

  it('falls back non-whitelisted relation to 关联', async () => {
    const ai = {
      nodes: [
        { type: 'character', key: 'zhangsan', label: '张三', importance: 8 },
        { type: 'character', key: 'lisi',     label: '李四', importance: 8 }
      ],
      edges: [
        { fromType: 'character', fromKey: 'zhangsan', toType: 'character', toKey: 'lisi', relation: '隶属', weight: 1 },   // 保留
        { fromType: 'character', fromKey: 'lisi',     toType: 'character', toKey: 'zhangsan', relation: '暧昧', weight: 1 } // → 关联
      ]
    }
    ;(callAIWithLog as any).mockResolvedValueOnce(JSON.stringify(ai))

    const state = await runGraphExtractStage(mockApp, baseInput)
    const rels = state.result?.chapterGraph.edges.map((e: any) => e.relation).sort()
    expect(rels).toEqual(['关联', '隶属'])
  })

  it('drops orphan edges whose endpoints are missing from nodes', async () => {
    const ai = {
      nodes: [
        { type: 'character', key: 'zhangsan', label: '张三', importance: 8 },
        { type: 'character', key: 'lisi',     label: '李四', importance: 8 }
        // wangwu 不存在
      ],
      edges: [
        { fromType: 'character', fromKey: 'zhangsan', toType: 'character', toKey: 'lisi',     relation: '朋友', weight: 1 }, // 保留
        { fromType: 'character', fromKey: 'zhangsan', toType: 'character', toKey: 'wangwu',   relation: '朋友', weight: 1 }, // 孤儿 → 丢弃
        { fromType: 'character', fromKey: 'wangwu',   toType: 'character', toKey: 'lisi',     relation: '朋友', weight: 1 }  // 孤儿 → 丢弃
      ]
    }
    ;(callAIWithLog as any).mockResolvedValueOnce(JSON.stringify(ai))

    const state = await runGraphExtractStage(mockApp, baseInput)
    expect(state.result?.chapterGraph.edges).toHaveLength(1)
    expect(state.result?.chapterGraph.edges[0].fromKey).toBe('zhangsan')
    expect(state.result?.chapterGraph.edges[0].toKey).toBe('lisi')
  })

  it('clamps edge weight to 1..2 range', async () => {
    const ai = {
      nodes: [
        { type: 'character', key: 'a', label: '甲', importance: 8 },
        { type: 'character', key: 'b', label: '乙', importance: 8 }
      ],
      edges: [
        { fromType: 'character', fromKey: 'a', toType: 'character', toKey: 'b', relation: '朋友', weight: 5 },   // → 2
        { fromType: 'character', fromKey: 'b', toType: 'character', toKey: 'a', relation: '朋友', weight: 0 },   // → 1
        { fromType: 'character', fromKey: 'a', toType: 'character', toKey: 'b', relation: '朋友', weight: 1.7 } // → 1.7 (保留)
      ]
    }
    ;(callAIWithLog as any).mockResolvedValueOnce(JSON.stringify(ai))

    const state = await runGraphExtractStage(mockApp, baseInput)
    const weights = state.result?.chapterGraph.edges.map((e: any) => e.weight).sort()
    expect(weights).toEqual([1, 1.7, 2])
  })
})