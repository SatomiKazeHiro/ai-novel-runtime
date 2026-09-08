<template>
  <!-- character -->
  <div v-if="stageName === 'character'" class="sc-result">
    <section
      v-if="(result?.characterStates?.length ?? 0) > 0"
      class="sc-section"
    >
      <header class="sc-section-header">
        <h4 class="sc-section-title">角色状态</h4>
        <span class="sc-count-badge">{{ result.characterStates.length }}</span>
      </header>
      <ul class="sc-list">
        <li
          v-for="(row, i) in result.characterStates"
          :key="i"
          class="sc-list-item"
          :data-accent="row.isNew ? 'new' : 'default'"
        >
          <div class="sc-row-main">
            <strong>{{ row.name }}</strong>
            <code class="sc-key">{{ row.key }}</code>
            <span v-if="row.isNew" class="sc-tag is-new">新增</span>
          </div>
          <div class="sc-row-meta">
            <span class="sc-meta-label">状态</span>
            <code class="sc-json">{{ truncateJson(row.status) }}</code>
          </div>
          <div class="sc-row-meta">
            <span class="sc-meta-label">关系</span>
            <code class="sc-json">{{ truncateJson(row.relationships) }}</code>
          </div>
        </li>
      </ul>
    </section>
    <p v-else class="sc-text-muted">本次未抽到角色状态</p>
  </div>

  <!-- memory -->
  <div v-else-if="stageName === 'memory'" class="sc-result">
    <section v-if="(result?.mainEvents?.length ?? 0) > 0" class="sc-section">
      <header class="sc-section-header">
        <h4 class="sc-section-title">主要事件</h4>
        <span class="sc-count-badge is-hot">{{ result.mainEvents.length }}</span>
      </header>
      <ul class="sc-list">
        <li v-for="(ev, i) in result.mainEvents" :key="`m${i}`" class="sc-list-item">
          <div class="sc-row-main">
            <span class="sc-imp" :data-imp="ev.importance">{{ ev.importance }}</span>
            <span>{{ ev.description }}</span>
          </div>
          <div v-if="ev.participants?.length" class="sc-row-meta">
            <span class="sc-meta-label">参与者</span>
            <span class="sc-chip-row">
              <span v-for="p in ev.participants" :key="p" class="sc-chip">{{ p }}</span>
            </span>
          </div>
        </li>
      </ul>
    </section>

    <section v-if="(result?.sideEvents?.length ?? 0) > 0" class="sc-section">
      <header class="sc-section-header">
        <h4 class="sc-section-title">次要事件</h4>
        <span class="sc-count-badge">{{ result.sideEvents.length }}</span>
      </header>
      <ul class="sc-list">
        <li v-for="(ev, i) in result.sideEvents" :key="`s${i}`" class="sc-list-item">
          <div class="sc-row-main">
            <span class="sc-imp" :data-imp="ev.importance">{{ ev.importance }}</span>
            <span>{{ ev.description }}</span>
          </div>
          <div v-if="ev.participants?.length" class="sc-row-meta">
            <span class="sc-meta-label">参与者</span>
            <span class="sc-chip-row">
              <span v-for="p in ev.participants" :key="p" class="sc-chip">{{ p }}</span>
            </span>
          </div>
        </li>
      </ul>
    </section>

    <section v-if="(result?.scenes?.length ?? 0) > 0" class="sc-section">
      <header class="sc-section-header">
        <h4 class="sc-section-title">场景</h4>
        <span class="sc-count-badge">{{ result.scenes.length }}</span>
      </header>
      <ul class="sc-list">
        <li v-for="(sc, i) in result.scenes" :key="`sc${i}`" class="sc-list-item">
          <div class="sc-row-main">
            <span class="sc-imp" :data-imp="sc.importance">{{ sc.importance }}</span>
            <strong>{{ sc.location }}</strong>
          </div>
          <div class="sc-row-meta">
            <span class="sc-meta-label">事件</span>
            <span>{{ sc.event }}</span>
          </div>
        </li>
      </ul>
    </section>

    <section v-if="result?.summary" class="sc-section">
      <header class="sc-section-header">
        <h4 class="sc-section-title">摘要</h4>
      </header>
      <p class="sc-summary">{{ result.summary }}</p>
    </section>

    <p
      v-if="
        (result?.mainEvents?.length ?? 0) === 0 &&
        (result?.sideEvents?.length ?? 0) === 0 &&
        (result?.scenes?.length ?? 0) === 0 &&
        !result?.summary
      "
      class="sc-text-muted"
    >本次未抽到记忆</p>
  </div>

  <!-- plotArc -->
  <div v-else-if="stageName === 'plotArc'" class="sc-result">
    <section
      v-if="(result?.plotArcs?.length ?? 0) > 0"
      class="sc-section"
    >
      <header class="sc-section-header">
        <h4 class="sc-section-title">剧情弧线</h4>
        <span class="sc-count-badge">{{ result.plotArcs.length }}</span>
      </header>
      <ul class="sc-list">
        <li
          v-for="(arc, i) in result.plotArcs"
          :key="i"
          class="sc-list-item"
          :data-accent="arc.isNew ? 'new' : 'default'"
        >
          <div class="sc-row-main">
            <strong>{{ arc.name }}</strong>
            <span v-if="arc.isNew" class="sc-tag is-new">新增</span>
            <span class="sc-tag" :data-status="arc.status">{{ arc.status }}</span>
            <span class="sc-tag is-type">{{ arc.type === 'main' ? '主线' : arc.type === 'side' ? '支线' : (arc.type || '?') }}</span>
          </div>
          <div class="sc-row-meta">
            <span class="sc-meta-label">进度</span>
            <span class="sc-progress" :data-tone="progressTone(arc.progress)">
              <span class="sc-progress-bar" :style="{ width: `${arc.progress}%` }" />
              <span class="sc-progress-num">{{ arc.progress }}%</span>
            </span>
            <span class="sc-meta-label">当前阶段</span>
            <span>{{ arc.currentStage || '未知' }}</span>
          </div>
        </li>
      </ul>
    </section>
    <p v-else class="sc-text-muted">本次未抽到剧情弧线</p>
  </div>

  <!-- graph -->
  <div v-else-if="stageName === 'graph'" class="sc-result">
    <template v-if="result?.chapterGraph">
      <section class="sc-section">
        <header class="sc-section-header">
          <h4 class="sc-section-title">节点 / 边统计</h4>
          <span class="sc-count-badge">{{ result.chapterGraph.nodes?.length ?? 0 }}</span>
          <span class="sc-meta-label">节点</span>
          <span class="sc-count-badge">{{ result.chapterGraph.edges?.length ?? 0 }}</span>
          <span class="sc-meta-label">边</span>
        </header>

        <!-- 内联 SVG 力导向图 -->
        <div v-if="(result.chapterGraph.nodes?.length ?? 0) > 0" class="sc-graph-frame">
          <svg
            :viewBox="`0 0 ${FORCE_WIDTH} ${FORCE_HEIGHT}`"
            :width="FORCE_WIDTH"
            :height="FORCE_HEIGHT"
            preserveAspectRatio="xMidYMid meet"
            class="sc-graph-svg"
          >
            <!-- Edges -->
            <g class="sc-graph-edges">
              <template v-for="(edge, i) in graphLayout.edges" :key="`edge-${i}`">
                <line
                  v-if="edge.x1 !== undefined"
                  :x1="edge.x1" :y1="edge.y1"
                  :x2="edge.x2" :y2="edge.y2"
                  stroke="var(--color-pebble-border)"
                  stroke-width="1.2"
                />
                <text
                  v-if="edge.x1 !== undefined && edge.midX !== undefined"
                  :x="edge.midX" :y="edge.midY"
                  class="sc-graph-edge-label"
                  text-anchor="middle"
                  dominant-baseline="middle"
                >{{ edge.relation }}</text>
              </template>
            </g>

            <!-- Nodes -->
            <g class="sc-graph-nodes">
              <g
                v-for="(node, i) in graphLayout.nodes"
                :key="`node-${i}`"
                :transform="`translate(${node.x}, ${node.y})`"
              >
                <circle
                  r="18"
                  :fill="node.fill"
                  stroke="var(--color-pure-white)"
                  stroke-width="2"
                />
                <text
                  class="sc-graph-node-label"
                  text-anchor="middle"
                  dominant-baseline="middle"
                  y="0"
                >{{ node.short }}</text>
                <title>{{ node.label }}</title>
              </g>
            </g>
          </svg>
          <div v-if="graphLayout.moreCount > 0" class="sc-graph-more">
            +{{ graphLayout.moreCount }} more (仅展示前 {{ graphLayout.nodes.length }} 个)
          </div>
        </div>

        <!-- 类型图例 -->
        <div v-if="(result.chapterGraph.nodes?.length ?? 0) > 0" class="sc-graph-legend">
          <span
            v-for="legend in graphLegend"
            :key="legend.type"
            class="sc-legend-item"
          >
            <span class="sc-legend-dot" :style="{ background: legend.color }" />
            {{ legend.label }} <span class="sc-legend-count">({{ legend.count }})</span>
          </span>
        </div>
      </section>

      <section v-if="(result.chapterGraph.edges?.length ?? 0) > 0" class="sc-section">
        <header class="sc-section-header">
          <h4 class="sc-section-title">关系列表</h4>
          <span class="sc-count-badge">{{ result.chapterGraph.edges.length }}</span>
        </header>
        <ul class="sc-list sc-list-compact">
          <li
            v-for="(e, i) in (result.chapterGraph.edges || [])"
            :key="`e${i}`"
            class="sc-list-item"
          >
            <code class="sc-edge">
              {{ e.fromType }}:{{ e.fromKey }} <span class="sc-arrow">→</span> {{ e.toType }}:{{ e.toKey }}
              <span v-if="e.relation" class="sc-tag is-relation">{{ e.relation }}</span>
            </code>
          </li>
        </ul>
      </section>

      <p
        v-if="
          (result.chapterGraph.nodes?.length ?? 0) === 0 &&
          (result.chapterGraph.edges?.length ?? 0) === 0
        "
        class="sc-text-muted"
      >本次未抽到本章图谱</p>
    </template>
    <p v-else class="sc-text-muted">本次未抽到本章图谱</p>
  </div>
</template>

<script setup lang="ts">
/**
 * 只读展示 StageCard 的 result 字段。按 stageName 分支渲染
 * character / memory / plotArc / graph 的具体数据。
 *
 * 为什么要单独抽出:StageCard 的 scoped slot 把 result 类型推导成
 * `unknown`,父组件模板上访问属性会被 vue-tsc 拒绝。把 result 接进
 * `defineProps<{ result: any }>()` 后,子组件内部访问就是合法 `any`。
 *
 * 这是 ReviewingPanel 的内部展示组件,不属于 StageCard 接口。
 */
import { computed } from 'vue'

const props = defineProps<{
  stageName: 'character' | 'memory' | 'plotArc' | 'graph'
  result: any
}>()

/**
 * 把后端 JSON 字符串字段(status / relationships)安全截断展示。
 * - 已经是对象 → 直接走 JSON.stringify
 * - 是字符串 → 尝试 parse;parse 失败时退回原串
 * - null/undefined → 返回空串
 * - 截断到 240 字符,避免卡片被超长 JSON 撑爆
 */
function truncateJson(value: unknown, max = 240): string {
  if (value === null || value === undefined) return ''
  let text: string
  if (typeof value === 'string') {
    try {
      text = JSON.stringify(JSON.parse(value))
    } catch {
      text = value
    }
  } else {
    text = JSON.stringify(value)
  }
  if (text.length > max) text = text.slice(0, max) + '…'
  return text
}

/**
 * progressTone: 进度条用色
 * - 进度 >= 70% → sage (positive,接近完成)
 * - 进度 >= 30% → blueprint (cool-accent,进行中)
 * - 进度 <  30% → terracotta (warm-accent,刚刚开始)
 */
function progressTone(progress: number): 'high' | 'mid' | 'low' {
  if (progress >= 70) return 'high'
  if (progress >= 30) return 'mid'
  return 'low'
}

/* ============================================================================
 * 内联 SVG 力导向图:无依赖实现
 * ----------------------------------------------------------------------------
 * 输入: result.chapterGraph.nodes 与 edges (GraphNode / GraphEdge 形状)
 * 算法: 节点初始化为网格 + 随机扰动;迭代 N 次,每步施加
 *       - 节点间库仑斥力 (repulsion)
 *       - 边连接的弹簧引力 (spring)
 *       - 中心向心力 (centering,避免整体飘到画外)
 *       - 边界软约束 (boundary)
 * 收敛后输出 SVG-friendly { x, y } 坐标。
 *
 * 入口:    forceLayout()        — 同步计算所有节点坐标与边端点
 * 主迭代:  ITERATIONS = 80      — 50–100 范围中位;经验值,够 25 节点收敛
 *
 * 调参点:
 *   - ITERATIONS    迭代次数 (收敛速度)
 *   - REPULSION_K   斥力强度 (越大越分散)
 *   - SPRING_LEN    弹簧自然长度 (越大节点间距越大)
 *   - SPRING_K      弹簧刚度
 *   - CENTER_K      中心向心强度
 *   - MAX_VELOCITY  速度上限 (防止飞出)
 * ========================================================================== */

const FORCE_WIDTH = 600
const FORCE_HEIGHT = 320
const MAX_NODES_RENDERED = 25

interface GraphNodeRaw {
  type: string
  key: string
  label?: string
  data?: Record<string, unknown>
}
interface GraphEdgeRaw {
  fromType: string
  fromKey: string
  toType: string
  toKey: string
  relation?: string
}

interface LaidOutNode {
  id: string
  type: string
  label: string
  short: string
  fill: string
  x: number
  y: number
}
interface LaidOutEdge {
  x1: number
  y1: number
  x2: number
  y2: number
  midX: number
  midY: number
  relation: string
}
interface GraphLayout {
  nodes: LaidOutNode[]
  edges: LaidOutEdge[]
  moreCount: number
}

const TYPE_COLOR: Record<string, string> = {
  character: 'var(--color-cool-accent)',
  faction: 'var(--color-review)',
  event: 'var(--color-warm-accent)',
  item: 'var(--color-mid-gray)'
}
const TYPE_LABEL: Record<string, string> = {
  character: '角色',
  faction: '阵营',
  event: '事件',
  item: '物品'
}

/**
 * 极简力导向布局:固定迭代次数同步求解。轻量、零依赖。
 *
 * 工作流程:
 *   1. 把输入节点列表标准化为 internal state (id, x, y, vx, vy)
 *   2. 初始化:网格放置 + 随机扰动,保证从非退化构型起步
 *   3. 迭代 ITERATIONS 次:
 *        a. 对每对节点施加 REPULSION_K / d^2 斥力
 *        b. 对每条边施加 -SPRING_K * (d - SPRING_LEN) 弹簧力
 *        c. 每个节点施加 -CENTER_K * x → 向心力
 *        d. 阻尼 + velocity clipping
 *        e. 把节点夹回画布内 [margin, dim-margin]
 *   4. 把 internal state 投影成 {x, y} 用于 SVG 渲染
 *
 * 计算量: O(N^2 * ITER) — N=25 时单机 < 几毫秒,可同步。
 */
function forceLayout(
  rawNodes: GraphNodeRaw[],
  rawEdges: GraphEdgeRaw[]
): GraphLayout {
  if (!rawNodes || rawNodes.length === 0) {
    return { nodes: [], edges: [], moreCount: 0 }
  }

  const total = rawNodes.length
  const moreCount = Math.max(0, total - MAX_NODES_RENDERED)
  const nodes = rawNodes.slice(0, MAX_NODES_RENDERED)

  // 1) 标准化 + 初始位置(环形 + 随机扰动)
  const margin = 32
  const cx = FORCE_WIDTH / 2
  const cy = FORCE_HEIGHT / 2
  const ringR = Math.min(FORCE_WIDTH, FORCE_HEIGHT) * 0.35

  interface InternalNode extends LaidOutNode {
    vx: number
    vy: number
  }
  const state: InternalNode[] = nodes.map((n, i) => {
    const angle = (2 * Math.PI * i) / nodes.length
    const jitter = (Math.random() - 0.5) * 12
    const x = cx + Math.cos(angle) * ringR + jitter
    const y = cy + Math.sin(angle) * ringR + jitter
    const type = (n.type || 'item').toLowerCase()
    return {
      id: `${n.type}:${n.key}`,
      type,
      label: n.label || `${n.type}:${n.key}`,
      short: shortLabel(n),
      fill: TYPE_COLOR[type] || TYPE_COLOR.item,
      x,
      y,
      vx: 0,
      vy: 0
    }
  })

  const idIndex = new Map<string, number>()
  state.forEach((s, i) => idIndex.set(s.id, i))

  // 边列表(仅引用两端 index)
  const edges = rawEdges
    .map(e => {
      const a = idIndex.get(`${e.fromType}:${e.fromKey}`)
      const b = idIndex.get(`${e.toType}:${e.toKey}`)
      if (a === undefined || b === undefined || a === b) return null
      return { a, b, relation: e.relation || '' }
    })
    .filter((x): x is { a: number; b: number; relation: string } => x !== null)

  // 2) 力导向迭代
  const ITERATIONS = 80
  const REPULSION_K = 1800
  const SPRING_LEN = 90
  const SPRING_K = 0.04
  const CENTER_K = 0.012
  const DAMPING = 0.82
  const MAX_VELOCITY = 8

  for (let iter = 0; iter < ITERATIONS; iter++) {
    // (a) 节点间斥力 — O(N^2)
    for (let i = 0; i < state.length; i++) {
      for (let j = i + 1; j < state.length; j++) {
        const ni = state[i]
        const nj = state[j]
        let dx = ni.x - nj.x
        let dy = ni.y - nj.y
        let d2 = dx * dx + dy * dy
        if (d2 < 0.01) {
          // 完全重合 → 加一点扰动避免除零
          dx = (Math.random() - 0.5) * 0.5
          dy = (Math.random() - 0.5) * 0.5
          d2 = dx * dx + dy * dy + 0.01
        }
        const d = Math.sqrt(d2)
        const force = REPULSION_K / d2
        const fx = (dx / d) * force
        const fy = (dy / d) * force
        ni.vx += fx
        ni.vy += fy
        nj.vx -= fx
        nj.vy -= fy
      }
    }

    // (b) 弹簧(引力) — 仅遍历边
    for (const edge of edges) {
      const ni = state[edge.a]
      const nj = state[edge.b]
      const dx = nj.x - ni.x
      const dy = nj.y - ni.y
      const d = Math.sqrt(dx * dx + dy * dy) || 0.01
      const stretch = d - SPRING_LEN
      const fx = (dx / d) * stretch * SPRING_K
      const fy = (dy / d) * stretch * SPRING_K
      ni.vx += fx
      ni.vy += fy
      nj.vx -= fx
      nj.vy -= fy
    }

    // (c) 中心向心力
    for (const n of state) {
      n.vx += (cx - n.x) * CENTER_K
      n.vy += (cy - n.y) * CENTER_K
    }

    // (d) 速度积分 + 阻尼 + clipping
    for (const n of state) {
      n.vx *= DAMPING
      n.vy *= DAMPING
      const sp = Math.sqrt(n.vx * n.vx + n.vy * n.vy)
      if (sp > MAX_VELOCITY) {
        n.vx = (n.vx / sp) * MAX_VELOCITY
        n.vy = (n.vy / sp) * MAX_VELOCITY
      }
      n.x += n.vx
      n.y += n.vy

      // (e) 边界软约束(节点半径 18)
      const minX = margin
      const maxX = FORCE_WIDTH - margin
      const minY = margin
      const maxY = FORCE_HEIGHT - margin
      if (n.x < minX) n.x = minX
      if (n.x > maxX) n.x = maxX
      if (n.y < minY) n.y = minY
      if (n.y > maxY) n.y = maxY
    }
  }

  // 3) 把 state 投影为渲染输出(去掉 vx/vy)
  const laidOutNodes: LaidOutNode[] = state.map(({ vx, vy, ...rest }) => rest)

  // 4) 边端点投影 + relation 文字位置(取中点)
  const laidOutEdges: LaidOutEdge[] = edges.map(edge => {
    const a = laidOutNodes[edge.a]
    const b = laidOutNodes[edge.b]
    return {
      x1: a.x,
      y1: a.y,
      x2: b.x,
      y2: b.y,
      midX: (a.x + b.x) / 2,
      midY: (a.y + b.y) / 2,
      relation: edge.relation
    }
  })

  return { nodes: laidOutNodes, edges: laidOutEdges, moreCount }
}

/**
 * 节点 label 截短:超过 4 字符时取前 4 字符 + "…"。
 * 用于叠加在 circle 上,不指望完整 label 在 circle 内显示。
 */
function shortLabel(n: GraphNodeRaw): string {
  const raw = n.label || n.key || `${n.type}`
  return raw.length > 4 ? raw.slice(0, 4) + '…' : raw
}

/**
 * graphLayout = computed forceLayout(result.chapterGraph) —
 * 这个 computed 在 result 变化时自动重跑,可保证用户在编辑 pendingArchiveData
 * 后看到 SVG 重新布局。
 */
const graphLayout = computed<GraphLayout>(() => {
  if (props.stageName !== 'graph' || !props.result?.chapterGraph) {
    return { nodes: [], edges: [], moreCount: 0 }
  }
  return forceLayout(
    props.result.chapterGraph.nodes || [],
    props.result.chapterGraph.edges || []
  )
})

const graphLegend = computed(() => {
  if (props.stageName !== 'graph') return []
  const counts = new Map<string, number>()
  for (const n of props.result?.chapterGraph?.nodes || []) {
    const t = (n.type || 'item').toLowerCase()
    counts.set(t, (counts.get(t) || 0) + 1)
  }
  // 按 TYPE_LABEL / TYPE_COLOR 已知的顺序输出
  return ['character', 'faction', 'event', 'item']
    .filter(t => counts.has(t))
    .map(t => ({
      type: t,
      label: TYPE_LABEL[t] || t,
      color: TYPE_COLOR[t],
      count: counts.get(t) || 0
    }))
})
</script>

<style scoped>
.sc-result {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

/* section 容器:左 border + 背景区分 */
.sc-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  background: var(--bg-section, var(--color-stone-gray));
  border: 1px solid var(--border-subtle);
  border-left: 3px solid var(--color-cool-accent);
  border-radius: var(--radius-card);
}

/* section 头部:左侧小标题 + 右侧计数 badge */
.sc-section-header {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding-bottom: var(--space-2);
  border-bottom: 1px dashed var(--border-default);
}
.sc-section-title {
  margin: 0;
  font-size: 12px;
  font-weight: var(--weight-semibold);
  color: var(--text-secondary);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

/* 计数 badge:左侧小色块 */
.sc-count-badge {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  padding: 1px 8px;
  border-radius: var(--radius-pill, 9999px);
  background: var(--color-stone-gray-pressed, #d4d4d2);
  color: var(--text-secondary);
}
.sc-count-badge.is-hot {
  background: var(--color-warm-accent-tint);
  color: var(--color-warm-accent);
}

.sc-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.sc-list-compact {
  gap: 4px;
}

.sc-list-item {
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-input, 6px);
  background: var(--color-canvas);
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 13px;
}

/* 新增项用绿色左边框强调 */
.sc-list-item[data-accent="new"] {
  border-left: 3px solid var(--color-positive);
}

.sc-row-main {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.sc-row-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-tertiary);
  flex-wrap: wrap;
}

.sc-meta-label {
  font-weight: var(--weight-semibold);
  color: var(--text-secondary);
}

.sc-key,
.sc-json,
.sc-node,
.sc-edge {
  font-family: var(--font-mono);
  font-size: 12px;
  background: var(--color-stone-gray);
  padding: 1px 6px;
  border-radius: 4px;
}

.sc-json {
  word-break: break-all;
}

.sc-tag {
  font-size: 11px;
  font-weight: 600;
  padding: 1px 8px;
  border-radius: var(--radius-badge);
  background: var(--color-stone-gray);
  color: var(--text-secondary);
  letter-spacing: 0.02em;
}

.sc-tag.is-new {
  background: var(--color-positive);
  color: #ffffff;
}

.sc-tag.is-type {
  background: var(--color-cool-accent-tint);
  color: var(--color-cool-accent);
}

.sc-tag.is-relation {
  background: var(--color-warm-accent-tint);
  color: var(--color-warm-accent);
  font-family: var(--font-mono);
  font-weight: 500;
}

.sc-tag[data-status="active"] {
  background: var(--color-positive-tint);
  color: var(--color-positive);
}
.sc-tag[data-status="resolving"],
.sc-tag[data-status="closed"] {
  background: var(--color-warm-accent-tint);
  color: var(--color-warm-accent);
}
.sc-tag[data-status="stale"] {
  background: var(--color-cool-accent-tint);
  color: var(--color-cool-accent);
}

/* 参与者 chip 列表 */
.sc-chip-row {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 4px;
}
.sc-chip {
  font-size: 11px;
  padding: 1px 8px;
  border-radius: var(--radius-badge);
  background: var(--color-cool-accent-tint);
  color: var(--color-cool-accent);
  font-family: var(--font-mono);
}

.sc-imp {
  display: inline-block;
  min-width: 22px;
  text-align: center;
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: var(--weight-semibold);
  padding: 1px 6px;
  border-radius: var(--radius-badge);
  background: var(--color-stone-gray);
}
.sc-imp[data-imp="8"],
.sc-imp[data-imp="9"],
.sc-imp[data-imp="10"] {
  background: var(--color-positive-tint);
  color: var(--color-positive);
}
.sc-imp[data-imp="6"],
.sc-imp[data-imp="7"] {
  background: var(--color-warm-accent-tint);
  color: var(--color-warm-accent);
}

/* 进度条 */
.sc-progress {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  flex: 0 0 140px;
  height: 16px;
  padding: 0 6px;
  border-radius: var(--radius-pill, 9999px);
  background: var(--color-stone-gray);
  overflow: hidden;
}
.sc-progress-bar {
  position: absolute;
  inset: 0 auto 0 0;
  height: 100%;
  border-radius: var(--radius-pill, 9999px);
  transition: width 0.3s ease;
}
.sc-progress[data-tone="high"] .sc-progress-bar { background: var(--color-positive); }
.sc-progress[data-tone="mid"]  .sc-progress-bar { background: var(--color-cool-accent); }
.sc-progress[data-tone="low"]  .sc-progress-bar { background: var(--color-warm-accent); }
.sc-progress-num {
  position: relative;
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  color: var(--color-pure-white);
  mix-blend-mode: difference;
  z-index: 1;
}

/* 摘要:左侧粗 border */
.sc-summary {
  margin: 0;
  font-size: 13px;
  color: var(--text-secondary);
  border-left: 3px solid var(--color-cool-accent);
  padding: var(--space-2) var(--space-3);
  background: var(--color-pure-white);
  border-radius: 0 var(--radius-card) var(--radius-card) 0;
}

.sc-text-muted {
  margin: 0;
  font-size: 13px;
  color: var(--text-tertiary);
}

/* === 内联 SVG 力导向图 === */
.sc-graph-frame {
  position: relative;
  background: var(--color-pure-white);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-card);
  padding: var(--space-2);
  overflow: hidden;
}
.sc-graph-svg {
  display: block;
  width: 100%;
  height: 320px;
  max-width: 100%;
}
.sc-graph-node-label {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 600;
  fill: var(--color-pure-white);
  pointer-events: none;
}
.sc-graph-edge-label {
  font-family: var(--font-mono);
  font-size: 9px;
  fill: var(--text-tertiary);
  paint-order: stroke;
  stroke: var(--color-pure-white);
  stroke-width: 3;
  stroke-linejoin: round;
  pointer-events: none;
}
.sc-graph-more {
  margin-top: var(--space-2);
  text-align: center;
  font-size: 11px;
  color: var(--text-tertiary);
  font-family: var(--font-mono);
}

.sc-graph-legend {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  font-size: 12px;
  color: var(--text-secondary);
  padding: var(--space-2) 0 0;
}
.sc-legend-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.sc-legend-dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 2px solid var(--color-pure-white);
  box-shadow: 0 0 0 1px var(--border-subtle);
}
.sc-legend-count {
  font-family: var(--font-mono);
  color: var(--text-tertiary);
}

/* 边列表里的箭头 */
.sc-arrow {
  color: var(--color-cool-accent);
  margin: 0 4px;
  font-weight: 700;
}
</style>
