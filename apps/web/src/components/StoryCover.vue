<template>
  <div class="story-cover" :class="{ 'story-cover--has-image': !!resolvedUrl }">
    <img
      v-if="resolvedUrl"
      :src="resolvedUrl"
      :alt="story.title"
      class="story-cover__image"
    />
    <div
      v-else
      class="story-cover__stamp"
      :style="stampStyle"
    >
      <!-- Center content: big first char + vertical full title -->
      <div class="story-cover__content">
        <span class="story-cover__glyph">{{ glyph }}</span>
        <div v-if="verticalTitle" class="story-cover__vertical-title">{{ verticalTitle }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

interface Props {
  story: { title: string; coverUrl?: string | null }
}
const props = defineProps<Props>()

const URL_RE = /^\/uploads\/covers\/[a-f0-9-]+-\d+\.(jpg|png|webp)$/

const resolvedUrl = computed(() => {
  const u = props.story.coverUrl
  if (u && URL_RE.test(u)) return u
  return null
})

function fnv1a32(str: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h
}

function hashColor(title: string): { from: string; to: string } {
  const hue = fnv1a32(title) % 360
  return {
    from: `hsl(${hue}, 45%, 35%)`,
    to:   `hsl(${(hue + 30) % 360}, 55%, 20%)`
  }
}

function firstGlyph(title: string): string {
  const t = title.trim()
  if (!t) return '?'
  const first = t[0]
  if (/[一-鿿぀-ヿ가-힯]/.test(first)) return first
  return first.toUpperCase()
}

const glyph = computed(() => firstGlyph(props.story.title))
const verticalTitle = computed(() => props.story.title.trim().slice(1))
const stampStyle = computed(() => {
  const { from, to } = hashColor(props.story.title)
  return {
    backgroundImage: `linear-gradient(135deg, ${from} 0%, ${to} 100%)`
  }
})
</script>

<style scoped>
.story-cover {
  position: relative;
  aspect-ratio: 3 / 4;
  overflow: hidden;
  background: var(--color-stone-gray, #f0f0ee);
  border-radius: 12px 12px 0 0;
}
.story-cover__image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.story-cover__stamp {
  position: absolute;
  inset: 0;
}
.story-cover__content {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px 14px;
}
.story-cover__glyph {
  font-size: clamp(56px, 16vw, 110px);
  font-weight: 600;
  color: #fff;
  font-family: 'Songti SC', 'STSong', 'Noto Serif CJK SC', serif;
  opacity: 0.95;
  user-select: none;
  flex: 1;
  text-align: center;
  line-height: 1;
}
.story-cover__vertical-title {
  writing-mode: vertical-rl;
  text-orientation: upright;
  letter-spacing: 4px;
  font-size: 13px;
  line-height: 1.3;
  color: rgba(255, 255, 255, 0.82);
  font-family: 'Songti SC', 'STSong', 'Noto Serif CJK SC', serif;
  user-select: none;
  max-height: 100%;
  overflow: hidden;
  text-overflow: clip;
  flex-shrink: 0;
}
</style>
