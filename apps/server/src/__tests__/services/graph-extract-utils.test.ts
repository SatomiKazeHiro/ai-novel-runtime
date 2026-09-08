import { describe, it, expect, vi } from 'vitest'
import {
  parseGraphResponse,
  dropOrphanEdges,
  dedupEdgesByPair
} from '../../services/stages/graph-extract-stage.js'
import { buildGraphExtractPrompt } from '../../services/stages/graph-extract.prompt.js'

describe('parseGraphResponse', () => {
  it('parses short field names', () => {
    const parsed = {
      n: [
        { t: 'character', k: 'a', l: 'A', d: { role: 'hero' } }
      ],
      e: [
        { ft: 'character', fk: 'a', tt: 'character', tk: 'b', r: '友' }
      ]
    }
    const result = parseGraphResponse(parsed)
    expect(result.nodes).toEqual([
      { type: 'character', key: 'a', label: 'A', data: { role: 'hero' } }
    ])
    expect(result.edges).toEqual([
      { fromType: 'character', fromKey: 'a', toType: 'character', toKey: 'b', relation: '友', weight: 1 }
    ])
  })

  it('falls back to long field names when short missing', () => {
    const parsed = {
      nodes: [
        { type: 'character', key: 'a', label: 'A' }
      ],
      edges: [
        { fromType: 'character', fromKey: 'a', toType: 'character', toKey: 'b', relation: '友' }
      ]
    }
    const result = parseGraphResponse(parsed)
    expect(result.nodes).toHaveLength(1)
    expect(result.edges).toHaveLength(1)
  })

  it('filters nodes missing type or key', () => {
    const parsed = {
      n: [
        { t: 'character', k: 'a' },                        // OK
        { t: 'character' },                                  // 缺 key
        { k: 'b' },                                          // 缺 type
        null,                                                // 非对象
        'string'                                             // 非对象
      ],
      e: []
    }
    const result = parseGraphResponse(parsed)
    expect(result.nodes).toHaveLength(1)
  })

  it('falls back label to key when label missing', () => {
    const parsed = { n: [{ t: 'character', k: 'a' }], e: [] }
    const result = parseGraphResponse(parsed)
    expect(result.nodes[0].label).toBe('a')
  })

  it('defaults data to empty object when missing or non-object', () => {
    const parsed = {
      n: [
        { t: 'character', k: 'a' },
        { t: 'character', k: 'b', d: null },
        { t: 'character', k: 'c', d: 'string' }
      ],
      e: []
    }
    const result = parseGraphResponse(parsed)
    expect(result.nodes.every(n => n.data && Object.keys(n.data).length === 0)).toBe(true)
  })

  it('defaults relation to empty string when missing', () => {
    const parsed = { n: [], e: [{ ft: 'c', fk: 'a', tt: 'c', tk: 'b' }] }
    const result = parseGraphResponse(parsed)
    expect(result.edges[0].relation).toBe('')
  })

  it('filters edges missing from/to type or key', () => {
    const parsed = {
      n: [
        { t: 'character', k: 'a' },
        { t: 'character', k: 'b' }
      ],
      e: [
        { ft: 'character', fk: 'a', tt: 'character', tk: 'b' },  // OK
        { ft: 'character', fk: 'a' },                             // 缺 toType/toKey
        { tt: 'character', tk: 'b' },                             // 缺 fromType/fromKey
        null                                                       // 非对象
      ]
    }
    const result = parseGraphResponse(parsed)
    expect(result.edges).toHaveLength(1)
  })
})

describe('dropOrphanEdges', () => {
  const silentLog = { info: vi.fn() }

  it('keeps edges with both endpoints in node list', () => {
    const nodes = [
      { type: 'character', key: 'a' },
      { type: 'character', key: 'b' }
    ]
    const edges = [
      { fromType: 'character', fromKey: 'a', toType: 'character', toKey: 'b', relation: '友' }
    ]
    const result = dropOrphanEdges(nodes, edges, silentLog)
    expect(result).toHaveLength(1)
    expect(silentLog.info).not.toHaveBeenCalled()
  })

  it('drops edges with endpoints not in node list and logs count', () => {
    const nodes = [{ type: 'character', key: 'a' }]
    const edges = [
      { fromType: 'character', fromKey: 'a', toType: 'character', toKey: 'b', relation: '友' },
      { fromType: 'character', fromKey: 'c', toType: 'character', toKey: 'a', relation: '友' }
    ]
    const result = dropOrphanEdges(nodes, edges, silentLog)
    expect(result).toHaveLength(0)
    expect(silentLog.info).toHaveBeenCalledWith(
      expect.stringContaining('orphan edges dropped: 2')
    )
  })

  it('drops edge when only one endpoint missing', () => {
    const nodes = [{ type: 'character', key: 'a' }]
    const edges = [
      { fromType: 'character', fromKey: 'a', toType: 'character', toKey: 'b', relation: '友' }
    ]
    const result = dropOrphanEdges(nodes, edges, silentLog)
    expect(result).toHaveLength(0)
  })
})

describe('dedupEdgesByPair', () => {
  const silentLog = { info: vi.fn() }

  it('keeps top 2 distinct relations per unordered pair', () => {
    const edges = [
      { fromType: 'c', fromKey: 'a', toType: 'c', toKey: 'b', relation: '友', weight: 1 },
      { fromType: 'c', fromKey: 'a', toType: 'c', toKey: 'b', relation: '敌', weight: 1 },
      { fromType: 'c', fromKey: 'a', toType: 'c', toKey: 'b', relation: '师', weight: 1 }
    ]
    const result = dedupEdgesByPair(edges, silentLog, 2)
    expect(result).toHaveLength(2)
    const rels = result.map(e => e.relation).sort()
    expect(rels).toEqual(['友', '敌'])  // 任意 2 条
  })

  it('treats A→B and B→A as same unordered pair', () => {
    const edges = [
      { fromType: 'c', fromKey: 'a', toType: 'c', toKey: 'b', relation: '友', weight: 1 },
      { fromType: 'c', fromKey: 'b', toType: 'c', toKey: 'a', relation: '敌', weight: 1 }
    ]
    const result = dedupEdgesByPair(edges, silentLog, 2)
    expect(result).toHaveLength(2)  // 同一 pair 但方向不同, 都是独立边
  })

  it('does not duplicate relation within same pair', () => {
    const edges = [
      { fromType: 'c', fromKey: 'a', toType: 'c', toKey: 'b', relation: '友', weight: 1 },
      { fromType: 'c', fromKey: 'a', toType: 'c', toKey: 'b', relation: '友', weight: 1 }
    ]
    const result = dedupEdgesByPair(edges, silentLog, 2)
    expect(result).toHaveLength(1)
  })

  it('does not affect different pairs', () => {
    const edges = [
      { fromType: 'c', fromKey: 'a', toType: 'c', toKey: 'b', relation: '友', weight: 1 },
      { fromType: 'c', fromKey: 'a', toType: 'c', toKey: 'c', relation: '敌', weight: 1 }
    ]
    const result = dedupEdgesByPair(edges, silentLog, 2)
    expect(result).toHaveLength(2)
  })

  it('sorts by weight desc, picks top distinct', () => {
    const edges = [
      { fromType: 'c', fromKey: 'a', toType: 'c', toKey: 'b', relation: '友', weight: 1 },
      { fromType: 'c', fromKey: 'a', toType: 'c', toKey: 'b', relation: '友', weight: 5 },  // 同 rel 高 weight
      { fromType: 'c', fromKey: 'a', toType: 'c', toKey: 'b', relation: '敌', weight: 1 }
    ]
    const result = dedupEdgesByPair(edges, silentLog, 2)
    expect(result).toHaveLength(2)
    const friends = result.filter(e => e.relation === '友')
    expect(friends).toHaveLength(1)
    expect(friends[0].weight).toBe(5)  // 高 weight 留下
  })
})

describe('buildGraphExtractPrompt', () => {
  it('contains 6 section headers', () => {
    const prompt = buildGraphExtractPrompt({ content: 'x', characterNames: [], prevCumulativeGraphNodes: [], prevCumulativeGraphEdges: [] })
    expect(prompt).toContain('【任务】')
    expect(prompt).toContain('【实体与关系定义】')
    expect(prompt).toContain('【提取规则】')
    expect(prompt).toContain('【已有实体及关系】')
    expect(prompt).toContain('【章节内容】')
    expect(prompt).toContain('【输出格式】')
  })

  it('uses short field names in schema example', () => {
    const prompt = buildGraphExtractPrompt({ content: 'x', characterNames: [], prevCumulativeGraphNodes: [], prevCumulativeGraphEdges: [] })
    expect(prompt).toContain('"n":')
    expect(prompt).toContain('"ft":')
    expect(prompt).toContain('"fk":')
    expect(prompt).toContain('"tt":')
    expect(prompt).toContain('"tk":')
    expect(prompt).toContain('"r":')
  })

  it('pre-filters keyList by content (only labels in content kept)', () => {
    const prompt = buildGraphExtractPrompt({
      content: '许青和姜禾',
      characterNames: [],
      prevCumulativeGraphNodes: [
        { type: 'character', key: 'xu_qing', label: '许青' },
        { type: 'character', key: 'unknown', label: '未出现' }
      ],
      prevCumulativeGraphEdges: []
    })
    expect(prompt).toContain('character:xu_qing')
    expect(prompt).not.toContain('character:unknown')
  })
})
