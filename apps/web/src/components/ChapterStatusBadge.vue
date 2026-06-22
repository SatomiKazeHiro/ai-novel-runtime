<template>
  <span class="chapter-status-badge" :data-tone="def.tone">
    <span
      class="chapter-status-badge__dot"
      :class="{ 'chapter-status-badge__dot--pulse': def.pulse }"
    />
    {{ def.label }}
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { getChapterStatus } from '../styles/chapter-status'

const props = defineProps<{
  status?: string
}>()

const def = computed(() => getChapterStatus(props.status))
</script>

<style scoped>
.chapter-status-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 1px 8px 1px 6px;
  border-radius: var(--radius-badge);
  background: var(--color-stone-gray);
  border: 1px solid transparent;
  color: var(--text-tertiary);
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: 0.04em;
  line-height: 1.5;
  flex-shrink: 0;
  font-weight: var(--weight-semibold);
  white-space: nowrap;
}

.chapter-status-badge__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  flex-shrink: 0;
}

.chapter-status-badge[data-tone="warm"] {
  color: var(--accent);
  background: var(--color-warm-accent-tint);
}
.chapter-status-badge[data-tone="cool"] {
  color: var(--accent-link);
  background: var(--accent-info-tint);
}
.chapter-status-badge[data-tone="review"] {
  color: var(--color-review);
  background: var(--color-review-tint);
}
.chapter-status-badge[data-tone="positive"] {
  color: var(--color-positive);
  background: var(--color-positive-tint);
}
.chapter-status-badge[data-tone="error"] {
  color: var(--color-error);
  background: var(--color-error-tint);
}
/* 'neutral' (草稿) 留默认 stone-gray + text-tertiary, 不覆盖 */

.chapter-status-badge__dot--pulse {
  animation: chapter-status-pulse 1.05s ease-in-out infinite;
}

@keyframes chapter-status-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}
</style>
