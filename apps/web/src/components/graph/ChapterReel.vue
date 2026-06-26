<template>
  <div class="chapter-reel" :aria-label="ariaLabel">
    <button
      class="chapter-reel__nav"
      type="button"
      :disabled="!hasPrev"
      :aria-label="prevLabel"
      @click="goPrev"
    >
      <span aria-hidden="true">‹</span>
    </button>

    <NSelect
      class="chapter-reel__select"
      :value="modelValue"
      :options="options"
      :placeholder="placeholder"
      :consistent-menu-width="false"
      :render-label="renderLabel"
      :render-tag="renderTag"
      @update:value="onSelect"
    />

    <button
      class="chapter-reel__nav"
      type="button"
      :disabled="!hasNext"
      :aria-label="nextLabel"
      @click="goNext"
    >
      <span aria-hidden="true">›</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, h } from 'vue'
import { NSelect, NTag, type SelectOption } from 'naive-ui'

/**
 * ChapterReel — pill-shaped chapter selector with prev/next nav buttons.
 *
 * Design intent:
 * - The pill reads as a film-reel: dropdown is the "film", two knobs on the
 *   ends let you flip through chapters like a director.
 * - Used in GraphView (knowledge graph) as the chapter switcher.
 *
 * Contract:
 * - v-model:value is the selected chapter id (string).
 * - `options` follows NSelect's { label, value } shape.
 * - `on-prev` / `on-next` fire when the arrow buttons are clicked; the
 *   parent is responsible for updating v-model to actually switch.
 */
const props = withDefaults(
  defineProps<{
    modelValue: string
    options: SelectOption[]
    placeholder?: string
    ariaLabel?: string
    prevLabel?: string
    nextLabel?: string
  }>(),
  {
    placeholder: '选择章节',
    ariaLabel: '章节导航',
    prevLabel: '上一章',
    nextLabel: '下一章'
  }
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
  'prev': []
  'next': []
}>()

const placeholder = computed(() => props.placeholder)
const ariaLabel = computed(() => props.ariaLabel)
const prevLabel = computed(() => props.prevLabel)
const nextLabel = computed(() => props.nextLabel)

const hasPrev = computed(() => {
  const idx = currentIndex.value
  return idx > 0
})
const hasNext = computed(() => {
  const idx = currentIndex.value
  return idx >= 0 && idx < props.options.length - 1
})

const currentIndex = computed(() => {
  return props.options.findIndex((o) => o.value === props.modelValue)
})

function onSelect(value: string) {
  emit('update:modelValue', value)
}

function goPrev() {
  if (!hasPrev.value) return
  emit('prev')
  const idx = currentIndex.value
  const next = props.options[idx - 1]
  if (next?.value !== undefined) emit('update:modelValue', next.value as string)
}

function goNext() {
  if (!hasNext.value) return
  emit('next')
  const idx = currentIndex.value
  const next = props.options[idx + 1]
  if (next?.value !== undefined) emit('update:modelValue', next.value as string)
}

function statusTagType(status?: string): 'default' | 'info' | 'warning' | 'success' | 'error' {
  if (status === 'archived') return 'success'
  if (status === 'failed') return 'error'
  if (status === 'reviewing') return 'warning'
  return 'default'
}

function renderLabel(option: SelectOption) {
  const meta = option as SelectOption & { meta?: { number?: number; status?: string } }
  return h('div', { class: 'chapter-reel__option' }, [
    h('span', { class: 'chapter-reel__num' }, meta.meta?.number != null ? `Ch.${meta.meta.number}` : ''),
    h('span', { class: 'chapter-reel__title' }, option.label as string)
  ])
}

function renderTag({ option }: { option: SelectOption }) {
  const meta = option as SelectOption & { meta?: { number?: number; status?: string } }
  const status = meta.meta?.status
  return h('div', { class: 'chapter-reel__option' }, [
    h('span', { class: 'chapter-reel__num' }, meta.meta?.number != null ? `Ch.${meta.meta.number}` : ''),
    h('span', { class: 'chapter-reel__title' }, option.label as string),
    status
      ? h(NTag, {
          size: 'tiny',
          type: statusTagType(status),
          round: true,
          bordered: false,
          style: { marginLeft: 'auto' }
        }, { default: () => statusLabel(status) })
      : null
  ])
}

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    draft: '草稿',
    generating: '生成中',
    generated: '已生成',
    scored: '已评分',
    selected: '已选',
    reviewing: '审阅',
    archived: '已归档',
    failed: '失败'
  }
  return map[status] || status
}
</script>

<style scoped>
:deep(.chapter-reel__option) {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  line-height: 1.2;
  max-width: 100%;
}
:deep(.chapter-reel__num) {
  font-size: 10px;
  font-weight: var(--weight-semibold);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-tertiary);
  flex-shrink: 0;
}
:deep(.chapter-reel__title) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary);
}
</style>
