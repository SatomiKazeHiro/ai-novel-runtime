<template>
  <n-config-provider
    :theme="naiveTheme"
    :theme-overrides="themeOverrides"
    :locale="zhCN"
    :date-locale="dateZhCN"
  >
    <n-loading-bar-provider>
      <n-dialog-provider>
        <n-notification-provider>
          <n-message-provider>
            <router-view />
          </n-message-provider>
        </n-notification-provider>
      </n-dialog-provider>
    </n-loading-bar-provider>
  </n-config-provider>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue'
import {
  NConfigProvider,
  NLoadingBarProvider,
  NDialogProvider,
  NNotificationProvider,
  NMessageProvider,
  zhCN,
  dateZhCN,
  darkTheme
} from 'naive-ui'
import { useThemeStore } from './stores/theme'
import { lightOverrides, darkOverrides } from './styles/naive-theme'

/* 接入层 —— themeOverrides 的完整内容在 ./styles/naive-theme.ts,
   这里只负责根据 isDark 把 themeOverrides 切到 light / dark,
   并把状态写到 :root[data-theme] 让 tokens.css 的 dark 块生效。 */
const themeStore = useThemeStore()

const naiveTheme = computed(() => themeStore.isDark ? darkTheme : null)
const themeOverrides = computed(() => themeStore.isDark ? darkOverrides : lightOverrides)

// 把主题状态写到 :root 的 data-theme 属性, 让 tokens.css 的 [data-theme="dark"] 块生效
// (useThemeStore 初始化时 mode 默认 system, isDark 取决于系统主题)
watch(
  () => themeStore.isDark,
  (dark) => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  },
  { immediate: true }
)
</script>