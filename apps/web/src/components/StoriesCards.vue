<template>
  <div class="stories-cards">
    <div
      v-for="story in stories"
      :key="story.id"
      class="stories-cards__item"
      @click="onDesign(story.id)"
    >
      <div class="stories-cards__cover">
        <StoryCover :story="story" />
        <n-dropdown
          :options="menuOptions"
          trigger="click"
          @select="(key) => onMenuSelect(story, key)"
        >
          <button class="stories-cards__menu" @click.stop aria-label="操作菜单">⋯</button>
        </n-dropdown>
      </div>
      <div class="stories-cards__body">
        <div class="stories-cards__title">{{ story.title }}</div>
        <div class="stories-cards__desc">{{ story.description || '（无简介）' }}</div>
        <div class="stories-cards__meta">
          <span class="stories-cards__status">{{ story.status }}</span>
          <span>· {{ story._count?.chapters ?? 0 }} 章</span>
          <span>· {{ story._count?.characters ?? 0 }} 角色</span>
        </div>
      </div>
    </div>
    <div v-if="stories.length === 0" class="stories-cards__empty">
      当前过滤条件下没有小说。
    </div>
  </div>
</template>

<script setup lang="ts">
import { NDropdown, type DropdownOption } from 'naive-ui'
import { useRouter } from 'vue-router'
import StoryCover from './StoryCover.vue'

interface Story {
  id: string
  title: string
  description: string | null
  status: string
  coverUrl?: string | null
  _count?: { chapters: number; characters: number }
  [key: string]: any
}

interface Props {
  stories: Story[]
}
defineProps<Props>()
const emit = defineEmits<{
  edit: [story: Story]
  remove: [story: Story]
}>()

const router = useRouter()

function onDesign(id: string) {
  router.push(`/novel-design-v2/${id}/characters`)
}

const menuOptions: DropdownOption[] = [
  { label: '编辑', key: 'edit' },
  { type: 'divider', key: 'd1' },
  { label: '删除', key: 'remove' }
]

function onMenuSelect(story: Story, key: string | number) {
  if (key === 'edit') emit('edit', story)
  else if (key === 'remove') emit('remove', story)
}
</script>

<style scoped>
.stories-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 20px;
}
.stories-cards__item {
  cursor: pointer;
  border-radius: 12px;
  overflow: hidden;
  background: var(--color-pure-white, #fff);
  border: 1px solid var(--border-default, #e5e5e5);
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}
.stories-cards__item:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(0,0,0,0.08);
}
.stories-cards__cover {
  position: relative;
}
.stories-cards__menu {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: none;
  background: rgba(255,255,255,0.85);
  color: #333;
  font-size: 18px;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s ease;
}
.stories-cards__item:hover .stories-cards__menu {
  opacity: 1;
}
.stories-cards__body {
  padding: 12px 14px 14px;
}
.stories-cards__title {
  font-size: 15px;
  font-weight: var(--weight-semibold, 600);
  color: var(--color-ink-black, #222);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.stories-cards__desc {
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-tertiary, #888);
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  min-height: 36px;
}
.stories-cards__meta {
  margin-top: 8px;
  display: flex;
  gap: 6px;
  font-size: 11px;
  color: var(--text-tertiary, #888);
}
.stories-cards__status {
  padding: 1px 6px;
  background: var(--color-stone-gray, #f0f0ee);
  border-radius: 4px;
}
.stories-cards__empty {
  grid-column: 1 / -1;
  padding: 60px 20px;
  text-align: center;
  color: var(--text-tertiary, #888);
  font-size: 14px;
}
</style>
