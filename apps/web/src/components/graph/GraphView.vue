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

    <!-- 工具条: chapter reel + view mode -->
    <div v-if="hasArchivedChapters" class="graph-toolbar">
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
    </div>

    <!-- 图谱画布 (graph-paper surface from base.css) -->
    <!-- 无 archived 章节时显示空态, 彻底不走 cytoscape 初始化路径 -->
    <div v-if="hasArchivedChapters" ref="cyContainer" class="graph-canvas" />
    <GraphEmptyState v-else />

    <div v-if="hasArchivedChapters" class="graph-foot">
      <span v-if="viewMode === 'delta'" class="graph-foot__hint">
        本章纯净视图只展示该章明确提及的实体和关系。
      </span>
      <span v-else class="graph-foot__hint is-muted">
        拖动节点可重新布局；单击节点 / 边可查看详情。
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import { useGraphData } from '../../composables/graph/useGraphData'
import { useCytoscapeLifecycle } from '../../composables/graph/useCytoscapeLifecycle'
import { useThemeStore } from '../../stores/theme'
import ChapterReel from './ChapterReel.vue'
import GraphEmptyState from './GraphEmptyState.vue'

const route = useRoute()
const themeStore = useThemeStore()

const {
  chapters,
  currentSnapshot,
  currentDelta,
  loadChapters,
  loadChapterGraph
} = useGraphData()

const selectedChapterId = ref<string>('')
const viewMode = ref<'snapshot' | 'delta'>('snapshot')
const cyContainer = ref<HTMLDivElement>()

const chapterOptions = computed(() =>
  chapters.value.map((c: any) => ({
    label: c.title,
    value: c.id,
    meta: { number: c.number, status: c.status }
  }))
)

// useGraphData.loadChapters 内部已经过滤掉非 archived 章节,
// 所以 chapters.length > 0 就表示至少有一个 archived 章节可供查看。
const hasArchivedChapters = computed(() => chapters.value.length > 0)

const displayData = computed(() =>
  viewMode.value === 'snapshot' ? currentSnapshot.value : currentDelta.value
)

const cytoscape = useCytoscapeLifecycle({
  containerRef: cyContainer,
  getDisplayData: () => displayData.value,
  isDark: computed(() => themeStore.isDark),
  onNodeTap: (node) => {
    focusedId.value = node.id
    focusedType.value = 'node'
    cytoscape.applyFocus(node.id, 'node')
  },
  onEdgeTap: (edge) => {
    focusedId.value = edge.id
    focusedType.value = 'edge'
    cytoscape.applyFocus(edge.id, 'edge')
  },
  onBackgroundTap: () => {
    if (focusedId.value) clearFocus()
  }
})

const focusedId = ref<string | null>(null)
const focusedType = ref<'node' | 'edge' | null>(null)

function clearFocus() {
  focusedId.value = null
  focusedType.value = null
  cytoscape.clearFocus()
}

async function selectChapter(chapterId: string) {
  selectedChapterId.value = chapterId
  await loadChapterGraph(chapterId)
}

async function init() {
  const storyId = (route.params.storyId as string) || ''
  if (!storyId) return
  await loadChapters(storyId)
  if (chapters.value.length === 0) return
  // useGraphData.loadChapters 已过滤非 archived 并按 number 升序排序,
  // 所以最后一个就是 number 最大的 archived 章节。
  const latest = chapters.value[chapters.value.length - 1]
  await selectChapter(latest.id)
}

// bug 1 修复 (2026-07-29):
// - selectedChapterId / viewMode 变化触发 watch
// - displayData (computed) 依赖 currentSnapshot / currentDelta, init() 拉完数据时
//   currentSnapshot 变 → displayData 变 → 再触发一次 watch2 调 rebuild(真实数据)
//   (避免 selectChapter 同步赋值早于 loadChapterGraph 完成, 首次 rebuild(null) 早退后再不触发)
// - route.storyId 同理
// 关键修复 (T3): 单 watch 收敛后, init 时序: selectChapter → rebuild(null 早退) →
// loadChapterGraph 完成 → displayData 变 → rebuild(realData)
watch(
  [selectedChapterId, viewMode, displayData, () => route.params.storyId],
  async () => {
    await nextTick()
    cytoscape.rebuild(displayData.value)
  }
)

function onChapterNav() {
  // viewMode 切换 / focusedId 清理由 watch 统一处理
}

onMounted(() => {
  init()
})
</script>

<style scoped>
/* === Toolbar: 一行装下 chapter reel + view mode === */
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
