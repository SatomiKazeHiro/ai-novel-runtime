<template>
  <div>
    <header class="page-head">
      <div class="page-head__text">
        <span class="cap-eyebrow is-accent">V2 · PLOT ARCS</span>
        <h1 class="page-head__title">剧情弧线</h1>
        <p class="page-head__lede cap-body-sm">追踪每条剧情线的状态与演进，支持激活/中断/完成/关闭四种状态。</p>
      </div>
    </header>

    <div class="cap-card" style="padding: 16px">
      <n-tabs v-model:value="activeStatus" type="segment" @update:value="loadArcs">
        <n-tab-pane v-for="s in statusOptions" :key="s.value" :name="s.value" :tab="s.label" />
      </n-tabs>

      <div v-if="loading" style="padding: 40px; text-align: center; color: var(--text-tertiary)">加载中...</div>

      <template v-else>
        <div v-if="arcs.length === 0" style="padding: 40px; text-align: center; color: var(--text-tertiary)">
          暂无剧情弧线数据
        </div>

        <div v-else class="arc-grid">
          <div v-for="arc in arcs" :key="arc.id" class="arc-card" :class="{ 'is-mainline': arc.isMainline }">
            <div class="arc-card__top">
              <div class="arc-card__title-row">
                <span v-if="arc.isMainline" class="mainline-badge" title="主角参与 · 主线">★ 主线</span>
                <h3 class="arc-card__title">{{ arc.title }}</h3>
              </div>
              <n-tag :type="statusTagType(arc.status)" :bordered="false" size="small">
                {{ statusLabel(arc.status) }}
              </n-tag>
            </div>
            <p class="arc-card__desc">{{ arc.description || '暂无描述' }}</p>
            <div class="arc-card__meta">
              <span>首章：第 {{ arc.firstChapterNumber }} 章</span>
              <span>最近：第 {{ arc.lastUpdateChapterNumber }} 章</span>
              <span class="arc-card__gap">
                跨度 {{ arc.lastUpdateChapterNumber - arc.firstChapterNumber + 1 }} 章
              </span>
            </div>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { NTabs, NTabPane, NTag } from 'naive-ui'
import { v2PlotArcsApi } from '../api-v2/plotArcs'

const statusLabels: Record<string, string> = {
  active: '激活',
  interrupted: '中断',
  completed: '完成',
  closed: '关闭'
}

const statusTagTypes: Record<string, 'success' | 'warning' | 'info' | 'default'> = {
  active: 'success',
  interrupted: 'warning',
  completed: 'info',
  closed: 'default'
}

const route = useRoute()
const arcs = ref<any[]>([])
const loading = ref(false)
const activeStatus = ref('all')

const statusOptions = [
  { value: 'all', label: '全部' },
  { value: 'active', label: '激活' },
  { value: 'interrupted', label: '中断' },
  { value: 'completed', label: '完成' },
  { value: 'closed', label: '关闭' }
]

function statusLabel(s: string) { return statusLabels[s] || s }
function statusTagType(s: string) { return statusTagTypes[s] || 'default' }

async function loadArcs() {
  const sid = route.params.storyId as string
  if (!sid) {
    arcs.value = []
    return
  }
  loading.value = true
  try {
    const filterStatus = activeStatus.value === 'all' ? undefined : activeStatus.value
    const res = await v2PlotArcsApi.list(sid, filterStatus)
    arcs.value = res.data.data ?? []
  } finally {
    loading.value = false
  }
}

watch(() => route.params.storyId, () => { loadArcs() })
onMounted(() => { if (route.params.storyId) loadArcs() })
</script>

<style scoped>
.arc-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
  gap: 16px;
  margin-top: 16px;
}
.arc-card {
  border: 1px solid var(--border-default);
  border-radius: 8px;
  padding: 16px 20px;
  background: var(--color-pure-white);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.arc-card:hover {
  border-color: var(--color-mid-gray);
  box-shadow: 0 1px 6px rgba(0,0,0,0.04);
}
.arc-card.is-mainline {
  border-left: 3px solid var(--color-protagonist);
}
.arc-card__top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 8px;
}
.arc-card__title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}
.mainline-badge {
  font-size: 11px;
  font-weight: var(--weight-semibold);
  color: var(--color-protagonist);
  white-space: nowrap;
  flex-shrink: 0;
}
.arc-card__title {
  margin: 0;
  font-size: 15px;
  font-weight: var(--weight-semibold);
  color: var(--color-ink-black);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.arc-card__desc {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.6;
  margin: 0 0 12px;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.arc-card__meta {
  display: flex;
  gap: 16px;
  font-size: 12px;
  color: var(--text-tertiary);
}
</style>
