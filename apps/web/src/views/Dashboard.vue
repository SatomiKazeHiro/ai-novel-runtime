<template>
  <div>
    <n-h1>仪表盘</n-h1>
    <n-p>欢迎使用 AI Novel Runtime 系统。</n-p>
    <n-space>
      <n-statistic label="小说工程" :value="stats.stories" />
      <n-statistic label="章节总数" :value="stats.chapters" />
      <n-statistic label="角色数量" :value="stats.characters" />
    </n-space>
    <n-divider />

    <n-h3>系统状态</n-h3>
    <n-alert v-if="health" title="后端服务" type="success">
      运行正常 — {{ health.timestamp }}
    </n-alert>
    <n-alert v-else title="后端服务" type="warning">
      连接中...
    </n-alert>

    <n-divider />
    <n-h3>快速入口</n-h3>
    <n-space>
      <n-button @click="$router.push('/stories')">小说管理</n-button>
      <n-button @click="$router.push('/novel-design/characters')">角色管理</n-button>
      <n-button @click="$router.push('/novel-design/lore')">世界观</n-button>
      <n-button @click="$router.push('/novel-design/chapters')">章节工作台</n-button>
    </n-space>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { NH1, NH3, NP, NStatistic, NSpace, NDivider, NAlert, NButton } from 'naive-ui'
import { api } from '../utils/api'
import { useStoryStore } from '../stores/story'

const storyStore = useStoryStore()
const health = ref<any>(null)
const stats = ref({ stories: 0, chapters: 0, characters: 0 })

function updateStats() {
  const stories = storyStore.stories
  stats.value.stories = stories.length
  stats.value.chapters = stories.reduce((sum: number, s: any) => sum + (s._count?.chapters || 0), 0)
  stats.value.characters = stories.reduce((sum: number, s: any) => sum + (s._count?.characters || 0), 0)
}

onMounted(async () => {
  try {
    const res = await api.get('/api/health')
    health.value = res.data
  } catch (e) {
    console.error('Health check failed', e)
  }
  if (!storyStore.loaded) {
    await storyStore.loadStories()
  }
  updateStats()
})

watch(() => storyStore.stories, updateStats)
</script>
