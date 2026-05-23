<template>
  <div class="branch-tree">
    <div
      v-for="node in treeData"
      :key="node.id"
      class="branch-node-wrapper"
    >
      <div class="branch-node-row" :style="{ paddingLeft: `${currentDepth * 28}px` }">
        <!-- 连接线 -->
        <div class="connector" v-if="currentDepth > 0">
          <div class="connector-line-vertical"></div>
          <div class="connector-line-horizontal"></div>
        </div>

        <!-- 节点内容 -->
        <div
          class="branch-node"
          :class="{ active: selectedId === node.id, archived: node.status === 'archived', selected: node.status === 'selected' }"
          @click="$emit('select', node)"
        >
          <div class="node-dot" :class="node.status"></div>
          <div class="node-content">
            <div class="node-header">
              <n-text strong class="node-title">{{ node.title }}</n-text>
              <n-tag v-if="node.isSideStory" size="tiny" type="warning">番外</n-tag>
              <n-tag size="tiny" :type="statusTagType(node.status)">{{ node.status }}</n-tag>
            </div>
            <div class="node-meta">
              <n-text depth="3" style="font-size: 12px">
                {{ formatNumber(node.number) }}
                <span v-if="node.branchName">· {{ node.branchName }}</span>
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
              v-if="canDelete(node)"
              size="tiny"
              type="error"
              @click.stop="$emit('delete', node)"
            >删除</n-button>
          </div>
        </div>
      </div>

      <!-- 递归子节点 -->
      <ChapterBranchTree
        v-if="node.children && node.children.length > 0"
        :tree-data="node.children"
        :depth="currentDepth + 1"
        :selected-id="selectedId"
        @select="$emit('select', $event)"
        @develop="$emit('develop', $event)"
        @edit="$emit('edit', $event)"
        @delete="$emit('delete', $event)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { NText, NTag, NButton } from 'naive-ui'

interface TreeNode {
  id: string
  number: number
  title: string
  status: string
  isSideStory?: boolean
  branchName?: string | null
  runtimeProfile?: { name: string } | null
  children?: TreeNode[]
}

const props = defineProps<{
  treeData: TreeNode[]
  depth?: number
  selectedId?: string
}>()

const currentDepth = computed(() => props.depth || 0)

defineEmits<{
  (e: 'select', node: TreeNode): void
  (e: 'develop', node: TreeNode): void
  (e: 'edit', node: TreeNode): void
  (e: 'delete', node: TreeNode): void
}>()

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

function canDevelop(node: TreeNode) {
  return node.status === 'archived'
}

function canEdit(node: TreeNode) {
  return ['draft', 'generated', 'selected'].includes(node.status)
}

function canDelete(node: TreeNode) {
  // archived 且有后续 archived 子节点的不能删除
  if (node.status === 'archived') {
    const hasArchivedChild = node.children?.some(c => c.status === 'archived')
    return !hasArchivedChild
  }
  return true
}
</script>

<style scoped>
.branch-tree {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

.branch-node-wrapper {
  position: relative;
}

.branch-node-row {
  display: flex;
  align-items: center;
  position: relative;
  padding: 4px 0;
}

.connector {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.connector-line-vertical {
  position: absolute;
  left: 14px;
  top: 0;
  bottom: 0;
  width: 2px;
  background: #e0e0e0;
}

.connector-line-horizontal {
  position: absolute;
  left: 14px;
  top: 50%;
  width: 14px;
  height: 2px;
  background: #e0e0e0;
}

.branch-node-wrapper:first-child .connector-line-vertical {
  top: 50%;
}

.branch-node-wrapper:last-child .connector-line-vertical {
  bottom: 50%;
}

.branch-node {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border: 1px solid #f0f0f0;
  border-radius: 8px;
  background: #fafafa;
  cursor: pointer;
  transition: all 0.2s;
  min-height: 48px;
}

.branch-node:hover {
  background: #f0f7ff;
  border-color: #1890ff;
}

.branch-node.active {
  background: #e6f7ff;
  border-color: #1890ff;
  box-shadow: 0 0 0 2px rgba(24, 144, 255, 0.2);
}

.branch-node.archived {
  background: #f6ffed;
  border-color: #b7eb8f;
}

.branch-node.selected {
  background: #e6f7ff;
  border-color: #91d5ff;
}

.node-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
  background: #d9d9d9;
}

.node-dot.archived { background: #52c41a; }
.node-dot.selected { background: #1890ff; }
.node-dot.generated { background: #faad14; }
.node-dot.generating { background: #faad14; animation: pulse 1.5s infinite; }
.node-dot.draft { background: #d9d9d9; }

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

.node-content {
  flex: 1;
  min-width: 0;
}

.node-header {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.node-title {
  font-size: 14px;
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
