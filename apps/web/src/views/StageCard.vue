<template>
  <div class="stage-card" :data-status="status">
    <header class="sc-header">
      <div class="sc-heading">
        <h3 class="sc-title">{{ title }}</h3>
        <p v-if="caption" class="sc-caption">{{ caption }}</p>
      </div>

      <!-- 勘印章:平方双线外框 + 中心一字 -->
      <span class="sc-seal" :data-status="status" :title="statusLabel" aria-hidden="true">
        <span class="sc-seal-char">{{ sealChar }}</span>
      </span>
    </header>

    <div v-if="status === 'failed'" class="sc-error">
      <span class="sc-error-mark" aria-hidden="true">×</span>
      <span class="sc-error-text">{{ state?.errorMessage || '本次解析未通过，点“再校”重试本阶段' }}</span>
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

const title = computed(() => ({
  character: '角色状态',
  memory: '记忆提取',
  plotArc: '剧情弧线',
  graph: '本章图谱'
}[props.stageName]))

const statusLabel = computed(() => ({
  pending: '待校',
  running: '待校',
  success: '已勘印',
  failed: '驳回'
} as Record<string, string>)[status.value])

/** 勘印章中心字：印(通过) / 驳(失败) / 待(待校或进行中)。 */
const sealChar = computed(() => ({
  success: '印',
  failed: '驳',
  running: '待',
  pending: '待'
} as Record<string, string>)[status.value])

/** header 右侧 caption：仅在 state 携带提取信息时渲染。 */
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
/* 古籍校样终审：纯白纸面 + 单线细边，无色条、无装饰、无实心徽章。 */
.stage-card {
  position: relative;
  border: 1px solid var(--color-pebble-border);
  border-radius: var(--radius-card);
  background: var(--color-pure-white);
  padding: 20px;
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

.sc-caption {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--color-muted-ash);
  letter-spacing: 0.02em;
}

/* === 勘印章 === */
.sc-seal {
  flex: 0 0 auto;
  position: relative;
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  /* 外粗线 */
  border: 1px solid currentColor;
  border-radius: 2px;
  color: var(--color-muted-ash);
}
/* 内细线：靠 inset box-shadow 画第二道框，形成“双线外框” */
.sc-seal::before {
  content: '';
  position: absolute;
  inset: 2px;
  border: 0.5px solid currentColor;
  border-radius: 1px;
  opacity: 0.55;
  pointer-events: none;
}
.sc-seal-char {
  font-family: 'Songti SC', 'STSong', 'Noto Serif CJK SC', serif;
  font-size: 14px;
  font-weight: var(--weight-semibold);
  line-height: 1;
  color: currentColor;
}

.sc-seal[data-status='success'] {
  color: var(--color-ink-black);
  /* 极淡外阴影模拟红泥沁染 */
  box-shadow: 0 0 6px rgba(185, 76, 76, 0.10);
}
.sc-seal[data-status='failed'] { color: var(--color-error); }
.sc-seal[data-status='running'] { color: var(--color-warm-accent); }
.sc-seal[data-status='pending'] { color: var(--color-muted-ash); }

/* === Body / states === */
.sc-body {
  margin-top: var(--space-4);
}

.sc-state {
  margin: var(--space-4) 0 0;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: 13px;
  color: var(--color-muted-ash);
}

/* 失败：一行错误文字，无背景 tint */
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
