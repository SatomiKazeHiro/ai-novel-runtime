<template>
  <div>
    <header class="page-head">
      <div class="page-head__text">
        <span class="cap-eyebrow">PLOT ARCS</span>
        <h1 class="page-head__title">剧情弧线</h1>
        <p class="page-head__lede cap-body-sm">激活 / 待激活 / 完成 / 关闭 的剧情线，及每章的推进点。</p>
      </div>
    </header>

    <div v-if="loading" class="cap-card" style="padding: 24px; text-align: center">
      <n-spin />
    </div>
    <n-empty v-else-if="arcs.length === 0" description="暂无剧情弧线，归档章节后自动生成" />

    <div v-else class="arc-list" style="display: flex; flex-direction: column; gap: 12px">
      <article v-for="arc in arcs" :key="arc.id" class="cap-card" style="padding: 16px">
        <header style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px">
          <div style="display: flex; align-items: center; gap: 8px">
            <span class="cap-chip" :class="arc.isMainline ? 'is-primary' : ''">{{ arc.isMainline ? '主线' : '支线' }}</span>
            <span class="cap-chip" :class="statusChipClass(arc.status)">{{ statusLabel(arc.status) }}</span>
            <h3 class="cap-arc-card__title-text" style="margin: 0">{{ arc.name }}</h3>
          </div>
          <n-button
            v-if="arc.status === 'active' || arc.status === 'inactive'"
            size="small"
            type="error"
            ghost
            @click="closeArc(arc)"
          >关闭</n-button>
        </header>

        <ol style="margin: 0; padding-left: 20px; color: var(--text-2, #666)">
          <li v-for="p in arc.progressPoints" :key="p.id" style="margin-bottom: 4px">
            <strong style="color: var(--text-1, #333)">第{{ p.chapterNumber }}章</strong>
            <span>{{ p.content }}</span>
            <span v-if="p.isEnd" class="cap-chip is-warm" style="margin-left: 8px">尾声</span>
          </li>
        </ol>
      </article>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { NButton, NEmpty, NSpin, useMessage } from 'naive-ui'
import { plotArcApi } from '../api/plot-arc'

const route = useRoute()
const message = useMessage()
const arcs = ref<any[]>([])
const loading = ref(false)

function statusLabel(status: string): string {
  return { active: '激活', inactive: '待激活', completed: '完成', closed: '关闭' }[status] ?? status
}

function statusChipClass(status: string): string {
  return {
    active: 'is-success',
    inactive: 'is-muted',
    completed: 'is-info',
    closed: 'is-warm'
  }[status] ?? ''
}

async function loadArcs() {
  if (!route.params.storyId) return
  loading.value = true
  try {
    const res = await plotArcApi.list(route.params.storyId as string)
    arcs.value = res.data?.data ?? []
  } finally {
    loading.value = false
  }
}

async function closeArc(arc: any) {
  try {
    await plotArcApi.close(arc.id)
    message.success('已关闭')
    await loadArcs()
  } catch (err: any) {
    message.error(err?.response?.data?.error || '关闭失败')
  }
}

onMounted(loadArcs)
</script>
