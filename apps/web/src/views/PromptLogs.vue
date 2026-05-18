<template>
  <div>
    <h2 style="margin-bottom: 16px;">AI 调用日志</h2>

    <n-space vertical size="large">
      <!-- 过滤器 -->
      <n-space>
        <n-select
          v-model:value="filterCallType"
          :options="callTypeOptions"
          placeholder="全部类型"
          clearable
          style="width: 160px"
          @update:value="handleFilterChange"
        />
        <n-statistic label="总 Token" :value="totalTokens" />
        <n-statistic label="总调用" :value="totalCalls" />
        <n-statistic label="成功" :value="successCalls" />
        <n-statistic label="失败" :value="errorCalls" />
      </n-space>

      <!-- 表格 -->
      <n-data-table
        :columns="columns"
        :data="logs"
        :loading="loading"
        :pagination="false"
        :row-props="rowProps"
        striped
      />

      <!-- 分页 -->
      <n-pagination
        v-model:page="page"
        v-model:page-size="pageSize"
        :page-count="pageCount"
        :page-sizes="[10, 20, 50]"
        show-size-picker
        @update:page="fetchLogs"
        @update:page-size="handlePageSizeChange"
      />
    </n-space>

    <!-- 详情弹窗 -->
    <n-modal
      v-model:show="showDetail"
      preset="card"
      :title="`调用详情 — ${detailLog?.callType || ''}`"
      style="width: 900px; max-width: 95vw;"
      :segmented="{ content: true }"
    >
      <n-space vertical v-if="detailLog">
        <n-descriptions bordered :column="3" size="small">
          <n-descriptions-item label="时间">{{ formatDate(detailLog.createdAt) }}</n-descriptions-item>
          <n-descriptions-item label="厂商">{{ detailLog.providerName }}</n-descriptions-item>
          <n-descriptions-item label="模型">{{ detailLog.model }}</n-descriptions-item>
          <n-descriptions-item label="预估 Token">{{ detailLog.estimatedTokens }}</n-descriptions-item>
          <n-descriptions-item label="实际 Prompt">{{ detailLog.promptTokens }}</n-descriptions-item>
          <n-descriptions-item label="实际 Completion">{{ detailLog.completionTokens }}</n-descriptions-item>
          <n-descriptions-item label="总 Token">{{ detailLog.totalTokens }}</n-descriptions-item>
          <n-descriptions-item label="耗时">{{ detailLog.durationMs }}ms</n-descriptions-item>
          <n-descriptions-item label="状态">
            <n-tag :type="detailLog.status === 'success' ? 'success' : 'error'">
              {{ detailLog.status === 'success' ? '成功' : '失败' }}
            </n-tag>
          </n-descriptions-item>
        </n-descriptions>

        <n-divider />

        <n-tabs type="line" animated>
          <n-tab-pane name="user" tab="User Message">
            <n-scrollbar style="max-height: 400px;">
              <n-code :code="detailLog.userMessage" language="markdown" show-line-numbers />
            </n-scrollbar>
          </n-tab-pane>
          <n-tab-pane name="system" tab="System Message">
            <n-scrollbar style="max-height: 400px;">
              <n-code :code="detailLog.systemMessage" language="markdown" show-line-numbers />
            </n-scrollbar>
          </n-tab-pane>
          <n-tab-pane name="response" tab="Response">
            <n-scrollbar style="max-height: 400px;">
              <n-code :code="detailLog.responseContent" language="markdown" show-line-numbers />
            </n-scrollbar>
          </n-tab-pane>
          <n-tab-pane v-if="detailLog.errorMessage" name="error" tab="Error">
            <n-alert type="error" :title="detailLog.errorMessage" />
          </n-tab-pane>
        </n-tabs>
      </n-space>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, h, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import {
  NDataTable, NPagination, NSelect, NSpace, NModal,
  NDescriptions, NDescriptionsItem, NTag, NDivider,
  NTabs, NTabPane, NCode, NScrollbar, NStatistic, NAlert,
  type DataTableColumns
} from 'naive-ui'
import { api } from '../utils/api.js'

const route = useRoute()
const storyId = computed(() => route.params.storyId as string)

const loading = ref(false)
const logs = ref<any[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const filterCallType = ref<string | null>(null)
const showDetail = ref(false)
const detailLog = ref<any>(null)

const pageCount = computed(() => Math.ceil(total.value / pageSize.value))

const totalTokens = computed(() => logs.value.reduce((sum, l) => sum + (l.totalTokens || 0), 0))
const totalCalls = computed(() => total.value)
const successCalls = computed(() => logs.value.filter(l => l.status === 'success').length)
const errorCalls = computed(() => logs.value.filter(l => l.status === 'error').length)

const callTypeMap: Record<string, string> = {
  generate: '章节生成',
  memory_extract: '记忆提取',
  graph_extract: '图谱提取',
  plot_extract: '弧线提取',
  combined_extract: '合并提取',
  compress: '记忆压缩'
}

const callTypeOptions = [
  { label: '章节生成', value: 'generate' },
  { label: '记忆提取', value: 'memory_extract' },
  { label: '图谱提取', value: 'graph_extract' },
  { label: '弧线提取', value: 'plot_extract' },
  { label: '合并提取', value: 'combined_extract' },
  { label: '记忆压缩', value: 'compress' },
  { label: '记忆整理', value: 'memory_organize' }
]

function formatDate(d: string) {
  return new Date(d).toLocaleString('zh-CN')
}

function formatCallType(type: string) {
  return callTypeMap[type] || type
}

const columns: DataTableColumns<any> = [
  {
    title: '时间',
    key: 'createdAt',
    width: 170,
    render: (row) => formatDate(row.createdAt)
  },
  {
    title: '类型',
    key: 'callType',
    width: 100,
    render: (row) => formatCallType(row.callType)
  },
  {
    title: '模型',
    key: 'model',
    width: 160
  },
  {
    title: '预估 Token',
    key: 'estimatedTokens',
    width: 110,
    align: 'right'
  },
  {
    title: '实际 Token',
    key: 'totalTokens',
    width: 110,
    align: 'right',
    render: (row) => {
      const diff = row.totalTokens - row.estimatedTokens
      const color = diff > 500 ? 'error' : diff > 0 ? 'warning' : 'success'
      return h('div', null, [
        row.totalTokens,
        h('span', { style: `color: var(--n-${color}-color); font-size: 12px; margin-left: 4px;` },
          diff !== 0 ? `(${diff > 0 ? '+' : ''}${diff})` : '')
      ])
    }
  },
  {
    title: '耗时',
    key: 'durationMs',
    width: 90,
    align: 'right',
    render: (row) => row.durationMs ? `${row.durationMs}ms` : '-'
  },
  {
    title: '状态',
    key: 'status',
    width: 80,
    render: (row) => h('span', {
      style: `color: ${row.status === 'success' ? '#18a058' : '#d03050'}; font-weight: bold;`
    }, row.status === 'success' ? '成功' : '失败')
  }
]

function rowProps(row: any) {
  return {
    style: 'cursor: pointer;',
    onClick: () => {
      detailLog.value = row
      showDetail.value = true
    }
  }
}

async function fetchLogs() {
  if (!storyId.value) return
  loading.value = true
  try {
    const params: any = { page: page.value, pageSize: pageSize.value }
    if (filterCallType.value) params.callType = filterCallType.value
    const res = await api.get(`/api/stories/${storyId.value}/prompt-logs`, { params })
    if (res.data.success) {
      logs.value = res.data.data.items
      total.value = res.data.data.total
    }
  } catch (err: any) {
    console.error('Failed to fetch prompt logs:', err)
  } finally {
    loading.value = false
  }
}

function handleFilterChange() {
  page.value = 1
  fetchLogs()
}

function handlePageSizeChange(size: number) {
  pageSize.value = size
  page.value = 1
  fetchLogs()
}

onMounted(fetchLogs)
watch(storyId, () => { page.value = 1; fetchLogs() })
watch(page, fetchLogs)
</script>
