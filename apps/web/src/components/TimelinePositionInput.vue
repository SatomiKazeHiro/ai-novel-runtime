<template>
  <n-space :size="8" align="center" :wrap="false" style="width: 100%">
    <n-input-number
      :value="value"
      :step="0.00001"
      :precision="5"
      :min="-99999"
      :max="99999"
      :controls="controls"
      placeholder="如 1.00106 (第1年第1天 06时)"
      style="flex: 1"
      @update:value="onChange"
    />
    <n-tag v-if="preview" size="small" :type="previewValid ? 'success' : 'warning'" style="flex-shrink: 0">
      {{ previewText }}
    </n-tag>
  </n-space>
</template>

<script setup lang="ts">
/**
 * TimelinePositionInput — Y.DDDHH position 共享输入组件
 *
 * 解决分散实现问题 (2026-06-27):
 *   - Timeline.vue / ReviewingPanel.vue 之前各自写 `<n-input-number :step="0.0001">`,
 *     placeholder / 默认值 / step 全不一致
 *   - ReviewingPanel 写过 `1.0101` 这种格式错误 (应是 5 位小数 `1.00106`)
 *
 * 行为:
 *   - step=0.00001, precision=5 → 强制 Y.DDDHH 5 位小数, 避免手算错误
 *   - 旁边实时显示 `formatTimelinePosition(position)` 给人看
 *   - 默认值 `DEFAULT_TIMELINE_POSITION = 1.00106` (从 shared 统一拿)
 *   - 非法值 (NaN, Infinity) → preview 显示 "格式错误", 仍允许编辑
 *
 * Props:
 *   - preview: 是否在右侧显示解码预览 (默认 true)
 *   - controls: 是否显示 n-input-number 的 +/- 步进按钮 (默认 true)
 *     一些 caller (如 ReviewingPanel 2026-06-27) 已经有自己的 hero 显示解码,
 *     不需要步进按钮,可传 false
 *
 * 用法:
 *   <TimelinePositionInput v-model="form.position" />
 *   <TimelinePositionInput v-model="te.position" :preview="false" :controls="false" />
 */
import { computed } from 'vue'
import { NInputNumber, NTag, NSpace } from 'naive-ui'
import { formatTimelinePosition, DEFAULT_TIMELINE_POSITION } from '@novel-runtime/shared'

const props = withDefaults(defineProps<{
  modelValue: number | null
  preview?: boolean  // 是否显示右侧解码预览
  controls?: boolean  // 是否显示 n-input-number 的 +/- 步进按钮
}>(), {
  preview: true,
  controls: true
})

const emit = defineEmits<{
  (e: 'update:modelValue', v: number | null): void
}>()

const value = computed({
  get: () => props.modelValue ?? DEFAULT_TIMELINE_POSITION,
  set: (v: number | null) => emit('update:modelValue', v)
})

function onChange(v: number | null) {
  emit('update:modelValue', v)
}

const previewValid = computed(() => {
  if (props.modelValue == null) return false
  if (!Number.isFinite(props.modelValue)) return false
  return true
})

const previewText = computed(() => {
  if (props.modelValue == null) return '未设置'
  if (!Number.isFinite(props.modelValue)) return '格式错误'
  return formatTimelinePosition(props.modelValue)
})
</script>