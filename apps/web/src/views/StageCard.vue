<template>
  <!-- stage-card 不再持有自己的外框,由父级 ReviewingPanel 提供单一卡片壳 -->
  <div class="stage-card" :data-status="dataStatus">
    <header class="sc-header">
      <div class="sc-heading">
        <h3 class="sc-title">{{ title }}</h3>
        <p v-if="caption" class="sc-caption">{{ caption }}</p>
      </div>

      <!-- 状态点:取代此前的印/驳/待 双线外框,8px 圆点 + data-status 着色 -->
      <span class="sc-dot" :data-status="status" :title="status" aria-hidden="true"></span>
    </header>

    <div v-if="status === 'failed'" class="sc-error">
      <span class="sc-error-mark" aria-hidden="true">×</span>
      <span class="sc-error-text">{{ state?.errorMessage || '本次解析未通过,点"再校"重试本阶段' }}</span>
    </div>

    <div v-else-if="status === 'running'" class="sc-state">
      <n-spin :size="16" />
      <span>正在解析…</span>
    </div>

    <div v-else-if="status === 'success'" class="sc-body">
      <slot :result="state?.result">
        <p class="sc-state">提取完成</p>
      </slot>
    </div>

    <div v-else class="sc-state">
      <span>等待开始</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { NSpin } from 'naive-ui'

defineEmits<{
  /** 子级 StageResultView 发出,父级 ReviewingPanel 监听并再 emit 到上一层 */
  (e: 'delete-row', section: string, index: number): void
}>()

const props = defineProps<{
  stageName: 'character' | 'memory' | 'plotArc' | 'graph'
  state?: {
    status: string
    result?: unknown
    errorMessage?: string
    extractedAt?: string
    chapterNumber?: number | string
  }
}>()

const status = computed(() => props.state?.status || 'pending')

/**
 * data-status:
 * - failed → 列级别错误处理(下边缘红线 + 标题加粗)
 * - empty  → 列级别空态降透明度 (success 但 result 无内容)
 * - 其他   → 不渲染,交给默认主题
 */
const dataStatus = computed(() => {
  if (status.value === 'failed') return 'failed'
  if (status.value === 'success') {
    const r = props.state?.result as null | undefined | Record<string, unknown>
    if (r === null || r === undefined) return 'empty'
    const { mainEvents, sideEvents, scenes, characterStates, plotArcs, chapterGraph } = r as any
    const sum =
      (mainEvents?.length ?? 0) +
      (sideEvents?.length ?? 0) +
      (scenes?.length ?? 0) +
      (characterStates?.length ?? 0) +
      (plotArcs?.length ?? 0)
    const graphCount =
      (chapterGraph?.nodes?.length ?? 0) + (chapterGraph?.edges?.length ?? 0)
    if (sum === 0 && graphCount === 0) return 'empty'
  }
  return status.value
})

const title = computed(() => ({
  character: '角色状态',
  memory: '记忆提取',
  plotArc: '剧情弧线',
  graph: '本章图谱'
}[props.stageName]))

/** header 下方 caption:仅在 state 携带提取信息时渲染 */
const caption = computed(() => {
  const at = props.state?.extractedAt
  const n = props.state?.chapterNumber
  if (!at && n === undefined) return ''
  const parts: string[] = []
  if (at) parts.push(`提取于 ${at}`)
  if (n !== undefined) parts.push(`章节 #${n}`)
  return parts.join(' · ')
})
</script>

<style scoped>
/* column 内不持外框:背景透明,由 grid 单层边框串联 */
.stage-card {
  position: relative;
  padding: 20px;
  background: transparent;
}

/* === Header === */
.sc-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-4);
}

.sc-heading {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.sc-title {
  margin: 0;
  font-family: 'Songti SC', 'STSong', 'Noto Serif CJK SC', serif;
  font-size: 16px;
  font-weight: var(--weight-semibold);
  color: var(--color-ink-black);
  letter-spacing: 0.02em;
  line-height: 1.4;
}

/* 失败列标题加粗 */
.stage-card[data-status='failed'] .sc-title {
  font-weight: var(--weight-bold);
}

.sc-caption {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--color-muted-ash);
  letter-spacing: 0.02em;
}

/* === 状态点 === */
.sc-dot {
  flex: 0 0 auto;
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-muted-ash);
  margin-top: 6px;
}
.sc-dot[data-status='success'] { background: var(--color-positive); }
.sc-dot[data-status='failed']  { background: var(--color-error); }
.sc-dot[data-status='running'] { background: var(--color-warm-accent); }
.sc-dot[data-status='pending'] { background: var(--color-muted-ash); }

/* === Body / states === */
.sc-body {
  margin-top: var(--space-4);
}

/* empty 列:整体降透明度 */
.stage-card[data-status='empty'] .sc-body,
.stage-card[data-status='empty'] .sc-state,
.stage-card[data-status='empty'] .sc-caption {
  opacity: 0.55;
}
.stage-card[data-status='empty'] .sc-title {
  color: var(--color-muted-ash);
}

.sc-state {
  margin: var(--space-4) 0 0;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: 13px;
  color: var(--color-muted-ash);
}

/* 失败:一行错误文字,无背景 tint */
.sc-error {
  margin-top: var(--space-3);
  display: flex;
  align-items: flex-start;
  gap: 6px;
  font-size: 13px;
  color: var(--color-error);
  line-height: 1.5;
}
.sc-error-mark {
  flex: 0 0 auto;
  font-weight: var(--weight-bold);
  line-height: 1.5;
}
.sc-error-text {
  word-break: break-word;
}
</style>
