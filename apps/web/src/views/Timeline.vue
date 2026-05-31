<template>
  <div>
    <n-space justify="space-between" align="center" style="margin-bottom: 16px">
      <n-h1>时间线</n-h1>
      <n-space>
        <n-button type="primary" @click="showModal = true">添加事件</n-button>
      </n-space>
    </n-space>

    <n-spin :show="loading">
      <n-timeline v-if="events.length > 0">
        <n-timeline-item v-for="evt in events" :key="evt.id" type="default" :title="`第 ${evt.day} 天`">
          <n-ul>
            <n-li v-for="(desc, idx) in JSON.parse(evt.events)" :key="idx">{{ desc }}</n-li>
          </n-ul>
          <n-space>
            <n-button size="tiny" @click="startEdit(evt)">编辑</n-button>
            <n-button size="tiny" type="error" @click="handleDelete(evt.id)">删除</n-button>
          </n-space>
        </n-timeline-item>
      </n-timeline>
      <n-empty v-else description="暂无时间线事件" />
    </n-spin>

    <n-modal v-model:show="showModal" :title="editingId ? '编辑事件' : '添加事件'" preset="card" style="width: 500px">
      <n-form :model="form" label-placement="left" label-width="80">
        <n-form-item label="天数" required>
          <n-input-number v-model:value="form.day" :min="1" />
        </n-form-item>
        <n-form-item label="事件">
          <n-dynamic-tags v-model:value="form.events" />
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showModal = false">取消</n-button>
          <n-button type="primary" @click="handleSave">保存</n-button>
        </n-space>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import {
  NH1, NSpace, NButton, NModal, NForm, NFormItem, NInputNumber, NDynamicTags,
  NTimeline, NTimelineItem, NUl, NLi, NEmpty, NSpin
} from 'naive-ui'
import { timelineApi } from '../api/timeline'

const route = useRoute()
const events = ref<any[]>([])
const loading = ref(false)
const showModal = ref(false)
const editingId = ref<string | null>(null)
const form = ref({ day: 1, events: [] as string[] })

async function loadTimeline() {
  if (!route.params.storyId) {
    events.value = []
    return
  }
  loading.value = true
  try {
    const res = await timelineApi.list(route.params.storyId as string)
    events.value = res.data.data
  } finally {
    loading.value = false
  }
}

function startEdit(evt: any) {
  editingId.value = evt.id
  form.value = { day: evt.day, events: JSON.parse(evt.events) }
  showModal.value = true
}

async function handleSave() {
  if (!route.params.storyId) return
  if (editingId.value) {
    await timelineApi.update(editingId.value, { day: form.value.day, events: form.value.events })
  } else {
    await timelineApi.create(route.params.storyId as string, { day: form.value.day, events: form.value.events })
  }
  showModal.value = false
  editingId.value = null
  form.value = { day: 1, events: [] }
  await loadTimeline()
}

async function handleDelete(id: string) {
  await timelineApi.remove(id)
  await loadTimeline()
}

watch(() => route.params.storyId, () => {
  loadTimeline()
})

onMounted(() => {
  if (route.params.storyId) {
    loadTimeline()
  }
})
</script>
