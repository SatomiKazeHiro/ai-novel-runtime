<template>
  <div>
    <header class="page-head">
      <div class="page-head__text">
        <span class="cap-eyebrow is-accent">KNOWLEDGE GRAPH</span>
        <h1 class="page-head__title">知识图谱</h1>
        <p class="page-head__lede cap-body-sm">
          实体与关系是叙事的脚手架 — 跨章节累积的角色、势力、事件与物品。
        </p>
      </div>
    </header>

    <!-- 工具条: chapter reel + view mode + 图例 -->
    <div class="graph-toolbar">
      <ChapterReel
        v-model="selectedChapterId"
        :options="chapterOptions"
        placeholder="选择章节"
        @prev="onChapterNav"
        @next="onChapterNav"
      />

      <div class="graph-toolbar__divider" aria-hidden="true" />

      <div class="graph-toolbar__mode" role="tablist" aria-label="视图模式">
        <button
          class="graph-toolbar__mode-btn"
          :class="{ 'is-active': viewMode === 'snapshot' }"
          type="button"
          role="tab"
          :aria-selected="viewMode === 'snapshot'"
          @click="viewMode = 'snapshot'"
        >
          累计全局
        </button>
        <button
          class="graph-toolbar__mode-btn"
          :class="{ 'is-active': viewMode === 'delta' }"
          type="button"
          role="tab"
          :aria-selected="viewMode === 'delta'"
          @click="viewMode = 'delta'"
        >
          本章纯净
        </button>
      </div>

      <div class="graph-toolbar__spacer" />

      <GraphLegend
        :show-new-marker="showNewMarker"
        :new-node-count="diffStats.addedNodes"
        :new-edge-count="diffStats.addedEdges"
      />
    </div>

    <!-- 图谱画布 (graph-paper surface from base.css) -->
    <div ref="cyContainer" class="graph-canvas" />

    <div class="graph-foot">
      <span v-if="viewMode === 'delta'" class="graph-foot__hint">
        本章纯净视图只展示该章明确提及的实体和关系。
      </span>
      <span v-else-if="showNewMarker" class="graph-foot__hint is-positive">
        绿色描边 = 相比上一章新增或更新的节点 / 关系。
      </span>
      <span v-else class="graph-foot__hint is-muted">
        拖动节点可重新布局；单击节点 / 边可查看详情。
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch, computed, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import { cumulativeGraphApi } from '../../api/cumulative-graph'
import { chaptersApi } from '../../api/chapters'
import {
  useCytoscapeLifecycle,
  toGraphData,
  type GraphData
} from '../../composables/graph/useCytoscapeLifecycle'
import { useThemeStore } from '../../stores/theme'
import ChapterReel from './ChapterReel.vue'
import GraphLegend from './GraphLegend.vue'

const route = useRoute()
const themeStore = useThemeStore()
const cyContainer = ref<HTMLDivElement>()

const chapters = ref<any[]>([])
const selectedChapterId = ref<string>('')
const viewMode = ref<'snapshot' | 'delta'>('snapshot')

// 当前章节的图谱数据
const currentSnapshot = ref<GraphData | null>(null)
const currentDelta = ref<GraphData | null>(null)

// 上一章的 snapshot 缓存（用于 diff）
const prevSnapshot = ref<{ nodes: any[]; edges: any[] } | null>(null)

const chapterOptions = computed(() =>
  chapters.value.map((c: any) => ({
    label: c.title,
    value: c.id,
    meta: { number: c.number, status: c.status }
  }))
)

const displayGraphData = computed<GraphData | null>(() => {
  if (viewMode.value === 'delta') {
    return currentDelta.value
  }
  return currentSnapshot.value
})

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

const showNewMarker = computed(() =>
  viewMode.value === 'snapshot' && (diffStats.value.addedNodes > 0 || diffStats.value.addedEdges > 0)
)

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

const focusedId = ref<string | null>(null)
const focusedType = ref<'node' | 'edge' | null>(null)

function clearFocus() {
  focusedId.value = null
  focusedType.value = null
  cytoscape.clearFocus()
}

const cytoscape = useCytoscapeLifecycle({
  containerRef: cyContainer,
  getDisplayData: () => displayGraphData.value,
  isDark: computed(() => themeStore.isDark),
  getNewIds: () => {
    if (viewMode.value !== 'snapshot' || !currentSnapshot.value || !prevSnapshot.value) {
      return { newNodes: new Set(), newEdges: new Set() }
    }
    return computeNewIds()
  },
  onNodeTap: (node) => {
    if (focusedId.value === node.id && focusedType.value === 'node') {
      clearFocus()
      return
    }
    focusedId.value = node.id
    focusedType.value = 'node'
    cytoscape.applyFocus(node.id, 'node')
  },
  onEdgeTap: (edge) => {
    if (focusedId.value === edge.id && focusedType.value === 'edge') {
      clearFocus()
      return
    }
    focusedId.value = edge.id
    focusedType.value = 'edge'
    cytoscape.applyFocus(edge.id, 'edge')
  },
  onBackgroundTap: () => {
    if (focusedId.value) clearFocus()
  }
})

async function loadChapters() {
  const storyId = (route.params.storyId as string) || ''
  if (!storyId) return
  const res = await chaptersApi.list(storyId)
  const list = res.data.data || []
  list.sort((a: any, b: any) => a.number - b.number)
  chapters.value = list

  // 默认选中最新 (按 number 倒序第一个); 优先选已归档
  const lastArchived = [...list].reverse().find((c: any) => c.status === 'archived')
  const fallback = [...list].reverse()[0]
  const target = lastArchived || fallback
  if (target) {
    await selectChapter(target.id)
  }
}

async function selectChapter(chapterId: string) {
  selectedChapterId.value = chapterId
  await loadChapterGraph(chapterId)
}

async function loadChapterGraph(chapterId: string) {
  const res = await cumulativeGraphApi.get(chapterId)
  const data = res.data.data

  // v3 接口: { graph: { nodes, edges, timestamp }, chapterGraph?: {...} }
  // graph = 累计图 (snapshot 视图), chapterGraph = 本章纯净 (delta 视图)
  currentSnapshot.value = toGraphData(data.graph?.nodes, data.graph?.edges)
  currentDelta.value = toGraphData(data.chapterGraph?.nodes, data.chapterGraph?.edges)

  await loadPrevSnapshot(chapterId)

  await nextTick()
  cytoscape.init()
}

async function loadPrevSnapshot(currentChapterId: string) {
  const currentIndex = chapters.value.findIndex((c) => c.id === currentChapterId)
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
    const res = await cumulativeGraphApi.get(prevChapter.id)
    prevSnapshot.value = res.data.data.graph
  } catch {
    prevSnapshot.value = null
  }
}

function onChapterNav() {
  // viewMode / prevSnapshot 在 selectChapter 内已处理
}

// 章节 / 视图模式 / 路由变化时, 清掉旧的聚焦 (cytoscape 会被 destroy 重建)
watch([() => route.params.storyId, viewMode, selectedChapterId], () => {
  if (focusedId.value) clearFocus()
})

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

<style scoped>
/* === Toolbar: 一行装下 chapter reel / view mode / 图例 === */
.graph-toolbar {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.graph-toolbar__divider {
  width: 1px;
  height: 20px;
  background: var(--border-subtle);
  flex-shrink: 0;
}
.graph-toolbar__spacer { flex: 1 1 auto; }

/* view mode 双选分段按钮 — 嵌在 toolbar 中, 用同样 pebble border */
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
.graph-toolbar__mode-btn:hover {
  color: var(--text-primary);
}
.graph-toolbar__mode-btn.is-active {
  background: var(--color-stone-gray);
  color: var(--text-primary);
}
.graph-toolbar__mode-btn.is-active:nth-child(2) {
  color: var(--accent);
}

/* === Foot hint — 替代原本的 n-alert === */
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
