<template>
  <div v-if="pending" class="reviewing-panel cap-card">
    <header class="rp-header">
      <span class="cap-eyebrow">ARCHIVE REVIEW</span>
      <h2>归档审查</h2>
      <p class="rp-meta">
        提取于 {{ pending.meta?.extractedAt || '未知' }} · 章节 #{{ pending.meta?.chapterNumber ?? '?' }}
      </p>
    </header>

    <StageCard
      v-for="stageName in STAGE_ORDER"
      :key="stageName"
      :stage-name="stageName"
      :state="pending.stages?.[stageName]"
    >
      <template #default="{ result }">
        <StageResultView :stage-name="stageName" :result="result" />
      </template>
    </StageCard>

    <footer class="rp-footer">
      <button class="cap-pill is-ghost" @click="emit('reprepare')">再校 · 重新解析</button>
      <button class="cap-pill is-ghost" @click="emit('cancel')">撤 · 撤销审查</button>
      <button class="cap-pill is-primary" :disabled="!allSuccess" @click="emit('archive')">定稿 · 确认归档</button>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import StageCard from './StageCard.vue'
import StageResultView from './StageResultView.vue'

const STAGE_ORDER = ['character', 'memory', 'plotArc', 'graph'] as const

const props = defineProps<{
  pending: any  // v3 shape: { version: 3, stages: {...}, meta }
}>()

const emit = defineEmits<{
  (e: 'reprepare'): void
  (e: 'cancel'): void
  (e: 'archive'): void
  (e: 'update-stage', stageName: string, result: unknown): void
}>()

const allSuccess = computed(() => {
  if (!props.pending?.stages) return false
  return STAGE_ORDER.every(name => props.pending.stages[name]?.status === 'success')
})
</script>

<style scoped>
.reviewing-panel {
  margin-top: 16px;
  padding: var(--space-5);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.rp-header h2 {
  margin: 4px 0 4px 0;
  font-size: 18px;
  font-weight: var(--weight-semibold);
}
.rp-meta {
  margin: 0;
  font-size: 12px;
  color: var(--text-tertiary);
}

.rp-footer {
  display: flex;
  gap: var(--space-3);
  justify-content: flex-end;
  padding-top: var(--space-4);
  border-top: 1px solid var(--border-default);
}
.rp-footer button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>