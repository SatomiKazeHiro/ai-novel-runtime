import { describe, it, expect, vi } from 'vitest'

vi.mock('../../services/ai-call-logger.js', () => ({
  callAIWithLog: vi.fn()
}))

vi.mock('../../services/runtime-loader.js', () => ({
  loadRuntimeBase: vi.fn().mockResolvedValue({
    identity: '',
    settings: {},
    behavior: ''
  }),
  loadWorkerTask: vi.fn().mockResolvedValue({
    workerType: 'graph',
    taskPrompt: ''
  })
}))

vi.mock('../../services/ai-provider-init.js', () => ({
  resolveProvider: vi.fn().mockResolvedValue({
    provider: {},
    config: { contextLength: 64000, maxTokens: 16384 }
  }),
  getProviderById: vi.fn(),
  getDefaultProvider: vi.fn()
}))

vi.mock('@novel-runtime/ai-provider', () => {
  class RuntimePromptCompiler {
    compile(_base: unknown, _task: unknown, userMessage: string) {
      return {
        systemMessage: '',
        userMessage,
        meta: { totalTokens: 0 }
      }
    }
  }
  return { RuntimePromptCompiler }
})

import { buildCumulativeGraph } from '../../services/cumulative-graph.js'
import { callAIWithLog } from '../../services/ai-call-logger.js'

const mockApp: any = {
  prisma: {},
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}

const ts = '2026-07-25T00:00:00.000Z'

describe('buildCumulativeGraph', () => {
  it('returns prevCumulativeGraph when chapterGraph is empty (no AI called)', async () => {
    const prev = { nodes: [{ type: 'character', key: 'a', label: 'A', data: {} }], edges: [], timestamp: ts }

    const result = await buildCumulativeGraph(mockApp, {
      storyId: 's1', chapterId: 'c1',
      chapterGraph: { nodes: [], edges: [], timestamp: ts },
      prevCumulativeGraph: prev
    })

    expect(result.aiCalled).toBe(false)
    expect(result.cumulativeGraph).toEqual(prev)
    expect(callAIWithLog).not.toHaveBeenCalled()
  })

  it('returns chapterGraph copy when prev is null (first chapter)', async () => {
    const chapterGraph = { nodes: [{ type: 'character', key: 'a', label: 'A', data: {} }], edges: [], timestamp: ts }

    const result = await buildCumulativeGraph(mockApp, {
      storyId: 's1', chapterId: 'c1',
      chapterGraph, prevCumulativeGraph: null
    })

    expect(result.aiCalled).toBe(false)
    expect(result.cumulativeGraph.nodes).toEqual(chapterGraph.nodes)
    expect(callAIWithLog).not.toHaveBeenCalled()
  })

  it('applies relation mapping from AI and merges chapterGraph into prev', async () => {
    // 模拟 3 章累积的"老字面漂移"数据: c1 写"收留/决定帮助", c2 写"收留并帮助"
    const prev = {
      nodes: [
        { type: 'character', key: 'xu_qing', label: '许青', data: {} },
        { type: 'character', key: 'jiang_he', label: '姜禾', data: {} }
      ],
      edges: [
        { fromType: 'character', fromKey: 'xu_qing', toType: 'character', toKey: 'jiang_he', relation: '收留/决定帮助', weight: 1 },
        { fromType: 'character', fromKey: 'jiang_he', toType: 'character', toKey: 'xu_qing', relation: '被收留/戒备与初步信任', weight: 1 }
      ],
      timestamp: ts
    }
    const chapterGraph = {
      nodes: [{ type: 'character', key: 'xu_qing', label: '许青', data: { newAttr: 'x' } }],
      edges: [
        { fromType: 'character', fromKey: 'xu_qing', toType: 'character', toKey: 'jiang_he', relation: '收留并帮助', weight: 1 },
        { fromType: 'character', fromKey: 'jiang_he', toType: 'character', toKey: 'xu_qing', relation: '初步信任并依赖', weight: 1 }
      ],
      timestamp: ts
    }

    // AI dedup 输出 relation 归一映射: 把同义字面统一
    const aiMapping = {
      mappings: [
        {
          from: 'character:xu_qing',
          to: 'character:jiang_he',
          variants: ['收留/决定帮助', '收留并帮助'],
          canonical: '收留'
        },
        {
          from: 'character:jiang_he',
          to: 'character:xu_qing',
          variants: ['被收留/戒备与初步信任', '初步信任并依赖'],
          canonical: '初步信任'
        }
      ]
    }
    ;(callAIWithLog as any).mockResolvedValueOnce(JSON.stringify(aiMapping))

    const result = await buildCumulativeGraph(mockApp, {
      storyId: 's1', chapterId: 'c1',
      chapterGraph, prevCumulativeGraph: prev
    })

    expect(result.aiCalled).toBe(true)
    expect(callAIWithLog).toHaveBeenCalled()
    // 应用映射后: 4 条不同字面的边 → 2 条统一字面的边, weight 累加
    expect(result.cumulativeGraph.edges).toHaveLength(2)
    const xqToJh = result.cumulativeGraph.edges.find(e => e.fromKey === 'xu_qing' && e.toKey === 'jiang_he')!
    const jhToXq = result.cumulativeGraph.edges.find(e => e.fromKey === 'jiang_he' && e.toKey === 'xu_qing')!
    expect(xqToJh.relation).toBe('收留')
    expect(jhToXq.relation).toBe('初步信任')
    expect(xqToJh.weight).toBe(2)  // prev + chapterGraph 各贡献 1
    expect(jhToXq.weight).toBe(2)
  })

  it('passes through when AI returns empty mapping (no relation changes)', async () => {
    const prev = {
      nodes: [{ type: 'character', key: 'a', label: 'A', data: {} }],
      edges: [{ fromType: 'character', fromKey: 'a', toType: 'character', toKey: 'b', relation: '朋友', weight: 1 }],
      timestamp: ts
    }
    const chapterGraph = {
      nodes: [{ type: 'character', key: 'a', label: 'A', data: {} }],
      edges: [{ fromType: 'character', fromKey: 'a', toType: 'character', toKey: 'b', relation: '敌对', weight: 1 }],
      timestamp: ts
    }
    ;(callAIWithLog as any).mockResolvedValueOnce(JSON.stringify({ mappings: [] }))

    const result = await buildCumulativeGraph(mockApp, {
      storyId: 's1', chapterId: 'c1',
      chapterGraph, prevCumulativeGraph: prev
    })

    // AI 没给 mapping → 不重写 → 两条字面不同的边都保留(关系演化)
    expect(result.cumulativeGraph.edges).toHaveLength(2)
  })

  it('throws when AI fails', async () => {
    const chapterGraph = { nodes: [{ type: 'character', key: 'a', label: 'A', data: {} }], edges: [], timestamp: ts }
    const prev = { nodes: [{ type: 'character', key: 'a', label: 'A', data: {} }], edges: [], timestamp: ts }

    ;(callAIWithLog as any).mockResolvedValueOnce(null)

    await expect(buildCumulativeGraph(mockApp, {
      storyId: 's1', chapterId: 'c1',
      chapterGraph, prevCumulativeGraph: prev
    })).rejects.toThrow()
  })
})
