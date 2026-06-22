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
  HammerOutline, CodeWorkingOutline
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

<style scoped>
.novel-design-layout {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--bg-canvas);
  /* 覆盖 .n-layout 默认 overflow: hidden, 让内容 min-width 能撑出
     横向滚动条到底层 document, 防止窄屏挤压表格列 / 表单控件。 */
  overflow: visible;
}
.novel-design-layout__body {
  flex: 1;
  /* 同上: has-sider 内的 .n-layout 也需要 overflow visible 才能传递溢出 */
  overflow: visible;
}
/* Naive UI 在 .n-layout 内部还套了一层 .n-layout-scroll-container,
   默认 overflow-x: hidden 会再裁一次。三层全部 visible 才能让
   content 的 min-width 一路溢出到 document 横向滚动条。 */
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
.novel-design-layout__content {
  overflow-y: auto;
  /* min-width 必须放在 content 层(不会被 flex 父级 min-width: 0 压缩),
     且外层 n-layout 必须 overflow: visible 才能把溢出传到底层 document。
     整体下限 = 240 sider + 1440 内容 = 1680px。 */
  min-width: var(--page-min-width);
}
</style>
