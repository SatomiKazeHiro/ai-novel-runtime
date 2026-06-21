<template>
  <n-layout-header
    bordered
    class="cap-nav"
  >
    <div class="cap-nav__brand-group">
      <div class="cap-nav__brand" @click="router.push('/')">
        <span class="cap-nav__brand-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="2" y="3" width="18" height="18" rx="4" :fill="markBg"/>
            <path d="M9 9 L14 12 L9 15" :stroke="markAccent" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
            <rect x="16" y="15" width="2" height="2" rx="0.4" :fill="markAccent"/>
          </svg>
        </span>
        <span class="cap-nav__brand-text">AI Novel Runtime</span>
        <span class="cap-nav__brand-version">v0.1.0</span>
      </div>
      <nav class="cap-nav__links">
        <button
          v-for="link in links"
          :key="link.path"
          class="cap-nav__link"
          :class="{ 'is-active': isActive(link.path) }"
          @click="router.push(link.path)"
        >
          {{ link.label }}
        </button>
      </nav>
    </div>

    <div class="cap-nav__actions">
      <button class="cap-nav__link" @click="showSettings = true">
        设置
      </button>
    </div>

    <n-modal v-model:show="showSettings" title="设置" preset="card" style="width: 480px">
      <n-form label-placement="left" label-width="100">
        <n-form-item label="主题">
          <n-radio-group v-model:value="themeStore.mode" @update:value="themeStore.setMode">
            <n-radio-button value="light">白天</n-radio-button>
            <n-radio-button value="dark">黑暗</n-radio-button>
            <n-radio-button value="system">系统</n-radio-button>
          </n-radio-group>
        </n-form-item>
        <n-form-item label="关于">
          <n-text>AI Novel Runtime v0.1.0</n-text>
        </n-form-item>
      </n-form>
    </n-modal>
  </n-layout-header>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  NLayoutHeader, NText,
  NModal, NForm, NFormItem, NRadioGroup, NRadioButton
} from 'naive-ui'
import { useThemeStore } from '../stores/theme'
import { COLOR } from '../styles/tokens'

const route = useRoute()
const router = useRouter()
const themeStore = useThemeStore()
const showSettings = ref(false)

// SVG fill/stroke attributes do not resolve var() — bind literal hex from tokens.
const markBg = COLOR.inkBlack
const markAccent = COLOR.warmAccent

const links = [
  { path: '/', label: '仪表盘' },
  { path: '/stories', label: '小说管理' },
  { path: '/runtime-profiles', label: '写作人格' },
  { path: '/worker-tasks', label: 'Worker Task' },
  { path: '/models', label: '模型管理' }
]

function isActive(path: string) {
  if (path === '/') return route.path === '/'
  return route.path.startsWith(path)
}
</script>

<style scoped>
.cap-nav {
  padding: 0 32px;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
  background: var(--bg-canvas);
  border-bottom: 1px solid var(--border-default);
  position: relative;
}

/* Subtle terracotta underline on the left of the nav — a single thin
   stroke that hints "this is a working storyboard tool" without shouting. */
.cap-nav::after {
  content: '';
  position: absolute;
  bottom: -1px;
  left: 32px;
  width: 64px;
  height: 2px;
  background: var(--accent);
  border-radius: 1px 1px 0 0;
}

.cap-nav__brand-group {
  display: flex;
  align-items: center;
  gap: 40px;
}

.cap-nav__brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  user-select: none;
  transition: opacity 0.15s ease;
}
.cap-nav__brand:hover { opacity: 0.78; }

.cap-nav__brand-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.cap-nav__brand-text {
  font-size: 16px;
  font-weight: var(--weight-semibold);
  color: var(--color-ink-black);
  letter-spacing: -0.005em;
}

.cap-nav__brand-version {
  display: inline-flex;
  align-items: center;
  height: 18px;
  padding: 0 6px;
  border-radius: 3px;
  background: var(--color-stone-gray);
  color: var(--text-tertiary);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: var(--weight-medium);
  letter-spacing: 0.02em;
  line-height: 1;
  font-variant-numeric: tabular-nums lining-nums;
}

.cap-nav__links {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.cap-nav__link {
  background: transparent;
  border: none;
  font-family: inherit;
  font-size: 14px;
  font-weight: var(--weight-medium);
  color: var(--text-secondary);
  padding: 6px 12px;
  border-radius: 6px;
  cursor: pointer;
  transition: color 0.15s ease, background 0.15s ease;
  position: relative;
}
.cap-nav__link:hover {
  color: var(--color-ink-black);
  background: var(--color-stone-gray);
}
.cap-nav__link.is-active {
  color: var(--accent);
}
.cap-nav__link.is-active::after {
  content: '';
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: -17px;
  height: 2px;
  background: var(--accent);
  border-radius: 1px 1px 0 0;
  z-index: 1;
}

.cap-nav__actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
</style>
