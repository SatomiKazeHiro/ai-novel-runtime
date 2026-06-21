<template>
  <div ref="wrapperRef" class="cap-dynamic-tags">
    <n-dynamic-tags v-model:value="value" :on-keydown="onTabKeydown" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted } from 'vue'
import { NDynamicTags } from 'naive-ui'

const props = defineProps<{
  modelValue: string[]
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: string[]): void
}>()

const value = computed({
  get: () => props.modelValue,
  set: (v: string[]) => emit('update:modelValue', v)
})

const wrapperRef = ref<HTMLElement | null>(null)

/* Tab 行为 — 解决 n-dynamic-tags 默认跳到下一行的问题:
   - 输入框有内容 + Tab → preventDefault 阻止跳焦, dispatch Enter 触发内部提交
   - 输入框为空 + Tab → 放行, 浏览器默认 Tab 跳到下一字段 */
function onTabKeydown(e: KeyboardEvent) {
  if (e.key !== 'Tab') return
  const target = e.target as HTMLInputElement
  if (target.tagName !== 'INPUT') return
  if (!target.closest('.n-dynamic-tags')) return

  const hasContent = target.value.trim().length > 0
  if (!hasContent) return

  e.preventDefault()
  target.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Enter',
    code: 'Enter',
    keyCode: 13,
    which: 13,
    bubbles: true,
    cancelable: true
  }))
}

/* 给每个 chip 加 title (hover 显示完整内容) — chip 长文本省略时用 */
function syncTitles() {
  const chips = wrapperRef.value?.querySelectorAll('.n-dynamic-tags .n-tag')
  chips?.forEach((chip, idx) => {
    const text = props.modelValue[idx]
    if (text != null) chip.setAttribute('title', text)
  })
}

watch(() => props.modelValue, () => {
  nextTick(syncTitles)
}, { flush: 'post', deep: true })

onMounted(() => {
  nextTick(syncTitles)
})
</script>

<style scoped>
/* chip 长内容省略 + hover 显示完整文本 */
.cap-dynamic-tags :deep(.n-dynamic-tags .n-tag) {
  max-width: 240px;
}
.cap-dynamic-tags :deep(.n-dynamic-tags .n-tag__content) {
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>