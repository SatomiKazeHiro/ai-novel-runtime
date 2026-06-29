<template>
  <n-layout class="novel-design-layout">
    <NavBar />
    <n-layout has-sider class="novel-design-layout__body">
      <n-layout-sider
        bordered
        collapse-mode="width"
        :collapsed="collapsed"
        :collapsed-width="64"
        :width="240"
        show-trigger="arrow-circle"
        class="novel-design-layout__sider"
        @update:collapsed="(v: boolean) => (collapsed = v)"
      >
        <div v-if="!collapsed" class="novel-design-layout__sider-head">
          <span class="cap-eyebrow">STORY · V2</span>
          <div class="novel-design-layout__story-title">
            {{ currentStory?.title || '未知小说' }}
          </div>
        </div>
        <n-menu
          class="novel-design-layout__menu"
          :collapsed="collapsed"
          :collapsed-width="64"
          :collapsed-icon-size="22"
          :indent="18"
          :options="menuOptions"
          :value="activeKey"
          @update:value="handleMenuSelect"
        />
      </n-layout-sider>
      <n-layout-content class="novel-design-layout__content">
        <div class="cap-page cap-shell">
          <router-view />
        </div>
      </n-layout-content>
    </n-layout>
  </n-layout>
</template>

<script setup lang="ts">
import { h, ref, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  NLayout, NLayoutSider, NLayoutContent,
  NMenu, NIcon, type MenuOption
} from 'naive-ui'
import {
  PeopleOutline, GlobeOutline, CreateOutline,
  AnalyticsOutline, LibraryOutline, TimerOutline,
  HammerOutline, CodeWorkingOutline, BookOutline,
  GitBranchOutline
} from '@vicons/ionicons5'
import NavBar from '../components/NavBar.vue'
import { useStoryStore } from '../stores/story'

const route = useRoute()
const router = useRouter()
const storyStore = useStoryStore()
const collapsed = ref(false)

const storyId = computed(() => route.params.storyId as string)

const currentStory = computed(() =>
  storyStore.stories.find(s => s.id === storyId.value) || null
)

watch(storyId, async (id) => {
  if (!id) return
  if (!storyStore.loaded) {
    await storyStore.loadStories()
  }
  storyStore.selectStory(id)
}, { immediate: true })

function renderIcon(icon: any) {
  return () => h(NIcon, null, { default: () => h(icon) })
}

const menuOptions: MenuOption[] = [
  { label: '角色管理',   key: 'V2Characters',      icon: renderIcon(PeopleOutline) },
  { label: '世界观',     key: 'V2LoreBook',        icon: renderIcon(GlobeOutline) },
  { label: '章节工作台', key: 'V2Chapters',        icon: renderIcon(CreateOutline) },
  { label: '阅读',       key: 'V2ChapterReader',   icon: renderIcon(BookOutline) },
  { label: '剧情弧线',   key: 'V2PlotArcs',        icon: renderIcon(GitBranchOutline) },
  { label: '记忆管理',   key: 'V2Memory',          icon: renderIcon(LibraryOutline) },
  { label: '知识图谱',   key: 'V2Graph',           icon: renderIcon(AnalyticsOutline) },
  { label: '时间线',     key: 'V2Timeline',        icon: renderIcon(TimerOutline) },
  { label: '任务模板',   key: 'V2StoryWorkerTasks', icon: renderIcon(HammerOutline) },
  { label: '调用日志',   key: 'V2PromptLogs',      icon: renderIcon(CodeWorkingOutline) }
]

const activeKey = computed(() => route.name?.toString() || '')

function handleMenuSelect(key: string) {
  const sid = storyId.value
  if (!sid) return
  const map: Record<string, string> = {
    V2Characters:      `/novel-design-v2/${sid}/characters`,
    V2LoreBook:        `/novel-design-v2/${sid}/lore`,
    V2Chapters:        `/novel-design-v2/${sid}/chapters`,
    V2ChapterReader:   `/novel-design-v2/${sid}/reader`,
    V2PlotArcs:        `/novel-design-v2/${sid}/plot-arcs`,
    V2Memory:          `/novel-design-v2/${sid}/memory`,
    V2Graph:           `/novel-design-v2/${sid}/graph`,
    V2Timeline:        `/novel-design-v2/${sid}/timeline`,
    V2StoryWorkerTasks: `/novel-design-v2/${sid}/worker-tasks`,
    V2PromptLogs:      `/novel-design-v2/${sid}/prompt-logs`
  }
  const path = map[key]
  if (path) router.push(path)
}
</script>

<style scoped>
.novel-design-layout {
  height: 100vh;
  background: var(--bg-canvas);
  overflow: visible;
}
.novel-design-layout > :deep(.n-layout-scroll-container) {
  display: flex;
  flex-direction: column;
}
.novel-design-layout__body {
  flex: 1;
  overflow: auto;
}
.novel-design-layout :deep(.n-layout-scroll-container) {
  overflow: visible;
}

.novel-design-layout__sider {
  background: var(--color-pure-white) !important;
  border-right: 1px solid var(--border-default) !important;
  position: relative;
  display: flex;
  flex-direction: column;
}
.novel-design-layout__sider-head {
  padding: 18px 20px 16px;
  border-bottom: 1px solid var(--border-default);
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex-shrink: 0;
}
.novel-design-layout__story-title {
  font-size: 14px;
  font-weight: var(--weight-semibold);
  color: var(--color-ink-black);
  line-height: 1.3;
  letter-spacing: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.novel-design-layout__menu {
  padding: 10px 8px;
  flex: 1;
  min-height: 0;
}
.novel-design-layout__menu.n-menu--collapsed :deep(.n-menu-item-content) {
  padding-left: 13px !important;
}
.novel-design-layout__menu :deep(.n-menu-item-content--selected) .n-menu-item-content__icon,
.novel-design-layout__menu :deep(.n-menu-item-content--selected:hover) .n-menu-item-content__icon,
.novel-design-layout__menu :deep(.n-menu-item-content--selected) .n-menu-item-content-header,
.novel-design-layout__menu :deep(.n-menu-item-content--selected:hover) .n-menu-item-content-header {
  color: var(--accent) !important;
}

.novel-design-layout :deep(.n-layout-toggle-button) {
  width: 28px;
  height: 28px;
  border: 1px solid var(--border-default);
  background: var(--color-pure-white);
  color: var(--text-tertiary);
  box-shadow: none;
  transition: color 0.15s ease, border-color 0.15s ease, background 0.15s ease;
}
.novel-design-layout :deep(.n-layout-toggle-button:hover) {
  color: var(--color-ink-black);
  border-color: var(--color-mid-gray);
  background: var(--color-stone-gray);
}

.novel-design-layout__content {
  overflow: auto;
}
.novel-design-layout__content > :deep(.n-layout-scroll-container) {
  min-width: 1280px;
}
</style>
