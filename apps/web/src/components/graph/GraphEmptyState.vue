<template>
  <div class="graph-empty" data-testid="graph-empty-state">
    <n-empty
      description="暂无已归档章节，先在章节编辑器完成一次归档再来看图谱"
      size="large"
    >
      <template #extra>
        <n-text depth="3">
          图谱会随着每次章节归档自动累积，本视图只展示已归档章节。
        </n-text>
      </template>
    </n-empty>
  </div>
</template>

<script setup lang="ts">
import { NEmpty, NText } from 'naive-ui'
</script>

<style scoped>
.graph-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 60vh;
  padding: 32px;
}
</style>
