<template>
  <div>
    <header class="page-head">
      <div class="page-head__text">
        <span class="cap-eyebrow is-accent">V2 · WORKER TASKS</span>
        <h1 class="page-head__title">任务模板</h1>
        <p class="page-head__lede cap-body-sm">为每个 Worker 类型选择使用的 Task 模板。</p>
      </div>
      <div class="page-head__actions">
        <button class="cap-pill is-primary" :disabled="saving" @click="saveAll">{{ saving ? '保存中…' : '保存配置' }}</button>
      </div>
    </header>

    <div class="cap-card" style="margin-bottom: 16px; padding: 14px 18px; background: var(--accent-info-tint); border-color: transparent;">
      <span class="cap-body-sm" style="color: var(--accent-link);">
        系统内置的 Task 会自动列出，你也可以在全局任务模板页面创建自定义版本。
      </span>
    </div>

    <n-spin :show="loading">
      <n-tabs type="line" animated>
        <n-tab-pane
          v-for="config in workerConfigs"
          :key="config.workerType"
          :name="config.workerType"
          :tab="config.label"
        >
          <n-space vertical>
            <n-form-item :label="`选择 ${config.label} 的 Task`">
              <n-select
                v-model:value="selectedTaskIds[config.workerType]"
                :options="getTaskOptions(config.workerType)"
                placeholder="选择 Task"
                clearable
                style="width: 400px"
              />
            </n-form-item>

            <n-descriptions v-if="getSelectedTask(config.workerType)" bordered :column="1" size="small">
              <n-descriptions-item label="名称">
                {{ getSelectedTask(config.workerType)?.name || '-' }}
              </n-descriptions-item>
              <n-descriptions-item label="类型">
                <n-tag :type="getSelectedTask(config.workerType)?.type === 'system' ? 'warning' : 'default'" size="small">
                  {{ getSelectedTask(config.workerType)?.type === 'system' ? '系统内置' : '自定义' }}
                </n-tag>
              </n-descriptions-item>
              <n-descriptions-item label="Task Prompt">
                <div style="white-space: pre-wrap; font-size: 13px; max-height: 400px; overflow-y: auto;">
                  {{ getSelectedTask(config.workerType)?.taskPrompt || '-' }}
                </div>
              </n-descriptions-item>
            </n-descriptions>

            <n-empty v-else description="未选择 Task，将回退到系统默认" />
          </n-space>
        </n-tab-pane>
      </n-tabs>
    </n-spin>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRoute } from 'vue-router'
import {
  NSpace, NSelect, NFormItem, NDescriptions, NDescriptionsItem, NTag, NEmpty, NSpin,
  NTabs, NTabPane,
  useMessage
} from 'naive-ui'
import { v2WorkerTaskApi } from '../api-v2/worker-tasks'

const route = useRoute()
const message = useMessage()
const storyId = computed(() => route.params.storyId as string)

const loading = ref(false)
const saving = ref(false)
const bindings = ref<any[]>([])
const allTasks = ref<any[]>([])

const selectedTaskIds = ref<Record<string, string | null>>({
  generation: null,
  scoring: null,
  memory: null,
  graph: null,
  timeline: null,
  rewrite: null
})

const workerConfigs = [
  { workerType: 'generation', label: 'Generation（章节生成）' },
  { workerType: 'scoring', label: 'Scoring（内容评分）' },
  { workerType: 'memory', label: 'Memory（记忆提取）' },
  { workerType: 'graph', label: 'Graph（图谱提取）' },
  { workerType: 'timeline', label: 'Timeline（时间线提取）' },
  { workerType: 'rewrite', label: 'Rewrite（改写润色）' }
]

function getTaskOptions(workerType: string) {
  const tasks = allTasks.value.filter(t => t.workerType === workerType && (t.type === 'system' || t.storyId === null))
  return tasks.map((t: any) => ({
    label: `${t.name} (${t.type === 'system' ? '系统' : '自定义'})`,
    value: t.id
  }))
}

function getSelectedTask(workerType: string) {
  const taskId = selectedTaskIds.value[workerType]
  if (!taskId) return null
  return allTasks.value.find(t => t.id === taskId) || null
}

async function loadData() {
  loading.value = true
  try {
    const [bindingsRes, tasksRes] = await Promise.all([
      v2WorkerTaskApi.getBindings(storyId.value),
      v2WorkerTaskApi.list()
    ])

    bindings.value = bindingsRes.data.data
    allTasks.value = tasksRes.data.data

    for (const config of workerConfigs) {
      const binding = bindings.value.find((b: any) => b.workerType === config.workerType)
      selectedTaskIds.value[config.workerType] = binding?.workerTaskId || null
    }
  } finally {
    loading.value = false
  }
}

async function saveAll() {
  saving.value = true
  try {
    const promises: Promise<any>[] = []
    for (const config of workerConfigs) {
      const taskId = selectedTaskIds.value[config.workerType]
      if (taskId) {
        promises.push(v2WorkerTaskApi.updateBinding(storyId.value, {
          workerType: config.workerType,
          workerTaskId: taskId
        }))
      }
    }
    await Promise.all(promises)
    message.success('配置已保存')
    await loadData()
  } catch (err: any) {
    message.error('保存失败: ' + (err.message || '未知错误'))
  } finally {
    saving.value = false
  }
}

onMounted(loadData)
</script>
