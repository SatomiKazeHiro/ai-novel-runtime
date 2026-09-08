<template>
  <div class="stage-card" :data-status="state?.status || 'pending'">
    <header class="sc-header">
      <h3>{{ title }}</h3>
      <span class="sc-status" :data-status="state?.status || 'pending'">
        {{ statusLabel }}
      </span>
    </header>

    <div v-if="state?.status === 'failed'" class="sc-body sc-failed">
      <p class="sc-error">{{ state?.errorMessage || '本次失败,请按"重新解析"重试' }}</p>
    </div>

    <div v-else-if="state?.status === 'running'" class="sc-body sc-running">
      <n-spin />
    </div>

    <div v-else-if="state?.status === 'success'" class="sc-body sc-success">
      <slot :result="state?.result">
        <p class="sc-text-muted">提取完成</p>
      </slot>
    </div>

    <div v-else class="sc-body sc-pending">
      <p class="sc-text-muted">等待开始...</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { NSpin } from 'naive-ui'

const props = defineProps<{
  stageName: 'character' | 'memory' | 'plotArc' | 'graph'
  state?: { status: string; result?: unknown; errorMessage?: string }
}>()

const title = computed(() => ({
  character: '角色状态',
  memory: '记忆提取',
  plotArc: '剧情弧线',
  graph: '本章图谱'
}[props.stageName]))

const statusLabel = computed(() => ({
  pending: '等待中',
  running: '运行中',
  success: '完成',
  failed: '失败'
} as Record<string, string>)[(props.state?.status as string) || 'pending'])
</script>

<style scoped>
.stage-card {
  border: 1px solid var(--border-default);
  border-radius: var(--radius-card);
  background: var(--color-pure-white);
  padding: var(--space-4);
}
.stage-card[data-status="failed"] {
  border-color: var(--color-danger, #c00);
}
.stage-card[data-status="success"] {
  border-color: var(--color-positive, #0a0);
}

.sc-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--space-3);
}
.sc-header h3 {
  margin: 0;
  font-size: 14px;
  font-weight: var(--weight-semibold);
}

.sc-status {
  font-family: var(--font-mono);
  font-size: 11px;
  padding: 2px 8px;
  border-radius: var(--radius-badge);
  background: var(--color-stone-gray);
}
.sc-status[data-status="success"] {
  background: color-mix(in srgb, var(--color-positive, #0a0) 15%, transparent);
  color: var(--color-positive, #0a0);
}
.sc-status[data-status="failed"] {
  background: color-mix(in srgb, var(--color-danger, #c00) 15%, transparent);
  color: var(--color-danger, #c00);
}

.sc-failed .sc-error {
  margin: 0;
  font-size: 13px;
  color: var(--color-danger, #c00);
}

.sc-running {
  display: flex;
  justify-content: center;
  padding: var(--space-4);
}

.sc-text-muted {
  margin: 0;
  font-size: 13px;
  color: var(--text-tertiary);
}
</style>
