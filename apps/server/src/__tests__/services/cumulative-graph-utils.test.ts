import { describe, it, expect } from 'vitest'
import {
  parseRelationMapping,
  applyRelationMapping,
  codeMerge
} from '../../services/cumulative-graph.js'

const ts = '2026-07-25T00:00:00.000Z'

describe('parseRelationMapping', () => {
  it('sets map for each variant', () => {
    const raw = [
      { f: 'a', t: 'b', v: ['同义A', '同义B'], c: '统一' }
    ]
    const map = parseRelationMapping(raw)
    expect(map.get('a|同义A|b')).toBe('统一')
    expect(map.get('a|同义B|b')).toBe('统一')
  })

  it('skips mapping when variants missing (no fallthrough)', () => {
    const raw = [
      { f: 'a', t: 'b', c: '统一' }  // variants 缺
    ]
    const map = parseRelationMapping(raw)
    // 不设任何 key, 严格 AI 责任
    expect(map.size).toBe(0)
  })

  it('skips mapping when canonical missing', () => {
    const raw = [
      { f: 'a', t: 'b', v: ['字面'] }  // canonical 缺
    ]
    const map = parseRelationMapping(raw)
    expect(map.size).toBe(0)
  })

  it('skips mapping with wrong field types', () => {
    const raw = [
      { f: 123, t: 'b', v: ['字面'], c: '统一' },        // from 非字符串
      { f: 'a', t: null, v: ['字面'], c: '统一' },         // to 非字符串
      { f: 'a', t: 'b', v: 'not-array', c: '统一' }       // variants 非数组
    ]
    const map = parseRelationMapping(raw)
    expect(map.size).toBe(0)
  })

  it('multiple mappings with same from/to do not conflict', () => {
    const raw = [
      { f: 'a', t: 'b', v: ['A1'], c: '统一1' },
      { f: 'a', t: 'b', v: ['B1'], c: '统一2' }
    ]
    const map = parseRelationMapping(raw)
    expect(map.get('a|A1|b')).toBe('统一1')
    expect(map.get('a|B1|b')).toBe('统一2')
  })

  it('skips non-object entries', () => {
    const raw = [null, undefined, 'string', 123, { f: 'a', t: 'b', v: ['字面'], c: '统一' }]
    const map = parseRelationMapping(raw as any)
    expect(map.get('a|字面|b')).toBe('统一')
    expect(map.size).toBe(1)
  })
})

describe('applyRelationMapping', () => {
  const sample = {
    nodes: [
      { type: 'character', key: 'a', label: 'A', data: { x: 1 } }
    ],
    edges: [
      { fromType: 'character', fromKey: 'a', toType: 'character', toKey: 'b', relation: '字面1', weight: 1 }
    ],
    timestamp: ts
  }

  it('returns original reference when mapping empty', () => {
    const map = new Map<string, string>()
    const result = applyRelationMapping(sample, map)
    expect(result).toBe(sample)
  })

  it('rewrites relation when key matches and differs', () => {
    const map = new Map([['character:a|字面1|character:b', '字面2']])
    const result = applyRelationMapping(sample, map)
    expect(result.edges[0].relation).toBe('字面2')
  })

  it('keeps original when key matches but canonical equals current', () => {
    const map = new Map([['character:a|字面1|character:b', '字面1']])
    const result = applyRelationMapping(sample, map)
    // 即使字面相同也产生新数组元素 (immutable, 但 relation 字段值不变)
    expect(result.edges[0].relation).toBe('字面1')
    expect(result.edges).not.toBe(sample.edges)  // 新数组
  })

  it('keeps edges with non-matching keys unchanged', () => {
    const map = new Map([['character:a|其他字面|character:b', '字面2']])
    const result = applyRelationMapping(sample, map)
    expect(result.edges[0].relation).toBe('字面1')
  })

  it('deep copies nodes (modifying original data does not pollute result)', () => {
    const map = new Map([['character:a|字面1|character:b', '字面2']])
    const result = applyRelationMapping(sample, map)
    // 修改原 sample.nodes[0].data
    sample.nodes[0].data.x = 999
    // result.nodes[0].data 不应被影响
    expect(result.nodes[0].data.x).toBe(1)
  })

  it('hits multiple variants in same snapshot', () => {
    const multi = {
      nodes: sample.nodes,
      edges: [
        { fromType: 'character', fromKey: 'a', toType: 'character', toKey: 'b', relation: '字面1', weight: 1 },
        { fromType: 'character', fromKey: 'a', toType: 'character', toKey: 'b', relation: '字面2', weight: 1 }
      ],
      timestamp: ts
    }
    const map = new Map([
      ['character:a|字面1|character:b', '统一'],
      ['character:a|字面2|character:b', '统一']
    ])
    const result = applyRelationMapping(multi, map)
    expect(result.edges.every(e => e.relation === '统一')).toBe(true)
  })
})

describe('codeMerge', () => {
  it('accumulates weight when prev and chapterGraph share edge', () => {
    const prev = {
      nodes: [{ type: 'character', key: 'a', label: 'A', data: {} }],
      edges: [{ fromType: 'character', fromKey: 'a', toType: 'character', toKey: 'b', relation: '友', weight: 1 }],
      timestamp: ts
    }
    const chapterGraph = {
      nodes: [{ type: 'character', key: 'a', label: 'A', data: {} }],
      edges: [{ fromType: 'character', fromKey: 'a', toType: 'character', toKey: 'b', relation: '友', weight: 1 }],
      timestamp: ts
    }
    const result = codeMerge(prev, chapterGraph, ts)
    expect(result.edges).toHaveLength(1)
    expect(result.edges[0].weight).toBe(2)
  })

  it('preserves prev cumulative weight (>1) instead of resetting to 1', () => {
    const prev = {
      nodes: [{ type: 'character', key: 'a', label: 'A', data: {} }],
      edges: [{ fromType: 'character', fromKey: 'a', toType: 'character', toKey: 'b', relation: '友', weight: 2 }],
      timestamp: ts
    }
    const chapterGraph = {
      nodes: [{ type: 'character', key: 'a', label: 'A', data: {} }],
      edges: [{ fromType: 'character', fromKey: 'a', toType: 'character', toKey: 'b', relation: '友', weight: 1 }],
      timestamp: ts
    }
    const result = codeMerge(prev, chapterGraph, ts)
    expect(result.edges).toHaveLength(1)
    expect(result.edges[0].weight).toBe(3) // 2 (prev 历史) + 1 (chapterGraph)，而非重置 1 再 +1=2
  })

  it('treats different relation literal as different edge', () => {
    const prev = {
      nodes: [{ type: 'character', key: 'a', label: 'A', data: {} }],
      edges: [{ fromType: 'character', fromKey: 'a', toType: 'character', toKey: 'b', relation: '友', weight: 1 }],
      timestamp: ts
    }
    const chapterGraph = {
      nodes: [{ type: 'character', key: 'a', label: 'A', data: {} }],
      edges: [{ fromType: 'character', fromKey: 'a', toType: 'character', toKey: 'b', relation: '敌', weight: 1 }],
      timestamp: ts
    }
    const result = codeMerge(prev, chapterGraph, ts)
    expect(result.edges).toHaveLength(2)
  })

  it('sets new edge weight to 1', () => {
    const prev = { nodes: [], edges: [], timestamp: ts }
    const chapterGraph = {
      nodes: [{ type: 'character', key: 'a', label: 'A', data: {} }],
      edges: [{ fromType: 'character', fromKey: 'a', toType: 'character', toKey: 'b', relation: '新', weight: 99 }],
      timestamp: ts
    }
    const result = codeMerge(prev, chapterGraph, ts)
    expect(result.edges[0].weight).toBe(1)  // 忽略 chapterGraph 的 weight
  })

  it('deduplicates nodes by type:key (chapterGraph overrides prev)', () => {
    const prev = {
      nodes: [{ type: 'character', key: 'a', label: 'A-old', data: { x: 1 } }],
      edges: [],
      timestamp: ts
    }
    const chapterGraph = {
      nodes: [{ type: 'character', key: 'a', label: 'A-new', data: { y: 2 } }],
      edges: [],
      timestamp: ts
    }
    const result = codeMerge(prev, chapterGraph, ts)
    expect(result.nodes).toHaveLength(1)
    expect(result.nodes[0].label).toBe('A-new')
  })
})
