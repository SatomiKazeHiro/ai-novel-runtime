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
          :cx="getNodeX(node)"
          :cy="getNodeY(node)"
          r="4"
          :fill="getNodeColor(node)"
          stroke="#fff"
          stroke-width="2"
        />
      </g>
    </svg>

    <!-- 右侧章节列表 -->
    <div class="list-rows">
      <div
        v-for="(node, index) in flatList"
        :key="node.id"
        class="list-row"
        :class="{ active: selectedId === node.id }"
        :style="{ height: ITEM_HEIGHT + 'px', marginBottom: (index < flatList.length - 1 ? GAP : 0) + 'px' }"
        @click="$emit('select', node)"
      >
        <div
          class="node-card"
          :class="{ archived: node.status === 'archived', selected: node.status === 'selected' }"
        >
          <div class="node-main">
            <div class="node-header">
              <n-text strong class="node-title">{{ node.title }}</n-text>
              <n-tag v-if="node.isSideStory" size="tiny" type="warning">番外</n-tag>
              <n-tag size="tiny" :type="statusTagType(node.status)">{{ node.status }}</n-tag>
            </div>
            <div class="node-meta">
              <n-text depth="3" style="font-size: 12px">
                {{ formatNumber(node.number) }}
                <span v-if="node.runtimeProfile">· {{ node.runtimeProfile.name }}</span>
              </n-text>
            </div>
          </div>
          <div class="node-actions">
            <n-button
              v-if="canDevelop(node)"
              size="tiny"
              type="primary"
              @click.stop="$emit('develop', node)"
            >发展</n-button>
            <n-button
              v-if="canEdit(node)"
              size="tiny"
              @click.stop="$emit('edit', node)"
            >编辑</n-button>
            <n-button
              v-if="canView(node)"
              size="tiny"
              @click.stop="$emit('view', node)"
            >查看</n-button>
            <n-button
              v-if="canDelete(node)"
              size="tiny"
              type="error"
              @click.stop="$emit('delete', node)"
            >删除</n-button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { NText, NTag, NButton } from 'naive-ui'

const ITEM_HEIGHT = 56
const GAP = 8
const COL_WIDTH = 20

// 分支颜色（主分支 + 7 个分支色）
const BRANCH_COLORS = [
  '#52c41a', // 0: 主线 - 绿
  '#1890ff', // 1: 分支1 - 蓝
  '#fa8c16', // 2: 分支2 - 橙
  '#eb2f96', // 3: 分支3 - 粉
  '#722ed1', // 4: 分支4 - 紫
  '#13c2c2', // 5: 分支5 - 青
  '#f5222d', // 6: 分支6 - 红
  '#2f54eb', // 7: 分支7 - 深蓝
]

interface TreeNode {
  id: string
  number: number
  title: string
  status: string
  isSideStory?: boolean
  runtimeProfile?: { name: string } | null
  createdAt: string
  parentChapterId?: string | null
  children?: TreeNode[]
}

interface FlatNode extends TreeNode {
  parentId: string | null
  rowIndex: number
  col: number
  hasChildren: boolean
  branchRootId: string | null // 所属分支的根节点（主分支为 null）
}

const props = defineProps<{
  treeData: TreeNode[]
  selectedId?: string
}>()

defineEmits<{
  (e: 'select', node: TreeNode): void
  (e: 'develop', node: TreeNode): void
  (e: 'edit', node: TreeNode): void
  (e: 'view', node: TreeNode): void
  (e: 'delete', node: TreeNode): void
}>()

// 1. 扁平化树，收集 parentId 和 hasChildren
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

  // 2. 按创建时间全局排序（时间线视图）
  allNodes.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())

  // 3. 计算主分支（从根出发，每次选 createdAt 最早的子节点）
  const mainBranch = findMainBranch(allNodes)

  // 4. 计算每个节点的分支根
  const nodeMap = new Map(allNodes.map(n => [n.id, n]))
  const branchRootMap = new Map<string, string | null>()
  for (const node of allNodes) {
    branchRootMap.set(node.id, getBranchRoot(node, mainBranch, nodeMap))
  }

  // 5. 分配列：主分支 col=0，每个独立分支根依次分配 col=1,2,3...
  const colMap = assignColumns(allNodes, mainBranch, branchRootMap)

  // 6. 组装结果
  const result: FlatNode[] = allNodes.map((node, index) => ({
    ...node,
    rowIndex: index,
    col: colMap.get(node.id) ?? 0,
    hasChildren: childrenSet.has(node.id),
    branchRootId: branchRootMap.get(node.id) ?? null
  }))

  return result
})

// 找主分支（createdAt 最早的链）
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

// 找节点的分支根（从主分支分叉出来的第一个节点）
function getBranchRoot(
  node: { id: string; parentId: string | null },
  mainBranch: Set<string>,
  nodeMap: Map<string, { id: string; parentId: string | null }>
): string | null {
  if (mainBranch.has(node.id)) return null
  if (!node.parentId) return node.id

  const parent = nodeMap.get(node.parentId)
  if (!parent) return node.id

  if (mainBranch.has(parent.id)) {
    return node.id // 父节点在主分支上，当前节点是分叉起点
  }

  return getBranchRoot(parent, mainBranch, nodeMap)
}

// 列分配
function assignColumns(
  nodes: Array<{ id: string; parentId: string | null }>,
  mainBranch: Set<string>,
  branchRootMap: Map<string, string | null>
): Map<string, number> {
  const colMap = new Map<string, number>()
  const branchColMap = new Map<string, number>() // branchRootId -> col

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
      // 从主分支分叉：每个分支根分配独立列
      const rootId = branchRootMap.get(node.id)
      if (rootId && !branchColMap.has(rootId)) {
        branchColMap.set(rootId, branchColMap.size + 1)
      }
      colMap.set(node.id, rootId ? (branchColMap.get(rootId) ?? 1) : 1)
    } else {
      // 从分支继续：保持同列
      colMap.set(node.id, parentCol)
    }
  }

  return colMap
}

// SVG 宽度动态计算
const svgWidth = computed(() => {
  const maxCol = flatList.value.reduce((max, n) => Math.max(max, n.col), 0)
  return 12 + maxCol * COL_WIDTH + 12
})

function getNodeX(node: FlatNode) {
  return 12 + node.col * COL_WIDTH
}

function getNodeY(node: FlatNode) {
  return node.rowIndex * (ITEM_HEIGHT + GAP) + ITEM_HEIGHT / 2
}

// 获取节点颜色（基于分支）
function getNodeColor(node: FlatNode) {
  if (node.branchRootId) {
    // 找到该分支根在分支列表中的索引
    const branchRoots = [...new Set(flatList.value.map(n => n.branchRootId).filter(Boolean))]
    const idx = branchRoots.indexOf(node.branchRootId)
    return BRANCH_COLORS[(idx + 1) % BRANCH_COLORS.length]
  }
  return BRANCH_COLORS[0] // 主分支
}

// 计算 SVG 连接线（Git graph 风格：先向下再拐弯，圆角曲线）
const svgLines = computed(() => {
  const lines: { key: string; d: string; color: string }[] = []
  const R = 5 // 圆角半径
  const DOWN = 10 // 从圆点向下延伸的距离

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
      // 同列：直线
      lines.push({
        key: `link-${parent.id}-${node.id}`,
        d: `M ${px},${py + 4} L ${cx},${cy - 4}`,
        color
      })
    } else {
      // 分叉：先从圆点向下走一段，再横向直达子节点列，然后向下到子节点
      const goingRight = cx > px
      const bendY = py + DOWN

      if (goingRight) {
        lines.push({
          key: `link-${parent.id}-${node.id}`,
          d: `M ${px},${py + 4}`
            + ` L ${px},${bendY - R}`
            + ` Q ${px},${bendY} ${px + R},${bendY}`
            + ` L ${cx - R},${bendY}`
            + ` Q ${cx},${bendY} ${cx},${bendY + R}`
            + ` L ${cx},${cy - 4}`,
          color
        })
      } else {
        lines.push({
          key: `link-${parent.id}-${node.id}`,
          d: `M ${px},${py + 4}`
            + ` L ${px},${bendY - R}`
            + ` Q ${px},${bendY} ${px - R},${bendY}`
            + ` L ${cx + R},${bendY}`
            + ` Q ${cx},${bendY} ${cx},${bendY + R}`
            + ` L ${cx},${cy - 4}`,
          color
        })
      }
    }
  }

  return lines
})

function statusTagType(status?: string) {
  switch (status) {
    case 'archived': return 'success'
    case 'selected': return 'info'
    case 'generated': return 'warning'
    case 'generating': return 'warning'
    case 'draft': return 'default'
    default: return 'default'
  }
}

function formatNumber(n: number) {
  return Number.isInteger(n) ? `第${n}章` : `第${n}章`
}

function canDevelop(node: FlatNode) {
  return node.status === 'archived'
}

function canEdit(node: FlatNode) {
  return ['draft', 'generated', 'selected'].includes(node.status)
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
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

/* SVG 层 */
.tree-svg {
  flex-shrink: 0;
  overflow: visible;
}

.link-line {
  stroke-width: 1.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}

/* 右侧内容 */
.list-rows {
  flex: 1;
  min-width: 0;
}

.list-row {
  display: flex;
  align-items: center;
  cursor: pointer;
  overflow: hidden;
}

.node-card {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border: 1px solid #f0f0f0;
  border-radius: 8px;
  background: #fafafa;
  transition: all 0.2s;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.node-card:hover {
  background: #f0f7ff;
  border-color: #1890ff;
}

.list-row.active .node-card {
  background: #e6f7ff;
  border-color: #1890ff;
  box-shadow: 0 0 0 2px rgba(24, 144, 255, 0.2);
}

.node-card.archived {
  background: #f6ffed;
  border-color: #b7eb8f;
}

.node-card.selected {
  background: #e6f7ff;
  border-color: #91d5ff;
}

.node-main {
  flex: 1;
  min-width: 0;
}

.node-header {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: nowrap;
  overflow: hidden;
}

.node-title {
  font-size: 14px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.node-meta {
  margin-top: 2px;
}

.node-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}
</style>
