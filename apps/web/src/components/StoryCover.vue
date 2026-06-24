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
      <!-- 4 ruyi corner ornaments -->
      <svg class="ruyi ruyi--tl" viewBox="0 0 48 48" aria-hidden="true">
        <g fill="rgba(255,255,255,0.22)" stroke="rgba(255,255,255,0.62)" stroke-width="0.9" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3,3 L3,18 M3,3 L18,3" fill="none" />
          <path d="M6,7 C6,4 9,3 11,4 C13,3 15,4 15,6 C18,6 19,9 17,11 C19,12 18,15 15,14 C14,16 11,16 10,14 C6,14 4,11 6,9 C5,8 6,7 6,7 Z" />
          <path d="M15,10 C18,9 20,11 20,14 C20,16 19,18 17,18" fill="none" />
        </g>
      </svg>
      <svg class="ruyi ruyi--tr" viewBox="0 0 48 48" aria-hidden="true">
        <g fill="rgba(255,255,255,0.22)" stroke="rgba(255,255,255,0.62)" stroke-width="0.9" stroke-linecap="round" stroke-linejoin="round">
          <path d="M45,3 L45,18 M45,3 L30,3" fill="none" />
          <path d="M42,7 C42,4 39,3 37,4 C35,3 33,4 33,6 C30,6 29,9 31,11 C29,12 30,15 33,14 C34,16 37,16 38,14 C42,14 44,11 42,9 C43,8 42,7 42,7 Z" />
          <path d="M33,10 C30,9 28,11 28,14 C28,16 29,18 31,18" fill="none" />
        </g>
      </svg>
      <svg class="ruyi ruyi--bl" viewBox="0 0 48 48" aria-hidden="true">
        <g fill="rgba(255,255,255,0.22)" stroke="rgba(255,255,255,0.62)" stroke-width="0.9" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3,45 L3,30 M3,45 L18,45" fill="none" />
          <path d="M6,41 C6,44 9,45 11,44 C13,45 15,44 15,42 C18,42 19,39 17,37 C19,36 18,33 15,34 C14,32 11,32 10,34 C6,34 4,37 6,39 C5,40 6,41 6,41 Z" />
          <path d="M15,38 C18,39 20,37 20,34 C20,32 19,30 17,30" fill="none" />
        </g>
      </svg>
      <svg class="ruyi ruyi--br" viewBox="0 0 48 48" aria-hidden="true">
        <g fill="rgba(255,255,255,0.22)" stroke="rgba(255,255,255,0.62)" stroke-width="0.9" stroke-linecap="round" stroke-linejoin="round">
          <path d="M45,45 L45,30 M45,45 L30,45" fill="none" />
          <path d="M42,41 C42,44 39,45 37,44 C35,45 33,44 33,42 C30,42 29,39 31,37 C29,36 30,33 33,34 C34,32 37,32 38,34 C42,34 44,37 42,39 C43,40 42,41 42,41 Z" />
          <path d="M33,38 C30,39 28,37 28,34 C28,32 29,30 31,30" fill="none" />
        </g>
      </svg>

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
  padding: 14px;
}
.story-cover__content {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
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
.ruyi {
  position: absolute;
  width: 44px;
  height: 44px;
  pointer-events: none;
}
.ruyi--tl { top: 6px; left: 6px; }
.ruyi--tr { top: 6px; right: 6px; transform: scaleX(-1); }
.ruyi--bl { bottom: 6px; left: 6px; transform: scaleY(-1); }
.ruyi--br { bottom: 6px; right: 6px; transform: scale(-1, -1); }
</style>
