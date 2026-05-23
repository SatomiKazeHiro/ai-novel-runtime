<template>
  <div>
    <n-space justify="space-between" align="center" style="margin-bottom: 16px">
      <n-h1>知识图谱</n-h1>
      <n-space>
        <n-radio-group v-model:value="viewMode" size="small">
          <n-radio-button value="chart">图表</n-radio-button>
          <n-radio-button value="list">列表</n-radio-button>
        </n-radio-group>
        <n-button v-if="viewMode === 'chart'" @click="resetLayout">重新布局</n-button>
        <n-button type="primary" @click="showNodeModal = true">添加节点</n-button>
      </n-space>
    </n-space>

    <!-- 分支视角选择器 -->
    <n-card v-if="branches.length > 0" size="small" style="margin-bottom: 16px" :bordered="false">
      <n-space align="center">
        <n-text strong>分支视角：</n-text>
        <n-radio-group v-model:value="branchMode" size="small">
          <n-radio-button :value="false">实时图谱</n-radio-button>
          <n-radio-button :value="true">分支快照</n-radio-button>
        </n-radio-group>
        <n-select
          v-if="branchMode"
          v-model:value="selectedBranchId"
          :options="branchOptions"
          style="width: 300px"
          size="small"
          placeholder="选择分支"
        />
        <n-tag v-if="branchMode && selectedBranchInfo" size="small" type="info">
          {{ selectedBranchInfo.title }} (第{{ selectedBranchInfo.number }}章)
        </n-tag>
      </n-space>
    </n-card>

    <n-card size="small" style="margin-bottom: 16px">
      <n-space>
        <n-tag v-for="t in typeLegend" :key="t.type" :color="{ color: t.color, textColor: '#fff', borderColor: t.color }">
          {{ t.label }}
        </n-tag>
        <n-text depth="3">点击节点可选中，选中后点击另一节点可添加关系</n-text>
      </n-space>
    </n-card>

    <!-- 图表视图 -->
    <div v-show="viewMode === 'chart'">
      <div ref="cyContainer" style="width: 100%; height: 600px; border: 1px solid var(--n-border-color); border-radius: 8px; background: var(--n-card-color);"></div>
    </div>

    <!-- 列表视图 -->
    <n-card v-if="viewMode === 'list' && displayGraphData" title="节点列表" size="small" style="margin-bottom: 16px">
      <n-data-table :columns="nodeColumns" :data="displayGraphData.nodes" size="small" />
    </n-card>
    <n-card v-if="viewMode === 'list' && displayGraphData" title="关系列表" size="small">
      <n-data-table :columns="edgeColumns" :data="displayGraphData.edges" size="small" />
    </n-card>

    <n-empty v-if="!displayGraphData || displayGraphData.nodes.length === 0" description="暂无图谱数据，生成章节或手动添加节点后可见" style="margin-top: 24px" />

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
  NH1, NSpace, NButton, NSelect, NCard, NTag, NText, NModal, NForm, NFormItem, NInput, NEmpty, NRadioGroup, NRadioButton, NDataTable
} from 'naive-ui'
import { graphApi } from '../api/graph'
import { chaptersApi } from '../api/chapters'
import cytoscape from 'cytoscape'

const route = useRoute()
const cyContainer = ref<HTMLDivElement>()
const graphData = ref<any>(null)
const showNodeModal = ref(false)
const showEdgeModal = ref(false)
const selectedNode = ref<any>(null)

const viewMode = ref<'chart' | 'list'>('chart')
const nodeForm = ref({ type: 'character', key: '', label: '' })
const edgeForm = ref({ targetId: '', relation: '' })

// 分支视角
const branchMode = ref(false)
const chapterTree = ref<any[]>([])
const branches = ref<any[]>([])
const selectedBranchId = ref<string>('')
const selectedBranchInfo = ref<any>(null)
const snapshotData = ref<any>(null)

const nodeColumns = [
  { title: 'ID', key: 'id', width: 200, ellipsis: { tooltip: true } },
  { title: '类型', key: 'type', width: 100 },
  { title: '标识', key: 'key', width: 150 },
  { title: '名称', key: 'label' }
]

const edgeColumns = [
  { title: '源', key: 'source', width: 200, ellipsis: { tooltip: true } },
  { title: '关系', key: 'relation', width: 120 },
  { title: '目标', key: 'target', width: 200, ellipsis: { tooltip: true } }
]

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

const branchOptions = computed(() => {
  return branches.value.map((b) => ({
    label: `${b.pathNames.join(' → ')} (第${b.chapterNumber}章)`,
    value: b.chapterId
  }))
})

// 当前展示的数据（实时图谱或分支快照）
const displayGraphData = computed(() => {
  if (branchMode.value && snapshotData.value) {
    return snapshotData.value
  }
  return graphData.value
})

let cy: cytoscape.Core | null = null

function initCytoscape() {
  if (!cyContainer.value || !displayGraphData.value) return
  if (cy) { cy.destroy(); cy = null }
  if (displayGraphData.value.nodes.length === 0) return

  const isSnapshot = branchMode.value && snapshotData.value

  const elements = isSnapshot
    ? [
        ...displayGraphData.value.nodes.map((n: any) => ({
          data: { id: `${n.type}:${n.key}`, label: n.label, type: n.type, key: n.key, ...n }
        })),
        ...displayGraphData.value.edges.map((e: any) => ({
          data: {
            id: `${e.fromType}:${e.fromKey}-${e.relation}-${e.toType}:${e.toKey}`,
            source: `${e.fromType}:${e.fromKey}`,
            target: `${e.toType}:${e.toKey}`,
            label: e.relation
          }
        }))
      ]
    : [
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

// 计算分支路径
function computeBranches(nodes: any[]): any[] {
  const result: any[] = []

  function walk(node: any, path: any[], pathNames: string[]) {
    const newPath = [...path, node]
    const newPathNames = [...pathNames, node.title || `第${node.number}章`]
    if (!node.children || node.children.length === 0) {
      // 叶子节点，找到路径上最后一个 archived 章节
      const lastArchived = [...newPath].reverse().find((n: any) => n.status === 'archived')
      if (lastArchived) {
        result.push({
          chapterId: lastArchived.id,
          chapterNumber: lastArchived.number,
          path: newPath,
          pathNames: newPathNames,
          depth: newPath.length
        })
      }
    } else {
      for (const child of node.children) {
        walk(child, newPath, newPathNames)
      }
    }
  }

  for (const root of nodes) {
    walk(root, [], [])
  }

  // 按深度排序，最深的在前
  return result.sort((a, b) => b.depth - a.depth)
}

async function loadChapterTree() {
  if (!route.params.storyId) return
  try {
    const res = await chaptersApi.getTree(route.params.storyId as string)
    chapterTree.value = res.data.data || []
    branches.value = computeBranches(chapterTree.value)
    // 默认选择最长分支
    if (branches.value.length > 0 && !selectedBranchId.value) {
      selectedBranchId.value = branches.value[0].chapterId
    }
  } catch {
    chapterTree.value = []
    branches.value = []
  }
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

async function loadBranchSnapshot() {
  if (!selectedBranchId.value) {
    snapshotData.value = null
    selectedBranchInfo.value = null
    return
  }
  try {
    const res = await graphApi.getSnapshot(selectedBranchId.value)
    const data = res.data.data
    selectedBranchInfo.value = data.chapter
    if (data.snapshot) {
      snapshotData.value = {
        nodes: data.snapshot.nodes || [],
        edges: data.snapshot.edges || []
      }
    } else {
      snapshotData.value = null
    }
  } catch {
    snapshotData.value = null
    selectedBranchInfo.value = null
  }
  await nextTick()
  initCytoscape()
}

async function handleCreateNode() {
  if (!route.params.storyId) return
  await graphApi.createNode(route.params.storyId as string, nodeForm.value)
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
  loadChapterTree()
})

watch(branchMode, async (val) => {
  if (val) {
    await loadBranchSnapshot()
  } else {
    snapshotData.value = null
    selectedBranchInfo.value = null
    await nextTick()
    initCytoscape()
  }
})

watch(selectedBranchId, async () => {
  if (branchMode.value) {
    await loadBranchSnapshot()
  }
})

onMounted(() => {
  if (route.params.storyId) {
    loadGraph()
    loadChapterTree()
  }
})
</script>
