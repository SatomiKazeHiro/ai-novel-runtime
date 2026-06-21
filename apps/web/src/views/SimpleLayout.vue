<template>
  <n-layout class="simple-layout">
    <NavBar />
    <n-layout-content class="simple-layout__content">
      <div class="cap-page cap-shell">
        <router-view />
      </div>
    </n-layout-content>
  </n-layout>
</template>

<script setup lang="ts">
import { NLayout, NLayoutContent } from 'naive-ui'
import NavBar from '../components/NavBar.vue'
</script>

<style scoped>
.simple-layout {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--bg-canvas);
  /* 覆盖 .n-layout 默认 overflow: hidden, 让内容 min-width 能撑出
     横向滚动条到底层 document, 防止窄屏挤压表格列 / 表单控件。 */
  overflow: visible;
}
/* Naive UI 在 .n-layout 内部套的 .n-layout-scroll-container
   默认 overflow-x: hidden, 同样要覆盖, 溢出才能传到 document。 */
.simple-layout :deep(.n-layout-scroll-container) {
  overflow: visible;
}
.simple-layout__content {
  flex: 1;
  overflow-y: auto;
  min-width: var(--page-min-width);
}
</style>
