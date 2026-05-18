<template>
  <div>
    <!-- ========== 列表视图 ========== -->
    <div v-if="!editMode">
      <n-space justify="space-between" align="center" style="margin-bottom: 16px">
        <n-h1>章节工作台</n-h1>
        <n-button type="primary" @click="showModal = true">新建章节</n-button>
      </n-space>

      <n-data-table :columns="columns" :data="chapters" :loading="loading" />
    </div>

    <!-- ========== 编辑子页面 ========== -->
    <div v-else>
      <!-- 顶部导航：返回 + 标题编辑 -->
      <n-space align="center" style="margin-bottom: 24px">
        <n-button @click="backToList">
          <template #icon>
            <n-icon><ArrowBackOutline /></n-icon>
          </template>
          返回
        </n-button>
        <n-divider vertical />
        <n-input
          v-model:value="editTitle"
          style="width: 320px; font-size: 16px; font-weight: 600"
          placeholder="章节标题"
          @blur="saveTitle"
        />
        <n-tag v-if="currentChapter?.isSideStory" size="small" type="warning">番外</n-tag>
        <n-tag size="small" :type="statusTagType(currentChapter?.status)">{{ currentChapter?.status }}</n-tag>
      </n-space>

      <!-- Step 1: 剧情弧线、大纲与场景 -->
      <n-card title="Step 1：剧情弧线、大纲与场景" style="margin-bottom: 24px">
        <!-- 剧情弧线 Grid -->
        <n-grid v-if="plotArcs.length > 0" :cols="3" :x-gap="12" :y-gap="12" style="margin-bottom: 16px">
          <n-grid-item v-for="arc in plotArcs" :key="arc.id">
            <n-card size="small" :bordered="false" embedded style="height: 100%;">
              <n-space justify="space-between" align="center">
                <n-text strong>{{ arc.name }}</n-text>
                <n-space>
                  <n-tag size="tiny" :type="arc.type === 'main' ? 'error' : 'default'">{{ arc.type === 'main' ? '主线' : '支线' }}</n-tag>
                  <n-tag size="tiny" :type="arcStatusType(arc.status)">{{ arc.status }}</n-tag>
                </n-space>
              </n-space>
              <n-progress :percentage="arc.progress" :show-indicator="false" :height="6" style="margin: 8px 0" />
              <n-text depth="3" style="font-size: 12px">当前：{{ arc.currentStage || '未知' }} | 目标：{{ arc.nextGoal || '待定' }}</n-text>
            </n-card>
          </n-grid-item>
        </n-grid>
        <n-empty v-else description="暂无剧情弧线" style="margin-bottom: 16px" />

        <n-divider />

        <!-- 大纲表单 -->
        <n-form label-placement="left" label-width="60">
          <n-form-item label="大纲">
            <n-input
              v-model:value="editForm.outline"
              type="textarea"
              :rows="12"
              placeholder="输入章节大纲..."
            />
          </n-form-item>
        </n-form>
        <n-space>
          <n-button type="primary" @click="saveOutline" size="small">保存大纲</n-button>
        </n-space>

        <n-divider />

        <!-- 场景表单 -->
        <n-form label-placement="left" label-width="60">
          <n-grid :cols="3" :x-gap="16">
            <n-grid-item>
              <n-form-item label="地点">
                <n-input v-model:value="editForm.sceneLocation" placeholder="场景地点" />
              </n-form-item>
            </n-grid-item>
            <n-grid-item>
              <n-form-item label="氛围">
                <n-input v-model:value="editForm.sceneMood" placeholder="如 tension" />
              </n-form-item>
            </n-grid-item>
            <n-grid-item>
              <n-form-item label="目标">
                <n-input v-model:value="editForm.sceneGoal" placeholder="如 confession" />
              </n-form-item>
            </n-grid-item>
          </n-grid>
        </n-form>
        <n-space>
          <n-button type="primary" @click="saveScene" size="small">保存场景</n-button>
        </n-space>
      </n-card>

      <!-- Step 2: 候选生成 -->
      <n-card title="Step 2：候选生成" style="margin-bottom: 24px">
        <!-- 生成候选 -->
        <n-space align="center" style="margin-bottom: 12px">
          <n-button type="primary" @click="handleGenerate" :loading="generating" :disabled="generating">
            {{ generating ? '生成中...' : drafts.length > 0 ? '重新生成候选' : '生成候选' }}
          </n-button>
          <n-text v-if="generating" depth="3">AI 正在创作中，请耐心等待（可能需数十秒至数分钟）</n-text>
        </n-space>

        <!-- 预算仪表盘 -->
        <n-card v-if="tokenStats" size="small" style="margin-bottom: 16px" :bordered="false">
          <n-space vertical>
            <n-space justify="space-between" align="center">
              <n-text strong>Prompt 预算</n-text>
              <n-space>
                <n-tag size="small" :type="tokenStats.totalTokens > 50000 ? 'error' : tokenStats.totalTokens > 40000 ? 'warning' : 'success'">
                  {{ tokenStats.totalTokens.toLocaleString() }} / {{ MODEL_MAX_TOKENS.toLocaleString() }} tokens
                </n-tag>
                <n-tag v-if="layerStats.some(l => l.truncated)" size="small" type="error">⚠️ 有层被截断</n-tag>
              </n-space>
            </n-space>
            <n-progress
              :percentage="Math.min(100, Math.round((tokenStats.totalTokens / MODEL_MAX_TOKENS) * 100))"
              :status="tokenStats.totalTokens > 55000 ? 'error' : tokenStats.totalTokens > 40000 ? 'warning' : 'success'"
              :show-indicator="false"
              :height="12"
            />
            <n-space v-if="layerStats.length > 0" size="small" style="margin-top: 4px">
              <n-tag v-for="layer in layerStats" :key="layer.name" size="tiny"
                :type="layer.truncated ? 'error' : 'default'"
                :title="`${layer.name}: ${layer.tokens.toLocaleString()} / ${layer.budget.toLocaleString()} tokens${layer.truncated ? ' (已截断)' : ''}`"
              >
                {{ layer.name }} {{ layer.tokens.toLocaleString() }}
                <span v-if="layer.truncated" style="color: #ef4444">⚠️</span>
              </n-tag>
            </n-space>
          </n-space>
        </n-card>

        <!-- 候选结果 Grid（3列卡片，固定高度） -->
        <n-grid v-if="drafts.length > 0" :cols="3" :x-gap="12" :y-gap="12">
          <n-grid-item v-for="draft in drafts" :key="draft.id">
            <n-card size="small" :bordered="true" content-style="height: 420px">
              <template #header>
                <n-space align="center" justify="space-between" style="width: 100%">
                  <n-text strong>{{ formatDraftTitle(draft) }}</n-text>
                  <n-tag :type="draft.status === 'selected' ? 'success' : 'default'" size="small">{{ draft.status }}</n-tag>
                </n-space>
              </template>
              <n-scrollbar>
                <n-p style="white-space: pre-wrap; line-height: 1.8; font-size: 13px">{{ draft.content }}</n-p>
              </n-scrollbar>
              <template #footer>
                <n-button size="small" type="primary" block @click="selectDraft(draft.id)">采用此候选</n-button>
              </template>
            </n-card>
          </n-grid-item>
        </n-grid>
      </n-card>

      <!-- Step 3: 正文编辑、保存与归档 -->
      <n-card title="Step 3：正文编辑、保存与归档" v-if="drafts.length > 0">
        <n-input
          v-model:value="editForm.content"
          type="textarea"
          :rows="20"
          placeholder="章节正文..."
          style="margin-bottom: 12px"
        />
        <n-space align="center">
          <n-button type="primary" @click="saveContent">保存正文</n-button>
          <n-button @click="archiveChapter" :disabled="!editForm.content?.trim()">
            归档{{ !editForm.content?.trim() ? '（需先填写正文）' : '' }}
          </n-button>
        </n-space>
      </n-card>
    </div>

    <!-- ========== 新建章节弹窗 ========== -->
    <n-modal v-model:show="showModal" title="新建章节" preset="card" style="width: 800px">
      <n-form :model="form" label-placement="left" label-width="80">
        <n-form-item label="标题" required>
          <n-input v-model:value="form.title" placeholder="章节标题" />
        </n-form-item>
        <n-form-item label="番外章节">
          <n-switch v-model:value="form.isSideStory" />
        </n-form-item>
        <n-form-item v-if="form.isSideStory" label="插入序号">
          <n-input v-model:value="form.number" placeholder="如 3.5 表示第3章后" />
        </n-form-item>
        <n-form-item label="大纲">
          <n-input v-model:value="form.outline" type="textarea" placeholder="章节大纲" :rows="12" />
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showModal = false">取消</n-button>
          <n-button type="primary" @click="handleCreate">创建</n-button>
        </n-space>
      </template>
    </n-modal>

    <!-- ========== Prompt Preview Modal ========== -->
    <n-modal v-model:show="showPreviewModal" title="Prompt 预览确认" preset="card" style="width: 800px; max-height: 80vh">
      <n-space vertical>
        <n-card size="small" :bordered="false">
          <n-space vertical>
            <n-space justify="space-between" align="center">
              <n-text strong>预算概览</n-text>
              <n-space>
                <n-tag size="small" :type="previewData?.tokens?.totalTokens > 50000 ? 'error' : previewData?.tokens?.totalTokens > 40000 ? 'warning' : 'success'">
                  {{ previewData?.tokens?.totalTokens?.toLocaleString() || 0 }} / {{ MODEL_MAX_TOKENS.toLocaleString() }} tokens
                </n-tag>
                <n-tag v-if="previewData?.layers?.some((l: any) => l.truncated)" size="small" type="error">⚠️ 有层被截断</n-tag>
              </n-space>
            </n-space>
            <n-progress
              :percentage="Math.min(100, Math.round(((previewData?.tokens?.totalTokens || 0) / MODEL_MAX_TOKENS) * 100))"
              :status="(previewData?.tokens?.totalTokens || 0) > 55000 ? 'error' : (previewData?.tokens?.totalTokens || 0) > 40000 ? 'warning' : 'success'"
              :show-indicator="false"
              :height="12"
            />
            <n-space v-if="previewData?.layers?.length > 0" size="small" style="margin-top: 4px">
              <n-tag v-for="layer in previewData.layers" :key="layer.name" size="tiny"
                :type="layer.truncated ? 'error' : 'default'"
                :title="`${layer.name}: ${layer.tokens.toLocaleString()} / ${layer.budget.toLocaleString()} tokens${layer.truncated ? ' (已截断)' : ''}`"
              >
                {{ layer.name }} {{ layer.tokens.toLocaleString() }}
                <span v-if="layer.truncated" style="color: #ef4444">⚠️</span>
              </n-tag>
            </n-space>
          </n-space>
        </n-card>

        <n-card size="small" title="Prompt 预览" :bordered="false">
          <n-input type="textarea" :value="previewData?.preview || ''" :rows="12" readonly />
        </n-card>
      </n-space>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showPreviewModal = false">取消</n-button>
          <n-button type="primary" @click="confirmGenerate" :loading="generating">确认生成</n-button>
        </n-space>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, h, watch } from 'vue'
import { useRoute } from 'vue-router'
import {
  NH1, NSpace, NButton, NDataTable, NModal, NForm, NFormItem, NInput,
  NCard, NP, NTag, NEmpty, NProgress, NText, NSwitch,
  NGrid, NGridItem, NScrollbar, NDivider, NIcon,
  useMessage,
  type DataTableColumns
} from 'naive-ui'
import { ArrowBackOutline } from '@vicons/ionicons5'
import { chaptersApi, draftsApi } from '../api/chapters'
import { plotArcApi } from '../api/plot-arc'

const route = useRoute()
const chapters = ref<any[]>([])
const loading = ref(false)
const showModal = ref(false)
const editMode = ref(false)
const currentChapter = ref<any>(null)
const editTitle = ref('')
const drafts = ref<any[]>([])
const message = useMessage()
const generating = ref(false)
const tokenStats = ref<{ systemTokens: number; userTokens: number; totalTokens: number } | null>(null)
const layerStats = ref<{ name: string; tokens: number; budget: number; truncated: boolean }[]>([])
const plotArcs = ref<any[]>([])
const showPreviewModal = ref(false)
const previewData = ref<any>(null)
const MODEL_MAX_TOKENS = 64000

const form = ref({ title: '', outline: '', isSideStory: false, number: '' })
const editForm = ref({ outline: '', content: '', sceneLocation: '', sceneMood: '', sceneGoal: '' })

const columns: DataTableColumns<any> = [
  {
    title: '序号',
    key: 'number',
    width: 90,
    render(row) {
      return h(NSpace, { align: 'center', size: 4 }, {
        default: () => [
          row.isSideStory ? h(NTag, { size: 'tiny', type: 'warning' }, { default: () => '番外' }) : null,
          h('span', null, row.number)
        ]
      })
    }
  },
  { title: '标题', key: 'title' },
  { title: '状态', key: 'status', width: 100 },
  { title: '场景', key: 'sceneLocation', width: 120 },
  {
    title: '操作',
    key: 'actions',
    width: 120,
    render(row) {
      return h(NSpace, null, {
        default: () => [
          h(NButton, { size: 'small', onClick: () => openDetail(row) }, { default: () => '编辑' }),
          h(NButton, { size: 'small', type: 'error', onClick: () => handleDelete(row.id) }, { default: () => '删除' })
        ]
      })
    }
  }
]

function statusTagType(status?: string) {
  switch (status) {
    case 'archived': return 'success'
    case 'selected': return 'info'
    case 'generated': return 'warning'
    case 'draft': return 'default'
    default: return 'default'
  }
}

function arcStatusType(status?: string) {
  switch (status) {
    case 'active': return 'success'
    case 'completed': return 'default'
    case 'resolving': return 'warning'
    case 'pending': return 'default'
    default: return 'default'
  }
}

async function loadChapters() {
  if (!route.params.storyId) {
    chapters.value = []
    return
  }
  loading.value = true
  try {
    const res = await chaptersApi.list(route.params.storyId as string)
    chapters.value = res.data.data
  } finally {
    loading.value = false
  }
}

async function openDetail(row: any) {
  currentChapter.value = row
  editTitle.value = row.title || ''
  editForm.value = {
    outline: row.outline || '',
    content: row.content || '',
    sceneLocation: row.sceneLocation || '',
    sceneMood: row.sceneMood || '',
    sceneGoal: row.sceneGoal || ''
  }
  editMode.value = true

  // 加载候选
  if (row.id) {
    const res = await draftsApi.list(row.id)
    drafts.value = res.data.data
  }
  // 加载剧情弧线
  if (route.params.storyId) {
    try {
      const arcRes = await plotArcApi.list(route.params.storyId as string)
      plotArcs.value = arcRes.data.data || []
    } catch {
      plotArcs.value = []
    }
  }
}

function backToList() {
  editMode.value = false
  currentChapter.value = null
  editTitle.value = ''
  drafts.value = []
  plotArcs.value = []
  tokenStats.value = null
  layerStats.value = []
}

async function handleCreate() {
  if (!route.params.storyId || !form.value.title) return
  const data: any = { title: form.value.title, outline: form.value.outline }
  if (form.value.isSideStory) {
    data.isSideStory = true
    data.number = form.value.number ? parseFloat(form.value.number) : undefined
  }
  const res = await chaptersApi.create(route.params.storyId as string, data)
  showModal.value = false
  form.value = { title: '', outline: '', isSideStory: false, number: '' }

  // 创建后直接打开编辑子页面
  const newChapter = res.data.data
  if (newChapter) {
    await openDetail(newChapter)
    await loadChapters()
  }
}

async function handleDelete(id: string) {
  await chaptersApi.remove(id)
  await loadChapters()
}

async function saveTitle() {
  if (!currentChapter.value) return
  if (editTitle.value !== currentChapter.value.title) {
    await chaptersApi.update(currentChapter.value.id, { title: editTitle.value })
    currentChapter.value.title = editTitle.value
    await loadChapters()
  }
}

async function saveOutline() {
  if (!currentChapter.value) return
  await chaptersApi.update(currentChapter.value.id, { outline: editForm.value.outline })
  message.success('大纲已保存')
}

async function saveContent() {
  if (!currentChapter.value) return
  await chaptersApi.update(currentChapter.value.id, { content: editForm.value.content })
  message.success('正文已保存')
}

async function saveScene() {
  if (!currentChapter.value) return
  await chaptersApi.update(currentChapter.value.id, {
    sceneLocation: editForm.value.sceneLocation,
    sceneMood: editForm.value.sceneMood,
    sceneGoal: editForm.value.sceneGoal
  })
  message.success('场景已保存')
}

async function handleGenerate() {
  if (!currentChapter.value || !route.params.storyId) return
  generating.value = true
  try {
    const res = await chaptersApi.preview(currentChapter.value.id, {
      storyId: route.params.storyId as string
    })
    previewData.value = res.data.data
    showPreviewModal.value = true
    generating.value = false
  } catch (e: any) {
    message.error(e.response?.data?.error || '预览失败')
    generating.value = false
  }
}

async function confirmGenerate() {
  if (!currentChapter.value || !route.params.storyId) return
  generating.value = true
  showPreviewModal.value = false
  try {
    const res = await chaptersApi.generate(currentChapter.value.id, {
      storyId: route.params.storyId as string,
      candidateCount: 3
    })
    drafts.value = res.data.data.drafts || []
    tokenStats.value = res.data.data.tokens || null
    layerStats.value = res.data.data.layers || []
    // 重新加载剧情弧线（generate 后可能有新弧线）
    try {
      const arcRes = await plotArcApi.list(route.params.storyId as string)
      plotArcs.value = arcRes.data.data || []
    } catch {
      // ignore
    }
    generating.value = false
    message.success(`已生成 ${drafts.value.length} 个候选`)
  } catch (e: any) {
    message.error(e.response?.data?.error || e.message || '生成失败，请重试')
    generating.value = false
  }
}

function formatDraftTitle(draft: any): string {
  const version = draft.version || ''
  const params = JSON.parse(draft.params || '{}')
  const temp = params.temperature ?? '?'
  return `${version} (${typeof temp === 'number' ? temp.toFixed(2) : temp})`
}

async function selectDraft(draftId: string) {
  if (!currentChapter.value) return
  const selected = drafts.value.find(d => d.id === draftId)
  generating.value = true
  try {
    const res = await chaptersApi.selectDraft(currentChapter.value.id, draftId)
    const extraction = res.data.data?.extraction
    const draftsRes = await draftsApi.list(currentChapter.value.id)
    drafts.value = draftsRes.data.data
    if (selected?.content) {
      editForm.value.content = selected.content
      await chaptersApi.update(currentChapter.value.id, { content: selected.content })
    }
    if (extraction) {
      message.success(`已采用，并提取了 ${extraction.memories} 条记忆`)
    } else {
      message.success('已采用候选填入正文')
    }
  } catch (e: any) {
    message.error(e.response?.data?.error || '采用失败')
  } finally {
    generating.value = false
  }
}

async function archiveChapter() {
  if (!currentChapter.value) return
  if (!editForm.value.content?.trim()) {
    message.warning('正文为空，无法归档')
    return
  }
  await chaptersApi.archive(currentChapter.value.id)
  message.success('已归档')
  backToList()
  await loadChapters()
}

watch(() => route.params.storyId, () => {
  backToList()
  loadChapters()
})

onMounted(() => {
  if (route.params.storyId) loadChapters()
})
</script>
