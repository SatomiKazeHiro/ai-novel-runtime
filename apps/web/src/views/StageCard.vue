<template>
  <div class="stage-card" :data-status="state?.status || 'pending'">
    <!-- 左侧色条:按 status 着色 (success=绿 / failed=红 / running=蓝图蓝 / pending=灰) -->
    <span class="sc-bar" :data-status="state?.status || 'pending'" aria-hidden="true" />

    <header class="sc-header">
      <h3 class="sc-title">{{ title }}</h3>
      <span class="sc-status" :data-status="state?.status || 'pending'">
        {{ statusLabel }}
      </span>
    </header>

    <div v-if="state?.status === 'failed'" class="sc-body sc-body--failed">
      <div class="sc-section">
        <div class="sc-row">
          <span class="sc-label">错误信息</span>
          <span class="sc-error-text">{{ state?.errorMessage || '本次失败,请按"重新解析"重试' }}</span>
        </div>
        <div class="sc-row">
          <span class="sc-label">建议操作</span>
          <span class="sc-hint">点击右下"重新解析"重试本阶段</span>
        </div>
      </div>
    </div>

    <div v-else-if="state?.status === 'running'" class="sc-body sc-body--running">
      <n-spin />
      <span class="sc-running-text">正在解析…</span>
    </div>

    <div v-else-if="state?.status === 'success'" class="sc-body sc-body--success">
      <slot :result="state?.result">
        <p class="sc-text-muted">提取完成</p>
      </slot>
    </div>

    <div v-else class="sc-body sc-body--pending">
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
/* === Card shell: 左侧色条 + 描边 + 分块 === */
.stage-card {
  position: relative;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-card);
  background: var(--color-pure-white);
  padding: var(--space-4) var(--space-4) var(--space-4) calc(var(--space-4) + 6px);
  overflow: hidden;
}

/* 左侧 4px 色条:绝对定位,不抢布局空间 */
.sc-bar {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 4px;
  background: var(--color-stone-gray);
}
.sc-bar[data-status="success"] { background: var(--color-positive); }
.sc-bar[data-status="failed"]  { background: var(--color-error); }
.sc-bar[data-status="running"] { background: var(--color-cool-accent); }
.sc-bar[data-status="pending"] { background: var(--color-stone-gray); }

/* 卡片外圈描边按 status 轻染色 */
.stage-card[data-status="failed"]  { border-color: var(--color-error); }
.stage-card[data-status="success"] { border-color: var(--color-positive); }
.stage-card[data-status="running"] { border-color: var(--color-cool-accent); }

/* === Header === */
.sc-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding-bottom: var(--space-3);
  border-bottom: 1px solid var(--border-default);
  margin-bottom: var(--space-3);
}
.sc-title {
  margin: 0;
  font-size: 14px;
  font-weight: var(--weight-semibold);
  color: var(--text-primary);
  letter-spacing: 0.02em;
}

/* 状态徽章:实心色块 + 白字 */
.sc-status {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  padding: 2px 10px;
  border-radius: var(--radius-badge);
  background: var(--color-stone-gray);
  color: var(--text-secondary);
  letter-spacing: 0.04em;
}
.sc-status[data-status="success"] {
  background: var(--color-positive);
  color: #ffffff;
}
.sc-status[data-status="failed"] {
  background: var(--color-error);
  color: #ffffff;
}
.sc-status[data-status="running"] {
  background: var(--color-cool-accent);
  color: #ffffff;
}
.sc-status[data-status="pending"] {
  background: var(--color-stone-gray);
  color: var(--text-secondary);
}

/* === Body shared === */
.sc-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

/* failed body: 带左侧色条的失败条 */
.sc-body--failed {
  padding: var(--space-3);
  background: var(--color-error-tint);
  border: 1px solid var(--color-error);
  border-radius: var(--radius-card);
}
.sc-body--running {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
  padding: var(--space-6) var(--space-4);
  background: var(--color-cool-accent-tint);
  border: 1px dashed var(--color-cool-accent);
  border-radius: var(--radius-card);
}
.sc-running-text {
  font-size: 12px;
  color: var(--color-cool-accent);
  letter-spacing: 0.04em;
}

/* failed 分块:标签 + 值 */
.sc-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.sc-row {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  font-size: 13px;
}
.sc-label {
  flex: 0 0 80px;
  font-weight: var(--weight-semibold);
  color: var(--text-secondary);
  font-size: 12px;
}
.sc-error-text {
  color: var(--color-error);
  font-weight: var(--weight-semibold);
  word-break: break-word;
}
.sc-hint {
  color: var(--text-tertiary);
  font-size: 12px;
}

.sc-text-muted {
  margin: 0;
  font-size: 13px;
  color: var(--text-tertiary);
}
</style>
