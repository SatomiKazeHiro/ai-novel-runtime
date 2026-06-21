import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useThemeStore } from '../theme'
import { mqMock } from '../../__tests__/setup'

const STORAGE_KEY = 'novel-runtime:theme'

describe('useThemeStore', () => {
  beforeEach(() => {
    localStorage.clear()
    mqMock.matches = false
    // 重置 listeners: 之前 store 实例可能已经订阅, 重建 store 后旧 listener 不再生效
    ;(mqMock as any).listeners = new Set()
    mqMock.matches = false
    setActivePinia(createPinia())
  })

  it('reads initial mode from localStorage, falls back to system', () => {
    localStorage.setItem(STORAGE_KEY, 'dark')
    const store = useThemeStore()
    expect(store.mode).toBe('dark')
  })

  it('falls back to system when localStorage is empty', () => {
    const store = useThemeStore()
    expect(store.mode).toBe('system')
  })

  it('setMode(light) makes isDark false', () => {
    const store = useThemeStore()
    store.setMode('light')
    expect(store.mode).toBe('light')
    expect(store.isDark).toBe(false)
    expect(localStorage.getItem(STORAGE_KEY)).toBe('light')
  })

  it('setMode(dark) makes isDark true', () => {
    const store = useThemeStore()
    store.setMode('dark')
    expect(store.isDark).toBe(true)
    expect(localStorage.getItem(STORAGE_KEY)).toBe('dark')
  })

  it('setMode(system) makes isDark follow system (mq false -> false)', () => {
    mqMock.matches = false
    const store = useThemeStore()
    store.setMode('system')
    expect(store.isDark).toBe(false)
  })

  it('setMode(system) makes isDark follow system (mq true -> true)', () => {
    mqMock.matches = true
    const store = useThemeStore()
    store.setMode('system')
    expect(store.isDark).toBe(true)
  })

  it('systemTick triggers isDark recompute when system theme changes', () => {
    mqMock.matches = false
    const store = useThemeStore()
    store.setMode('system')
    expect(store.isDark).toBe(false)

    // 模拟系统切到 dark — 关键: 这条变化不应改 mode, 也不应改 localStorage,
    // 但 isDark 必须重算成 true
    mqMock.matches = true
    mqMock.__triggerChange(true)

    expect(store.isDark).toBe(true)
    expect(store.mode).toBe('system')
    expect(localStorage.getItem(STORAGE_KEY)).toBe('system')
  })

  it('system theme change is a no-op when mode != system', () => {
    mqMock.matches = false
    const store = useThemeStore()
    store.setMode('light')
    expect(store.isDark).toBe(false)

    // 系统切到 dark — 但 mode=light, isDark 应保持 false, 不应被系统覆盖
    mqMock.__triggerChange(true)
    expect(store.isDark).toBe(false)
    expect(store.mode).toBe('light')
  })
})