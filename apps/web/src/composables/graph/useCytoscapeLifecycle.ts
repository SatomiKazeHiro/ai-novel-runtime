import type { Ref } from 'vue'
import { onBeforeUnmount } from 'vue'
import cytoscape from 'cytoscape'

// ===== 类型导出 =====

export interface GraphNode {
  id?: string
  type: string
  key: string
  label: string
  isNew?: boolean
  [k: string]: any
}

export interface GraphEdge {
  id?: string
  source: string
  target: string
  relation: string
  fromType?: string
  fromKey?: string
  toType?: string
  toKey?: string
  weight?: number
  isNew?: boolean
  [k: string]: any
}

export interface GraphData<N = GraphNode, E = GraphEdge> {
  nodes: N[]
  edges: E[]
}

export interface CytoscapeLifecycleOptions {
  containerRef: Ref<HTMLDivElement | undefined>
  getDisplayData: () => GraphData | null
  getNewIds?: () => { newNodes: Set<string>; newEdges: Set<string> }
  onNodeTap?: (node: { id: string; label: string; key: string; type: string }) => void
  onEdgeTap?: (edge: { id: string; source: string; target: string; relation: string }) => void
  onBackgroundTap?: () => void
  getNodeColor?: (type: string) => string
}

export interface CytoscapeLifecycle {
  init(): void
  destroy(): void
  resetLayout(): void
  getInstance(): cytoscape.Core | null
}

// ===== normalizeGraph 工具 =====

export const TYPE_NORMALIZE_MAP: Record<string, string> = {
  // 中文映射
  '角色': 'character', '人物': 'character',
  '势力': 'faction', '组织': 'faction', '门派': 'faction',
  '事件': 'event',
  '物品': 'item', '道具': 'item', '武器': 'item', '装备': 'item',
  '兵器': 'item', '法宝': 'item', '灵器': 'item',
  // AI 可能自创的英文类型（统一收敛到四类）
  'weapon': 'item', 'prop': 'item', 'object': 'item', 'tool': 'item',
  'armor': 'item', 'treasure': 'item', 'artifact': 'item', 'gear': 'item',
  'realm': 'faction', 'sect': 'faction', 'clan': 'faction', 'guild': 'faction',
  'place': 'event', 'location': 'event', 'scene': 'event',
}

export function normalizeType(type: string): string {
  return TYPE_NORMALIZE_MAP[type] || type
}

export function normalizeGraph(rawNodes: any[], rawEdges: any[]) {
  // 1. 规范化节点 type
  const nodes = (rawNodes || []).map(n => ({
    ...n,
    type: normalizeType(n.type || 'character'),
  }))

  // 2. 建立 key -> 实际 type 映射（解决 AI 返回的节点 type 和边 type 不一致问题）
  const keyToType = new Map<string, string>()
  for (const n of nodes) {
    keyToType.set(n.key, n.type)
  }

  // 3. 规范化边：先用映射表转换 type，再用节点实际 type 修正
  const edges = (rawEdges || []).map(e => {
    const fromType = keyToType.get(e.fromKey) || normalizeType(e.fromType || 'character')
    const toType = keyToType.get(e.toKey) || normalizeType(e.toType || 'character')
    return { ...e, fromType, toType }
  })

  return { nodes, edges }
}

/**
 * 把后端返回的 raw 图谱数据转换成组件/cytoscape 用的 GraphData。
 * - 节点 id 兜底为 `${type}:${key}`
 * - 边转成 {source, target, relation} 三元组
 * - 同时保留所有原始字段（data / fromType / fromKey / ...）以兼容下游
 */
export function toGraphData(rawNodes: any[], rawEdges: any[]): GraphData {
  const normalized = normalizeGraph(rawNodes, rawEdges)
  return {
    nodes: normalized.nodes.map((n: any) => ({
      id: `${n.type}:${n.key}`,
      type: n.type,
      key: n.key,
      label: n.label,
      ...n.data
    })),
    edges: normalized.edges.map((e: any) => ({
      source: `${e.fromType}:${e.fromKey}`,
      target: `${e.toType}:${e.toKey}`,
      relation: e.relation,
      ...e
    }))
  }
}

// ===== Cytoscape 视觉常量 =====

function defaultNodeColor(type: string): string {
  const legend: Record<string, string> = {
    character: '#3b82f6',
    faction: '#ef4444',
    event: '#f97316',
    item: '#a855f7',
  }
  return legend[type] || '#94a3b8'
}

const COSE_LAYOUT_OPTIONS = {
  name: 'cose',
  padding: 20,
  animate: true,
  animationDuration: 500,
  randomize: false,
  componentSpacing: 60,
  nodeRepulsion: 400000,
  edgeElasticity: 100,
  nestingFactor: 5,
  gravity: 80,
  numIter: 1000,
  initialTemp: 200,
  coolingFactor: 0.95,
  minTemp: 1.0
} as const

function buildCytoscapeStyle(getNodeColor: (type: string) => string): cytoscape.StylesheetJson {
  return [
    {
      selector: 'node',
      style: {
        'background-color': (ele: any) => getNodeColor(ele.data('type')),
        'label': 'data(label)',
        'width': 40,
        'height': 40,
        'font-size': '12px',
        'color': '#fff',
        'text-outline-color': '#000',
        'text-outline-width': 2,
        'text-valign': 'center',
        'text-halign': 'center',
        'border-width': (ele: any) => ele.data('isNew') ? 3 : 0,
        'border-color': '#22c55e'
      }
    },
    {
      selector: 'edge',
      style: {
        'width': (ele: any) => ele.data('isNew') ? 3 : 2,
        'line-color': (ele: any) => ele.data('isNew') ? '#22c55e' : '#94a3b8',
        'target-arrow-color': (ele: any) => ele.data('isNew') ? '#22c55e' : '#94a3b8',
        'target-arrow-shape': 'triangle',
        'curve-style': 'bezier',
        'label': 'data(label)',
        'font-size': '10px',
        'color': '#64748b',
        'text-background-color': '#fff',
        'text-background-opacity': 0.8,
        'text-background-padding': '2px',
        'text-background-shape': 'roundrectangle'
      }
    },
    {
      selector: ':selected',
      style: {
        'border-width': 4,
        'border-color': '#fbbf24',
        'border-opacity': 1
      }
    }
  ]
}

// ===== Cytoscape 实例管理 =====

export function useCytoscapeLifecycle(
  options: CytoscapeLifecycleOptions
): CytoscapeLifecycle {
  let cy: cytoscape.Core | null = null

  function destroy() {
    if (cy) {
      // 先摘所有事件,防止 destroy 后 mouseover 还在 in-flight（4def263 修复点）
      cy.removeAllListeners()
      cy.destroy()
      cy = null
    }
  }

  function init() {
    if (!options.containerRef.value) return
    const data = options.getDisplayData()
    if (!data) return
    destroy() // 复用 unmount 路径,保证 destroy 行为一致
    if (data.nodes.length === 0) return

    const { newNodes = new Set<string>(), newEdges = new Set<string>() } =
      options.getNewIds?.() ?? {}

    // 收集所有有效节点 ID，过滤掉源或目标不存在的边（避免 AI 生成的 delta 数据不一致导致报错）
    const validNodeIds = new Set<string>(
      data.nodes.map((n: any) => `${n.type}:${n.key}`)
    )

    const nodeColorFn = options.getNodeColor ?? defaultNodeColor

    const elements = [
      ...data.nodes.map((n: any) => {
        const nodeId = `${n.type}:${n.key}`
        const isNew = newNodes.has(nodeId)
        return {
          data: { id: nodeId, label: n.label, type: n.type, key: n.key, isNew, ...n }
        }
      }),
      ...data.edges
        .filter((e: any) => {
          const sourceId = `${e.fromType}:${e.fromKey}`
          const targetId = `${e.toType}:${e.toKey}`
          return validNodeIds.has(sourceId) && validNodeIds.has(targetId)
        })
        .map((e: any) => {
          const sourceId = `${e.fromType}:${e.fromKey}`
          const targetId = `${e.toType}:${e.toKey}`
          const edgeId = `${sourceId}-${e.relation}-${targetId}`
          const isNew = newEdges.has(`${e.fromType}:${e.fromKey}:${e.relation}:${e.toType}:${e.toKey}`)
          return {
            data: { id: edgeId, source: sourceId, target: targetId, label: e.relation, isNew }
          }
        })
    ]

    cy = cytoscape({
      container: options.containerRef.value,
      elements,
      style: buildCytoscapeStyle(nodeColorFn),
      layout: COSE_LAYOUT_OPTIONS as any
    })

    if (options.onNodeTap) {
      cy.on('tap', 'node', (evt) => {
        const node = evt.target
        options.onNodeTap!({
          id: node.id(),
          label: node.data('label'),
          key: node.data('key'),
          type: node.data('type')
        })
      })
    }

    if (options.onEdgeTap) {
      cy.on('tap', 'edge', (evt) => {
        const edge = evt.target
        options.onEdgeTap!({
          id: edge.id(),
          source: edge.data('source'),
          target: edge.data('target'),
          relation: edge.data('label')
        })
      })
    }

    if (options.onBackgroundTap) {
      cy.on('tap', (evt) => {
        if (evt.target === cy) {
          options.onBackgroundTap!()
        }
      })
    }
  }

  function resetLayout() {
    if (!cy) return
    const layout = cy.layout({ ...COSE_LAYOUT_OPTIONS, randomize: true } as any)
    layout.run()
  }

  function getInstance() {
    return cy
  }

  onBeforeUnmount(() => {
    destroy()
  })

  return { init, destroy, resetLayout, getInstance }
}