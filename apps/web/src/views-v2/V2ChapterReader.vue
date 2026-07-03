<template>
  <div class="reader">
    <aside class="reader__aside">
      <div class="reader__aside-head">
        <span class="cap-eyebrow is-accent">V2 · ARCHIVED</span>
        <div class="reader__aside-count">{{ archivedChapters.length }} 章</div>
      </div>
      <n-scrollbar class="reader__aside-scroll">
        <div
          v-for="ch in archivedChapters"
          :key="ch.id"
          class="reader__chapter-item"
          :class="{ active: ch.id === selectedId }"
          @click="selectChapter(ch.id)"
        >
          <div class="reader__chapter-num">
            <span class="reader__chapter-bracket">[</span>
            <span class="reader__chapter-number">{{ formatNumber(ch.number) }}</span>
            <span class="reader__chapter-bracket">]</span>
          </div>
          <div class="reader__chapter-title">{{ ch.title }}</div>
        </div>
        <div v-if="!loading && archivedChapters.length === 0" class="reader__empty">
          <div class="reader__empty-mark">—</div>
          <div>暂无归档章节</div>
          <div class="reader__empty-hint">先在章节工作台归档章节</div>
        </div>
      </n-scrollbar>
    </aside>

    <main class="reader__main">
      <n-scrollbar class="reader__main-scroll">
        <Transition name="reader-fade" mode="out-in">
          <article v-if="currentChapter" :key="currentChapter.id" class="reader__article">
            <header class="reader__article-head">
              <div class="reader__article-meta">
                <span class="reader__article-num">第 {{ formatNumber(currentChapter.number) }} 章</span>
              </div>
              <h1 class="reader__article-title">{{ currentChapter.title }}</h1>
            </header>
            <div v-if="currentChapter.content" class="reader__article-body">
              <p
                v-for="(para, idx) in paragraphs"
                :key="idx"
                class="reader__paragraph"
              >{{ para }}</p>
            </div>
            <div v-else class="reader__loading-body">载入中…</div>
          </article>
          <div v-else-if="!loading" key="empty" class="reader__main-empty">
            <div class="reader__main-empty-mark">—</div>
            <div v-if="archivedChapters.length === 0">还没有归档章节, 归档后会在左侧出现</div>
            <div v-else>从左侧选一章开始阅读</div>
          </div>
        </Transition>
      </n-scrollbar>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { NScrollbar, useMessage } from 'naive-ui'
import { v2ChaptersApi } from '../api-v2/chapters'

const route = useRoute()
const storyId = computed(() => route.params.storyId as string)
const message = useMessage()

interface ChapterItem {
  id: string
  number: number
  title: string
  status: string
  content?: string
}

const allChapters = ref<ChapterItem[]>([])
const currentChapter = ref<ChapterItem | null>(null)
const selectedId = ref('')
const loading = ref(false)

const archivedChapters = computed(() =>
  allChapters.value
    .filter(ch => ch.status === 'archived')
    .sort((a, b) => a.number - b.number)
)

const paragraphs = computed(() => {
  const text = currentChapter.value?.content?.trim() || ''
  if (!text) return []
  return text.split(/\n{2,}/).map(p => p.trim()).filter(Boolean)
})

function formatNumber(n: number) {
  if (Number.isInteger(n)) return n.toString().padStart(2, '0')
  return n.toFixed(2)
}

async function loadChapters() {
  if (!storyId.value) return
  loading.value = true
  try {
    const res = await v2ChaptersApi.list(storyId.value)
    allChapters.value = (res.data?.data || []) as ChapterItem[]
    if (!selectedId.value && archivedChapters.value.length > 0) {
      await selectChapter(archivedChapters.value[0].id)
    }
  } catch (err: any) {
    message.error(err?.message || '加载章节列表失败')
    allChapters.value = []
  } finally {
    loading.value = false
  }
}

async function selectChapter(id: string) {
  selectedId.value = id
  currentChapter.value = null
  try {
    const res = await v2ChaptersApi.detail(id)
    currentChapter.value = (res.data?.data || res.data) as ChapterItem
  } catch (err: any) {
    message.error(err?.message || '加载章节内容失败')
    currentChapter.value = null
  }
}

onMounted(loadChapters)
watch(storyId, () => {
  selectedId.value = ''
  currentChapter.value = null
  loadChapters()
})
</script>

<style scoped>
.reader {
  display: flex;
  height: calc(100vh - var(--nav-height));
  background: var(--bg-canvas);
}

.reader__aside {
  width: 280px;
  flex-shrink: 0;
  background: var(--bg-card);
  border-right: 1px solid var(--border-default);
  display: flex;
  flex-direction: column;
}
.reader__aside-head {
  padding: 18px 20px 16px;
  border-bottom: 1px solid var(--border-default);
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex-shrink: 0;
}
.reader__aside-count {
  font-size: 14px;
  font-weight: var(--weight-semibold);
  color: var(--text-primary);
  font-family: var(--font-mono);
}
.reader__aside-scroll {
  flex: 1;
  min-height: 0;
}
.reader__chapter-item {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 12px 20px;
  cursor: pointer;
  border-left: 3px solid transparent;
  transition: background 0.15s ease, border-color 0.15s ease;
}
.reader__chapter-item:hover {
  background: var(--color-stone-gray);
}
.reader__chapter-item.active {
  background: color-mix(in srgb, var(--accent) 8%, var(--bg-card));
  border-left-color: var(--accent);
}
.reader__chapter-num {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-tertiary);
  letter-spacing: 0.04em;
  flex-shrink: 0;
}
.reader__chapter-bracket { color: var(--text-tertiary); }
.reader__chapter-number { font-weight: var(--weight-semibold); }
.reader__chapter-item.active .reader__chapter-number { color: var(--accent); }
.reader__chapter-title {
  font-size: 13px;
  color: var(--text-primary);
  font-weight: var(--weight-medium);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}

.reader__empty {
  padding: 60px 24px;
  text-align: center;
  color: var(--text-tertiary);
  font-size: 13px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.reader__empty-mark {
  font-size: 28px;
  color: var(--text-muted);
  font-family: var(--font-mono);
}
.reader__empty-hint {
  font-size: 11px;
  color: var(--text-muted);
}

.reader__main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.reader__main-scroll {
  flex: 1;
  min-height: 0;
}
.reader__article {
  max-width: 720px;
  margin: 0 auto;
  padding: 60px 64px 120px;
}
.reader__article-head {
  margin-bottom: 48px;
  padding-bottom: 32px;
  border-bottom: 1px solid var(--border-default);
}
.reader__article-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}
.reader__article-num {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-tertiary);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.reader__article-title {
  font-size: 32px;
  font-weight: var(--weight-bold);
  line-height: 1.25;
  color: var(--text-primary);
  letter-spacing: -0.01em;
  margin: 0;
}
.reader__article-body {
  font-family: var(--font-sans);
  font-size: 17px;
  line-height: 1.75;
  color: var(--text-primary);
}
.reader__paragraph {
  margin: 0 0 18px;
  text-indent: 2em;
}
.reader__paragraph:first-child::first-letter {
  font-size: 1.18em;
  font-weight: var(--weight-semibold);
  color: var(--accent);
}
.reader__loading-body {
  text-align: center;
  padding: 80px 0;
  color: var(--text-tertiary);
}

.reader__main-empty {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--text-tertiary);
  font-size: 14px;
}
.reader__main-empty-mark {
  font-size: 36px;
  color: var(--text-muted);
  font-family: var(--font-mono);
}

.reader-fade-enter-active,
.reader-fade-leave-active {
  transition: opacity 0.2s ease;
}
.reader-fade-enter-from,
.reader-fade-leave-to {
  opacity: 0;
}

@media (max-width: 900px) {
  .reader__aside { width: 220px; }
  .reader__article { padding: 40px 32px 80px; }
  .reader__article-title { font-size: 26px; }
  .reader__article-body { font-size: 16px; }
}
</style>
