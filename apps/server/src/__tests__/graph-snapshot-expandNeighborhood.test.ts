import { describe, it, expect } from 'vitest'
import { expandNeighborhood, type GraphSnapshot } from '../services/graph-snapshot.js'

function makeSnapshot(): GraphSnapshot {
  return {
    nodes: [
      { type: 'character', key: 'a', label: 'A', data: {} },
      { type: 'character', key: 'b', label: 'B', data: {} },
      { type: 'character', key: 'c', label: 'C', data: {} },
      { type: 'character', key: 'd', label: 'D', data: {} },
      { type: 'character', key: 'e', label: 'E', data: {} },
      { type: 'faction',   key: 'f1', label: 'F1', data: {} }
    ],
    edges: [
      { fromType: 'character', fromKey: 'a', toType: 'character', toKey: 'b', relation: 'friend',  weight: 1 },
      { fromType: 'character', fromKey: 'b', toType: 'character', toKey: 'c', relation: 'mentor',  weight: 1 },
      { fromType: 'character', fromKey: 'c', toType: 'character', toKey: 'd', relation: 'sibling', weight: 1 },
      { fromType: 'character', fromKey: 'a', toType: 'faction',   toKey: 'f1', relation: 'member',  weight: 1 },
      { fromType: 'character', fromKey: 'e', toType: 'character', toKey: 'a', relation: 'enemy',   weight: 1 }
    ],
    timestamp: '2026-06-17T00:00:00.000Z'
  }
}

describe('expandNeighborhood — basic BFS', () => {
  it('depth=0 returns only the matched keys themselves (no edges)', () => {
    const r = expandNeighborhood(makeSnapshot(), ['character:a'], { maxDepth: 0, maxTokens: 10_000 })
    expect(r.nodes.map(n => `${n.type}:${n.key}`).sort()).toEqual(['character:a'])
    expect(r.edges).toEqual([])
    expect(r.truncated).toBe(false)
  })

  it('depth=1 includes direct neighbors and the edges that connect matched -> neighbor', () => {
    const r = expandNeighborhood(makeSnapshot(), ['character:a'], { maxDepth: 1, maxTokens: 10_000 })
    const keys = r.nodes.map(n => `${n.type}:${n.key}`).sort()
    expect(keys).toEqual(['character:a', 'character:b', 'character:e', 'faction:f1'])
    // Edges should be only those whose BOTH endpoints are in the node set
    expect(r.edges).toHaveLength(3)
    expect(r.edges.every(e =>
      r.nodes.some(n => n.type === e.fromType && n.key === e.fromKey) &&
      r.nodes.some(n => n.type === e.toType   && n.key === e.toKey)
    )).toBe(true)
  })

  it('depth=2 reaches 2-hop neighbors (a -> b -> c, but not d which is 3-hop)', () => {
    const r = expandNeighborhood(makeSnapshot(), ['character:a'], { maxDepth: 2, maxTokens: 10_000 })
    const keys = r.nodes.map(n => `${n.type}:${n.key}`).sort()
    // depth 0: a
    // depth 1: a's direct neighbors b, e, f1
    // depth 2: b's new neighbor c (e and f1 have no new neighbors)
    // d is 3-hop (a -> b -> c -> d) — must NOT be included at maxDepth=2
    expect(keys).toContain('character:c')
    expect(keys).not.toContain('character:d')
  })

  it('drops edges whose endpoint was not visited (orphans)', () => {
    // BFS starts at 'b'. a is reachable (1 hop) but c is not.
    // The edge a->c has one endpoint visited (a) and one unvisited (c);
    // the edge must be pruned from the result.
    const snap: GraphSnapshot = {
      nodes: [
        { type: 'character', key: 'a', label: 'A', data: {} },
        { type: 'character', key: 'b', label: 'B', data: {} },
        { type: 'character', key: 'c', label: 'C', data: {} }
      ],
      edges: [
        { fromType: 'character', fromKey: 'a', toType: 'character', toKey: 'b', relation: 'friend', weight: 1 },
        { fromType: 'character', fromKey: 'a', toType: 'character', toKey: 'c', relation: 'sibling', weight: 1 }
      ],
      timestamp: ''
    }
    const r = expandNeighborhood(snap, ['character:b'], { maxDepth: 1, maxTokens: 10_000 })
    // a is 1-hop from b, so a is in. c is not connected to b, so c is OUT.
    // Edge a->b: both endpoints in {a, b} → keep.
    // Edge a->c: c is OUT → drop.
    expect(r.nodes.map(n => n.key).sort()).toEqual(['a', 'b'])
    expect(r.edges).toHaveLength(1)
    expect(r.edges[0].toKey).toBe('b')
  })

  it('returns empty when matched key is not in snapshot', () => {
    const r = expandNeighborhood(makeSnapshot(), ['character:zzz'], { maxDepth: 2, maxTokens: 10_000 })
    expect(r.nodes).toEqual([])
    expect(r.edges).toEqual([])
    expect(r.truncated).toBe(false)
  })
})

describe('expandNeighborhood — budget enforcement', () => {
  it('truncates when estimated tokens exceed maxTokens (token_budget)', () => {
    // Custom estimator that returns large values to force early stop
    const heavy = (n: any) => 100
    const r = expandNeighborhood(makeSnapshot(), ['character:a'], {
      maxDepth: 2, maxTokens: 250, tokenEstimator: heavy
    })
    expect(r.truncated).toBe(true)
    expect(r.truncateReason).toBe('token_budget')
    // 250 / 100 = at most 2 nodes (matched + 1 neighbor)
    expect(r.nodes.length).toBeLessThanOrEqual(2)
  })

  it('truncates when node count exceeds maxEntities (max_entities)', () => {
    const r = expandNeighborhood(makeSnapshot(), ['character:a'], {
      maxDepth: 2, maxTokens: 10_000, maxEntities: 2
    })
    expect(r.truncated).toBe(true)
    expect(r.truncateReason).toBe('max_entities')
    expect(r.nodes.length).toBeLessThanOrEqual(2)
  })

  it('maxEntities: 1 keeps only the matched key and truncates (max_entities)', () => {
    const r = expandNeighborhood(makeSnapshot(), ['character:a'], {
      maxDepth: 2, maxTokens: 10_000, maxEntities: 1
    })
    expect(r.truncated).toBe(true)
    expect(r.truncateReason).toBe('max_entities')
    // Only the matched key itself, no neighbors admitted
    expect(r.nodes.map(n => `${n.type}:${n.key}`)).toEqual(['character:a'])
    expect(r.nodes).toHaveLength(1)
  })

  it('throws RangeError when maxTokens is NaN', () => {
    expect(() =>
      expandNeighborhood(makeSnapshot(), ['character:a'], { maxDepth: 1, maxTokens: NaN })
    ).toThrow(RangeError)
  })

  it('throws RangeError when maxTokens is negative', () => {
    expect(() =>
      expandNeighborhood(makeSnapshot(), ['character:a'], { maxDepth: 1, maxTokens: -1 })
    ).toThrow(RangeError)
  })

  it('reports estimatedTokens = sum of estimator over all included nodes', () => {
    const sizeOf = (n: any) => JSON.stringify(n).length
    const r = expandNeighborhood(makeSnapshot(), ['character:a'], {
      maxDepth: 1, maxTokens: 10_000, tokenEstimator: sizeOf
    })
    const expected = r.nodes.reduce((sum, n) => sum + sizeOf(n), 0)
    expect(r.estimatedTokens).toBe(expected)
  })
})
