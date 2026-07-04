<template>
  <div>
    <header class="page-head">
      <div class="page-head__text">
        <span class="cap-eyebrow is-accent">V2 · TIMELINE</span>
        <h1 class="page-head__title">时间线</h1>
        <p class="page-head__lede cap-body-sm">
          <template v-if="totalEventCount > 0">
            {{ totalEventCount }} 条事件 · 跨 {{ chapterCount }} 章 · {{ anchorCount }} 个锚点
          </template>
          <template v-else>
            跨章节事件按时间锚点串联，保持时序与剧情推进一致。
          </template>
        </p>
      </div>
    </header>

    <!-- Anchor 切换器：多线剧情时显示 -->
    <div
      v-if="anchors.length > 1"
      class="cap-toolbar is-between timeline-anchor-toolbar"
    >
      <div class="cap-toolbar">
        <span class="cap-caption" style="margin-right: 4px">锚点</span>
        <button
          v-for="a in anchors"
          :key="a.id"
          type="button"
          class="cap-chip"
          :class="{ 'is-active': a.id === activeAnchorId }"
          @click="activeAnchorId = a.id"
        >
          {{ a.name }}
          <span class="cap-chip__count">{{ (a.events || []).length }}</span>
        </button>
      </div>
      <span class="cap-caption">{{ activeAnchor?.name || '' }}</span>
    </div>

    <!-- 主体 -->
    <n-spin :show="loading">
      <div v-if="chapterGroups.length > 0">
        <article
          v-for="group in chapterGroups"
          :key="group.chapterNumber"
          class="cap-card timeline-group"
        >
          <header class="timeline-group__head">
            <span class="cap-eyebrow">第 {{ group.chapterNumber }} 章</span>
            <span class="timeline-group__title">{{ chapterTitle(group.chapterNumber) || '（无标题）' }}</span>
            <span class="cap-caption">{{ group.events.length }} 条</span>
          </header>
          <ol class="timeline-events">
            <li v-for="evt in group.events" :key="evt.id" class="timeline-event">
              <span class="timeline-event__order">{{ evt.narrativeOrder ?? '·' }}</span>
              <div class="timeline-event__body">
                <h3 class="timeline-event__title">{{ evt.title }}</h3>
                <p v-if="evt.summary" class="timeline-event__summary">{{ evt.summary }}</p>
                <div
                  v-if="parsedTimeExpr(evt.timeExpression) || evt.location || evt.participants"
                  class="timeline-event__meta"
                >
                  <span v-if="parsedTimeExpr(evt.timeExpression)" class="timeline-event__time">
                    {{ parsedTimeExpr(evt.timeExpression)!.raw }}
                  </span>
                  <span v-if="evt.location" class="timeline-event__location">{{ evt.location }}</span>
                  <span v-if="evt.participants" class="timeline-event__participants">{{ evt.participants }}</span>
                </div>
              </div>
              <span class="timeline-event__importance" :class="`is-${evt.importance || 'normal'}`">
                {{ importanceLabel(evt.importance) }}
              </span>
            </li>
          </ol>
        </article>
      </div>
      <div v-else-if="!loading" class="cap-card timeline-empty">
        <p class="cap-body">暂无时间线事件</p>
        <p class="cap-caption" style="margin-top: 6px">归档章节后，AI 提取的事件会自动出现在这里</p>
      </div>
    </n-spin>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { NSpin } from 'naive-ui'
import { v2TimelineApi } from '../api-v2/timeline'
import { v2ChaptersApi } from '../api-v2/chapters'

const route = useRoute()
const anchors = ref<any[]>([])
const chapters = ref<any[]>([])
const activeAnchorId = ref<string | null>(null)
const loading = ref(false)

const activeAnchor = computed(() =>
  anchors.value.find((a: any) => a.id === activeAnchorId.value)
)
const activeAnchorEvents = computed<any[]>(
  () => activeAnchor.value?.events || []
)

const chapterGroups = computed(() => {
  const map = new Map<number, any[]>()
  for (const evt of activeAnchorEvents.value) {
    const cn = evt.chapterNumber
    if (!map.has(cn)) map.set(cn, [])
    map.get(cn)!.push(evt)
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a - b)
    .map(([chapterNumber, events]) => ({ chapterNumber, events }))
})

const totalEventCount = computed(() =>
  anchors.value.reduce((sum, a: any) => sum + ((a.events || []).length), 0)
)
const chapterCount = computed(() => {
  const nums = new Set<number>()
  for (const a of anchors.value) {
    for (const e of a.events || []) nums.add(e.chapterNumber)
  }
  return nums.size
})
const anchorCount = computed(() => anchors.value.length)

function chapterTitle(num: number): string {
  return chapters.value.find((c: any) => c.number === num)?.title || ''
}

interface ParsedTimeExpression {
  raw: string
  type: string
  confidence: string
}

function parsedTimeExpr(raw: string | null | undefined): ParsedTimeExpression | null {
  if (!raw) return null
  try {
    const obj = JSON.parse(raw)
    return obj && typeof obj === 'object' && obj.raw ? obj : null
  } catch {
    return null
  }
}

const IMPORTANCE_LABELS: Record<string, string> = {
  major: '浓墨',
  normal: '常规',
  minor: '铺场'
}
function importanceLabel(imp: string | null | undefined): string {
  return IMPORTANCE_LABELS[imp || ''] || imp || '常规'
}

async function loadTimeline() {
  const sid = route.params.storyId as string
  if (!sid) {
    anchors.value = []
    return
  }
  loading.value = true
  try {
    const res = await v2TimelineApi.list(sid)
    anchors.value = (res.data.data as any[]) || []
    if (!activeAnchorId.value && anchors.value.length > 0) {
      activeAnchorId.value = anchors.value[0].id
    }
  } finally {
    loading.value = false
  }
}

async function loadChapters() {
  const sid = route.params.storyId as string
  if (!sid) {
    chapters.value = []
    return
  }
  try {
    const res = await v2ChaptersApi.list(sid)
    chapters.value = (res.data.data as any[]) || []
  } catch {
    chapters.value = []
  }
}

async function refresh() {
  await Promise.all([loadTimeline(), loadChapters()])
}

watch(() => route.params.storyId, () => {
  activeAnchorId.value = null
  refresh()
})

onMounted(refresh)
</script>

<style scoped>
/* === Anchor 切换器 (timeline-anchor-toolbar) === */
.timeline-anchor-toolbar {
  margin-bottom: var(--space-6);
}
.timeline-anchor-toolbar .cap-chip {
  cursor: pointer;
  border: 1px solid var(--border-default);
  background: var(--bg-card);
  color: var(--text-secondary);
}
.timeline-anchor-toolbar .cap-chip:hover {
  border-color: var(--color-mid-gray);
  color: var(--text-primary);
}
.timeline-anchor-toolbar .cap-chip.is-active {
  background: var(--color-warm-accent-tint);
  color: var(--accent);
  border-color: rgba(184, 88, 30, 0.30);
  cursor: default;
}
.timeline-anchor-toolbar .cap-chip.is-active::before {
  background: var(--accent);
}
.cap-chip__count {
  margin-left: 6px;
  font-family: var(--font-mono);
  font-size: 10px;
  opacity: 0.7;
}

/* === 章节分组卡片 === */
.timeline-group {
  margin-bottom: var(--space-4);
}
.timeline-group:last-child {
  margin-bottom: 0;
}
.timeline-group__head {
  display: flex;
  align-items: baseline;
  gap: 12px;
  margin-bottom: var(--space-4);
  padding-bottom: var(--space-3);
  border-bottom: 1px solid var(--border-subtle);
}
.timeline-group__title {
  flex: 1;
  font-size: var(--text-body-lg-size);
  font-weight: var(--weight-semibold);
  color: var(--color-ink-black);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* === 事件条目 === */
.timeline-events {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
.timeline-event {
  display: grid;
  grid-template-columns: 28px 1fr auto;
  gap: 14px;
  align-items: start;
}
.timeline-event__order {
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: var(--weight-semibold);
  text-align: center;
  background: var(--bg-canvas);
  border: 1px solid var(--border-default);
  border-radius: 50%;
  width: 24px;
  height: 24px;
  line-height: 22px;
  margin-top: 2px;
  color: var(--text-tertiary);
}
.timeline-event__body {
  min-width: 0;
}
.timeline-event__title {
  margin: 0 0 4px;
  font-size: 14px;
  font-weight: var(--weight-semibold);
  color: var(--color-ink-black);
  line-height: 1.4;
  letter-spacing: 0.01em;
}
.timeline-event__summary {
  margin: 0 0 6px;
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.65;
}
.timeline-event__meta {
  display: flex;
  gap: 0;
  font-size: 11px;
  color: var(--text-tertiary);
  flex-wrap: wrap;
  letter-spacing: 0.02em;
}
.timeline-event__meta > span {
  padding-right: 10px;
  margin-right: 10px;
  position: relative;
}
.timeline-event__meta > span:not(:last-child)::after {
  content: '';
  position: absolute;
  right: 0;
  top: 50%;
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: var(--border-default);
  transform: translateY(-50%);
}
.timeline-event__time {
  font-family: var(--font-mono);
  color: var(--accent-link);
}

/* importance badge */
.timeline-event__importance {
  font-size: 10px;
  font-weight: var(--weight-semibold);
  padding: 3px 8px;
  border-radius: var(--radius-badge);
  letter-spacing: 0.06em;
  background: var(--accent-info-tint);
  color: var(--accent-link);
  border: 1px solid transparent;
  white-space: nowrap;
  flex-shrink: 0;
  margin-top: 4px;
}
.timeline-event__importance.is-major {
  background: var(--color-warm-accent-tint);
  color: var(--accent);
  border-color: rgba(184, 88, 30, 0.30);
}
.timeline-event__importance.is-normal {
  background: var(--accent-info-tint);
  color: var(--accent-link);
  border-color: rgba(74, 90, 122, 0.30);
}
.timeline-event__importance.is-minor {
  background: var(--color-positive-tint);
  color: var(--accent-positive);
  border-color: rgba(90, 122, 79, 0.30);
}

/* === 空态 === */
.timeline-empty {
  text-align: center;
  padding: 56px 16px;
}
</style>
