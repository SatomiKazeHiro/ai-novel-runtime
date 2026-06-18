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

    <!-- 添加节点弹窗（display 模式可通过 API 直接创建节点） -->
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
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch, computed, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import {
  NH1, NSpace, NButton, NSelect, NCard, NTag, NText, NModal, NForm, NFormItem, NInput, NEmpty,
  NRadioGroup, NRadioButton, NScrollbar, NAlert
} from 'naive-ui'
import { graphApi } from '../../api/graph'
import { chaptersApi } from '../../api/chapters'
import {
  useCytoscapeLifecycle,
  toGraphData,
  type GraphData
} from '../../composables/graph/useCytoscapeLifecycle'

const route = useRoute()
const cyContainer = ref<HTMLDivElement>()
const showNodeModal = ref(false)

const chapters = ref<any[]>([])
const selectedChapterId = ref<string>('')
const viewMode = ref<'snapshot' | 'delta'>('snapshot')

// 当前章节的图谱数据
const currentSnapshot = ref<GraphData | null>(null)
const currentDelta = ref<GraphData | null>(null)

// 上一章的 snapshot 缓存（用于 diff）
const prevSnapshot = ref<{ nodes: any[]; edges: any[] } | null>(null)

const nodeForm = ref({ type: 'character', key: '', label: '' })

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

// 根据视图模式决定展示的数据
const displayGraphData = computed<GraphData | null>(() => {
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

const cytoscape = useCytoscapeLifecycle({
  containerRef: cyContainer,
  getDisplayData: () => displayGraphData.value,
  getNewIds: () => {
    if (viewMode.value !== 'snapshot' || !currentSnapshot.value || !prevSnapshot.value) {
      return { newNodes: new Set(), newEdges: new Set() }
    }
    return computeNewIds()
  }
  // 不传 tap callback(只读)
})

function resetLayout() {
  cytoscape.resetLayout()
}

async function loadChapters() {
  const storyId = (route.params.storyId as string) || ''
  if (!storyId) return
  const res = await chaptersApi.list(storyId)
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

async function loadChapterGraph(chapterId: string) {
  const res = await graphApi.getSnapshot(chapterId)
  const data = res.data.data

  currentSnapshot.value = toGraphData(data.snapshot?.nodes, data.snapshot?.edges)
  currentDelta.value = toGraphData(data.delta?.nodes, data.delta?.edges)

  // 加载上一章的 snapshot 用于 diff
  await loadPrevSnapshot(chapterId)

  await nextTick()
  cytoscape.init()
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
  const storyId = (route.params.storyId as string) || ''
  if (!storyId) return
  await graphApi.createNode(storyId, { ...nodeForm.value })
  showNodeModal.value = false
  nodeForm.value = { type: 'character', key: '', label: '' }
  // 刷新当前视图
  if (selectedChapterId.value) {
    await loadChapterGraph(selectedChapterId.value)
  }
}

watch(() => route.params.storyId, () => {
  loadChapters()
})

watch(viewMode, () => {
  nextTick(() => cytoscape.init())
})

onMounted(() => {
  if (route.params.storyId) loadChapters()
})
</script>