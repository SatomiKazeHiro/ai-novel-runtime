<template>
  <div>
    <n-space justify="space-between" align="center" style="margin-bottom: 16px">
      <n-h1>本章图谱</n-h1>
      <n-space>
        <n-button :disabled="!selectedNode" @click="openEditNode">编辑节点</n-button>
        <n-button :disabled="!selectedNode && !selectedEdge" type="error" @click="handleDelete">删除选中</n-button>
        <n-button @click="resetLayout">重新布局</n-button>
        <n-button type="primary" @click="showNodeModal = true">添加节点</n-button>
      </n-space>
    </n-space>

    <!-- 图谱画布 -->
    <div ref="cyContainer" style="width: 100%; height: 520px; border: 1px solid var(--n-border-color); border-radius: 8px; background: var(--n-card-color);"></div>

    <n-empty v-if="!displayGraphData || displayGraphData.nodes.length === 0" description="暂无图谱数据" style="margin-top: 24px" />

    <!-- 添加节点弹窗 -->
    <n-modal v-model:show="showNodeModal" title="添加节点" preset="card" style="width: 500px">
      <n-form :model="nodeForm" label-placement="left" label-width="80">
        <n-form-item label="类型" required>
          <n-select v-model:value="nodeForm.type" :options="nodeTypeOptions" />
        </n-form-item>
        <n-form-item label="标识" required>
          <n-input v-model:value="nodeForm.key" placeholder="唯一标识，如 linfan" />
        </n-form-item>
        <n-form-item label="名称" required>
          <n-input v-model:value="nodeForm.label" placeholder="显示名称" />
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showNodeModal = false">取消</n-button>
          <n-button type="primary" @click="handleCreateNode">创建</n-button>
        </n-space>
      </template>
    </n-modal>

    <!-- 编辑节点弹窗 -->
    <n-modal v-model:show="showEditNodeModal" title="编辑节点" preset="card" style="width: 500px">
      <n-form :model="editNodeForm" label-placement="left" label-width="80">
        <n-form-item label="类型" required>
          <n-select v-model:value="editNodeForm.type" :options="nodeTypeOptions" />
        </n-form-item>
        <n-form-item label="标识" required>
          <n-input v-model:value="editNodeForm.key" placeholder="唯一标识，如 linfan" />
        </n-form-item>
        <n-form-item label="名称" required>
          <n-input v-model:value="editNodeForm.label" placeholder="显示名称" />
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showEditNodeModal = false">取消</n-button>
          <n-button type="primary" @click="handleUpdateNode">保存</n-button>
        </n-space>
      </template>
    </n-modal>

    <!-- 添加关系弹窗 -->
    <n-modal v-model:show="showEdgeModal" title="添加关系" preset="card" style="width: 500px">
      <n-form :model="edgeForm" label-placement="left" label-width="80">
        <n-form-item label="源节点">
          <n-input :value="selectedNode?.label || selectedNode?.key || ''" disabled />
        </n-form-item>
        <n-form-item label="目标节点" required>
          <n-select v-model:value="edgeForm.targetId" :options="targetNodeOptions" placeholder="选择目标节点" />
        </n-form-item>
        <n-form-item label="关系" required>
          <n-input v-model:value="edgeForm.relation" placeholder="如：隶属、对抗、师徒、配偶" />
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="cancelEdge">取消</n-button>
          <n-button type="primary" @click="handleCreateEdge">创建</n-button>
        </n-space>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed, nextTick } from 'vue'
import {
  NH1, NSpace, NButton, NSelect, NModal, NForm, NFormItem, NInput, NEmpty
} from 'naive-ui'
import {
  useCytoscapeLifecycle,
  toGraphData,
  type GraphData
} from '../../composables/graph/useCytoscapeLifecycle'

const props = defineProps<{
  initialGraphData?: GraphData<any, any> | null
}>()

const emit = defineEmits<{
  'update:graphData': [data: GraphData<any, any>]
}>()

// draft 模式下的本地编辑数据
const draftGraphData = ref<GraphData<any, any>>({ nodes: [], edges: [] })
const cyContainer = ref<HTMLDivElement>()

const showNodeModal = ref(false)
const showEdgeModal = ref(false)
const showEditNodeModal = ref(false)
const selectedNode = ref<{ id: string; label: string; key: string; type: string } | null>(null)
const selectedEdge = ref<{ id: string; source: string; target: string; relation: string } | null>(null)

const nodeForm = ref({ type: 'character', key: '', label: '' })
const edgeForm = ref({ targetId: '', relation: '' })
const editNodeForm = ref({ id: '', type: 'character', key: '', label: '' })

const nodeTypeOptions = [
  { label: '角色', value: 'character' },
  { label: '势力', value: 'faction' },
  { label: '事件', value: 'event' },
  { label: '物品', value: 'item' }
]

const targetNodeOptions = computed(() => {
  if (!draftGraphData.value?.nodes || !selectedNode.value) return []
  return draftGraphData.value.nodes
    .filter((n: any) => n.id !== selectedNode.value!.id)
    .map((n: any) => ({ label: `${n.label} (${n.type})`, value: n.id }))
})

const displayGraphData = computed<GraphData<any, any> | null>(() => draftGraphData.value)

const cytoscape = useCytoscapeLifecycle({
  containerRef: cyContainer,
  getDisplayData: () => displayGraphData.value,
  onNodeTap: (node) => {
    if (selectedNode.value && selectedNode.value.id !== node.id) {
      edgeForm.value = { targetId: node.id, relation: '' }
      showEdgeModal.value = true
    } else {
      selectedNode.value = node
      selectedEdge.value = null
    }
  },
  onEdgeTap: (edge) => {
    selectedEdge.value = edge
    selectedNode.value = null
  },
  onBackgroundTap: () => {
    selectedNode.value = null
    selectedEdge.value = null
  }
})

function loadDraftGraph(raw?: GraphData<any, any> | null) {
  if (!raw) {
    draftGraphData.value = { nodes: [], edges: [] }
    return
  }
  draftGraphData.value = toGraphData(raw.nodes, raw.edges)
}

function resetLayout() {
  cytoscape.resetLayout()
}

async function handleCreateNode() {
  const newNode = {
    id: `${nodeForm.value.type}:${nodeForm.value.key}`,
    type: nodeForm.value.type,
    key: nodeForm.value.key,
    label: nodeForm.value.label,
    importance: 5
  }
  draftGraphData.value = {
    nodes: [...(draftGraphData.value?.nodes || []), newNode],
    edges: draftGraphData.value?.edges || []
  }
  showNodeModal.value = false
  nodeForm.value = { type: 'character', key: '', label: '' }
  emit('update:graphData', draftGraphData.value)
  await nextTick()
  cytoscape.init()
}

function cancelEdge() {
  showEdgeModal.value = false
  selectedNode.value = null
  selectedEdge.value = null
  edgeForm.value = { targetId: '', relation: '' }
  const cy = cytoscape.getInstance()
  if (cy) cy.$(':selected').unselect()
}

async function handleCreateEdge() {
  if (!selectedNode.value || !edgeForm.value.targetId || !edgeForm.value.relation) return

  const target = draftGraphData.value?.nodes.find((n: any) => `${n.type}:${n.key}` === edgeForm.value.targetId)
  if (!target) return
  const newEdge = {
    source: selectedNode.value.id,
    target: edgeForm.value.targetId,
    fromType: selectedNode.value.type,
    fromKey: selectedNode.value.key,
    toType: target.type,
    toKey: target.key,
    relation: edgeForm.value.relation,
    weight: 1
  }
  draftGraphData.value = {
    nodes: draftGraphData.value?.nodes || [],
    edges: [...(draftGraphData.value?.edges || []), newEdge]
  }
  cancelEdge()
  emit('update:graphData', draftGraphData.value)
  await nextTick()
  cytoscape.init()
}

function openEditNode() {
  if (!selectedNode.value) return
  editNodeForm.value = {
    id: selectedNode.value.id,
    type: selectedNode.value.type,
    key: selectedNode.value.key,
    label: selectedNode.value.label
  }
  showEditNodeModal.value = true
}

async function handleUpdateNode() {
  if (!draftGraphData.value) return
  const oldId = editNodeForm.value.id
  const newId = `${editNodeForm.value.type}:${editNodeForm.value.key}`

  draftGraphData.value = {
    nodes: draftGraphData.value.nodes.map((n: any) => {
      if (`${n.type}:${n.key}` !== oldId) return n
      return {
        ...n,
        id: newId,
        type: editNodeForm.value.type,
        key: editNodeForm.value.key,
        label: editNodeForm.value.label
      }
    }),
    edges: draftGraphData.value.edges.map((e: any) => {
      const isSource = e.source === oldId
      const isTarget = e.target === oldId
      if (!isSource && !isTarget) return e
      const updated: any = { ...e }
      if (isSource) {
        updated.source = newId
        updated.fromType = editNodeForm.value.type
        updated.fromKey = editNodeForm.value.key
      }
      if (isTarget) {
        updated.target = newId
        updated.toType = editNodeForm.value.type
        updated.toKey = editNodeForm.value.key
      }
      return updated
    })
  }

  showEditNodeModal.value = false
  selectedNode.value = null
  emit('update:graphData', draftGraphData.value)
  await nextTick()
  cytoscape.init()
}

async function handleDelete() {
  if (!draftGraphData.value) return
  const nodeId = selectedNode.value?.id
  const edgeId = selectedEdge.value?.id

  if (nodeId) {
    draftGraphData.value = {
      nodes: draftGraphData.value.nodes.filter((n: any) => `${n.type}:${n.key}` !== nodeId),
      edges: draftGraphData.value.edges.filter((e: any) => e.source !== nodeId && e.target !== nodeId)
    }
    selectedNode.value = null
  } else if (edgeId) {
    draftGraphData.value = {
      ...draftGraphData.value,
      edges: draftGraphData.value.edges.filter((e: any) => `${e.source}-${e.relation}-${e.target}` !== edgeId)
    }
    selectedEdge.value = null
  } else {
    return
  }

  emit('update:graphData', draftGraphData.value)
  await nextTick()
  cytoscape.init()
}

watch(() => props.initialGraphData, (val) => {
  loadDraftGraph(val)
  nextTick(() => cytoscape.init())
}, { immediate: true, deep: true })
</script>