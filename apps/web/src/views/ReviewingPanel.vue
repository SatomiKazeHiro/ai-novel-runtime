<template>
  <div class="cap-card" style="margin-top: 16px">
    <header class="page-head" style="margin-bottom: 16px">
      <div class="page-head__text">
        <span class="cap-eyebrow">ARCHIVE REVIEW</span>
        <h2 class="page-head__title" style="font-size: 20px">归档审查</h2>
        <p class="cap-body-sm">本章已进入归档审查。你可以编辑 AI 提取的记忆和图谱，确认无误后再归档。</p>
      </div>
    </header>

    <n-space vertical size="large" style="width: 100%">

      <!-- 主编辑区 -->
      <n-tabs type="line" default-value="memories" :animated="true">
        <!-- 记忆 tab：记忆编辑器 + 角色状态 -->
        <n-tab-pane name="memories" tab="记忆">
          <n-space vertical size="large" style="width: 100%">
            <!-- 记忆编辑器 -->
            <n-card title="提取的记忆" size="small">
              <n-space vertical style="width: 100%">
                <n-collapse :default-expanded-names="['mainEvents']">
                  <n-collapse-item title="主要事件" name="mainEvents">
                    <n-empty v-if="mainMemories.length === 0" description="暂无主要事件" />
                    <n-space v-for="(mem, idx) in mainMemories" :key="`main-${idx}`" vertical style="width: 100%; margin-bottom: 12px">
                      <n-input v-model:value="mem.content" type="textarea" :rows="2" placeholder="事件内容" />
                      <n-space justify="space-between" style="width: 100%">
                        <n-input-number v-model:value="mem.importance" :min="1" :max="10" placeholder="重要性" />
                        <n-button size="small" type="error" @click="removeMemory(mem)">删除</n-button>
                      </n-space>
                    </n-space>
                    <n-button size="small" dashed block @click="addMainMemory">添加主要事件</n-button>
                  </n-collapse-item>

                  <n-collapse-item title="次要事件" name="sideEvents">
                    <n-empty v-if="sideMemories.length === 0" description="暂无次要事件" />
                    <n-space v-for="(mem, idx) in sideMemories" :key="`side-${idx}`" vertical style="width: 100%; margin-bottom: 12px">
                      <n-input v-model:value="mem.content" type="textarea" :rows="2" placeholder="事件内容" />
                      <n-space justify="space-between" style="width: 100%">
                        <n-input-number v-model:value="mem.importance" :min="1" :max="10" placeholder="重要性" />
                        <n-button size="small" type="error" @click="removeMemory(mem)">删除</n-button>
                      </n-space>
                    </n-space>
                    <n-button size="small" dashed block @click="addSideMemory">添加次要事件</n-button>
                  </n-collapse-item>

                  <n-collapse-item title="情绪 / 伏笔 / 关系" name="others">
                    <n-space vertical style="width: 100%">
                      <n-text depth="3">情绪变化</n-text>
                      <DynamicTags v-model="emotions" />
                      <n-text depth="3">新埋下的伏笔</n-text>
                      <DynamicTags v-model="foreshadowing" />
                      <n-text depth="3">角色关系变化</n-text>
                      <DynamicTags v-model="relationshipChanges" />
                    </n-space>
                  </n-collapse-item>
                </n-collapse>

                <n-divider />

                <n-form-item label="本章摘要" label-placement="left">
                  <n-input v-model:value="summary" type="textarea" :rows="2" placeholder="一句话摘要" />
                </n-form-item>
              </n-space>
            </n-card>

            <!-- 角色状态编辑器 -->
            <n-card title="角色状态" size="small">
              <n-empty v-if="characterStates.length === 0" description="暂无角色状态" />
              <n-space v-for="(state, idx) in characterStates" :key="`state-${idx}`" vertical style="width: 100%; margin-bottom: 12px">
                <n-space justify="space-between" style="width: 100%">
                  <n-text strong>{{ state.characterId }}</n-text>
                  <n-button size="small" type="error" @click="removeCharacterState(idx)">删除</n-button>
                </n-space>
                <n-form-item label="状态 JSON" label-placement="left" style="margin-bottom: 8px">
                  <n-input v-model:value="state.status" type="textarea" :rows="3" placeholder='{"rank": "...", "location": "..."}' />
                </n-form-item>
                <n-form-item label="关系 JSON" label-placement="left">
                  <n-input v-model:value="state.relationships" type="textarea" :rows="2" placeholder='{"角色A": "朋友", "角色B": "敌对"}' />
                </n-form-item>
              </n-space>
              <n-button size="small" dashed block @click="addCharacterState">添加角色状态</n-button>
            </n-card>
          </n-space>
        </n-tab-pane>

        <!-- 时间线 tab -->
        <n-tab-pane name="timeline" tab="时间线">
          <!-- 时间线编辑器 -->
          <n-card title="时间线事件" size="small">
            <n-empty v-if="timelineEvents.length === 0" description="暂无时间线事件" />
            <n-space v-for="(te, idx) in timelineEvents" :key="`te-${idx}`" vertical style="width: 100%; margin-bottom: 12px">
              <n-space justify="space-between" style="width: 100%; align-items: flex-start">
                <TimelinePositionInput v-model="te.position" style="flex: 1" />
                <n-button size="small" type="error" @click="removeTimelineEvent(idx)" style="flex-shrink: 0; margin-top: 4px">删除</n-button>
              </n-space>
              <n-input v-model:value="te.events" type="textarea" :rows="3" placeholder='事件 JSON 数组，如 ["事件1", "事件2"]' />
            </n-space>
            <n-button size="small" dashed block @click="addTimelineEvent">添加时间线事件</n-button>
          </n-card>
        </n-tab-pane>

        <!-- 剧情弧线 tab -->
        <n-tab-pane name="plotArcs" tab="剧情弧线">
          <!-- 剧情弧线编辑器 -->
          <n-card title="剧情弧线" size="small">
            <n-empty v-if="plotArcs.length === 0" description="暂无剧情弧线" />
            <n-grid
              v-else
              cols="2"
              x-gap="14"
              y-gap="14"
              responsive="screen"
              style="margin-bottom: 12px"
            >
              <n-gi v-for="(arc, idx) in plotArcs" :key="`arc-${idx}`">
                <article class="cap-arc-card cap-rise" :data-rise="String(Math.min(idx + 1, 7))">
                  <!-- 头部: 序号 + 类型/状态 chip + 相似 badge -->
                  <header class="cap-arc-card__head">
                    <div class="cap-arc-card__head-left">
                      <span class="cap-arc-card__no">N°&nbsp;{{ String(idx + 1).padStart(2, '0') }}<span class="cap-arc-card__no-sep"> / {{ String(plotArcs.length).padStart(2, '0') }}</span></span>
                      <span class="cap-chip" :class="arcTypeChipClass(arc.type)">
                        {{ arc.type === 'main' ? '主线' : '支线' }}
                      </span>
                      <span class="cap-chip" :class="arcStatusChipClass(arc.status)">
                        {{ arcStatusLabel(arc.status) }}
                      </span>
                    </div>
                    <span
                      v-if="arc.similarToExistingIds && safeJsonParse<string[]>(arc.similarToExistingIds, []).length > 0"
                      class="cap-chip is-warm"
                      :title="formatSimilarArcNames(arc.similarToExistingIds)"
                    >
                      ⚠ 相似 · {{ formatSimilarArcNames(arc.similarToExistingIds) }}
                    </span>
                    <span v-else-if="arc.status === 'closed'" class="cap-chip is-error">
                      已关闭
                    </span>
                  </header>

                  <!-- 大标题 -->
                  <h3 class="cap-arc-card__title">{{ arc.name || '(未命名)' }}</h3>

                  <!-- 薄分隔线 + DRAFT eyebrow + 右侧圆点收尾 -->
                  <div class="cap-arc-card__rule">
                    <span class="cap-arc-card__rule-text">DRAFT ENTRY</span>
                    <span class="cap-arc-card__rule-line" />
                    <span class="cap-arc-card__rule-dot" aria-hidden="true" />
                  </div>

                  <!-- 字段: 名称 (inline edit) -->
                  <div class="cap-arc-card__field">
                    <span class="cap-arc-card__label">01 · 名称</span>
                    <n-input
                      v-model:value="arc.name"
                      placeholder="弧线名称"
                      size="small"
                      :input-props="{ class: 'cap-arc-card__name-input' }"
                    />
                  </div>

                  <!-- 类型 / 状态 (chip-row, 可点改) -->
                  <div class="cap-arc-card__field">
                    <span class="cap-arc-card__label">02 · 类型 / 状态</span>
                    <div class="cap-arc-card__chip-row">
                      <n-select
                        v-model:value="arc.type"
                        :options="arcTypeOptions"
                        size="small"
                        style="flex: 1"
                      />
                      <n-select
                        v-model:value="arc.status"
                        :options="arcStatusOptions"
                        size="small"
                        style="flex: 1"
                      />
                    </div>
                  </div>

                  <!-- 进度条: 笔触 visual + 透明 slider + mono % -->
                  <div class="cap-arc-card__field">
                    <span class="cap-arc-card__label">03 · 进度</span>
                    <div class="cap-arc-card__progress">
                      <div class="cap-arc-card__progress-track" aria-hidden="true">
                        <div
                          class="cap-arc-card__progress-fill"
                          :style="{ width: arc.progress + '%' }"
                        />
                      </div>
                      <n-slider
                        v-model:value="arc.progress"
                        :min="0"
                        :max="100"
                        :step="1"
                        class="cap-arc-card__progress-slider"
                      />
                      <span class="cap-arc-card__progress-text">{{ String(arc.progress).padStart(2, '0') }}%</span>
                    </div>
                  </div>

                  <!-- 当前阶段 -->
                  <div class="cap-arc-card__field">
                    <span class="cap-arc-card__label">04 · 当前阶段</span>
                    <n-input
                      v-model:value="arc.currentStage"
                      placeholder="当前阶段"
                      size="small"
                    />
                  </div>

                  <!-- 下一目标 -->
                  <div class="cap-arc-card__field">
                    <span class="cap-arc-card__label">05 · 下一目标</span>
                    <n-input
                      v-model:value="arc.nextGoal"
                      placeholder="下一目标"
                      size="small"
                    />
                  </div>

                  <!-- 摘要: textarea 直接编辑 -->
                  <div class="cap-arc-card__field">
                    <span class="cap-arc-card__label">06 · 摘要</span>
                    <n-input
                      v-model:value="arc.summary"
                      type="textarea"
                      :rows="2"
                      placeholder="弧线摘要"
                      size="small"
                    />
                  </div>

                  <!-- 未解悬念 (mono 块) -->
                  <div class="cap-arc-card__field">
                    <span class="cap-arc-card__label">07 · 未解悬念</span>
                    <n-input
                      v-model:value="arc.unresolved"
                      type="textarea"
                      :rows="2"
                      placeholder='JSON 数组, 如 ["悬念1", "悬念2"]'
                      size="small"
                      class="cap-arc-card__mono-input"
                    />
                  </div>

                  <!-- 阶段记录 (mono 块) -->
                  <div class="cap-arc-card__field">
                    <span class="cap-arc-card__label">08 · 阶段记录</span>
                    <n-input
                      v-model:value="arc.stages"
                      type="textarea"
                      :rows="5"
                      placeholder="阶段记录 JSON"
                      size="small"
                      class="cap-arc-card__mono-input"
                    />
                  </div>

                  <!-- 底部: 删除 -->
                  <footer class="cap-arc-card__foot">
                    <button
                      type="button"
                      class="cap-pill is-sm is-danger"
                      @click="removePlotArc(idx)"
                    >
                      删除此弧线
                    </button>
                  </footer>
                </article>
              </n-gi>
            </n-grid>
            <n-button size="small" dashed block @click="addPlotArc">添加剧情弧线</n-button>
          </n-card>
        </n-tab-pane>

        <!-- 图谱 tab -->
        <n-tab-pane name="graph" tab="图谱">
          <!-- 图谱编辑器 -->
          <n-card title="本章图谱" size="small">
            <EditableGraph
              :initial-graph-data="graphData"
              @update:graphData="onGraphUpdate"
            />
          </n-card>
        </n-tab-pane>
      </n-tabs>

      <!-- 底部操作 -->
      <n-space justify="end" style="width: 100%; margin-top: 16px">
        <n-button @click="emit('cancel')">取消</n-button>
        <n-button type="primary" :loading="saving" @click="handleSave">保存调整</n-button>
        <n-button type="success" :loading="confirming" @click="handleConfirm">确认归档</n-button>
      </n-space>
    </n-space>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import {
  NCard, NSpace, NTabs, NTabPane, NCollapse, NCollapseItem,
  NInput, NInputNumber, NButton, NEmpty, NDivider, NFormItem, NGrid, NGi, NText,
  NSelect, NSlider,
  useDialog
} from 'naive-ui'
import { DEFAULT_TIMELINE_POSITION, safeJsonParse } from '@novel-runtime/shared'
import type { PendingArchiveData } from '@novel-runtime/shared'
import EditableGraph from '../components/graph/EditableGraph.vue'
import DynamicTags from '../components/DynamicTags.vue'
import TimelinePositionInput from '../components/TimelinePositionInput.vue'

// PendingArchiveData is now imported from @novel-runtime/shared — the
// single source of truth shared with the server. Adding fields is
// compile-checked across both apps.

const props = defineProps<{
  chapter: any
  pendingArchiveData: PendingArchiveData
}>()

const emit = defineEmits<{
  'save': [data: PendingArchiveData]
  'confirm': [data: PendingArchiveData]
  'cancel': []
}>()

const saving = ref(false)
const confirming = ref(false)
const dialog = useDialog()

function confirmRemove(content: string, onConfirm: () => void) {
  dialog.warning({
    title: '确认删除',
    content,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: onConfirm
  })
}

function normalizePendingData(data: any): PendingArchiveData {
  const safe = data || {}
  return {
    memories: {
      memories: Array.isArray(safe.memories?.memories) ? safe.memories.memories : [],
      characterStates: Array.isArray(safe.memories?.characterStates) ? safe.memories.characterStates : [],
      timelineEvents: Array.isArray(safe.memories?.timelineEvents) ? safe.memories.timelineEvents : [],
      summary: safe.memories?.summary || null,
      timelinePosition: typeof safe.memories?.timelinePosition === 'number' ? safe.memories.timelinePosition : null
    },
    graph: {
      mergedGraph: {
        nodes: Array.isArray(safe.graph?.mergedGraph?.nodes) ? safe.graph.mergedGraph.nodes : [],
        edges: Array.isArray(safe.graph?.mergedGraph?.edges) ? safe.graph.mergedGraph.edges : [],
        timestamp: safe.graph?.mergedGraph?.timestamp || new Date().toISOString()
      },
      chapterGraph: {
        nodes: Array.isArray(safe.graph?.chapterGraph?.nodes) ? safe.graph.chapterGraph.nodes : [],
        edges: Array.isArray(safe.graph?.chapterGraph?.edges) ? safe.graph.chapterGraph.edges : [],
        timestamp: safe.graph?.chapterGraph?.timestamp || new Date().toISOString()
      }
    },
    plotArcs: Array.isArray(safe.plotArcs) ? safe.plotArcs : [],
    meta: safe.meta || {}
  }
}

const localData = ref<PendingArchiveData>(normalizePendingData(props.pendingArchiveData))
const baselineChapterGraph = ref<{ nodes: any[], edges: any[] }>(JSON.parse(JSON.stringify(localData.value.graph.chapterGraph)))

watch(() => props.pendingArchiveData, (val) => {
  localData.value = normalizePendingData(val)
  baselineChapterGraph.value = JSON.parse(JSON.stringify(localData.value.graph.chapterGraph))
}, { deep: true })

const memories = computed(() => localData.value.memories.memories)
const mainMemories = computed(() => memories.value.filter((m: any) => m.tags?.includes('main-plot')))
const sideMemories = computed(() => memories.value.filter((m: any) => !m.tags?.includes('main-plot') && !isSpecialContent(m.content)))

const emotions = computed({
  get: () => getSpecialMemories('情绪：'),
  set: (val: string[]) => setSpecialMemories('情绪：', val)
})
const foreshadowing = computed({
  get: () => getSpecialMemories('伏笔：'),
  set: (val: string[]) => setSpecialMemories('伏笔：', val)
})
const relationshipChanges = computed({
  get: () => getSpecialMemories('关系：'),
  set: (val: string[]) => setSpecialMemories('关系：', val)
})

const summary = computed({
  get: () => localData.value.memories.summary || '',
  set: (val: string) => { localData.value.memories.summary = val || null }
})

const graphData = computed(() => localData.value.graph.chapterGraph)

const characterStates = computed(() => localData.value.memories.characterStates)
const timelineEvents = computed(() => localData.value.memories.timelineEvents)
const plotArcs = computed(() => localData.value.plotArcs)

const arcTypeOptions = [
  { label: '主线', value: 'main' },
  { label: '支线', value: 'side' }
]

const arcStatusOptions = [
  { label: '进行中', value: 'active' },
  { label: '收尾中', value: 'resolving' },
  { label: '已完成', value: 'completed' },
  { label: '已关闭', value: 'closed' },
  { label: '沉寂', value: 'stale' }
]

/**
 * cap-chip variant 映射 — 5 status 各有视觉语义:
 *   active    → is-positive (sage)  "活"
 *   resolving → is-warm     (terra)  "热"
 *   completed → is-snow     (neutral) "已完结"
 *   closed    → is-error    (calm red) "被合并/关闭"
 *   stale     → is-muted    (ash)     "沉寂"
 */
function arcStatusLabel(status: string): string {
  const opt = arcStatusOptions.find(o => o.value === status)
  return opt?.label || status
}

function arcStatusChipClass(status: string): string {
  switch (status) {
    case 'active': return 'is-positive'
    case 'resolving': return 'is-warm'
    case 'completed': return 'is-snow'
    case 'closed': return 'is-error'
    case 'stale': return 'is-muted'
    default: return ''
  }
}

function arcTypeChipClass(type: string): string {
  return type === 'main' ? 'is-warm' : 'is-blue'
}

/**
 * 解析 similarToExistingIds JSON 数组, 在 plotArcs 里找对应 name。
 * 找不到时退化为 id 前 8 位。
 */
function formatSimilarArcNames(similarToJson: string | undefined): string {
  if (!similarToJson) return ''
  const ids = safeJsonParse<string[]>(similarToJson, [])
  if (ids.length === 0) return ''
  return ids.map(id => {
    const target = plotArcs.value.find((a: any) => a.existingId === id || a.id === id)
    return target?.name || id.slice(0, 8)
  }).join(', ')
}

function isSpecialContent(content?: string): boolean {
  if (!content) return false
  return content.startsWith('情绪：') || content.startsWith('伏笔：') || content.startsWith('关系：')
}

function getSpecialMemories(prefix: string): string[] {
  return memories.value
    .filter((m: any) => m.content?.startsWith(prefix))
    .map((m: any) => m.content.slice(prefix.length))
}

function setSpecialMemories(prefix: string, values: string[]) {
  // 移除旧的
  localData.value.memories.memories = localData.value.memories.memories.filter((m: any) => !m.content?.startsWith(prefix))
  // 添加新的
  const chNum = props.chapter.fromChapterNumber ?? props.chapter.number ?? 0
  for (const v of values) {
    localData.value.memories.memories.push({
      storyId: props.chapter.storyId,
      chapterId: props.chapter.id,
      fromChapterNumber: chNum,
      layer: 'chapter',
      content: `${prefix}${v}`,
      tags: JSON.stringify(['auto-extracted']),
      importance: 5
    })
  }
}

function addMainMemory() {
  const chNum = props.chapter.fromChapterNumber ?? props.chapter.number ?? 0
  memories.value.push({
    storyId: props.chapter.storyId,
    chapterId: props.chapter.id,
    fromChapterNumber: chNum,
    layer: 'chapter',
    content: '',
    tags: JSON.stringify(['auto-extracted', 'main-plot']),
    importance: 7
  })
}

function addSideMemory() {
  const chNum = props.chapter.fromChapterNumber ?? props.chapter.number ?? 0
  memories.value.push({
    storyId: props.chapter.storyId,
    chapterId: props.chapter.id,
    fromChapterNumber: chNum,
    layer: 'chapter',
    content: '',
    tags: JSON.stringify(['auto-extracted']),
    importance: 5
  })
}

function removeMemory(mem: any) {
  confirmRemove('确定要删除这条记忆吗?', () => {
    const idx = memories.value.indexOf(mem)
    if (idx >= 0) memories.value.splice(idx, 1)
  })
}

function addCharacterState() {
  const chNum = props.chapter.fromChapterNumber ?? props.chapter.number ?? 0
  characterStates.value.push({
    characterId: '新角色',
    fromChapterNumber: chNum,
    status: '{}',
    relationships: '{}'
  })
}

function removeCharacterState(idx: number) {
  confirmRemove('确定要删除该角色状态吗?', () => {
    characterStates.value.splice(idx, 1)
  })
}

function addTimelineEvent() {
  const chNum = props.chapter.fromChapterNumber ?? props.chapter.number ?? 0
  timelineEvents.value.push({
    storyId: props.chapter.storyId,
    fromChapterNumber: chNum,
    position: DEFAULT_TIMELINE_POSITION,
    events: '[]'
  })
}

function removeTimelineEvent(idx: number) {
  confirmRemove('确定要删除该时间线事件吗?', () => {
    timelineEvents.value.splice(idx, 1)
  })
}

function addPlotArc() {
  plotArcs.value.push({
    storyId: props.chapter.storyId,
    name: '新弧线',
    type: 'side',
    status: 'active',
    progress: 0,
    stages: '[]',
    currentStage: '',
    nextGoal: '',
    unresolved: '[]',
    summary: '',
    isNew: true,
    similarToExistingIds: '[]'
  })
}

function removePlotArc(idx: number) {
  confirmRemove('确定要删除该剧情弧线吗?', () => {
    plotArcs.value.splice(idx, 1)
  })
}

function onGraphUpdate(data: { nodes: any[], edges: any[] }) {
  localData.value.graph.chapterGraph = {
    nodes: data.nodes,
    edges: data.edges,
    timestamp: new Date().toISOString()
  }

  const base = baselineChapterGraph.value
  const merged = localData.value.graph.mergedGraph

  // 把 draft 格式规范化回 DB 格式
  function normalizeNode(n: any) {
    const { id, type, key, label, ...rest } = n
    return { type, key, label, importance: n.importance ?? 5, data: rest }
  }
  function normalizeEdge(e: any) {
    return {
      fromType: e.fromType,
      fromKey: e.fromKey,
      toType: e.toType,
      toKey: e.toKey,
      relation: e.relation,
      weight: e.weight ?? 1
    }
  }
  function nodeKey(n: any) {
    return `${n.type}:${n.key}`
  }
  function edgeKey(e: any) {
    return `${e.fromType}:${e.fromKey}:${e.relation}:${e.toType}:${e.toKey}`
  }

  const baseNodes = new Map((base.nodes || []).map((n: any) => [nodeKey(n), normalizeNode(n)]))
  const baseEdges = new Set((base.edges || []).map((e: any) => edgeKey(normalizeEdge(e))))
  const newNodes = new Map(data.nodes.map((n: any) => [nodeKey(n), normalizeNode(n)]))
  const newEdges = new Set(data.edges.map((e: any) => edgeKey(normalizeEdge(e))))

  // mergedGraph = mergedGraph - baseChapterGraph + newChapterGraph
  const mergedNodeMap = new Map((merged.nodes || []).map((n: any) => [nodeKey(n), n]))
  const mergedEdgeList = (merged.edges || []).map((e: any) => ({ key: edgeKey(e), value: e }))

  // 删除旧 chapterGraph 中独有的节点
  for (const [key, _] of baseNodes) {
    if (!newNodes.has(key)) {
      mergedNodeMap.delete(key)
    }
  }
  // 添加/更新新 chapterGraph 中的节点
  for (const [key, n] of newNodes) {
    mergedNodeMap.set(key, n)
  }

  // 删除旧 chapterGraph 中独有的边
  const remainingEdges = mergedEdgeList.filter(({ key, value }) => {
    // 如果这条边在 base 中且不在 new 中，则删除
    if (baseEdges.has(key) && !newEdges.has(key)) return false
    // 如果这条边关联的节点已被删除，也删除
    const e = value
    if (!mergedNodeMap.has(`${e.fromType}:${e.fromKey}`)) return false
    if (!mergedNodeMap.has(`${e.toType}:${e.toKey}`)) return false
    return true
  })

  // 添加新 chapterGraph 中的边
  const remainingEdgeKeys = new Set(remainingEdges.map(e => e.key))
  for (const e of data.edges) {
    const key = edgeKey(normalizeEdge(e))
    if (!remainingEdgeKeys.has(key)) {
      remainingEdges.push({ key, value: normalizeEdge(e) })
      remainingEdgeKeys.add(key)
    }
  }

  localData.value.graph.mergedGraph = {
    nodes: Array.from(mergedNodeMap.values()),
    edges: remainingEdges.map(e => e.value),
    timestamp: new Date().toISOString()
  }
}

function buildData(): PendingArchiveData {
  return JSON.parse(JSON.stringify(localData.value))
}

function handleSave() {
  saving.value = true
  emit('save', buildData())
  saving.value = false
}

function handleConfirm() {
  confirming.value = true
  emit('confirm', buildData())
}

function startConfirm() {
  confirming.value = true
}

function stopConfirm() {
  confirming.value = false
}

defineExpose({ startConfirm, stopConfirm })
</script>

<style scoped>
/* === Editorial storyboard entry — plot arc card ===
   卡片像杂志条目:N° 序号 + 类型/状态 chip cluster + 24px 大标题 +
   笔触分隔线 + 编号字段 eyebrow。暖色 canvas 上纯白卡 + 1px pebble border,
   无 shadow(继承 .cap-card 的扁平纸张感)。hover 时 1px border 转 mid-gray
   + 微抬升 1px,与 .cap-card.is-interactive 风格一致。*/

.cap-arc-card {
  position: relative;
  background: var(--bg-card);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-card);
  padding: 18px 20px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  transition: border-color 0.18s ease, transform 0.18s ease;
}
.cap-arc-card:hover {
  border-color: var(--color-mid-gray);
  transform: translateY(-1px);
}

/* === 头部: 序号 + chip cluster + 相似 badge === */
.cap-arc-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
  min-height: 22px;
}
.cap-arc-card__head-left {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.cap-arc-card__no {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: var(--weight-semibold);
  letter-spacing: 0.08em;
  color: var(--text-tertiary);
  text-transform: uppercase;
}
.cap-arc-card__no-sep {
  color: var(--color-mid-gray);
  font-weight: var(--weight-regular);
}

/* === cap-chip 新增 is-muted variant ===
   base.css 现有 4 个 variant (snow/warm/positive/error),
   stale 状态需要灰一点,不靠 blueprint blue。直接在 scoped style 里 patch。 */
:deep(.cap-chip.is-muted),
.cap-chip.is-muted {
  background: var(--color-stone-gray);
  color: var(--text-tertiary);
  border-color: var(--border-default);
}

/* === cap-chip 新增 is-blue variant ===
   蓝图蓝 tint,跟 is-positive / is-warm 同结构但用 cool-accent 系。
   支线 arc 标识用 — 比 is-snow (中性白) 多一层"冷调支线"语义。 */
:deep(.cap-chip.is-blue),
.cap-chip.is-blue {
  background: var(--color-cool-accent-tint);
  color: var(--accent-link);
  border-color: rgba(74, 90, 122, 0.25);
}

/* === 大标题: arc.name === */
.cap-arc-card__title {
  margin: 0;
  font-size: var(--text-heading-sm-size); /* 24px */
  font-weight: var(--weight-semibold);
  line-height: var(--text-heading-sm-lh);
  color: var(--text-primary);
  letter-spacing: -0.005em;
  word-break: break-word;
}

/* === 薄分隔线 + cap-pencil + DRAFT eyebrow === */
.cap-arc-card__rule {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: -2px 0 -2px;
}
.cap-arc-card__rule-text {
  font-size: 9px;
  font-weight: var(--weight-semibold);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--text-tertiary);
  font-family: var(--font-mono);
}
.cap-arc-card__rule-line {
  flex: 1;
  height: 1px;
  background: var(--border-default);
  min-width: 24px;
}
/* 右侧装饰小圆点 — 跟左侧 cap-pencil 视觉对称,收尾感 */
.cap-arc-card__rule-dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--border-default);
  flex-shrink: 0;
}

/* === 字段: label + content === */
.cap-arc-card__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.cap-arc-card__label {
  font-size: var(--text-caption-size); /* 10px */
  font-weight: var(--weight-semibold);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-tertiary);
  line-height: 1;
}

/* === 类型/状态 chip-row ===
   Naive UI NSelect 默认 font-size 14px + 12px internal padding,
   比 NInput 看着大一圈。统一字号到 13px + 收紧 padding,跟 input 视觉对齐。 */
.cap-arc-card__chip-row {
  display: flex;
  gap: 8px;
  align-items: stretch;
}
.cap-arc-card__chip-row :deep(.n-base-selection),
.cap-arc-card__chip-row :deep(.n-base-selection-input__content) {
  font-size: 13px;
}
.cap-arc-card__chip-row :deep(.n-base-selection-label) {
  font-size: 13px;
}

/* === 名称输入: 大字无 form-item 包裹,直接显示 === */
.cap-arc-card__name-input {
  font-weight: var(--weight-semibold) !important;
  font-size: 15px !important;
}

/* === 进度条: 4px 笔触 visual + 透明 slider overlay + mono % ===
   把 n-slider 内部 rail/fill 完全 display:none,只保留 handle 做拖拽交互。
   视觉完全交给自定义 track + fill,避免两层 bar 重叠。*/
.cap-arc-card__progress {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  height: 28px;
}
.cap-arc-card__progress-track {
  position: absolute;
  left: 0;
  right: 56px;
  top: 50%;
  transform: translateY(-50%);
  height: 4px;
  background: var(--color-stone-gray);
  border-radius: var(--radius-pill);
  pointer-events: none;
  overflow: hidden;
}
.cap-arc-card__progress-fill {
  height: 100%;
  background: var(--accent);
  border-radius: var(--radius-pill);
  transition: width 0.25s cubic-bezier(0.2, 0.7, 0.2, 1);
}
/* n-slider 只做交互,视觉全部让位 */
.cap-arc-card__progress :deep(.n-slider) {
  flex: 1;
  height: 28px;
  position: relative;
}
.cap-arc-card__progress :deep(.n-slider-rail),
.cap-arc-card__progress :deep(.n-slider-fill) {
  display: none !important;
}
.cap-arc-card__progress :deep(.n-slider-handle-wrapper) {
  height: 28px;
}
.cap-arc-card__progress :deep(.n-slider-handle) {
  width: 14px !important;
  height: 14px !important;
  border-color: var(--accent);
  border-width: 2px;
  box-shadow: 0 0 0 2px var(--color-warm-accent-tint);
}
.cap-arc-card__progress-text {
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: var(--weight-semibold);
  color: var(--text-secondary);
  min-width: 38px;
  text-align: right;
  letter-spacing: 0.02em;
}

/* === 摘要: (引文块已移除,直接 textarea 编辑) === */

/* === JSON 字段: 等宽字体(保留和普通输入框一致的卡片底色) === */
.cap-arc-card__mono-input :deep(textarea) {
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.55;
  letter-spacing: 0.01em;
}

/* === 底部: 删除 === */
.cap-arc-card__foot {
  margin-top: 2px;
  padding-top: 10px;
  border-top: 1px solid var(--border-subtle);
  display: flex;
  justify-content: flex-end;
}
</style>
