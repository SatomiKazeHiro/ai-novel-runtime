import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export type ThemeMode = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'novel-runtime:theme'

function getSystemDark() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export const useThemeStore = defineStore('theme', () => {
  const mode = ref<ThemeMode>((localStorage.getItem(STORAGE_KEY) as ThemeMode) || 'system')

  const isDark = computed(() => {
    if (mode.value === 'system') return getSystemDark()
    return mode.value === 'dark'
  })

  function setMode(m: ThemeMode) {
    mode.value = m
    localStorage.setItem(STORAGE_KEY, m)
  }

  // 监听系统主题变化
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
  mediaQuery.addEventListener('change', () => {
    // 当 mode 为 system 时，触发响应式更新
    if (mode.value === 'system') {
      mode.value = 'system'
    }
  })

  return { mode, isDark, setMode }
})
