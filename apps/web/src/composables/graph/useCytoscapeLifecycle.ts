import type { Ref } from 'vue'
import { onBeforeUnmount } from 'vue'
import cytoscape from 'cytoscape'
import { COLOR } from '../../styles/tokens'

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
  /**
   * 聚焦模式: 将与 focusId 相关的元素(节点 1 跳邻居 / 边 + 两端)保持原样,
   * 其余元素加 .faded class 变半透明。重复点同一个焦点 = 取消聚焦。
   */
  applyFocus(focusId: string, focusType: 'node' | 'edge'): void
  clearFocus(): void
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
    character: COLOR.graphCharacter,
    faction: COLOR.graphFaction,
    event: COLOR.graphEvent,
    item: COLOR.graphItem,
  }
  // 大小写防御: 后端偶发返回 'Character' / 'CHARACTER' 时, 不至于全部 fallback 成灰色
  const key = (type || '').toLowerCase()
  return legend[key] || COLOR.graphEdge
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
        // 缩小时不让字缩到 < 10px (否则糊); 章节图 zoom ≈ 0.9 字号 10.8 不触发,
        // 知识图 zoom 被限制 ≥ 0.6 字号 7.2 也会被拉回 10
        'min-zoomed-font-size': 10,
        'border-width': (ele: any) => ele.data('isNew') ? 3 : 0,
        'border-color': COLOR.graphNew
      }
    },
    {
      selector: 'edge',
      style: {
        'width': (ele: any) => ele.data('isNew') ? 3 : 2,
        'line-color': (ele: any) => ele.data('isNew') ? COLOR.graphNew : COLOR.graphEdge,
        'target-arrow-color': (ele: any) => ele.data('isNew') ? COLOR.graphNew : COLOR.graphEdge,
        'target-arrow-shape': 'triangle',
        'curve-style': 'bezier',
        'label': 'data(label)',
        'font-size': '10px',
        'color': COLOR.graphText,
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
        'border-color': COLOR.graphSelected,
        'border-opacity': 1
      }
    },
    {
      /* 聚焦模式: 不相关的元素半透明 */
      selector: '.faded',
      style: {
        'opacity': 0.12,
        'transition-property': 'opacity, background-opacity, border-opacity, text-opacity',
        'transition-duration': 180,
        'transition-timing-function': 'ease'
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
      layout: COSE_LAYOUT_OPTIONS as any,
      // retina / 高 DPI 屏: 默认 1 让 canvas 被拉伸模糊, 改 'auto'
      // 让 cytoscape 跟着 devicePixelRatio 渲染, 节点/边/字都更清晰
      pixelRatio: 'auto',
      // 节点少时 (如章节图) 不要被无限制放大, 防止 fit() 之后节点变巨大
      maxZoom: 1.5,
      minZoom: 0.3
    })

    // COSE 布局跑完后自动 fit 居中, 让画布被充分利用。
    // 不加这一步: 节点多时画布只占一角, 节点少时画布又太空, 看着松散。
    const cyRef = cy
    cyRef.one('layoutstop', () => {
      cyRef.fit(undefined, 20)
      // 知识图谱节点多 (20+), fit() 后 zoom 会被压到 0.3-0.5,
      // 节点缩到 12-20px、字号 4-6px 看着糊。强制把 zoom 拉回 0.6:
      // - 节点 24px、字号 7.2px (再被 min-zoomed-font-size 拉回 10)
      // - 节点会溢出画布, 用户可拖动查看, 比"糊"好
      // - 章节图谱节点少 (≤10), fit zoom ≈ 0.9, 不触发, 不影响
      const z = cyRef.zoom()
      if (z < 0.6) {
        cyRef.zoom({
          level: 0.6,
          renderedPosition: { x: cyRef.width() / 2, y: cyRef.height() / 2 }
        })
      }
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

  function clearFocus() {
    if (!cy) return
    cy.elements().removeClass('faded')
  }

  function applyFocus(focusId: string, focusType: 'node' | 'edge') {
    if (!cy) return
    const ele = cy.getElementById(focusId)
    if (ele.empty()) return

    cy.elements().removeClass('faded')

    // 节点 = 自身 + 1 跳邻居 (closedNeighborhood)
    // 边   = 自身 + 两端节点
    let keep: cytoscape.Collection
    if (focusType === 'node') {
      keep = ele.closedNeighborhood()
    } else {
      keep = ele.union(ele.connectedNodes())
    }

    cy.elements().difference(keep).addClass('faded')
  }

  onBeforeUnmount(() => {
    destroy()
  })

  return { init, destroy, resetLayout, getInstance, applyFocus, clearFocus }
}