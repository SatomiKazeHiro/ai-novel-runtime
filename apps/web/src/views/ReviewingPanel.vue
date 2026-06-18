<template>
  <n-card title="归档审查" size="small" style="margin-top: 16px">
    <n-space vertical size="large" style="width: 100%">
      <!-- 顶部提示 -->
      <n-alert type="info" :show-icon="false">
        本章已进入归档审查。你可以编辑 AI 提取的记忆和图谱，确认无误后再归档。
      </n-alert>

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
                      <n-dynamic-tags v-model:value="emotions" />
                      <n-text depth="3">新埋下的伏笔</n-text>
                      <n-dynamic-tags v-model:value="foreshadowing" />
                      <n-text depth="3">角色关系变化</n-text>
                      <n-dynamic-tags v-model:value="relationshipChanges" />
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
              <n-space justify="space-between" style="width: 100%">
                <n-input-number v-model:value="te.day" :min="1" placeholder="第几天" />
                <n-button size="small" type="error" @click="removeTimelineEvent(idx)">删除</n-button>
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
            <n-collapse
              v-if="plotArcs.length > 0"
              :default-expanded-names="plotArcs.map((_, i) => String(i))"
            >
              <n-collapse-item
                v-for="(arc, idx) in plotArcs"
                :key="`arc-${idx}`"
                :name="String(idx)"
                :title="arc.name"
              >
                <n-space vertical style="width: 100%">
                  <n-form-item label="名称" label-placement="left">
                    <n-input v-model:value="arc.name" placeholder="弧线名称" />
                  </n-form-item>
                  <n-grid cols="2" x-gap="12" :show-divider="false">
                    <n-gi>
                      <n-select v-model:value="arc.type" :options="arcTypeOptions" />
                    </n-gi>
                    <n-gi>
                      <n-select v-model:value="arc.status" :options="arcStatusOptions" />
                    </n-gi>
                  </n-grid>
                  <n-form-item label="进度" label-placement="left">
                    <n-slider v-model:value="arc.progress" :min="0" :max="100" :step="1" />
                    <n-text>{{ arc.progress }}%</n-text>
                  </n-form-item>
                  <n-form-item label="当前阶段" label-placement="left">
                    <n-input v-model:value="arc.currentStage" placeholder="当前阶段" />
                  </n-form-item>
                  <n-form-item label="下一目标" label-placement="left">
                    <n-input v-model:value="arc.nextGoal" placeholder="下一目标" />
                  </n-form-item>
                  <n-form-item label="摘要" label-placement="left">
                    <n-input v-model:value="arc.summary" type="textarea" :rows="2" placeholder="弧线摘要" />
                  </n-form-item>
                  <n-form-item label="未解悬念" label-placement="left">
                    <n-input v-model:value="arc.unresolved" type="textarea" :rows="2" placeholder='JSON 数组，如 ["悬念1", "悬念2"]' />
                  </n-form-item>
                  <n-form-item label="阶段记录" label-placement="left">
                    <n-input v-model:value="arc.stages" type="textarea" :rows="3" placeholder="阶段记录 JSON" />
                  </n-form-item>
                  <n-button size="small" type="error" block @click="removePlotArc(idx)">删除此弧线</n-button>
                </n-space>
              </n-collapse-item>
            </n-collapse>
            <n-button size="small" dashed block @click="addPlotArc" style="margin-top: 12px">添加剧情弧线</n-button>
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
  </n-card>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import {
  NCard, NSpace, NAlert, NTabs, NTabPane, NCollapse, NCollapseItem,
  NInput, NInputNumber, NButton, NEmpty, NDivider, NFormItem, NGrid, NText, NDynamicTags,
  NSelect, NSlider,
  useDialog
} from 'naive-ui'
import type { PendingArchiveData } from '@novel-runtime/shared'
import EditableGraph from '../components/graph/EditableGraph.vue'

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
      summary: safe.memories?.summary || null
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
  { label: '待启动', value: 'pending' },
  { label: '进行中', value: 'active' },
  { label: '收尾中', value: 'resolving' },
  { label: '已完成', value: 'completed' }
]

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
    day: 1,
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
    status: 'pending',
    progress: 0,
    stages: '[]',
    currentStage: '',
    nextGoal: '',
    unresolved: '[]',
    summary: '',
    isNew: true
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
