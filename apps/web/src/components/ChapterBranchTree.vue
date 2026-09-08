<template>
  <div class="branch-list">
    <!-- 左侧 SVG 分叉树 -->
    <svg
      class="tree-svg"
      :width="svgWidth"
      :height="flatList.length * ITEM_HEIGHT + Math.max(0, flatList.length - 1) * GAP"
    >
      <!-- 连接线 -->
      <g v-for="line in svgLines" :key="line.key">
        <path :d="line.d" :stroke="line.color" class="link-line" fill="none" />
      </g>
      <!-- 节点圆点 -->
      <g v-for="node in flatList" :key="node.id">
        <circle
          v-if="node.branchRootId === null"
          :cx="getNodeX(node)"
          :cy="getNodeY(node)"
          r="5"
          :fill="getNodeColor(node)"
          style="stroke: var(--color-pure-white); stroke-width: 2"
          class="node-dot node-dot--main"
        />
        <circle
          v-else
          :cx="getNodeX(node)"
          :cy="getNodeY(node)"
          r="3.5"
          :fill="var_fill(node)"
          style="stroke: var(--color-pure-white); stroke-width: 2"
          class="node-dot"
        />
      </g>
    </svg>

    <!-- 右侧章节列表 -->
    <div class="list-rows">
      <div
        v-for="(node, index) in flatList"
        :key="node.id"
        class="list-row cap-rise"
        :data-status="node.status"
        :data-mainline="node.branchRootId === null ? 'true' : 'false'"
        :style="{
          height: ITEM_HEIGHT + 'px',
          marginBottom: (index < flatList.length - 1 ? GAP : 0) + 'px',
          animationDelay: Math.min(index, 12) * 0.035 + 's',
          '--row-color': getRowColor(node),
          '--row-spine': getSpineColor(node)
        }"
      >
        <!-- 左侧编号徽章 -->
        <div class="row-id">
          <span class="row-id__bracket">[</span>
          <span class="row-id__num">{{ formatNumberShort(node.number) }}</span>
          <span class="row-id__bracket">]</span>
        </div>

        <!-- 主体信息 -->
        <div class="row-main">
          <div class="row-title">
            <span class="row-title__text">{{ node.title }}</span>
            <span v-if="node.isSideStory" class="row-tag row-tag--branch">番外</span>
            <!-- <span class="row-title__spacer" /> -->
            <ChapterStatusBadge :status="node.status" />
          </div>
          <div class="row-meta">
            <template v-if="node.status === 'archived' && archivedPreview(node)">
              <n-tooltip placement="top" :delay="400">
                <template #trigger>
                  <span class="row-preview">{{ truncate(archivedPreview(node), 80) }}</span>
                </template>
                <div class="row-preview-tooltip">{{ truncate(archivedPreview(node), 300) }}</div>
              </n-tooltip>
              <span v-if="node.runtimeProfile" class="row-meta__sep">·</span>
            </template>
            <span v-if="node.runtimeProfile" class="row-meta__profile">{{ node.runtimeProfile.name }}</span>
          </div>
        </div>

        <!-- 右侧动作 -->
        <div class="row-actions">
          <button
            v-if="canDevelop(node)"
            class="cap-pill is-sm is-primary"
            @click.stop="$emit('develop', node)"
          >发展</button>
          <button
            v-if="canEdit(node)"
            class="cap-pill is-sm is-ghost"
            @click.stop="$emit('edit', node)"
          >编辑</button>
          <button
            v-if="canView(node)"
            class="cap-pill is-sm is-ghost"
            @click.stop="$emit('view', node)"
          >查看</button>
          <button
            v-if="canDelete(node)"
            class="cap-pill is-sm is-danger"
            @click.stop="$emit('delete', node)"
          >删除</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { NTooltip } from 'naive-ui'
import { COLOR } from '../styles/tokens'
import { getChapterPreview } from '../styles/chapter-status'
import ChapterStatusBadge from './ChapterStatusBadge.vue'

const ITEM_HEIGHT = 64
const GAP = 10
const COL_WIDTH = 22

// boords warm palette: main = terracotta; branches = 7 muted, storyboard-friendly hues
// These values are consumed both by SVG attribute bindings (:fill, :stroke)
// and by Vue :style custom properties (--row-color, --row-spine) — neither
// path supports var() refs, so we use hex from tokens.ts. Branch hues 1–5
// are storyboard-specific artistic colors; 6–7 are aliases for the system
// tokens so theme changes flow through automatically.
const MAIN_COLOR = COLOR.warmAccent
const BRANCH_COLORS = [
  COLOR.warmAccentHover, // deep terracotta
  '#8a6914',             // ochre
  '#7a4a2a',             // sienna
  '#6a7a3a',             // olive
  '#3a6a4a',             // forest
  COLOR.positive,        // sage
  COLOR.coolAccent       // slate
]

interface TreeNode {
  id: string
  number: number
  title: string
  status: string
  isSideStory?: boolean
  runtimeProfile?: { name: string } | null
  /** 摘要 / 大纲, 仅 archived 状态在列表行展示 1 行预览 + 悬浮 tooltip 全文 300 字 */
  summary?: string | null
  outline?: string | null
  createdAt: string
  parentChapterId?: string | null
  children?: TreeNode[]
}

interface FlatNode extends TreeNode {
  parentId: string | null
  rowIndex: number
  col: number
  hasChildren: boolean
  branchRootId: string | null
}

const props = defineProps<{
  treeData: TreeNode[]
}>()

defineEmits<{
  (e: 'develop', node: TreeNode): void
  (e: 'edit', node: TreeNode): void
  (e: 'view', node: TreeNode): void
  (e: 'delete', node: TreeNode): void
}>()

// 1. 扁平化树
const flatList = computed(() => {
  const allNodes: Omit<FlatNode, 'rowIndex' | 'col' | 'hasChildren' | 'branchRootId'>[] = []
  const childrenSet = new Set<string>()

  function walk(nodes: TreeNode[], parentId: string | null = null) {
    for (const node of nodes) {
      allNodes.push({
        ...node,
        parentId: node.parentChapterId ?? parentId,
        children: undefined
      })
      if (node.children && node.children.length > 0) {
        childrenSet.add(node.id)
        walk(node.children, node.id)
      }
    }
  }

  walk(props.treeData)
  allNodes.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
  const mainBranch = findMainBranch(allNodes)

  const nodeMap = new Map(allNodes.map(n => [n.id, n]))
  const branchRootMap = new Map<string, string | null>()
  for (const node of allNodes) {
    branchRootMap.set(node.id, getBranchRoot(node, mainBranch, nodeMap))
  }
  const colMap = assignColumns(allNodes, mainBranch, branchRootMap)
  const result: FlatNode[] = allNodes.map((node, index) => ({
    ...node,
    rowIndex: index,
    col: colMap.get(node.id) ?? 0,
    hasChildren: childrenSet.has(node.id),
    branchRootId: branchRootMap.get(node.id) ?? null
  }))
  return result
})

function findMainBranch(
  nodes: Array<{ id: string; parentId: string | null; createdAt: string }>
): Set<string> {
  const mainBranch = new Set<string>()
  const roots = nodes
    .filter(n => !n.parentId)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
  if (roots.length === 0) return mainBranch
  let current = roots[0]
  while (current) {
    mainBranch.add(current.id)
    const children = nodes
      .filter(n => n.parentId === current.id)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    current = children[0]
  }
  return mainBranch
}

function getBranchRoot(
  node: { id: string; parentId: string | null },
  mainBranch: Set<string>,
  nodeMap: Map<string, { id: string; parentId: string | null }>
): string | null {
  if (mainBranch.has(node.id)) return null
  if (!node.parentId) return node.id
  const parent = nodeMap.get(node.parentId)
  if (!parent) return node.id
  if (mainBranch.has(parent.id)) return node.id
  return getBranchRoot(parent, mainBranch, nodeMap)
}

function assignColumns(
  nodes: Array<{ id: string; parentId: string | null }>,
  mainBranch: Set<string>,
  branchRootMap: Map<string, string | null>
): Map<string, number> {
  const colMap = new Map<string, number>()
  const branchColMap = new Map<string, number>()
  for (const node of nodes) {
    if (mainBranch.has(node.id)) {
      colMap.set(node.id, 0)
      continue
    }
    if (!node.parentId) {
      colMap.set(node.id, 1)
      continue
    }
    const parentCol = colMap.get(node.parentId) ?? 0
    if (parentCol === 0) {
      const rootId = branchRootMap.get(node.id)
      if (rootId && !branchColMap.has(rootId)) {
        branchColMap.set(rootId, branchColMap.size + 1)
      }
      colMap.set(node.id, rootId ? (branchColMap.get(rootId) ?? 1) : 1)
    } else {
      colMap.set(node.id, parentCol)
    }
  }
  return colMap
}

const svgWidth = computed(() => {
  const maxCol = flatList.value.reduce((max, n) => Math.max(max, n.col), 0)
  return 14 + maxCol * COL_WIDTH + 14
})

function getNodeX(node: FlatNode) {
  return 14 + node.col * COL_WIDTH
}
function getNodeY(node: FlatNode) {
  return node.rowIndex * (ITEM_HEIGHT + GAP) + ITEM_HEIGHT / 2
}

function getNodeColor(node: FlatNode) {
  if (node.branchRootId) {
    const branchRoots = [...new Set(flatList.value.map(n => n.branchRootId).filter(Boolean))]
    const idx = branchRoots.indexOf(node.branchRootId)
    return BRANCH_COLORS[(idx + 0) % BRANCH_COLORS.length]
  }
  return MAIN_COLOR
}

function getRowColor(node: FlatNode) {
  return node.branchRootId === null ? MAIN_COLOR : getNodeColor(node)
}

function getSpineColor(node: FlatNode) {
  if (node.status === 'archived') return MAIN_COLOR
  if (node.status === 'reviewing') return COLOR.chapterReviewing
  return getRowColor(node)
}

function var_fill(node: FlatNode) {
  return getNodeColor(node)
}

const svgLines = computed(() => {
  const lines: { key: string; d: string; color: string }[] = []
  const R = 6
  const DOWN = 12
  for (const node of flatList.value) {
    if (!node.parentId) continue
    const parent = flatList.value.find(n => n.id === node.parentId)
    if (!parent) continue
    const px = getNodeX(parent)
    const py = getNodeY(parent)
    const cx = getNodeX(node)
    const cy = getNodeY(node)
    const color = getNodeColor(node)
    if (parent.col === node.col) {
      lines.push({
        key: `link-${parent.id}-${node.id}`,
        d: `M ${px},${py + 5} L ${cx},${cy - 5}`,
        color
      })
    } else {
      const goingRight = cx > px
      const bendY = py + DOWN
      if (goingRight) {
        lines.push({
          key: `link-${parent.id}-${node.id}`,
          d: `M ${px},${py + 5}`
            + ` L ${px},${bendY - R}`
            + ` Q ${px},${bendY} ${px + R},${bendY}`
            + ` L ${cx - R},${bendY}`
            + ` Q ${cx},${bendY} ${cx},${bendY + R}`
            + ` L ${cx},${cy - 5}`,
          color
        })
      } else {
        lines.push({
          key: `link-${parent.id}-${node.id}`,
          d: `M ${px},${py + 5}`
            + ` L ${px},${bendY - R}`
            + ` Q ${px},${bendY} ${px - R},${bendY}`
            + ` L ${cx + R},${bendY}`
            + ` Q ${cx},${bendY} ${cx},${bendY + R}`
            + ` L ${cx},${cy - 5}`,
          color
        })
      }
    }
  }
  return lines
})

function formatNumberShort(n: number) {
  if (Number.isInteger(n)) {
    return n.toString().padStart(2, '0')
  }
  return n.toFixed(2)
}

function archivedPreview(node: TreeNode): string {
  return getChapterPreview(node)
}

function truncate(text: string, max: number): string {
  if (!text) return ''
  return text.length > max ? text.slice(0, max) + '…' : text
}

function canDevelop(node: FlatNode) {
  return node.status === 'archived'
}
function canEdit(node: FlatNode) {
  // v2: draft / reviewing 可编辑; archived 只读
  return ['draft', 'reviewing'].includes(node.status)
}
function canView(node: FlatNode) {
  return node.status === 'archived'
}
function canDelete(node: FlatNode) {
  if (node.status === 'archived') {
    return !node.hasChildren
  }
  return true
}
</script>

<style scoped>
.branch-list {
  display: flex;
  font-family: var(--font-sans);
  position: relative;
}

.tree-svg {
  flex-shrink: 0;
  overflow: visible;
}
.link-line {
  stroke-width: 1.5;
  stroke-linecap: round;
  stroke-linejoin: round;
  opacity: 0.55;
}
.node-dot--main {
  filter: drop-shadow(0 0 2px rgba(184, 88, 30, 0.45));
}

.list-rows {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.list-row {
  display: flex;
  align-items: stretch;
  cursor: pointer;
  position: relative;
  border-radius: var(--radius-card);
  background: var(--color-pure-white);
  border: 1px solid var(--border-default);
  overflow: hidden;
  transition:
    background 0.18s ease,
    border-color 0.18s ease,
    transform 0.18s ease;
}
.list-row::before {
  content: '';
  width: 3px;
  flex-shrink: 0;
  background: var(--row-spine, var(--border-default));
  transition: background 0.2s ease;
}

.list-row:hover {
  border-color: var(--color-mid-gray);
  transform: translateX(2px);
}

.list-row.active {
  border-color: var(--row-color, var(--accent));
  background: color-mix(in srgb, var(--row-color, var(--accent)) 7%, var(--color-pure-white));
}
.list-row.active::before {
  background: var(--row-color, var(--accent));
}

.row-id {
  width: 92px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 var(--space-3);
  font-family: var(--font-mono);
  font-size: 12px;
  letter-spacing: 0.04em;
  border-right: 1px solid var(--border-default);
  background: var(--color-stone-gray);
}
.row-id__bracket {
  color: var(--color-mid-gray);
  margin: 0 2px;
  font-weight: var(--weight-regular);
}
.row-id__num {
  color: var(--row-color, var(--accent));
  font-variant-numeric: tabular-nums lining-nums;
  font-weight: var(--weight-semibold);
}

.row-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 4px;
  padding: 0 var(--space-4);
  overflow: hidden;
}
.row-title {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  min-width: 0;
}
.row-title__text {
  font-size: 14px;
  font-weight: var(--weight-semibold);
  color: var(--color-ink-black);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex-shrink: 0;
  max-width: 60%;
}
.list-row[data-mainline="false"] .row-title__text {
  color: var(--color-graphite);
  font-weight: var(--weight-medium);
}
.row-title__spacer {
  flex: 1;
  min-width: var(--space-2);
}

.row-meta {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: 12px;
  color: var(--text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  min-width: 0;
}
.row-meta__sep { opacity: 0.5; flex-shrink: 0; }
.row-meta__profile {
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.04em;
  color: var(--color-graphite);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex-shrink: 0;
}

.row-preview {
  font-family: var(--font-sans);
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  min-width: 0;
}
.row-preview-tooltip {
  max-width: 360px;
  font-size: 13px;
  line-height: 1.6;
  white-space: normal;
  color: inherit;
}

.row-tag {
  display: inline-flex;
  align-items: center;
  height: 18px;
  padding: 0 8px;
  border-radius: var(--radius-badge);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: var(--weight-semibold);
  letter-spacing: 0.04em;
  line-height: 1;
  flex-shrink: 0;
  background: var(--color-warm-accent-tint);
  color: var(--accent);
  border: 1px solid transparent;
}

.row-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-right: var(--space-3);
  flex-shrink: 0;
}
.row-actions .cap-pill {
  height: 28px;
  padding: 0 12px;
  font-size: 12px;
}

@media (max-width: 760px) {
  .row-id { width: 72px; padding: 0 var(--space-2); }
  .row-main { padding: 0 var(--space-3); }
  .row-title__text { max-width: 50%; }
  .row-actions { padding-right: var(--space-2); gap: 4px; }
  .row-actions .cap-pill { height: 26px; padding: 0 8px; font-size: 11px; }
}
</style>
