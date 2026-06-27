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

    <n-modal v-model:show="showModal" preset="card" style="width: 580px">
      <template #header>
        <div class="evt-modal-head">
          <span class="cap-eyebrow">{{ editingId ? 'EDIT · TIMELINE EVENT' : 'NEW · TIMELINE EVENT' }}</span>
          <h2 class="evt-modal-head__title">
            {{ editingId ? '编辑事件' : '添加事件' }}
            <span class="evt-modal-head__time">{{ formatTimelinePosition(form.position) }}</span>
          </h2>
          <p class="cap-body-sm evt-modal-head__lede">
            章节锚点 · 时刻定位 · 事件描述
          </p>
        </div>
      </template>

      <div class="evt-form">
        <section class="evt-field">
          <span class="cap-eyebrow evt-field__label">Chapter · 绑定章节</span>
          <div v-if="editingId" class="evt-chapter-card">
            <div class="evt-chapter-card__icon" aria-hidden="true">
              <svg viewBox="0 0 20 20" width="18" height="18" fill="none">
                <path d="M3.5 3.5h13v13h-13z" stroke="currentColor" stroke-width="1.2"/>
                <path d="M3.5 7.5h13" stroke="currentColor" stroke-width="1.2"/>
                <path d="M6 11.5h8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
                <path d="M6 13.5h5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
              </svg>
            </div>
            <div class="evt-chapter-card__body">
              <span class="evt-chapter-card__title">{{ chapterLabelFor(form.fromChapterNumber) }}</span>
              <span class="evt-chapter-card__meta">编辑模式下章节不可修改 · 由 archive 流程维护</span>
            </div>
            <span class="evt-chapter-card__lock" aria-label="locked">
              <svg viewBox="0 0 20 20" width="12" height="12" fill="none">
                <rect x="4.5" y="9" width="11" height="7.5" rx="1" stroke="currentColor" stroke-width="1.2"/>
                <path d="M7 9V7a3 3 0 0 1 6 0v2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
              </svg>
              LOCKED
            </span>
          </div>
          <n-select
            v-else
            v-model:value="form.fromChapterNumber"
            :options="archivedChapterOptions"
            :disabled="archivedChapterOptions.length === 0"
            placeholder="选择已归档章节"
            @update:value="onChapterChange"
          />
          <span
            v-if="!editingId && archivedChapterOptions.length === 0"
            class="cap-caption evt-field__hint evt-field__hint--warn"
          >
            该故事下尚无已归档章节, 无法添加事件 (需先归档至少一个章节)
          </span>
          <span
            v-else-if="!editingId && form.fromChapterNumber != null"
            class="cap-caption evt-field__hint"
          >
            已绑到 {{ chapterLabelFor(form.fromChapterNumber) }} · 后续可在归档流程追溯
          </span>
        </section>

        <div class="evt-divider" aria-hidden="true"></div>

        <section class="evt-field">
          <span class="cap-eyebrow evt-field__label">Position · 时间位置</span>
          <div class="evt-position">
            <div class="evt-position__input">
              <TimelinePositionInput v-model="form.position" :preview="false" />
            </div>
            <span class="evt-position__preview">{{ formatTimelinePosition(form.position) }}</span>
          </div>
          <span class="cap-caption evt-field__hint">
            Y.DDDHH 编码:整数位=年(负数=前史), 5 位小数=年内第几天(001-365)+小时(00-23)
          </span>
        </section>

        <div class="evt-divider" aria-hidden="true"></div>

        <section class="evt-field">
          <span class="cap-eyebrow evt-field__label">Events · 事件描述</span>
          <DynamicTags v-model="form.events" />
          <span class="cap-caption evt-field__hint">
            回车或 + 添加一条 · × 删除 · 至少 1 条
          </span>
        </section>
      </div>

      <template #footer>
        <div class="evt-modal-foot">
          <button class="cap-pill is-ghost" @click="showModal = false">取消</button>
          <button class="cap-pill is-primary" :disabled="!canSave" @click="handleSave">保存</button>
        </div>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import {
  NSpace, NButton, NModal, NSelect, NText,
  NTimeline, NTimelineItem, NUl, NLi, NEmpty, NSpin,
  useDialog, useMessage
} from 'naive-ui'
import { formatTimelinePosition, DEFAULT_TIMELINE_POSITION } from '@novel-runtime/shared'
import { timelineApi } from '../api/timeline'
import { chaptersApi } from '../api/chapters'
import DynamicTags from '../components/DynamicTags.vue'
import TimelinePositionInput from '../components/TimelinePositionInput.vue'

const route = useRoute()
const dialog = useDialog()
const message = useMessage()
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

/**
 * 由 number 推导显示标签 "第N章 · 标题"。无匹配时回退 "第N章"。
 * locked 态下从 chapters 缓存中查找, 不重新请求。
 */
function chapterLabelFor(chapterNumber: number | null): string {
  if (chapterNumber == null) return '(未选择)'
  const c = chapters.value.find(ch => ch.number === chapterNumber)
  const prefix = c?.isSideStory ? `番外·第${chapterNumber}章` : `第${chapterNumber}章`
  return c?.title ? `${prefix} · ${c.title}` : prefix
}

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

/**
 * 把 axios 错误的 server 业务消息提取出来。Fastify route 失败时 body 通常是
 *   { success: false, error: "..." }
 * 但 axios 把它包在 err.response.data, fetch 失败 / 网络断时 err.response 不存在。
 */
function extractErrorMessage(err: any): string {
  const data = err?.response?.data
  if (data && typeof data === 'object' && typeof data.error === 'string') return data.error
  if (typeof data === 'string' && data) return data
  return err?.message || '请求失败'
}

async function handleSave() {
  if (!route.params.storyId) return
  try {
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
  } catch (err: any) {
    // 409 (PUT position 冲突) / 400 (业务校验) / 500 都给用户看得懂的提示
    // 不关 modal, 让用户改完再保存
    message.error(extractErrorMessage(err))
    return
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

<style scoped>
/* === 编辑/添加事件 modal (boords storyboard frame) ===
   取代 n-form 默认 label-placement=left 排版, 每个字段有独立 cap-eyebrow
   header + 控件 + caption, 用 1px hairline divider 分章节锚点 / 时刻定位 /
   事件描述三段, locked 章节渲染为档案卡片 (cream-tint + lock badge)。 */
.evt-modal-head {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 4px 0 2px;
}
.evt-modal-head__title {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin: 0;
  font-size: var(--text-heading-sm-size);
  font-weight: var(--weight-semibold);
  line-height: var(--text-heading-sm-lh);
  letter-spacing: var(--text-heading-sm-ls);
  color: var(--color-ink-black);
}
.evt-modal-head__time {
  font-family: var(--font-mono);
  font-size: var(--text-body-size);
  font-weight: var(--weight-medium);
  color: var(--accent);
  letter-spacing: 0.04em;
  padding: 2px 8px;
  background: var(--color-warm-accent-tint);
  border-radius: var(--radius-badge);
}
.evt-modal-head__lede {
  margin: 0;
  color: var(--text-tertiary);
}

.evt-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-2) 0 var(--space-3);
}

.evt-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.evt-field__label {
  color: var(--text-tertiary);
}
.evt-field__hint {
  color: var(--text-muted);
  line-height: 1.5;
  display: block;
}
.evt-field__hint--warn {
  color: var(--color-error);
}

.evt-divider {
  height: 1px;
  background: var(--border-subtle);
  margin: var(--space-1) 0;
}

/* 章节 locked 档案卡片: 模仿故事板 "场景档案" 的视觉 */
.evt-chapter-card {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: 10px 12px;
  background: var(--color-stone-gray);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-card);
}
.evt-chapter-card__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: var(--radius-badge);
  background: var(--bg-card);
  color: var(--accent);
  border: 1px solid var(--border-subtle);
  flex-shrink: 0;
}
.evt-chapter-card__body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.evt-chapter-card__title {
  font-size: var(--text-body-size);
  font-weight: var(--weight-semibold);
  color: var(--text-primary);
  letter-spacing: 0.02em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.evt-chapter-card__meta {
  font-size: var(--text-caption-size);
  color: var(--text-muted);
  letter-spacing: 0.025em;
  line-height: 1.4;
}
.evt-chapter-card__lock {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--text-caption-size);
  font-weight: var(--weight-semibold);
  color: var(--text-tertiary);
  letter-spacing: 0.1em;
  padding: 4px 8px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-badge);
  background: var(--bg-card);
  flex-shrink: 0;
  font-family: var(--font-mono);
}

/* 时间位置: input + 右侧大预览徽章 (terracotta tint, 等宽) */
.evt-position {
  display: flex;
  align-items: stretch;
  gap: var(--space-3);
}
.evt-position__input {
  flex: 1;
  min-width: 0;
}
.evt-position__preview {
  display: inline-flex;
  align-items: center;
  font-family: var(--font-mono);
  font-size: var(--text-subheading-size);
  font-weight: var(--weight-semibold);
  color: var(--accent);
  padding: 0 14px;
  background: var(--color-warm-accent-tint);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-card);
  white-space: nowrap;
  letter-spacing: 0.04em;
  flex-shrink: 0;
}

.evt-modal-foot {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: var(--space-2);
  padding-top: var(--space-2);
}
.evt-modal-foot .cap-pill:disabled {
  opacity: 0.45;
  cursor: not-allowed;
  transform: none;
}
</style>
