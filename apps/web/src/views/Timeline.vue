<template>
  <div>
    <header class="page-head">
      <div class="page-head__text">
        <span class="cap-eyebrow">TIMELINE</span>
        <h1 class="page-head__title">时间线</h1>
        <p class="page-head__lede cap-body-sm">章节中的事件按天串联，跨章节保持时序一致。</p>
      </div>
      <div class="page-head__actions">
        <button class="cap-pill is-primary" @click="openAddModal">+ 添加事件</button>
      </div>
    </header>

    <n-spin :show="loading">
      <n-timeline v-if="events.length > 0">
        <n-timeline-item v-for="evt in events" :key="evt.id" type="default" :title="formatTimelinePosition(evt.position)">
          <n-ul>
            <n-li v-for="(desc, idx) in JSON.parse(evt.events)" :key="idx">{{ desc }}</n-li>
          </n-ul>
          <n-text v-if="evt.fromChapterNumber != null" depth="3" style="display:block; margin-bottom: 4px; font-size: 12px">
            来自: 第{{ evt.fromChapterNumber }}章
          </n-text>
          <n-space>
            <n-button size="tiny" @click="startEdit(evt)">编辑</n-button>
            <n-button size="tiny" type="error" @click="handleDelete(evt)">删除</n-button>
          </n-space>
        </n-timeline-item>
      </n-timeline>
      <n-empty v-else description="暂无时间线事件" />
    </n-spin>

    <n-modal v-model:show="showModal" :title="editingId ? '编辑事件' : '添加事件'" preset="card" style="width: 500px">
      <n-form :model="form" label-placement="left" label-width="80">
        <n-form-item v-if="!editingId" label="绑定章节" required>
          <n-select
            v-model:value="form.fromChapterNumber"
            :options="archivedChapterOptions"
            :disabled="archivedChapterOptions.length === 0"
            placeholder="选择已归档章节"
            @update:value="onChapterChange"
          />
          <n-text v-if="archivedChapterOptions.length === 0" depth="3" style="font-size: 12px; margin-top: 4px; display: block">
            该故事下尚无已归档章节, 无法添加事件 (需先归档至少一个章节)。
          </n-text>
        </n-form-item>
        <n-form-item v-if="!editingId" label="时间位置" required>
          <TimelinePositionInput v-model="form.position" />
        </n-form-item>
        <n-form-item v-else label="时间位置" required>
          <TimelinePositionInput v-model="form.position" />
        </n-form-item>
        <n-form-item label="事件">
          <DynamicTags v-model="form.events" />
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showModal = false">取消</n-button>
          <n-button type="primary" :disabled="!canSave" @click="handleSave">保存</n-button>
        </n-space>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import {
  NSpace, NButton, NModal, NForm, NFormItem, NSelect, NText,
  NTimeline, NTimelineItem, NUl, NLi, NEmpty, NSpin,
  useDialog
} from 'naive-ui'
import { formatTimelinePosition, DEFAULT_TIMELINE_POSITION } from '@novel-runtime/shared'
import { timelineApi } from '../api/timeline'
import { chaptersApi } from '../api/chapters'
import DynamicTags from '../components/DynamicTags.vue'
import TimelinePositionInput from '../components/TimelinePositionInput.vue'

const route = useRoute()
const dialog = useDialog()
const events = ref<any[]>([])
const chapters = ref<any[]>([])
const loading = ref(false)
const showModal = ref(false)
const editingId = ref<string | null>(null)
const form = ref<{
  fromChapterNumber: number | null
  position: number
  events: string[]
}>({
  fromChapterNumber: null,
  position: DEFAULT_TIMELINE_POSITION,
  events: []
})

/**
 * 已归档章节下拉选项。
 * - 排除 draft / selected / reviewing / rejected (这些章节的事件未稳定, 不该绑定)
 * - 主线 number 整数 1/2/3..., 番外 number 小数 1.01/1.02 (Float? 兼容)
 * - 排序: 按 number 升序, 与 SQL 顺序一致
 *
 * 设计动机 (2026-06-27): 修复章节删除时 timeline cascade 行为不一致 bug —
 * 之前 UI 创建的事件 fromChapterNumber=NULL, 在章节删除时幸存, 与
 * archive 流程写入的有 fromChapterNumber 事件行为不一致。修复方案: UI
 * 强制选章节, server 端 zod + 业务校验 (apps/server/src/routes/timeline.ts)
 * 双层防御。历史 fromChapterNumber=NULL 行保留不动。
 */
const archivedChapterOptions = computed(() => {
  return chapters.value
    .filter(c => c.status === 'archived')
    .sort((a, b) => a.number - b.number)
    .map(c => ({
      label: c.isSideStory
        ? `番外·第${c.number}章 · ${c.title || '(无标题)'}`
        : `第${c.number}章 · ${c.title || '(无标题)'}`,
      value: c.number
    }))
})

const canSave = computed(() => {
  if (!form.value.events || form.value.events.length === 0) return false
  if (!editingId.value && form.value.fromChapterNumber == null) return false
  return true
})

async function loadTimeline() {
  if (!route.params.storyId) {
    events.value = []
    return
  }
  loading.value = true
  try {
    const res = await timelineApi.list(route.params.storyId as string)
    events.value = res.data.data
  } finally {
    loading.value = false
  }
}

async function loadChapters() {
  if (!route.params.storyId) {
    chapters.value = []
    return
  }
  try {
    const res = await chaptersApi.list(route.params.storyId as string)
    chapters.value = res.data.data || []
  } catch {
    chapters.value = []
  }
}

function resetForm() {
  form.value = {
    fromChapterNumber: null,
    position: DEFAULT_TIMELINE_POSITION,
    events: []
  }
}

/**
 * 选中章节后, 把 position 默认填为该章节已有事件的最大 position + 一个 5-digit 步长。
 * 0 个事件 → DEFAULT_TIMELINE_POSITION (1.00106)。
 * 用户可再手动微调。
 *
 * 2026-06-27 改动:
 *   - 步长 0.00001 (Y.DDDHH 编码的最小刻度 = 1 小时), 确保 +1 步仍在合法 DDDHH 范围
 *   - 加 collision check against 全 story events, 不只是当前章节, 防止跨章节撞 position
 *     (TimelineEvent unique constraint on (storyId, position))
 */
const POSITION_STEP = 0.00001  // 1 小时 = Y.DDDHH 编码的最小单位

function nextFreePosition(seed: number, storyEvents: Array<{ position: number }>): number {
  const taken = new Set(storyEvents.map(e => e.position))
  let candidate = seed
  while (taken.has(candidate)) {
    candidate += POSITION_STEP
  }
  return candidate
}

function onChapterChange(chapterNumber: number | null) {
  if (chapterNumber == null) {
    form.value.position = nextFreePosition(DEFAULT_TIMELINE_POSITION, events.value)
    return
  }
  const chapterEvents = events.value.filter(
    e => e.fromChapterNumber === chapterNumber
  )
  if (chapterEvents.length === 0) {
    form.value.position = nextFreePosition(DEFAULT_TIMELINE_POSITION, events.value)
  } else {
    const max = Math.max(...chapterEvents.map(e => e.position))
    form.value.position = nextFreePosition(max + POSITION_STEP, events.value)
  }
}

function openAddModal() {
  editingId.value = null
  resetForm()
  // 默认绑到 number 最大的已归档章节 (2026-06-27: 用户反馈默认总是第一章很烦)
  if (archivedChapterOptions.value.length > 0) {
    const last = archivedChapterOptions.value[archivedChapterOptions.value.length - 1]
    form.value.fromChapterNumber = last.value
    onChapterChange(form.value.fromChapterNumber)
  }
  showModal.value = true
}

function startEdit(evt: any) {
  editingId.value = evt.id
  form.value = {
    fromChapterNumber: evt.fromChapterNumber ?? null,
    position: evt.position,
    events: JSON.parse(evt.events)
  }
  showModal.value = true
}

async function handleSave() {
  if (!route.params.storyId) return
  if (editingId.value) {
    await timelineApi.update(editingId.value, { position: form.value.position, events: form.value.events })
  } else {
    if (form.value.fromChapterNumber == null) return
    await timelineApi.create(route.params.storyId as string, {
      fromChapterNumber: form.value.fromChapterNumber,
      position: form.value.position,
      events: form.value.events
    })
  }
  showModal.value = false
  editingId.value = null
  resetForm()
  await loadTimeline()
}

function handleDelete(evt: any) {
  dialog.warning({
    title: '确认删除',
    content: `确定要删除 ${formatTimelinePosition(evt.position)} 的时间线事件吗？删除后不可恢复。`,
    positiveText: '删除',
    negativeText: '取消',
    positiveButtonProps: { type: 'error' },
    onPositiveClick: async () => {
      await timelineApi.remove(evt.id)
      await loadTimeline()
    }
  })
}

watch(() => route.params.storyId, () => {
  loadTimeline()
  loadChapters()
})

onMounted(() => {
  if (route.params.storyId) {
    loadTimeline()
    loadChapters()
  }
})
</script>
