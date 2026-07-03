<template>
  <div>
    <header class="page-head">
      <div class="page-head__text">
        <span class="cap-eyebrow is-accent">V2 · KNOWLEDGE GRAPH</span>
        <h1 class="page-head__title">知识图谱</h1>
        <p class="page-head__lede cap-body-sm">逐章记录的角色、势力、地点、事件、物品关系网络，仅供作者回顾。</p>
      </div>
    </header>

    <!-- 工具条 -->
    <div class="graph-toolbar">
      <div class="graph-toolbar__reel">
        <button
          class="graph-toolbar__nav-btn"
          :disabled="!canGoPrev"
          @click="navigateChapter(-1)"
        >&lt;</button>
        <select v-model="selectedChapterId" class="graph-toolbar__select" @change="onChapterSelect">
          <option value="" disabled>选择章节</option>
          <option v-for="ch in chapterOptions" :key="ch.value" :value="ch.value">
            第{{ ch.meta.number }}章 {{ ch.label }}
          </option>
        </select>
        <button
          class="graph-toolbar__nav-btn"
          :disabled="!canGoNext"
          @click="navigateChapter(1)"
        >&gt;</button>
      </div>

      <div class="graph-toolbar__divider" />

      <div class="graph-toolbar__mode" role="tablist" aria-label="视图模式">
        <button
          class="graph-toolbar__mode-btn"
          :class="{ 'is-active': viewMode === 'merged' }"
          type="button"
          role="tab"
          :aria-selected="viewMode === 'merged'"
          @click="viewMode = 'merged'"
        >累计全局</button>
        <button
          class="graph-toolbar__mode-btn"
          :class="{ 'is-active': viewMode === 'chapter' }"
          type="button"
          role="tab"
          :aria-selected="viewMode === 'chapter'"
          @click="viewMode = 'chapter'"
        >本章纯净</button>
      </div>

      <div class="graph-toolbar__spacer" />

      <GraphLegendV2 :show-new-marker="showNewMarker" :nodes="legendStats.nodes" :edges="legendStats.edges" />
    </div>

    <!-- 图谱画布 -->
    <div ref="cyContainer" class="graph-canvas" />

    <div class="graph-foot">
      <span v-if="viewMode === 'chapter'" class="graph-foot__hint">
        本章纯净视图只展示该章明确提及的实体和关系。
      </span>
      <span v-else-if="showNewMarker" class="graph-foot__hint is-positive">
        绿色描边 = 相比上一章新增或更新的节点/关系。
      </span>
      <span v-else class="graph-foot__hint is-muted">
        拖动节点可重新布局；单击节点/边可查看详情。
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch, computed } from 'vue'
import { useRoute } from 'vue-router'
import { v2GraphApi, type GraphNodeData, type GraphEdgeData, type GraphData, GRAPH_NODE_COLORS_V2 } from '../api-v2/graph'
import { v2ChaptersApi } from '../api-v2/chapters'
import {
  useCytoscapeLifecycle,
  type GraphData as CyGraphData
} from '../composables/graph/useCytoscapeLifecycle'
import GraphLegendV2 from '../components/graph/GraphLegendV2.vue'

const route = useRoute()
const cyContainer = ref<HTMLDivElement>()

const chapters = ref<any[]>([])
const selectedChapterId = ref<string>('')
const viewMode = ref<'merged' | 'chapter'>('merged')

const currentMerged = ref<GraphData | null>(null)
const currentChapter = ref<GraphData | null>(null)

// 上一章的 mergedGraph（用于 diff 统计）
const prevMerged = ref<GraphData | null>(null)

interface ChapterOption {
  label: string
  value: string
  meta: { number: number; status: string }
}

const chapterOptions = computed<ChapterOption[]>(() =>
  chapters.value.map((c: any) => ({
    label: c.title || '未命名',
    value: c.id,
    meta: { number: c.number, status: c.status }
  }))
)

const selectedIndex = computed(() =>
  chapters.value.findIndex((c: any) => c.id === selectedChapterId.value)
)

const canGoPrev = computed(() => selectedIndex.value > 0)
const canGoNext = computed(() => selectedIndex.value < chapters.value.length - 1)

/** 将 V2 图谱数据转为 cytoscape 所需格式 */
function toCyGraphData(data: GraphData | null): CyGraphData | null {
  if (!data || !data.nodes?.length) return null

  // key → type 映射
  const keyToType = new Map<string, string>()
  for (const n of data.nodes) {
    keyToType.set(n.key, n.type)
  }

  return {
    nodes: data.nodes.map((n: GraphNodeData) => ({
      id: `${n.type}:${n.key}`,
      type: n.type,
      key: n.key,
      label: n.label,
      ...n.data
    })),
    edges: data.edges.map((e: GraphEdgeData) => {
      const fromType = keyToType.get(e.fromKey) || 'other'
      const toType = keyToType.get(e.toKey) || 'other'
      return {
        source: `${fromType}:${e.fromKey}`,
        target: `${toType}:${e.toKey}`,
        relation: e.relation,
        fromType,
        fromKey: e.fromKey,
        toType,
        toKey: e.toKey
      }
    })
  }
}

const displayGraphData = computed<CyGraphData | null>(() => {
  if (viewMode.value === 'chapter') {
    return toCyGraphData(currentChapter.value)
  }
  return toCyGraphData(currentMerged.value)
})

// diff 统计
const diffStats = computed(() => {
  const cur = currentMerged.value
  const prev = prevMerged.value
  if (!cur || !prev) return { addedNodes: 0, addedEdges: 0 }

  const prevNodeSet = new Set((prev.nodes || []).map((n: any) => `${n.type}:${n.key}`))
  const prevEdgeSet = new Set((prev.edges || []).map(
    (e: any) => `${e.fromKey}|${e.relation}|${e.toKey}`
  ))

  const addedNodes = (cur.nodes || []).filter(
    (n: any) => !prevNodeSet.has(`${n.type}:${n.key}`)
  ).length
  const addedEdges = (cur.edges || []).filter(
    (e: any) => !prevEdgeSet.has(`${e.fromKey}|${e.relation}|${e.toKey}`)
  ).length

  return { addedNodes, addedEdges }
})

const showNewMarker = computed(() =>
  viewMode.value === 'merged' && (diffStats.value.addedNodes > 0 || diffStats.value.addedEdges > 0)
)

// 图例数据
const legendStats = computed(() => {
  const data = viewMode.value === 'chapter' ? currentChapter.value : currentMerged.value
  if (!data) return { nodes: [], edges: [] }

  const typeCount: Record<string, number> = {}
  for (const n of data.nodes) {
    typeCount[n.type] = (typeCount[n.type] || 0) + 1
  }
  const nodes = Object.entries(typeCount).map(([type, count]) => ({
    type,
    count,
    color: GRAPH_NODE_COLORS_V2[type] || GRAPH_NODE_COLORS_V2.other
  }))

  return { nodes, edges: [{ count: data.edges.length }] }
})

function computeNewIds(): { newNodes: Set<string>; newEdges: Set<string> } {
  const newNodes = new Set<string>()
  const newEdges = new Set<string>()

  const cur = currentMerged.value
  const prev = prevMerged.value
  if (!cur || !prev) return { newNodes, newEdges }

  const prevNodeSet = new Set((prev.nodes || []).map((n: any) => `${n.type}:${n.key}`))
  const prevEdgeSet = new Set((prev.edges || []).map(
    (e: any) => `${e.fromKey}|${e.relation}|${e.toKey}`
  ))

  for (const n of cur.nodes || []) {
    if (!prevNodeSet.has(`${n.type}:${n.key}`)) newNodes.add(`${n.type}:${n.key}`)
  }
  for (const e of cur.edges || []) {
    if (!prevEdgeSet.has(`${e.fromKey}|${e.relation}|${e.toKey}`)) {
      newEdges.add(`${e.fromKey}|${e.relation}|${e.toKey}`)
    }
  }
  return { newNodes, newEdges }
}

function getNodeColor(type: string): string {
  return GRAPH_NODE_COLORS_V2[type] || GRAPH_NODE_COLORS_V2.other
}

const cytoscape = useCytoscapeLifecycle({
  containerRef: cyContainer,
  getDisplayData: () => displayGraphData.value as CyGraphData | null,
  getNewIds: () => {
    if (viewMode.value !== 'merged') return { newNodes: new Set(), newEdges: new Set() }
    return computeNewIds()
  },
  getNodeColor
})

async function loadChapters() {
  const storyId = route.params.storyId as string
  if (!storyId) return
  const res = await v2ChaptersApi.list(storyId)
  const list = res.data.data || []
  list.sort((a: any, b: any) => a.number - b.number)
  chapters.value = list

  // 默认选中最新归档章节，否则选最新的
  const lastArchived = [...list].reverse().find((c: any) => c.status === 'archived')
  const fallback = [...list].reverse()[0]
  const target = lastArchived || fallback
  if (target) await selectChapter(target.id)
}

async function selectChapter(chapterId: string) {
  selectedChapterId.value = chapterId
  try {
    const res = await v2GraphApi.getByChapter(chapterId)
    const d = res.data.data
    currentChapter.value = d.chapterGraph
    currentMerged.value = d.mergedGraph
  } catch {
    currentChapter.value = null
    currentMerged.value = null
  }

  // 加载上一章的 mergedGraph
  await loadPrevMerged(chapterId)

  // 延迟重建 cytoscape
  setTimeout(() => cytoscape.init(), 0)
}

async function loadPrevMerged(currentChapterId: string) {
  const idx = chapters.value.findIndex((c: any) => c.id === currentChapterId)
  if (idx <= 0) {
    prevMerged.value = null
    return
  }
  const prevChapter = chapters.value[idx - 1]
  if (!prevChapter) {
    prevMerged.value = null
    return
  }
  try {
    const res = await v2GraphApi.getByChapter(prevChapter.id)
    prevMerged.value = res.data.data.mergedGraph
  } catch {
    prevMerged.value = null
  }
}

function onChapterSelect() {
  if (selectedChapterId.value) selectChapter(selectedChapterId.value)
}

function navigateChapter(dir: number) {
  const idx = selectedIndex.value + dir
  if (idx >= 0 && idx < chapters.value.length) {
    selectChapter(chapters.value[idx].id)
  }
}

watch(viewMode, () => {
  setTimeout(() => cytoscape.init(), 0)
})

watch(() => route.params.storyId, () => {
  loadChapters()
})

onMounted(() => {
  if (route.params.storyId) loadChapters()
})
</script>

<style scoped>
.graph-toolbar {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.graph-toolbar__reel {
  display: flex;
  align-items: center;
  gap: 6px;
}

.graph-toolbar__nav-btn {
  border: 1px solid var(--border-default);
  background: var(--color-pure-white);
  border-radius: var(--radius-pill);
  padding: 0 10px;
  height: 32px;
  font-family: inherit;
  font-size: 13px;
  cursor: pointer;
  color: var(--text-secondary);
}
.graph-toolbar__nav-btn:hover:not(:disabled) { color: var(--text-primary); }
.graph-toolbar__nav-btn:disabled { opacity: 0.35; cursor: default; }

.graph-toolbar__select {
  height: 32px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-pill);
  padding: 0 12px;
  font-family: inherit;
  font-size: 13px;
  color: var(--text-primary);
  background: var(--color-pure-white);
  min-width: 160px;
}

.graph-toolbar__divider {
  width: 1px;
  height: 20px;
  background: var(--border-subtle);
  flex-shrink: 0;
}

.graph-toolbar__spacer { flex: 1 1 auto; }

.graph-toolbar__mode {
  display: inline-flex;
  align-items: stretch;
  height: 32px;
  background: var(--color-pure-white);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-pill);
  padding: 2px;
  gap: 2px;
}

.graph-toolbar__mode-btn {
  border: 0;
  background: transparent;
  font-family: inherit;
  font-size: 12px;
  font-weight: var(--weight-medium);
  letter-spacing: 0.02em;
  color: var(--text-secondary);
  padding: 0 14px;
  height: 100%;
  border-radius: var(--radius-pill);
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;
}
.graph-toolbar__mode-btn:hover { color: var(--text-primary); }
.graph-toolbar__mode-btn.is-active {
  background: var(--color-stone-gray);
  color: var(--text-primary);
}

.graph-foot {
  margin-top: 10px;
  min-height: 20px;
}
.graph-foot__hint {
  font-size: 12px;
  color: var(--text-tertiary);
  line-height: 1.5;
}
.graph-foot__hint.is-positive { color: var(--color-positive); }
.graph-foot__hint.is-muted { color: var(--text-muted); }
</style>
