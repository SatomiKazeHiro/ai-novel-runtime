<template>
  <n-layout style="height: 100vh; display: flex; flex-direction: column;">
    <NavBar />
    <n-layout has-sider style="flex: 1; overflow: hidden;">
      <n-layout-sider
        bordered
        collapse-mode="width"
        :collapsed-width="64"
        :width="200"
        show-trigger
      >
        <div style="padding: 12px; text-align: center; border-bottom: 1px solid var(--n-border-color);">
          <n-text strong style="font-size: 14px;">{{ currentStory?.title || '未知小说' }}</n-text>
        </div>
        <n-menu
          :collapsed-width="64"
          :collapsed-icon-size="22"
          :options="menuOptions"
          :value="activeKey"
          @update:value="handleMenuSelect"
        />
      </n-layout-sider>
      <n-layout-content style="padding: 24px; overflow-y: auto">
        <router-view />
      </n-layout-content>
    </n-layout>
  </n-layout>
</template>

<script setup lang="ts">
import { h, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  NLayout, NLayoutSider, NLayoutContent,
  NMenu, NIcon, NText, type MenuOption
} from 'naive-ui'
import {
  PeopleOutline, GlobeOutline, CreateOutline,
  AnalyticsOutline, LibraryOutline, TimerOutline,
  HammerOutline, CodeWorkingOutline
} from '@vicons/ionicons5'
import NavBar from '../components/NavBar.vue'
import { useStoryStore } from '../stores/story'

const route = useRoute()
const router = useRouter()
const storyStore = useStoryStore()

const storyId = computed(() => route.params.storyId as string)

const currentStory = computed(() =>
  storyStore.stories.find(s => s.id === storyId.value) || null
)

// 进入小说设计空间时，同步 store 中的选中状态
watch(storyId, (id) => {
  if (id && id !== storyStore.selectedStoryId) {
    storyStore.selectStory(id)
  }
}, { immediate: true })

function renderIcon(icon: any) {
  return () => h(NIcon, null, { default: () => h(icon) })
}

const menuOptions: MenuOption[] = [
  { label: '角色管理', key: 'Characters', icon: renderIcon(PeopleOutline) },
  { label: '世界观', key: 'LoreBook', icon: renderIcon(GlobeOutline) },
  { label: '章节工作台', key: 'Chapters', icon: renderIcon(CreateOutline) },
  { label: '知识图谱', key: 'Graph', icon: renderIcon(AnalyticsOutline) },
  { label: '记忆管理', key: 'Memory', icon: renderIcon(LibraryOutline) },
  { label: '时间线', key: 'Timeline', icon: renderIcon(TimerOutline) },
  { label: 'Worker Task', key: 'StoryWorkerTasks', icon: renderIcon(HammerOutline) },
  { label: '调用日志', key: 'PromptLogs', icon: renderIcon(CodeWorkingOutline) }
]

const activeKey = computed(() => route.name?.toString() || '')

function handleMenuSelect(key: string) {
  const sid = storyId.value
  if (!sid) return
  const map: Record<string, string> = {
    Characters: `/novel-design/${sid}/characters`,
    LoreBook: `/novel-design/${sid}/lore`,
    Chapters: `/novel-design/${sid}/chapters`,
    Graph: `/novel-design/${sid}/graph`,
    Memory: `/novel-design/${sid}/memory`,
    Timeline: `/novel-design/${sid}/timeline`,
    StoryWorkerTasks: `/novel-design/${sid}/worker-tasks`,
    PromptLogs: `/novel-design/${sid}/prompt-logs`
  }
  const path = map[key]
  if (path) router.push(path)
}
</script>
