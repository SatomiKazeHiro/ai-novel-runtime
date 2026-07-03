<template>
  <div>
    <header class="page-head">
      <div class="page-head__text">
        <span class="cap-eyebrow is-accent">V2 · TIMELINE</span>
        <h1 class="page-head__title">时间线</h1>
        <p class="page-head__lede cap-body-sm">章节事件按时间锚点串联，跨章节保持时序一致。</p>
      </div>
    </header>

    <div class="cap-card" style="padding: 16px">
      <n-spin :show="loading">
        <div v-if="anchors.length > 0">
          <n-timeline>
            <n-timeline-item
              v-for="anchor in anchors"
              :key="anchor.id"
              type="default"
              :title="anchor.name"
            >
              <n-ul v-if="anchor.events && anchor.events.length > 0">
                <n-li v-for="evt in anchor.events" :key="evt.id">
                  {{ evt.description }}
                  <n-text depth="3" style="display: block; font-size: 12px">
                    来自: 第{{ evt.chapterNumber }}章
                  </n-text>
                </n-li>
              </n-ul>
              <n-text v-else depth="3">暂无事件</n-text>
            </n-timeline-item>
          </n-timeline>
        </div>
        <n-empty v-else description="暂无时间线数据，归档章节后将自动生成" />
      </n-spin>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { NTimeline, NTimelineItem, NUl, NLi, NText, NEmpty, NSpin } from 'naive-ui'
import { v2TimelineApi } from '../api-v2/timeline'

const route = useRoute()
const anchors = ref<any[]>([])
const loading = ref(false)

async function loadTimeline() {
  const sid = route.params.storyId as string
  if (!sid) {
    anchors.value = []
    return
  }
  loading.value = true
  try {
    const res = await v2TimelineApi.list(sid)
    anchors.value = res.data.data || []
  } finally {
    loading.value = false
  }
}

watch(() => route.params.storyId, loadTimeline)

onMounted(() => {
  if (route.params.storyId) loadTimeline()
})
</script>
