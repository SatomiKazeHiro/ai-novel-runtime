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

      <!-- 本章级常驻区: 摘要 (跨 tab 通用, 不藏在记忆tab 内) -->

      <!-- 本章摘要 — 印刷感引文块: cap-eyebrow 副标 + 大字引号 + 内嵌 textarea + 字符计数 hint -->
      <n-card class="cap-summary-card" size="small">
        <template #header>
          <header class="cap-summary-card__head">
            <span class="cap-eyebrow">EXCERPT · 本章摘要</span>
            <h3 class="cap-summary-card__title">一句话核心</h3>
          </header>
        </template>
        <div class="cap-summary-card__body">
          <span class="cap-summary-card__quote-mark" aria-hidden="true">"</span>
          <n-input
            v-model:value="summary"
            type="textarea"
            :rows="3"
            placeholder="本章的核心冲突、转折或情感落点…"
            class="cap-summary-card__input"
          />
        </div>
        <footer class="cap-summary-card__foot">
          <span class="cap-summary-card__hint">印在章节标题下方 · 一行说清本章发生了什么</span>
          <span class="cap-summary-card__count">{{ (summary || '').length }} 字</span>
        </footer>
      </n-card>

      <!-- 主编辑区 -->
      <n-tabs type="line" default-value="characters" :animated="true">
        <!-- 角色 tab: 角色状态 (2 列 grid + 卡片, 与剧情弧线节奏一致) -->
        <n-tab-pane name="characters">
          <template #tab>
            <span class="rp-tab-label">
              <span class="rp-tab-dot" :style="{ background: dotColor('character') }" aria-hidden="true" />
              角色
            </span>
          </template>
          <div v-if="stageStatus('character') === 'failed'" class="rp-stage-error">
            <strong>解析失败:</strong> {{ props.pending?.stages?.character?.errorMessage || '未知错误' }}
          </div>
          <div class="rp-stage-actions">
            <n-button size="small" :disabled="isRetrying('character')" @click="emit('retry-stage', 'character')">
              {{ isRetrying('character') ? '重新解析中…' : '重新解析此阶段' }}
            </n-button>
          </div>
          <n-empty v-if="characterStates.length === 0" description="暂无角色状态, 点击下方添加" />
          <n-grid
            v-else
            cols="2"
            x-gap="14"
            y-gap="14"
            responsive="screen"
            class="cap-character-card__grid"
          >
            <n-gi v-for="(state, idx) in characterStates" :key="`state-${idx}`">
              <article class="cap-character-card__item cap-rise" :data-rise="String(Math.min(idx + 1, 7))">
                <header class="cap-character-card__item-head">
                  <div class="cap-character-card__item-meta">
                    <span class="cap-character-card__item-no">N°&nbsp;{{ String(idx + 1).padStart(2, '0') }}<span class="cap-character-card__item-no-sep"> / {{ String(characterStates.length).padStart(2, '0') }}</span></span>
                  </div>
                  <h3 class="cap-character-card__item-name-wrap">
                    <span>{{ state.name || state.characterId }}</span>
                    <button
                      type="button"
                      class="cap-pill is-sm is-danger cap-character-card__item-remove"
                      title="删除该角色状态"
                      aria-label="删除该角色状态"
                      @click="removeCharacterState(idx)"
                    >删除</button>
                  </h3>
                </header>
                <div class="cap-character-card__field">
                  <span class="cap-character-card__field-label">01 · 状态</span>
                  <n-input
                    v-model:value="state.status"
                    type="textarea"
                    :rows="3"
                    placeholder='{"rank": "...", "location": "..."}'
                    class="cap-character-card__json-input"
                  />
                </div>
                <div class="cap-character-card__field">
                  <span class="cap-character-card__field-label">02 · 关系</span>
                  <n-input
                    v-model:value="state.relationships"
                    type="textarea"
                    :rows="2"
                    placeholder='{"角色A": "朋友", "角色B": "敌对"}'
                    class="cap-character-card__json-input"
                  />
                </div>
              </article>
            </n-gi>
          </n-grid>
          <footer class="cap-character-card__foot">
            <button
              type="button"
              class="cap-pill is-sm is-primary cap-character-card__add"
              @click="addCharacterState"
            >+ 添加角色状态</button>
          </footer>
        </n-tab-pane>

        <!-- 记忆 tab: 提取的记忆 (主/次事件 + 情绪/伏笔/关系). 摘要上移到 banner 下, 角色状态在第 1 个 tab -->
        <n-tab-pane name="memories">
          <template #tab>
            <span class="rp-tab-label">
              <span class="rp-tab-dot" :style="{ background: dotColor('memory') }" aria-hidden="true" />
              记忆
            </span>
          </template>
          <div v-if="stageStatus('memory') === 'failed'" class="rp-stage-error">
            <strong>解析失败:</strong> {{ props.pending?.stages?.memory?.errorMessage || '未知错误' }}
          </div>
          <div class="rp-stage-actions">
            <n-button size="small" :disabled="isRetrying('memory')" @click="emit('retry-stage', 'memory')">
              {{ isRetrying('memory') ? '重新解析中…' : '重新解析此阶段' }}
            </n-button>
          </div>
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
              </n-space>
            </n-card>
          </n-space>
        </n-tab-pane>

        <!-- 剧情弧线 tab -->
        <n-tab-pane name="plotArcs">
          <template #tab>
            <span class="rp-tab-label">
              <span class="rp-tab-dot" :style="{ background: dotColor('plotArc') }" aria-hidden="true" />
              剧情弧线
            </span>
          </template>
          <div v-if="stageStatus('plotArc') === 'failed'" class="rp-stage-error">
            <strong>解析失败:</strong> {{ props.pending?.stages?.plotArc?.errorMessage || '未知错误' }}
          </div>
          <div class="rp-stage-actions">
            <n-button size="small" :disabled="isRetrying('plotArc')" @click="emit('retry-stage', 'plotArc')">
              {{ isRetrying('plotArc') ? '重新解析中…' : '重新解析此阶段' }}
            </n-button>
          </div>
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
                  <!-- 头部: meta (序号 + chips) + 大标题,合并展示 -->
                  <header class="cap-arc-card__head">
                    <div class="cap-arc-card__head-meta">
                      <span class="cap-arc-card__no">N°&nbsp;{{ String(idx + 1).padStart(2, '0') }}<span class="cap-arc-card__no-sep"> / {{ String(plotArcs.length).padStart(2, '0') }}</span></span>
                      <div class="cap-arc-card__head-chips">
                        <span class="cap-chip" :class="arcTypeChipClass(arc.type)">
                          {{ arc.type === 'main' ? '主线' : '支线' }}
                        </span>
                        <span class="cap-chip" :class="arcStatusChipClass(arc.status)">
                          {{ arcStatusLabel(arc.status) }}
                        </span>
                        <span v-if="arc.status === 'closed'" class="cap-chip is-error">
                          已关闭
                        </span>
                      </div>
                    </div>
                    <h3 class="cap-arc-card__title">
                      <span class="cap-arc-card__title-text">{{ arc.name || '(未命名)' }}</span>
                      <span
                        v-if="arc.isNew"
                        class="cap-chip is-warm cap-arc-card__new-tag"
                        title="本次归档新建的弧线"
                      >
                        NEW
                      </span>
                    </h3>
                  </header>

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
        <n-tab-pane name="graph">
          <template #tab>
            <span class="rp-tab-label">
              <span class="rp-tab-dot" :style="{ background: dotColor('graph') }" aria-hidden="true" />
              图谱
            </span>
          </template>
          <div v-if="stageStatus('graph') === 'failed'" class="rp-stage-error">
            <strong>解析失败:</strong> {{ props.pending?.stages?.graph?.errorMessage || '未知错误' }}
          </div>
          <div class="rp-stage-actions">
            <n-button size="small" :disabled="isRetrying('graph')" @click="emit('retry-stage', 'graph')">
              {{ isRetrying('graph') ? '重新解析中…' : '重新解析此阶段' }}
            </n-button>
          </div>
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
import { ref, computed, watch, onUnmounted } from 'vue'
import {
  NCard, NSpace, NTabs, NTabPane, NCollapse, NCollapseItem,
  NInput, NInputNumber, NButton, NEmpty, NGrid, NGi, NText,
  NSelect, NSlider,
  useDialog
} from 'naive-ui'
import EditableGraph from '../components/graph/EditableGraph.vue'
import DynamicTags from '../components/DynamicTags.vue'
import {
  fromV3, toV3,
  type V3PendingArchiveData, type LocalData
} from './ReviewingPanel.adapter'

const props = defineProps<{
  pending: V3PendingArchiveData
  retryingStages?: Partial<Record<StageName, boolean>>
}>()

type StageName = 'character' | 'memory' | 'plotArc' | 'graph'

const emit = defineEmits<{
  (e: 'save', data: V3PendingArchiveData): void
  (e: 'confirm', data: V3PendingArchiveData): void
  (e: 'cancel'): void
  (e: 'reprepare'): void
  (e: 'retry-stage', stageName: StageName): void
}>()

const saving = ref(false)
const confirming = ref(false)
const dialog = useDialog()

const localData = ref<LocalData>(fromV3(props.pending))

// 父组件传入新 pending(整章重抽)时重新初始化本地编辑态
watch(() => props.pending, (next) => {
  localData.value = fromV3(next)
})

// 自动防抖保存: localData 变化 800ms 后 emit save
let saveTimer: ReturnType<typeof setTimeout> | null = null
watch(localData, () => {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    emit('save', toV3(localData.value, props.pending))
  }, 800)
}, { deep: true })
onUnmounted(() => { if (saveTimer) clearTimeout(saveTimer) })

// === tab header 状态圆点 ===
function stageStatus(name: StageName): string {
  return props.pending?.stages?.[name]?.status ?? 'pending'
}
// 哪个 stage 正在重跑,父组件持有状态后通过 prop 传进来
function isRetrying(name: StageName): boolean {
  return !!props.retryingStages?.[name]
}
function dotColor(name: StageName): string {
  const status = stageStatus(name)
  switch (status) {
    case 'failed':
    case 'error':
      return 'var(--color-error)'
    case 'success':
    case 'completed':
      return 'var(--color-positive)'
    case 'running':
    case 'pending-ai':
      return 'var(--color-warm-accent)'
    default:
      return 'var(--color-muted-ash)'
  }
}

function confirmRemove(content: string, onConfirm: () => void) {
  dialog.warning({
    title: '确认删除',
    content,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: onConfirm
  })
}

// === 剧情弧线常量与 helper(照搬 v2,删除 timeline / similar 相关) ===
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

// === computed 与各 tab 用到的派生 ===
const summary = computed({
  get: () => localData.value.summary,
  set: (v: string) => { localData.value.summary = v }
})
const memories = computed(() => localData.value.memories.memories)
const mainMemories = computed(() => memories.value.filter((m: any) => m.tags?.includes('main-plot')))
const sideMemories = computed(() => memories.value.filter((m: any) => !m.tags?.includes('main-plot')))
const emotions = computed({
  get: () => localData.value.memories.emotions,
  set: (v: string[]) => { localData.value.memories.emotions = v }
})
const foreshadowing = computed({
  get: () => localData.value.memories.foreshadowing,
  set: (v: string[]) => { localData.value.memories.foreshadowing = v }
})
const relationshipChanges = computed({
  get: () => localData.value.memories.relationshipChanges,
  set: (v: string[]) => { localData.value.memories.relationshipChanges = v }
})
const characterStates = computed(() => localData.value.memories.characterStates)
const plotArcs = computed(() => localData.value.plotArcs)
const graphData = computed(() => localData.value.graph.chapterGraph)

// === 各 tab 内的 add/remove 方法(照搬 v2,删除 timeline 相关) ===
function addMainMemory() {
  localData.value.memories.memories.push({
    content: '',
    tags: ['main-plot'],
    importance: 7,
    fromChapterNumber: Number(props.pending?.meta?.chapterNumber ?? 0)
  })
}
function addSideMemory() {
  localData.value.memories.memories.push({
    content: '',
    tags: ['side-plot'],
    importance: 5,
    fromChapterNumber: Number(props.pending?.meta?.chapterNumber ?? 0)
  })
}
function removeMemory(mem: any) {
  confirmRemove(`删除该记忆?\n\n"${(mem.content || '').slice(0, 60)}"`, () => {
    const idx = localData.value.memories.memories.indexOf(mem)
    if (idx >= 0) localData.value.memories.memories.splice(idx, 1)
  })
}
function addCharacterState() {
  localData.value.memories.characterStates.push({
    characterId: null,
    name: '新角色',
    key: '',
    status: '{}',
    relationships: '{}',
    isNew: true
  })
}
function removeCharacterState(idx: number) {
  confirmRemove('删除该角色状态?', () => {
    localData.value.memories.characterStates.splice(idx, 1)
  })
}
function addPlotArc() {
  localData.value.plotArcs.push({
    name: '新弧线',
    type: 'side',
    status: 'active',
    progress: 0,
    currentStage: '',
    nextGoal: '',
    summary: '',
    unresolved: '[]',
    stages: '[]',
    isNew: true
  })
}
function removePlotArc(idx: number) {
  confirmRemove('删除该剧情弧线?', () => {
    localData.value.plotArcs.splice(idx, 1)
  })
}
function onGraphUpdate(next: { nodes: any[]; edges: any[] }) {
  localData.value.graph.chapterGraph = next
}

// === 底部三按钮 ===
function handleSave() {
  saving.value = true
  try { emit('save', toV3(localData.value, props.pending)) }
  finally { setTimeout(() => { saving.value = false }, 200) }
}
function handleConfirm() {
  confirming.value = true
  try { emit('confirm', toV3(localData.value, props.pending)) }
  finally { setTimeout(() => { confirming.value = false }, 200) }
}
</script>

<style scoped>
/* === tab header 状态圆点 === */
.rp-tab-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.rp-tab-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

/* === stage 失败提示条: 暖底红字 === */
.rp-stage-error {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 10px 14px;
  margin-bottom: 8px;
  border-radius: 6px;
  background: rgba(217, 75, 75, 0.08);
  border: 1px solid rgba(217, 75, 75, 0.35);
  color: #a83232;
  font-size: 13px;
  line-height: 1.5;
}
/* === stage 操作行: 重新解析按钮 (始终可见,失败时与 .rp-stage-error 联动) === */
.rp-stage-actions {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 12px;
}

/* === Editorial storyboard entry — plot arc card ===
   卡片像杂志条目: meta (序号 + chips) + 大标题 + 编号字段 eyebrow。
   暖色 canvas 上纯白卡 + 1px pebble border, 无 shadow (继承 .cap-card 的扁平纸张感)。
   hover 时 1px border 转 mid-gray + 微抬升 1px, 与 .cap-card.is-interactive 风格一致。*/

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

/* === 头部: meta (序号 + chips) + 大标题,合并展示 ===
   上下两层:
   - 上层 meta: 序号左对齐, chips 右对齐 (justify-between)
   - 下层 title: arc.name 22px 大标题, 跟 meta 紧凑相邻 */
.cap-arc-card__head {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.cap-arc-card__head-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
  min-height: 22px;
}
.cap-arc-card__head-chips {
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
  font-size: var(--text-subheading-size); /* 20px — 跟 chips 视觉层次更和谐 */
  font-weight: var(--weight-semibold);
  line-height: 1.4;
  color: var(--text-primary);
  letter-spacing: -0.005em;
  word-break: break-word;
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
}
.cap-arc-card__title-text {
  flex: 1 1 auto;
  min-width: 0;
}
.cap-arc-card__new-tag {
  flex: 0 0 auto;
  font-size: 10px;
  height: 18px;
  padding: 0 7px;
  letter-spacing: 0.08em;
  line-height: 18px;
  align-self: center;
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

/* =================================================================
   本章摘要卡片 — 印刷感引文块
   ----------------------------------------------------------------
   设计意图 (2026-06-28 用户反馈 "不那么平淡也不那么炫酷"):
     - banner 下常驻卡片原本是裸 n-card + n-input, 与其他 tab 内的
       n-card 视觉完全一样, 没有层级区分, 显得"平淡"
     - 这里用"引文 / 印刷感"语义包装: 巨号引号 + 内嵌 textarea + 字符
       计数 hint, 让用户感觉是在"写一句给读者看的话"而非"填一个表单字段"
   ================================================================= */
.cap-summary-card {
  position: relative;
  background: var(--bg-card);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-card);
  transition: border-color 0.18s ease, transform 0.18s ease;
}
.cap-summary-card:hover {
  border-color: var(--color-mid-gray);
  transform: translateY(-1px);
}
.cap-summary-card :deep(.n-card-header) {
  padding-bottom: 0;
  border-bottom: none;
}
.cap-summary-card :deep(.n-card__content) {
  padding-top: 4px;
}
.cap-summary-card__head {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.cap-summary-card__title {
  margin: 0;
  font-size: var(--text-subheading-size);
  font-weight: var(--weight-semibold);
  line-height: 1.4;
  color: var(--text-primary);
  letter-spacing: -0.005em;
}
/* 引文块: 巨号引号 + 内嵌 textarea */
.cap-summary-card__body {
  position: relative;
  padding: 4px 8px 4px 32px;
}
.cap-summary-card__quote-mark {
  position: absolute;
  left: 0;
  top: -8px;
  font-family: var(--font-sans);
  font-size: 56px;
  line-height: 1;
  font-weight: var(--weight-bold);
  color: var(--accent);
  opacity: 0.55;
  user-select: none;
  pointer-events: none;
}
/* 内嵌 textarea: 去边框 + 透明底, 跟卡片白底融成"印在纸上"的感觉 */
.cap-summary-card__input :deep(textarea) {
  background: transparent !important;
  border: none !important;
  padding: 0 !important;
  font-family: var(--font-sans);
  font-size: 14px;
  line-height: 1.65;
  letter-spacing: 0.01em;
  color: var(--text-primary);
  font-weight: var(--weight-regular);
  resize: vertical;
  min-height: 60px;
}
.cap-summary-card__input :deep(textarea::placeholder) {
  color: var(--color-placeholder);
  font-style: italic;
}
.cap-summary-card__input :deep(.n-input__border),
.cap-summary-card__input :deep(.n-input__state-border) {
  display: none !important;
}
.cap-summary-card__foot {
  margin-top: 4px;
  padding: 8px 0 0;
  border-top: 1px dashed var(--border-subtle);
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: var(--text-caption-size);
  letter-spacing: 0.04em;
}
.cap-summary-card__hint {
  color: var(--text-tertiary);
  font-style: italic;
}
.cap-summary-card__count {
  font-family: var(--font-mono);
  color: var(--text-tertiary);
  font-weight: var(--weight-semibold);
  font-variant-numeric: tabular-nums;
}

/* =================================================================
   角色 tab 内的角色状态卡片 — 角色表 (跟剧情弧线卡片同构)
   ----------------------------------------------------------------
   保留 .cap-character-card__item 内层卡片样式 (跟 .cap-arc-card 同构:
   白底 + 1px border + 6px radius + 18px 20px 16px padding + hover 抬升
   + cap-rise staggered reveal), 卡片内 2 字段 (状态 / 关系 JSON) 单列竖排。
   ================================================================= */
/* 2 列 grid (跟剧情弧线卡片同构) */
.cap-character-card__grid {
  margin-bottom: 12px;
}
/* 角色状态卡片 — 与 .cap-arc-card 同构 */
.cap-character-card__item {
  position: relative;
  background: var(--bg-card);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-card);
  padding: 18px 20px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  transition: border-color 0.18s ease, transform 0.18s ease;
}
.cap-character-card__item:hover {
  border-color: var(--color-mid-gray);
  transform: translateY(-1px);
}
/* 头部: meta (N° 编号) + 大标题等价物 (角色名) + 删除按钮 */
.cap-character-card__item-head {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.cap-character-card__item-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
  min-height: 22px;
}
.cap-character-card__item-no {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: var(--weight-semibold);
  letter-spacing: 0.08em;
  color: var(--text-tertiary);
  text-transform: uppercase;
}
.cap-character-card__item-no-sep {
  color: var(--color-mid-gray);
  font-weight: var(--weight-regular);
}
.cap-character-card__item-remove {
  flex-shrink: 0;
  align-self: flex-end;
}
/* 角色名 — h3 大标题等价物 */
.cap-character-card__item-name-wrap {
  margin: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.cap-character-card__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.cap-character-card__field-label {
  font-size: var(--text-caption-size);
  font-weight: var(--weight-semibold);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-tertiary);
  line-height: 1;
}
/* JSON 输入: mono 字体 + 1px 细边框, 跟卡片白底形成 "档案抽屉" 感 */
.cap-character-card__json-input :deep(textarea) {
  font-family: var(--font-mono) !important;
  font-size: 12px !important;
  line-height: 1.55 !important;
  letter-spacing: 0.01em;
  background: var(--bg-card);
}
.cap-character-card__foot {
  margin-top: 12px;
  display: flex;
  justify-content: flex-start;
}
.cap-character-card__add {
  /* cap-pill is-sm is-primary 已定义, 这里只调一下节奏 */
  letter-spacing: 0.04em;
}
</style>
