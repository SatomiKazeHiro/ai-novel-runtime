<template>
  <div>
    <!-- ========== Hero ========== -->
    <section class="cap-hero" style="padding: 24px 0 64px">
      <div class="cap-hero__text">
        <span class="cap-eyebrow cap-rise" data-rise="1">
          <span class="cap-pencil" />
          AI NOVEL RUNTIME · DASHBOARD
        </span>
        <h1 class="cap-display cap-rise" data-rise="2" style="margin: 16px 0 0">
          Build novels<br /><em>with one runtime.</em>
        </h1>
        <p class="cap-body-lg cap-silver cap-rise" data-rise="3" style="margin: 20px 0 28px; max-width: 520px">
          {{ greeting }} — 你的故事工作台。统一管理写作人格、运行模型、章节生成与归档流水线。
        </p>
        <div class="cap-rise" data-rise="4">
          <n-space :size="12">
            <button class="cap-pill is-primary is-lg" @click="router.push('/stories')">
              <n-icon size="16"><AddOutline /></n-icon>
              新建小说
            </button>
            <button class="cap-pill is-ghost is-lg" @click="router.push('/runtime-profiles')">
              写作人格
              <n-icon size="14"><ArrowForwardOutline /></n-icon>
            </button>
          </n-space>
        </div>
      </div>
    </section>

    <!-- ========== Stats strip ========== -->
    <div class="cap-stat-grid">
      <div class="cap-stat cap-rise" data-rise="3">
        <div class="cap-stat__label">小说工程</div>
        <div class="cap-stat__value">{{ stats.stories }}</div>
        <div class="cap-stat__hint">Stories</div>
      </div>
      <div class="cap-stat cap-rise" data-rise="4">
        <div class="cap-stat__label">章节总数</div>
        <div class="cap-stat__value">{{ stats.chapters }}</div>
        <div class="cap-stat__hint">Chapters</div>
      </div>
      <div class="cap-stat cap-rise" data-rise="5">
        <div class="cap-stat__label">角色数量</div>
        <div class="cap-stat__value">{{ stats.characters }}</div>
        <div class="cap-stat__hint">Characters</div>
      </div>
      <div class="cap-stat cap-rise" data-rise="6">
        <div class="cap-stat__label">后端服务</div>
        <div class="cap-stat__value cap-stat__value--small">
          {{ health ? 'OK' : '…' }}
        </div>
        <div class="cap-stat__hint">
          <span v-if="health" class="cap-stat__live"><span class="cap-stat__live-dot" />运行中</span>
          <span v-else class="cap-muted">连接中</span>
        </div>
      </div>
    </div>

    <!-- ========== Feature 2x2 grid ========== -->
    <div class="cap-section-tight">
      <div class="cap-feature-grid">
        <article class="cap-feature cap-rise" data-rise="4" @click="router.push('/stories')">
          <span class="cap-feature__icon">
            <n-icon size="20"><BookOutline /></n-icon>
          </span>
          <h3 class="cap-subheading">故事</h3>
          <p class="cap-body-sm">管理小说工程、关联写作人格与运行模型。每个 story 是独立的运行时沙盒。</p>
          <a class="cap-feature__link">打开管理 →</a>
        </article>
        <article class="cap-feature cap-rise" data-rise="5" @click="router.push('/models')">
          <span class="cap-feature__icon">
            <n-icon size="20"><HardwareChipOutline /></n-icon>
          </span>
          <h3 class="cap-subheading">模型</h3>
          <p class="cap-body-sm">配置 AI Provider、API Key、模型参数。运行时热切换，全局默认与故事级覆盖。</p>
          <a class="cap-feature__link">管理模型 →</a>
        </article>
        <article class="cap-feature cap-rise" data-rise="6" @click="router.push('/runtime-profiles')">
          <span class="cap-feature__icon">
            <n-icon size="20"><PersonCircleOutline /></n-icon>
          </span>
          <h3 class="cap-subheading">写作人格</h3>
          <p class="cap-body-sm">Runtime Profile 定义"谁在写"。Identity / Settings / Behavior / Jailbreak 四个固定层。</p>
          <a class="cap-feature__link">编辑人格 →</a>
        </article>
        <article class="cap-feature cap-rise" data-rise="7" @click="router.push('/worker-tasks')">
          <span class="cap-feature__icon">
            <n-icon size="20"><ConstructOutline /></n-icon>
          </span>
          <h3 class="cap-subheading">Worker Task</h3>
          <p class="cap-body-sm">生成、评分、记忆、图谱、改写 — 每种 worker 一个 prompt 模板，全局可覆盖。</p>
          <a class="cap-feature__link">查看 Task →</a>
        </article>
      </div>
    </div>

    <!-- ========== Status footer ========== -->
    <div class="cap-card cap-status cap-rise" data-rise="7">
      <div class="cap-status__row">
        <span class="cap-eyebrow">SYSTEM STATUS</span>
        <div class="cap-status__items">
          <span class="cap-status__item">
            <span class="cap-status__indicator" :class="health ? 'is-on' : 'is-off'" />
            Backend
            <span class="cap-muted">{{ health ? health.timestamp : '—' }}</span>
          </span>
          <span class="cap-status__item">
            <span class="cap-status__indicator is-on" />
            Queue
            <span class="cap-muted">in-memory</span>
          </span>
          <span class="cap-status__item">
            <span class="cap-status__indicator is-on" />
            Prisma
            <span class="cap-muted">SQLite</span>
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch, computed } from 'vue'
import { useRouter } from 'vue-router'
import {
  NIcon, NSpace
} from 'naive-ui'
import {
  AddOutline, ArrowForwardOutline,
  BookOutline, HardwareChipOutline, PersonCircleOutline, ConstructOutline
} from '@vicons/ionicons5'
import { api } from '../utils/api'
import { useStoryStore } from '../stores/story'

const router = useRouter()
const storyStore = useStoryStore()
const health = ref<any>(null)
const stats = ref({ stories: 0, chapters: 0, characters: 0 })

const greeting = computed(() => {
  const h = new Date().getHours()
  if (h < 6) return '深夜了'
  if (h < 12) return '早上好'
  if (h < 18) return '下午好'
  return '晚上好'
})

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

<style scoped>
.cap-hero__text { display: flex; flex-direction: column; }
.cap-hero__art { display: flex; align-items: center; justify-content: center; }

.cap-display em { font-style: italic; color: var(--accent); }

/* === Storyboard frame (boords-style product panel) === */
.storyboard-frame {
  width: 100%;
  max-width: 360px;
  background: var(--color-pure-white);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-card);
  overflow: hidden;
  transition: transform 0.25s cubic-bezier(0.2, 0.7, 0.2, 1), box-shadow 0.25s ease;
}
.storyboard-frame:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-product);
}
.storyboard-frame__image {
  background: var(--color-skeleton-end);
  border-bottom: 1px solid var(--border-default);
  position: relative;
}
.storyboard-frame__image svg {
  display: block;
  width: 100%;
  height: auto;
}
.storyboard-frame__body {
  padding: 12px 14px 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.storyboard-frame__badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  align-self: flex-start;
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: var(--weight-semibold);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--accent-link);
  background: var(--accent-info-tint);
  padding: 3px 8px;
  border-radius: var(--radius-badge);
  line-height: 1;
}
.storyboard-frame__badge-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--accent-link);
  flex-shrink: 0;
}
.storyboard-frame__title {
  font-size: 14px;
  font-weight: var(--weight-semibold);
  color: var(--color-ink-black);
  line-height: 1.3;
}
.storyboard-frame__meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  font-weight: var(--weight-semibold);
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--text-tertiary);
  margin-top: 2px;
}
.storyboard-frame__status { color: var(--color-positive); }

/* === Stats === */
.cap-stat-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
  margin-bottom: 24px;
}
@media (max-width: 880px) { .cap-stat-grid { grid-template-columns: repeat(2, 1fr); } }

.cap-stat {
  background: var(--bg-card);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-card);
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  position: relative;
  transition: border-color 0.18s ease, transform 0.18s ease;
}
.cap-stat:hover {
  border-color: var(--color-mid-gray);
  transform: translateY(-1px);
}
.cap-stat__label {
  font-size: 11px;
  font-weight: var(--weight-semibold);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-tertiary);
}
.cap-stat__value {
  font-size: 36px;
  font-weight: var(--weight-semibold);
  line-height: 1.1;
  color: var(--color-ink-black);
  font-variant-numeric: tabular-nums lining-nums;
  margin-top: 4px;
}
.cap-stat__value--small { font-size: 22px; }
.cap-stat__hint {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-muted);
  letter-spacing: 0.04em;
  margin-top: 2px;
}
.cap-stat__live {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--color-positive);
}
.cap-stat__live-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-positive);
}

/* === Features === */
.cap-feature-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}
@media (max-width: 760px) { .cap-feature-grid { grid-template-columns: 1fr; } }

.cap-feature {
  background: var(--bg-card);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-card);
  padding: 22px 22px 20px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  position: relative;
  cursor: pointer;
  transition: border-color 0.18s ease, transform 0.18s ease, box-shadow 0.18s ease;
}
.cap-feature:hover {
  border-color: var(--color-mid-gray);
  transform: translateY(-2px);
  box-shadow: var(--shadow-product);
}
.cap-feature__icon {
  width: 32px;
  height: 32px;
  border-radius: 6px;
  background: var(--color-stone-gray);
  color: var(--accent);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background 0.18s ease, color 0.18s ease;
}
.cap-feature:hover .cap-feature__icon {
  background: var(--color-warm-accent-tint);
  color: var(--accent);
}
.cap-feature h3 { margin: 0; }
.cap-feature p { margin: 0; }
.cap-feature__link {
  display: inline-flex;
  align-items: center;
  margin-top: 6px;
  font-size: 13px;
  font-weight: var(--weight-medium);
  color: var(--accent-link);
  text-decoration: none;
  align-self: flex-start;
}
.cap-feature__link:hover {
  text-decoration: underline;
  text-underline-offset: 3px;
}

/* === Status === */
.cap-status { margin-top: 24px; }
.cap-status__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  flex-wrap: wrap;
}
.cap-status__items {
  display: flex;
  gap: 24px;
  flex-wrap: wrap;
}
.cap-status__item {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--color-ink-black);
}
.cap-status__indicator {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-mid-gray);
}
.cap-status__indicator.is-on { background: var(--color-positive); }
.cap-status__indicator.is-off { background: var(--color-mid-gray); }
</style>
