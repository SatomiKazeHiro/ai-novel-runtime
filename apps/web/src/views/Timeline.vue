<template>
  <div>
    <header class="page-head">
      <div class="page-head__text">
        <span class="cap-eyebrow">TIMELINE</span>
        <h1 class="page-head__title">时间线</h1>
        <p class="page-head__lede cap-body-sm">章节中的事件按天串联，跨章节保持时序一致。</p>
      </div>
      <div class="page-head__actions">
        <button class="cap-pill is-primary" @click="showModal = true">+ 添加事件</button>
      </div>
    </header>

    <n-spin :show="loading">
      <n-timeline v-if="events.length > 0">
        <n-timeline-item v-for="evt in events" :key="evt.id" type="default" :title="formatPosition(evt.position)">
          <n-ul>
            <n-li v-for="(desc, idx) in JSON.parse(evt.events)" :key="idx">{{ desc }}</n-li>
          </n-ul>
          <n-space>
            <n-button size="tiny" @click="startEdit(evt)">编辑</n-button>
            <n-button size="tiny" type="error" @click="handleDelete(evt)">删除</n-button>
          </n-space>
        </n-timeline-item>
      </n-timeline>
      <n-empty v-else description="暂无时间线事件" />
    </n-spin>

    <n-modal v-model:show="showModal" :title="editingId ? '编辑事件' : '添加事件'" preset="card" style="width: 500px">
      <n-form :model="form" label-placement="left" label-width="80">
        <n-form-item label="时间位置" required>
          <n-input-number v-model:value="form.position" :step="0.0001" placeholder="如 1.00106 表示第1年第1天 06时" />
        </n-form-item>
        <n-form-item label="事件">
          <DynamicTags v-model="form.events" />
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
  NSpace, NButton, NModal, NForm, NFormItem, NInputNumber,
  NTimeline, NTimelineItem, NUl, NLi, NEmpty, NSpin,
  useDialog
} from 'naive-ui'
import { timelineApi } from '../api/timeline'
import DynamicTags from '../components/DynamicTags.vue'

const route = useRoute()
const dialog = useDialog()
const events = ref<any[]>([])
const loading = ref(false)
const showModal = ref(false)
const editingId = ref<string | null>(null)
const form = ref({ position: 1.00106, events: [] as string[] })

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

function formatPosition(p: number): string {
  const sign = p < 0 ? '前' : ''
  const abs = Math.abs(p)
  const [intPart, decPart = ''] = abs.toString().split('.')
  const year = parseInt(intPart, 10)
  const padded = (decPart + '00000').slice(0, 5)
  const day = parseInt(padded.slice(0, 3), 10)
  const hh = parseInt(padded.slice(3, 5), 10)
  return `${sign}第${year}年第${day}天 ${String(hh).padStart(2, '0')}时`
}

function startEdit(evt: any) {
  editingId.value = evt.id
  form.value = { position: evt.position, events: JSON.parse(evt.events) }
  showModal.value = true
}

async function handleSave() {
  if (!route.params.storyId) return
  if (editingId.value) {
    await timelineApi.update(editingId.value, { position: form.value.position, events: form.value.events })
  } else {
    await timelineApi.create(route.params.storyId as string, { position: form.value.position, events: form.value.events })
  }
  showModal.value = false
  editingId.value = null
  form.value = { position: 1.00106, events: [] }
  await loadTimeline()
}

function handleDelete(evt: any) {
  dialog.warning({
    title: '确认删除',
    content: `确定要删除 ${formatPosition(evt.position)} 的时间线事件吗？删除后不可恢复。`,
    positiveText: '删除',
    negativeText: '取消',
    positiveButtonProps: { type: 'error' },
    onPositiveClick: async () => {
      await timelineApi.remove(evt.id)
      await loadTimeline()
    }
  })
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
