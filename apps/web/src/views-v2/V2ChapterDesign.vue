<template>
  <div>
    <header class="page-head">
      <div class="page-head__text">
        <span class="cap-eyebrow is-accent">V2 · CHAPTER DESIGN</span>
        <h1 class="page-head__title">
          <n-button size="small" style="margin-right: 8px" @click="goBack">←</n-button>
          {{ chapter?.title || '章节设计' }}
          <n-tag v-if="chapter" :type="statusTagType(chapter.status)" :bordered="false" size="small" style="margin-left: 12px; vertical-align: middle">
            {{ statusLabel(chapter.status) }}
          </n-tag>
        </h1>
      </div>
    </header>

    <div v-if="loading" style="padding: 40px; text-align: center; color: var(--text-tertiary)">加载中...</div>

    <template v-else-if="chapter">
      <div class="design-grid">
        <!-- 左栏：正文编辑 -->
        <div class="design-main">
          <div class="cap-card" style="margin-bottom: 16px">
            <h2 class="cap-eyebrow" style="margin-top: 0">正文</h2>
            <n-input
              v-model:value="content"
              type="textarea"
              :rows="18"
              placeholder="直接输入正文，或使用下方生成区生产候选文章..."
              :disabled="chapter.status === 'archived'"
              style="font-family: var(--font-serif); font-size: 14px; line-height: 1.8"
            />
            <div v-if="chapter.status !== 'archived'" style="margin-top: 12px; display: flex; justify-content: space-between; align-items: center">
              <span v-if="saveMsg" style="font-size: 12px; color: var(--text-tertiary)">{{ saveMsg }}</span>
              <span v-else></span>
              <n-button type="primary" size="small" @click="saveContent" :loading="saving">保存正文</n-button>
            </div>
            <div v-if="chapter.contentHash" style="margin-top: 8px; font-size: 11px; color: var(--text-tertiary); font-family: monospace">
              SHA256: {{ chapter.contentHash.substring(0, 16) }}...
            </div>
          </div>

          <!-- 生成区 (Phase 4c) -->
          <div class="cap-card" style="margin-bottom: 16px; opacity: 0.5">
            <h2 class="cap-eyebrow" style="margin-top: 0">候选生成</h2>
            <p class="cap-body-sm" style="color: var(--text-tertiary)">Phase 4c 实现 — SSE 流式生成多候选文章</p>
          </div>

          <!-- 分析区 (Phase 4d) -->
          <div class="cap-card" style="margin-bottom: 16px; opacity: 0.5">
            <h2 class="cap-eyebrow" style="margin-top: 0">AI 分析</h2>
            <p class="cap-body-sm" style="color: var(--text-tertiary)">Phase 4d 实现 — 5 路独立分析（角色/记忆/弧线/时间线/图谱）</p>
          </div>
        </div>

        <!-- 右栏：配置 + 操作 -->
        <div class="design-side">
          <div class="cap-card" style="margin-bottom: 16px">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px">
              <h2 class="cap-eyebrow" style="margin: 0">Prompt 配置</h2>
              <n-button v-if="chapter.status !== 'archived'" size="tiny" @click="generateConfig" :loading="configLoading">
                重新生成
              </n-button>
            </div>
            <template v-if="parsedConfig">
              <div class="config-summary">
                <div class="config-item">
                  <span class="config-label">角色</span>
                  <span class="config-val">{{ parsedConfig.characterIds?.length || 0 }} 个</span>
                </div>
                <div class="config-item">
                  <span class="config-label">记忆</span>
                  <span class="config-val">{{ parsedConfig.memoryTypeIds?.length || 0 }} 条</span>
                </div>
                <div class="config-item">
                  <span class="config-label">剧情弧线</span>
                  <span class="config-val">{{ parsedConfig.plotArcIds?.length || 0 }} 条</span>
                </div>
                <div class="config-item">
                  <span class="config-label">世界观</span>
                  <span class="config-val">{{ parsedConfig.loreIds?.length || 0 }} 条</span>
                </div>
              </div>
              <div v-if="parsedConfig.outline" style="margin-top: 8px">
                <span class="config-label">大纲</span>
                <p style="font-size: 13px; color: var(--text-secondary); margin: 4px 0 0">{{ parsedConfig.outline }}</p>
              </div>
            </template>
            <p v-else class="cap-body-sm" style="color: var(--text-tertiary)">
              暂无配置，点击"生成配置"从当前数据自动填充。
            </p>
          </div>

          <!-- 归档操作 (Phase 4d) -->
          <div class="cap-card" style="opacity: 0.5">
            <h2 class="cap-eyebrow" style="margin-top: 0">归档</h2>
            <p class="cap-body-sm" style="color: var(--text-tertiary)">Phase 4d 实现 — hash 校验 + 二次确认 + 事务写入</p>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NButton, NInput, NTag } from 'naive-ui'
import { v2ChaptersApi } from '../api-v2/chapters'

const statusLabels: Record<string, string> = {
  draft: '草稿', generating: '生成中', analyzing: '分析中', archived: '已归档'
}
const statusTagTypes: Record<string, 'default' | 'warning' | 'info' | 'success'> = {
  draft: 'default', generating: 'warning', analyzing: 'info', archived: 'success'
}

const route = useRoute()
const router = useRouter()
const chapter = ref<any>(null)
const loading = ref(false)
const saving = ref(false)
const configLoading = ref(false)
const content = ref('')
const saveMsg = ref('')

const parsedConfig = computed(() => {
  const raw = chapter.value?.config
  if (!raw || raw === '{}') return null
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw
  } catch { return null }
})

function statusLabel(s: string) { return statusLabels[s] || s }
function statusTagType(s: string) { return statusTagTypes[s] || 'default' }

function goBack() {
  const sid = route.params.storyId as string
  router.push(`/novel-design-v2/${sid}/chapters`)
}

async function loadChapter() {
  const chapterId = route.params.chapterId as string
  if (!chapterId) return
  loading.value = true
  try {
    const res = await v2ChaptersApi.detail(chapterId)
    chapter.value = res.data.data
    content.value = chapter.value?.content || ''
  } finally { loading.value = false }
}

async function saveContent() {
  const chapterId = route.params.chapterId as string
  if (!chapterId) return
  saving.value = true
  saveMsg.value = ''
  try {
    const res = await v2ChaptersApi.update(chapterId, { content: content.value })
    chapter.value = res.data.data
    saveMsg.value = '正文已保存'
    setTimeout(() => { saveMsg.value = '' }, 2000)
  } finally { saving.value = false }
}

async function generateConfig() {
  const chapterId = route.params.chapterId as string
  if (!chapterId) return
  configLoading.value = true
  try {
    const res = await v2ChaptersApi.generateConfig(chapterId)
    if (res.data.data) {
      chapter.value.config = JSON.stringify(res.data.data)
    }
  } finally { configLoading.value = false }
}

watch(() => route.params.chapterId, () => { loadChapter() })
onMounted(() => {
  if (route.params.chapterId) loadChapter()
})
</script>

<style scoped>
.design-grid {
  display: grid;
  grid-template-columns: 1fr 360px;
  gap: 20px;
  align-items: start;
}
.config-summary {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.config-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 14px;
}
.config-label {
  color: var(--text-tertiary);
}
.config-val {
  font-weight: var(--weight-semibold);
  color: var(--color-ink-black);
}
</style>
