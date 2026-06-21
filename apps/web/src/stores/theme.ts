import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export type ThemeMode = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'novel-runtime:theme'

function getSystemDark() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export const useThemeStore = defineStore('theme', () => {
  const mode = ref<ThemeMode>((localStorage.getItem(STORAGE_KEY) as ThemeMode) || 'system')

  // system 主题变化时 isDark 必须重算;用一个 ref 当 trigger 让 Vue 追踪到
  const systemTick = ref(0)

  const isDark = computed(() => {
    void systemTick.value // 触发响应式追踪
    if (mode.value === 'system') return getSystemDark()
    return mode.value === 'dark'
  })

  function setMode(m: ThemeMode) {
    mode.value = m
    localStorage.setItem(STORAGE_KEY, m)
  }

  // 监听系统主题变化 — 触发 isDark 重算,不动 localStorage
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
  mediaQuery.addEventListener('change', () => {
    if (mode.value === 'system') systemTick.value++
  })

  return { mode, isDark, setMode }
})
