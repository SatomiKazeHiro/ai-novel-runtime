<template>
  <div>
    <n-space justify="space-between" align="center" style="margin-bottom: 16px">
      <n-h1>知识图谱</n-h1>
      <n-space>
        <n-button @click="resetLayout">重新布局</n-button>
        <n-button type="primary" @click="showNodeModal = true">添加节点</n-button>
      </n-space>
    </n-space>

    <!-- 剧情发展轴 -->
    <n-card size="small" style="margin-bottom: 16px">
      <n-space vertical size="small">
        <n-text depth="3" style="font-size: 12px">剧情发展轴 — 选择章节查看该章归档时的图谱状态</n-text>
        <n-scrollbar x-scrollable>
          <n-space>
            <n-button
              v-for="ch in chapters"
              :key="ch.id"
              :type="selectedChapterId === ch.id ? 'primary' : 'default'"
              size="small"
              @click="selectChapter(ch.id)"
            >
              {{ ch.title }}
            </n-button>
          </n-space>
        </n-scrollbar>
      </n-space>
    </n-card>

    <!-- 视图切换 + 图例 -->
    <n-card size="small" style="margin-bottom: 16px">
      <n-space justify="space-between" align="center">
        <n-radio-group v-model:value="viewMode" size="small">
          <n-radio-button value="snapshot">累计全局</n-radio-button>
          <n-radio-button value="delta">本章纯净</n-radio-button>
        </n-radio-group>
        <n-space align="center">
          <n-tag
            v-if="viewMode === 'snapshot' && (diffStats.addedNodes > 0 || diffStats.addedEdges > 0)"
            size="small"
            :color="{ color: '#22c55e', textColor: '#fff', borderColor: '#22c55e' }"
          >
            本章新增 {{ diffStats.addedNodes }} 节点 / {{ diffStats.addedEdges }} 关系
          </n-tag>
          <n-tag
            v-for="t in typeLegend"
            :key="t.type"
            :color="{ color: t.color, textColor: '#fff', borderColor: t.color }"
          >
            {{ t.label }}
          </n-tag>
        </n-space>
      </n-space>
    </n-card>

    <!-- 纯净视图提示 -->
    <n-alert v-if="viewMode === 'delta'" type="info" size="small" style="margin-bottom: 16px" :show-icon="false">
      本章纯净视图只展示该章明确提及的实体和关系，不夹带全局历史信息。
    </n-alert>

    <!-- 新增高亮提示 -->
    <n-alert
      v-if="viewMode === 'snapshot' && (diffStats.addedNodes > 0 || diffStats.addedEdges > 0)"
      type="success"
      size="small"
      style="margin-bottom: 16px"
      :show-icon="false"
    >
      绿色高亮 = 相比上一章新增或更新的内容
    </n-alert>

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
  NH1, NSpace, NButton, NSelect, NCard, NTag, NText, NModal, NForm, NFormItem, NInput, NEmpty,
  NRadioGroup, NRadioButton, NScrollbar, NAlert
} from 'naive-ui'
import { graphApi } from '../api/graph'
import { chaptersApi } from '../api/chapters'
import cytoscape from 'cytoscape'

const route = useRoute()
const cyContainer = ref<HTMLDivElement>()
const showNodeModal = ref(false)
const showEdgeModal = ref(false)
const selectedNode = ref<any>(null)

const chapters = ref<any[]>([])
const selectedChapterId = ref<string>('')
const viewMode = ref<'snapshot' | 'delta'>('snapshot')

// 当前章节的图谱数据
const currentSnapshot = ref<any>(null)
const currentDelta = ref<any>(null)

// 上一章的 snapshot 缓存（用于 diff）
const prevSnapshot = ref<any>(null)

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

// 根据视图模式决定展示的数据
const displayGraphData = computed(() => {
  if (viewMode.value === 'delta') {
    return currentDelta.value
  }
  return currentSnapshot.value
})

// Diff 统计
const diffStats = computed(() => {
  if (!currentSnapshot.value || !prevSnapshot.value) {
    return { addedNodes: 0, addedEdges: 0 }
  }
  const prevNodeSet = new Set((prevSnapshot.value.nodes || []).map((n: any) => `${n.type}:${n.key}`))
  const prevEdgeSet = new Set((prevSnapshot.value.edges || []).map((e: any) =>
    `${e.fromType}:${e.fromKey}:${e.relation}:${e.toType}:${e.toKey}`
  ))

  const addedNodes = (currentSnapshot.value.nodes || []).filter((n: any) =>
    !prevNodeSet.has(`${n.type}:${n.key}`)
  ).length

  const addedEdges = (currentSnapshot.value.edges || []).filter((e: any) =>
    !prevEdgeSet.has(`${e.fromType}:${e.fromKey}:${e.relation}:${e.toType}:${e.toKey}`)
  ).length

  return { addedNodes, addedEdges }
})

let cy: cytoscape.Core | null = null

function computeNewIds(): { newNodes: Set<string>; newEdges: Set<string> } {
  const newNodes = new Set<string>()
  const newEdges = new Set<string>()

  if (!currentSnapshot.value || !prevSnapshot.value) {
    return { newNodes, newEdges }
  }

  const prevNodeSet = new Set((prevSnapshot.value.nodes || []).map((n: any) => `${n.type}:${n.key}`))
  const prevEdgeSet = new Set((prevSnapshot.value.edges || []).map((e: any) =>
    `${e.fromType}:${e.fromKey}:${e.relation}:${e.toType}:${e.toKey}`
  ))

  for (const n of currentSnapshot.value.nodes || []) {
    const key = `${n.type}:${n.key}`
    if (!prevNodeSet.has(key)) newNodes.add(key)
  }

  for (const e of currentSnapshot.value.edges || []) {
    const key = `${e.fromType}:${e.fromKey}:${e.relation}:${e.toType}:${e.toKey}`
    if (!prevEdgeSet.has(key)) newEdges.add(key)
  }

  return { newNodes, newEdges }
}

function initCytoscape() {
  if (!cyContainer.value || !displayGraphData.value) return
  if (cy) { cy.destroy(); cy = null }
  if (displayGraphData.value.nodes.length === 0) return

  const { newNodes, newEdges } = viewMode.value === 'snapshot' ? computeNewIds() : { newNodes: new Set<string>(), newEdges: new Set<string>() }

  // 收集所有有效节点 ID，过滤掉源或目标不存在的边（避免 AI 生成的 delta 数据不一致导致报错）
  const validNodeIds = new Set<string>(
    displayGraphData.value.nodes.map((n: any) => `${n.type}:${n.key}`)
  )

  const elements = [
    ...displayGraphData.value.nodes.map((n: any) => {
      const nodeId = `${n.type}:${n.key}`
      const isNew = newNodes.has(nodeId)
      return {
        data: { id: nodeId, label: n.label, type: n.type, key: n.key, isNew, ...n }
      }
    }),
    ...displayGraphData.value.edges
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

async function loadChapters() {
  if (!route.params.storyId) return
  const res = await chaptersApi.list(route.params.storyId as string)
  const list = res.data.data || []
  // 按 number 排序，主线在前，番外按父章节分组
  list.sort((a: any, b: any) => a.number - b.number)
  chapters.value = list

  // 默认选中最后一个已归档的章节，如果没有则选第一个
  const lastArchived = [...list].reverse().find((c: any) => c.status === 'archived')
  if (lastArchived) {
    await selectChapter(lastArchived.id)
  } else if (list.length > 0) {
    await selectChapter(list[0].id)
  }
}

async function selectChapter(chapterId: string) {
  selectedChapterId.value = chapterId
  await loadChapterGraph(chapterId)
}

const TYPE_NORMALIZE_MAP: Record<string, string> = {
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

function normalizeType(type: string): string {
  return TYPE_NORMALIZE_MAP[type] || type
}

function normalizeGraph(rawNodes: any[], rawEdges: any[]) {
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

async function loadChapterGraph(chapterId: string) {
  const res = await graphApi.getSnapshot(chapterId)
  const data = res.data.data

  // 转换 snapshot 为前端需要的格式，同时做 type 规范化
  const snapshot = normalizeGraph(data.snapshot?.nodes, data.snapshot?.edges)
  const delta = normalizeGraph(data.delta?.nodes, data.delta?.edges)

  currentSnapshot.value = {
    nodes: snapshot.nodes.map((n: any) => ({
      id: `${n.type}:${n.key}`,
      type: n.type,
      key: n.key,
      label: n.label,
      ...n.data
    })),
    edges: snapshot.edges.map((e: any) => ({
      source: `${e.fromType}:${e.fromKey}`,
      target: `${e.toType}:${e.toKey}`,
      relation: e.relation,
      ...e
    }))
  }

  currentDelta.value = {
    nodes: delta.nodes.map((n: any) => ({
      id: `${n.type}:${n.key}`,
      type: n.type,
      key: n.key,
      label: n.label,
      ...n.data
    })),
    edges: delta.edges.map((e: any) => ({
      source: `${e.fromType}:${e.fromKey}`,
      target: `${e.toType}:${e.toKey}`,
      relation: e.relation,
      ...e
    }))
  }

  // 加载上一章的 snapshot 用于 diff
  await loadPrevSnapshot(chapterId)

  await nextTick()
  initCytoscape()
}

async function loadPrevSnapshot(currentChapterId: string) {
  const currentIndex = chapters.value.findIndex(c => c.id === currentChapterId)
  if (currentIndex <= 0) {
    prevSnapshot.value = null
    return
  }
  // 找前一个章节（按 number 排序后的前一个）
  const prevChapter = chapters.value[currentIndex - 1]
  if (!prevChapter) {
    prevSnapshot.value = null
    return
  }
  try {
    const res = await graphApi.getSnapshot(prevChapter.id)
    prevSnapshot.value = res.data.data.snapshot
  } catch {
    prevSnapshot.value = null
  }
}

async function handleCreateNode() {
  if (!route.params.storyId) return
  await graphApi.createNode(route.params.storyId as string, { ...nodeForm.value })
  showNodeModal.value = false
  nodeForm.value = { type: 'character', key: '', label: '' }
  // 刷新当前视图
  if (selectedChapterId.value) {
    await loadChapterGraph(selectedChapterId.value)
  }
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
  if (selectedChapterId.value) {
    await loadChapterGraph(selectedChapterId.value)
  }
}

watch(() => route.params.storyId, () => {
  loadChapters()
})

watch(viewMode, () => {
  if (selectedChapterId.value) {
    nextTick(() => initCytoscape())
  }
})

onMounted(() => {
  if (route.params.storyId) {
    loadChapters()
  }
})
</script>
