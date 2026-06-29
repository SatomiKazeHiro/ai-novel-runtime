<template>
  <div>
    <header class="page-head">
      <div class="page-head__text">
        <span class="cap-eyebrow">V2 · CHARACTER</span>
        <h1 class="page-head__title">{{ character?.name || '角色详情' }}</h1>
        <p class="page-head__lede cap-body-sm">
          <n-button size="small" @click="goBack">← 返回角色列表</n-button>
        </p>
      </div>
    </header>

    <div v-if="loading" style="padding: 40px; text-align: center; color: var(--text-tertiary)">加载中...</div>

    <template v-else-if="character">
      <div class="detail-grid">
        <!-- 左：基础信息 -->
        <div class="detail-card cap-card">
          <h2 class="detail-card__title cap-eyebrow">初始设定</h2>
          <dl class="detail-card__dl">
            <dt>标识</dt>
            <dd>{{ character.slug }}</dd>
            <dt>姓名</dt>
            <dd>{{ character.name }}</dd>
            <dt>主角</dt>
            <dd>
              <span v-if="character.isProtagonist" style="color: var(--color-protagonist)">★ 主角</span>
              <span v-else style="color: var(--text-tertiary)">否</span>
            </dd>
            <dt>身份</dt>
            <dd><div class="tag-row"><n-tag v-for="t in baseTags.identity" :key="t" size="small">{{ t }}</n-tag></div><span v-if="!baseTags.identity.length" style="color: var(--text-tertiary)">未设定</span></dd>
            <dt>外貌</dt>
            <dd><div class="tag-row"><n-tag v-for="t in baseTags.appearance" :key="t" size="small">{{ t }}</n-tag></div><span v-if="!baseTags.appearance.length" style="color: var(--text-tertiary)">未设定</span></dd>
            <dt>气质</dt>
            <dd><div class="tag-row"><n-tag v-for="t in baseTags.temperament" :key="t" size="small">{{ t }}</n-tag></div><span v-if="!baseTags.temperament.length" style="color: var(--text-tertiary)">未设定</span></dd>
            <dt>性格</dt>
            <dd><div class="tag-row"><n-tag v-for="t in baseTags.personality" :key="t" size="small">{{ t }}</n-tag></div><span v-if="!baseTags.personality.length" style="color: var(--text-tertiary)">未设定</span></dd>
            <dt>说话风格</dt>
            <dd><div class="tag-row"><n-tag v-for="t in baseTags.speechStyle" :key="t" size="small">{{ t }}</n-tag></div><span v-if="!baseTags.speechStyle.length" style="color: var(--text-tertiary)">未设定</span></dd>
          </dl>
        </div>

        <!-- 右：快照 -->
        <div class="detail-card cap-card">
          <div class="detail-card__header">
            <h2 class="detail-card__title cap-eyebrow">章节快照</h2>
            <n-select
              v-model:value="selectedChapter"
              :options="chapterOptions"
              placeholder="选择章节"
              style="width: 200px"
            />
          </div>

          <template v-if="currentSnapshot">
            <dl class="detail-card__dl">
              <dt>章节</dt>
              <dd>第 {{ currentSnapshot.chapterNumber }} 章</dd>
              <dt>身份</dt>
              <dd><div class="tag-row"><n-tag v-for="t in snapTags.identity" :key="t" size="small">{{ t }}</n-tag></div><span v-if="!snapTags.identity.length" style="color: var(--text-tertiary)">未设定</span></dd>
              <dt>外貌</dt>
              <dd><div class="tag-row"><n-tag v-for="t in snapTags.appearance" :key="t" size="small">{{ t }}</n-tag></div><span v-if="!snapTags.appearance.length" style="color: var(--text-tertiary)">未设定</span></dd>
              <dt>气质</dt>
              <dd><div class="tag-row"><n-tag v-for="t in snapTags.temperament" :key="t" size="small">{{ t }}</n-tag></div><span v-if="!snapTags.temperament.length" style="color: var(--text-tertiary)">未设定</span></dd>
              <dt>性格</dt>
              <dd><div class="tag-row"><n-tag v-for="t in snapTags.personality" :key="t" size="small">{{ t }}</n-tag></div><span v-if="!snapTags.personality.length" style="color: var(--text-tertiary)">未设定</span></dd>
              <dt>说话风格</dt>
              <dd><div class="tag-row"><n-tag v-for="t in snapTags.speechStyle" :key="t" size="small">{{ t }}</n-tag></div><span v-if="!snapTags.speechStyle.length" style="color: var(--text-tertiary)">未设定</span></dd>
              <dt>关系</dt>
              <dd>
                <div v-if="relEntries.length" class="kv-list">
                  <div v-for="[k, v] in relEntries" :key="k" class="kv-item">
                    <span class="kv-key">{{ k }}</span>
                    <span class="kv-val">{{ v }}</span>
                  </div>
                </div>
                <span v-else style="color: var(--text-tertiary)">暂无</span>
              </dd>
              <dt>状态</dt>
              <dd>
                <div v-if="statusEntries.length" class="kv-list">
                  <div v-for="[k, v] in statusEntries" :key="k" class="kv-item">
                    <span class="kv-key">{{ k }}</span>
                    <span class="kv-val">{{ v }}</span>
                  </div>
                </div>
                <span v-else style="color: var(--text-tertiary)">暂无</span>
              </dd>
            </dl>
          </template>
          <div v-else style="padding: 40px; text-align: center; color: var(--text-tertiary)">
            暂无快照数据
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NButton, NSelect, NTag } from 'naive-ui'
import { v2CharactersApi } from '../api-v2/characters'
import { safeJsonParse } from '@novel-runtime/shared'

const route = useRoute()
const router = useRouter()
const character = ref<any>(null)
const loading = ref(false)
const selectedChapter = ref<number | null>(null)

const snapshots = computed(() => character.value?.snapshots ?? [])

const chapterOptions = computed(() =>
  snapshots.value.map((s: any) => ({
    label: `第 ${s.chapterNumber} 章`,
    value: s.chapterNumber
  }))
)

const currentSnapshot = computed(() => {
  if (selectedChapter.value == null) return null
  return snapshots.value.find((s: any) => s.chapterNumber === selectedChapter.value) ?? null
})

function parseTags(json: string): string[] {
  return safeJsonParse<string[]>(json, [])
}

const baseTags = computed(() => ({
  identity: parseTags(character.value?.identity ?? '[]'),
  appearance: parseTags(character.value?.appearance ?? '[]'),
  temperament: parseTags(character.value?.temperament ?? '[]'),
  personality: parseTags(character.value?.personality ?? '[]'),
  speechStyle: parseTags(character.value?.speechStyle ?? '[]')
}))

const snapTags = computed(() => ({
  identity: parseTags(currentSnapshot.value?.identity ?? '[]'),
  appearance: parseTags(currentSnapshot.value?.appearance ?? '[]'),
  temperament: parseTags(currentSnapshot.value?.temperament ?? '[]'),
  personality: parseTags(currentSnapshot.value?.personality ?? '[]'),
  speechStyle: parseTags(currentSnapshot.value?.speechStyle ?? '[]')
}))

const relEntries = computed(() => {
  if (!currentSnapshot.value?.relationships) return []
  const obj = safeJsonParse<Record<string, any>>(currentSnapshot.value.relationships, {})
  return Object.entries(obj)
})

const statusEntries = computed(() => {
  if (!currentSnapshot.value?.status) return []
  const obj = safeJsonParse<Record<string, any>>(currentSnapshot.value.status, {})
  return Object.entries(obj)
})

function goBack() {
  const sid = route.params.storyId as string
  router.push(`/novel-design-v2/${sid}/characters`)
}

async function loadCharacter() {
  const charId = route.params.charId as string
  if (!charId) return
  loading.value = true
  try {
    const res = await v2CharactersApi.detail(charId)
    character.value = res.data.data
    if (character.value?.snapshots?.length) {
      selectedChapter.value = character.value.snapshots[0].chapterNumber
    }
  } finally {
    loading.value = false
  }
}

onMounted(() => { loadCharacter() })
</script>

<style scoped>
.detail-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
  align-items: start;
}
.detail-card__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}
.detail-card__title {
  margin: 0;
}
.detail-card__dl {
  display: grid;
  grid-template-columns: 80px 1fr;
  gap: 8px 12px;
  font-size: 14px;
}
.detail-card__dl dt {
  color: var(--text-tertiary);
  font-weight: var(--weight-medium);
  text-align: right;
}
.detail-card__dl dd {
  color: var(--color-ink-black);
  margin: 0;
}
.tag-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
}
.kv-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.kv-item {
  display: flex;
  gap: 8px;
}
.kv-key {
  color: var(--text-tertiary);
  min-width: 60px;
}
.kv-key::after {
  content: '\FF1A';
}
.kv-val {
  color: var(--color-ink-black);
}
</style>
