<template>
  <div>
    <header class="page-head">
      <div class="page-head__text">
        <span class="cap-eyebrow">PROMPT LOGS</span>
        <h1 class="page-head__title">AI 调用日志</h1>
        <p class="page-head__lede cap-body-sm">所有 AI 调用的完整记录 — prompt 模板、token 用量、响应时间、错误追踪。</p>
      </div>
      <div class="page-head__actions">
        <n-select
          v-model:value="filterCallType"
          :options="callTypeSelectOptions"
          placeholder="全部类型"
          clearable
          style="width: 180px"
          @update:value="handleFilterChange"
        />
      </div>
    </header>

    <n-space vertical size="large">
      <!-- 指标看板: 4 张 metric 卡片, boords 风格 1px border + 6px radius -->
      <div class="metric-board">
        <div class="metric-card">
          <span class="cap-eyebrow metric-card__label">总 Token</span>
          <span class="metric-card__num">{{ formatNumber(totalTokens) }}</span>
          <span class="metric-card__delta cap-caption">{{ totalCalls }} 次调用</span>
        </div>
        <div class="metric-card">
          <span class="cap-eyebrow metric-card__label">总调用</span>
          <span class="metric-card__num">{{ totalCalls }}</span>
          <span class="metric-card__delta cap-caption">含本页与历史</span>
        </div>
        <div class="metric-card">
          <span class="cap-eyebrow metric-card__label">成功</span>
          <span class="metric-card__num">{{ successCalls }}</span>
          <span class="metric-card__delta cap-caption metric-card__delta--positive">
            {{ successRateLabel }}
          </span>
        </div>
        <div class="metric-card metric-card--error">
          <span class="cap-eyebrow metric-card__label">失败</span>
          <span class="metric-card__num">{{ errorCalls }}</span>
          <span class="metric-card__delta cap-caption metric-card__delta--error">
            {{ errorRateLabel }}
          </span>
        </div>
      </div>

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
      :title="`调用详情 — ${detailTypeLabel}`"
      style="width: 900px; max-width: 95vw;"
      :segmented="{ content: true }"
    >
      <n-space vertical v-if="detailLog">
        <n-descriptions bordered :column="3" size="small">
          <n-descriptions-item label="时间">{{ formatDate(detailLog.createdAt) }}</n-descriptions-item>
          <n-descriptions-item label="类型">
            <span class="prompt-chip" :data-tone="detailCallType.tone">
              {{ detailCallType.label }}
            </span>
          </n-descriptions-item>
          <n-descriptions-item label="状态">
            <span class="prompt-chip" :data-tone="detailCallStatus.tone">
              {{ detailCallStatus.label }}
            </span>
          </n-descriptions-item>
          <n-descriptions-item label="厂商">{{ detailLog.providerName }}</n-descriptions-item>
          <n-descriptions-item label="模型">{{ detailLog.model }}</n-descriptions-item>
          <n-descriptions-item label="耗时">{{ detailLog.durationMs }}ms</n-descriptions-item>
          <n-descriptions-item label="预估 Token">{{ detailLog.estimatedTokens }}</n-descriptions-item>
          <n-descriptions-item label="实际 Prompt">{{ detailLog.promptTokens }}</n-descriptions-item>
          <n-descriptions-item label="实际 Completion">{{ detailLog.completionTokens }}</n-descriptions-item>
          <n-descriptions-item label="总 Token" :span="3">{{ detailLog.totalTokens }}</n-descriptions-item>
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
  NDescriptions, NDescriptionsItem, NDivider,
  NTabs, NTabPane, NCode, NScrollbar, NAlert,
  type DataTableColumns
} from 'naive-ui'
import { api } from '../utils/api'
import { getCallType, getCallStatus, CALL_TYPES } from '../styles/prompt-log-types'

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

// 成功率/失败率显示在 metric 卡片上, 总数 0 时显示 "—"
const successRateLabel = computed(() => {
  if (totalCalls.value === 0) return '—'
  return `成功率 ${Math.round((successCalls.value / totalCalls.value) * 100)}%`
})
const errorRateLabel = computed(() => {
  if (totalCalls.value === 0) return '—'
  return `占比 ${Math.round((errorCalls.value / totalCalls.value) * 100)}%`
})

// 过滤下拉选项: 从映射表生成, 顺序由 order 决定, 不混入未在 schema 中的旧值
const callTypeSelectOptions = computed(() =>
  [...CALL_TYPES]
    .sort((a, b) => a.order - b.order)
    .map(t => ({ label: t.label, value: t.id }))
)

// 详情弹窗用, 避免在标题里写 id 原文
const detailTypeLabel = computed(() => detailLog.value ? getCallType(detailLog.value.callType).label : '')
const detailCallType = computed(() => getCallType(detailLog.value?.callType))
const detailCallStatus = computed(() => getCallStatus(detailLog.value?.status))

function formatDate(d: string) {
  return new Date(d).toLocaleString('zh-CN')
}

// 千分位: 让大数字可读 (1234567 -> 1,234,567)
function formatNumber(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '0'
  return n.toLocaleString('en-US')
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
    width: 110,
    render: (row) => {
      const def = getCallType(row.callType)
      return h('span', { class: 'prompt-chip', 'data-tone': def.tone }, def.label)
    }
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
    width: 130,
    align: 'right',
    render: (row) => {
      const diff = row.totalTokens - row.estimatedTokens
      // 与原逻辑一致: 偏差 >500 红色, >0 黄色, 0 绿色
      const color = diff > 500 ? 'error' : diff > 0 ? 'warning' : 'success'
      return h('div', { class: 'token-cell' }, [
        h('span', { class: 'token-cell__num' }, formatNumber(row.totalTokens)),
        diff !== 0
          ? h('span', {
              class: `token-cell__delta token-cell__delta--${color}`
            }, `(${diff > 0 ? '+' : ''}${formatNumber(diff)})`)
          : null
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
    width: 90,
    render: (row) => {
      const def = getCallStatus(row.status)
      return h('span', { class: 'prompt-chip', 'data-tone': def.tone }, def.label)
    }
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

<style scoped>
/* === Metric board: 4 张数字卡片横排, boords 风格 === */
.metric-board {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--space-3);
}
@media (max-width: 880px) {
  .metric-board { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 480px) {
  .metric-board { grid-template-columns: 1fr; }
}

.metric-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: var(--space-4) var(--space-5);
  background: var(--bg-card);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-card);
  transition: border-color 0.18s ease;
}
.metric-card:hover {
  border-color: var(--color-mid-gray);
}
.metric-card--error {
  border-left: 2px solid var(--color-error);
}

.metric-card__label {
  color: var(--text-tertiary);
}
.metric-card__num {
  font-family: var(--font-mono);
  font-size: var(--text-heading-size);
  font-weight: var(--weight-semibold);
  line-height: 1.1;
  color: var(--color-ink-black);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.01em;
}
.metric-card--error .metric-card__num {
  color: var(--color-error);
}
.metric-card__delta {
  font-variant-numeric: tabular-nums;
}
.metric-card__delta--positive { color: var(--accent-positive); }
.metric-card__delta--error    { color: var(--color-error); }

/* === Token 单元格: 主数字 + 偏差小字 (保持原逻辑, 视觉上变精致) === */
.token-cell {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
}
.token-cell__num {
  font-variant-numeric: tabular-nums;
}
.token-cell__delta {
  font-family: var(--font-mono);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.token-cell__delta--success { color: var(--accent-positive); }
.token-cell__delta--warning { color: var(--accent); }
.token-cell__delta--error   { color: var(--color-error); }

/* === Chip: 类型 / 状态共用, 复用 6-tone 调色板 (与 ChapterStatusBadge 同源) === */
.prompt-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 1px 8px 1px 6px;
  border-radius: var(--radius-badge);
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: 0.04em;
  line-height: 1.5;
  font-weight: var(--weight-semibold);
  white-space: nowrap;
  flex-shrink: 0;
}
.prompt-chip[data-tone="warm"]     { color: var(--accent);          background: var(--color-warm-accent-tint); }
.prompt-chip[data-tone="cool"]     { color: var(--accent-link);      background: var(--accent-info-tint); }
.prompt-chip[data-tone="review"]   { color: var(--color-review);     background: var(--color-review-tint); }
.prompt-chip[data-tone="positive"] { color: var(--accent-positive);  background: var(--color-positive-tint); }
.prompt-chip[data-tone="error"]    { color: var(--color-error);      background: var(--color-error-tint); }
.prompt-chip[data-tone="neutral"]  { color: var(--text-tertiary);    background: var(--bg-section); }
</style>
