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
        <!-- STORY head: 折叠时不渲染, 避开 64px 宽度下 "STORY + 截断文字" 错位 -->
        <div v-if="!collapsed" class="novel-design-layout__sider-head">
          <span class="cap-eyebrow">STORY</span>
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
  HammerOutline, CodeWorkingOutline, BookOutline, GitBranchOutline
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
  // URL 直接进入时 stories 还没加载 (store 是惰性的), 此时 find 返回 undefined
  // 会让 sider 标题显示 "未知小说". 先确保列表已加载再 select.
  if (!storyStore.loaded) {
    await storyStore.loadStories()
  }
  storyStore.selectStory(id)
}, { immediate: true })

function renderIcon(icon: any) {
  return () => h(NIcon, null, { default: () => h(icon) })
}

const menuOptions: MenuOption[] = [
  { label: '角色管理', key: 'Characters', icon: renderIcon(PeopleOutline) },
  { label: '世界观', key: 'LoreBook', icon: renderIcon(GlobeOutline) },
  { label: '章节工作台', key: 'Chapters', icon: renderIcon(CreateOutline) },
  { label: '阅读', key: 'ChapterReader', icon: renderIcon(BookOutline) },
  { label: '知识图谱', key: 'Graph', icon: renderIcon(AnalyticsOutline) },
  { label: '记忆管理', key: 'Memory', icon: renderIcon(LibraryOutline) },
  { label: '时间线', key: 'Timeline', icon: renderIcon(TimerOutline) },
  { label: '剧情弧线', key: 'PlotArcs', icon: renderIcon(GitBranchOutline) },
  { label: '任务模板', key: 'StoryWorkerTasks', icon: renderIcon(HammerOutline) },
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
    ChapterReader: `/novel-design/${sid}/reader`,
    Graph: `/novel-design/${sid}/graph`,
    Memory: `/novel-design/${sid}/memory`,
    Timeline: `/novel-design/${sid}/timeline`,
    PlotArcs: `/novel-design/${sid}/plot-arcs`,
    StoryWorkerTasks: `/novel-design/${sid}/worker-tasks`,
    PromptLogs: `/novel-design/${sid}/prompt-logs`
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

/* 左侧菜单 */
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

/* Trigger 按钮: 默认垂直居中靠右, 这里放大一点 + 加上 pebble 边框,
   让它和菜单图标的视觉重量匹配 (默认 24px 太小、没边框). */
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

/* 右侧内容 */
.novel-design-layout__content {
  overflow: auto;
}
.novel-design-layout__content > :deep(.n-layout-scroll-container) {
  min-width: 1280px;
}
</style>
