<template>
  <div>
    <n-space justify="space-between" align="center" style="margin-bottom: 16px">
      <n-h1>知识图谱</n-h1>
      <n-space>
        <n-button @click="resetLayout">重新布局</n-button>
        <n-button type="primary" @click="showNodeModal = true">添加节点</n-button>
      </n-space>
    </n-space>

    <n-card size="small" style="margin-bottom: 16px">
      <n-space>
        <n-tag v-for="t in typeLegend" :key="t.type" :color="{ color: t.color, textColor: '#fff', borderColor: t.color }">
          {{ t.label }}
        </n-tag>
        <n-text depth="3">点击节点可选中，选中后点击另一节点可添加关系</n-text>
      </n-space>
    </n-card>

    <div ref="cyContainer" style="width: 100%; height: 600px; border: 1px solid var(--n-border-color); border-radius: 8px; background: var(--n-card-color);"></div>

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
import { ref, onMounted, watch, computed, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import {
  NH1, NSpace, NButton, NSelect, NCard, NTag, NText, NModal, NForm, NFormItem, NInput, NEmpty
} from 'naive-ui'
import { graphApi } from '../api/graph'
import cytoscape from 'cytoscape'

const route = useRoute()
const cyContainer = ref<HTMLDivElement>()
const graphData = ref<any>(null)
const showNodeModal = ref(false)
const showEdgeModal = ref(false)
const selectedNode = ref<any>(null)

const nodeForm = ref({ type: 'character', key: '', label: '' })
const edgeForm = ref({ targetId: '', relation: '' })

const nodeTypeOptions = [
  { label: '角色', value: 'character' },
  { label: '势力', value: 'faction' },
  { label: '事件', value: 'event' },
  { label: '物品', value: 'item' }
]

const typeLegend = [
  { type: 'character', label: '角色', color: '#3b82f6' },
  { type: 'faction', label: '势力', color: '#ef4444' },
  { type: 'event', label: '事件', color: '#f97316' },
  { type: 'item', label: '物品', color: '#a855f7' }
]

function getNodeColor(type: string) {
  return typeLegend.find(t => t.type === type)?.color || '#94a3b8'
}

const targetNodeOptions = computed(() => {
  if (!displayGraphData.value?.nodes || !selectedNode.value) return []
  return displayGraphData.value.nodes
    .filter((n: any) => n.id !== selectedNode.value.id)
    .map((n: any) => ({ label: `${n.label} (${n.type})`, value: n.id }))
})

const displayGraphData = computed(() => graphData.value)

let cy: cytoscape.Core | null = null

function initCytoscape() {
  if (!cyContainer.value || !displayGraphData.value) return
  if (cy) { cy.destroy(); cy = null }
  if (displayGraphData.value.nodes.length === 0) return

  const elements = [
    ...displayGraphData.value.nodes.map((n: any) => ({
      data: { id: n.id, label: n.label, type: n.type, key: n.key, ...n }
    })),
    ...displayGraphData.value.edges.map((e: any) => ({
      data: { id: `${e.source}-${e.relation}-${e.target}`, source: e.source, target: e.target, label: e.relation }
    }))
  ]

  cy = cytoscape({
    container: cyContainer.value,
    elements,
    style: [
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
          'text-halign': 'center'
        }
      },
      {
        selector: 'edge',
        style: {
          'width': 2,
          'line-color': '#94a3b8',
          'target-arrow-color': '#94a3b8',
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
    ],
    layout: {
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
    } as any
  })

  cy.on('tap', 'node', (evt) => {
    const node = evt.target
    if (selectedNode.value && selectedNode.value.id !== node.id()) {
      edgeForm.value = { targetId: node.id(), relation: '' }
      showEdgeModal.value = true
    } else {
      selectedNode.value = { id: node.id(), label: node.data('label'), key: node.data('key') }
      cy!.$(`#${node.id()}`).select()
    }
  })

  cy.on('tap', (evt) => {
    if (evt.target === cy) {
      selectedNode.value = null
      cy!.$(':selected').unselect()
    }
  })
}

function resetLayout() {
  if (!cy) return
  const layout = cy.layout({
    name: 'cose',
    padding: 20,
    animate: true,
    animationDuration: 500,
    randomize: true,
    componentSpacing: 60,
    nodeRepulsion: 400000,
    edgeElasticity: 100,
    nestingFactor: 5,
    gravity: 80,
    numIter: 1000,
    initialTemp: 200,
    coolingFactor: 0.95,
    minTemp: 1.0
  } as any)
  layout.run()
}

async function loadGraph() {
  if (!route.params.storyId) {
    graphData.value = null
    return
  }
  const res = await graphApi.get(route.params.storyId as string)
  graphData.value = res.data.data
  await nextTick()
  initCytoscape()
}

async function handleCreateNode() {
  if (!route.params.storyId) return
  await graphApi.createNode(route.params.storyId as string, { ...nodeForm.value })
  showNodeModal.value = false
  nodeForm.value = { type: 'character', key: '', label: '' }
  await loadGraph()
}

function cancelEdge() {
  showEdgeModal.value = false
  selectedNode.value = null
  edgeForm.value = { targetId: '', relation: '' }
  if (cy) cy.$(':selected').unselect()
}

async function handleCreateEdge() {
  if (!route.params.storyId || !selectedNode.value || !edgeForm.value.targetId || !edgeForm.value.relation) return
  await graphApi.createEdge(route.params.storyId as string, {
    fromId: selectedNode.value.id,
    toId: edgeForm.value.targetId,
    relation: edgeForm.value.relation,
    weight: 1
  })
  cancelEdge()
  await loadGraph()
}

watch(() => route.params.storyId, () => {
  loadGraph()
})

onMounted(() => {
  if (route.params.storyId) {
    loadGraph()
  }
})
</script>
