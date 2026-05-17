<template>
  <div>
    <n-space justify="space-between" align="center" style="margin-bottom: 16px">
      <n-h1>章节工作台</n-h1>
      <n-button type="primary" @click="showModal = true">新建章节</n-button>
    </n-space>

    <n-data-table :columns="columns" :data="chapters" :loading="loading" />

    <!-- Chapter Detail Drawer -->
    <n-drawer v-model:show="drawerVisible" :width="800" :close-on-esc="true">
      <n-drawer-content :title="currentChapter?.title" closable>
        <n-tabs type="line">
          <n-tab-pane name="outline" tab="大纲">
            <n-input v-model:value="editForm.outline" type="textarea" :rows="10" placeholder="输入章节大纲..." />
            <n-space style="margin-top: 12px">
              <n-button type="primary" @click="saveOutline">保存大纲</n-button>
            </n-space>
          </n-tab-pane>

          <n-tab-pane name="scene" tab="场景">
            <n-form label-placement="left" label-width="100">
              <n-form-item label="地点">
                <n-input v-model:value="editForm.sceneLocation" placeholder="场景地点" />
              </n-form-item>
              <n-form-item label="氛围">
                <n-input v-model:value="editForm.sceneMood" placeholder="氛围，如 tension" />
              </n-form-item>
              <n-form-item label="目标">
                <n-input v-model:value="editForm.sceneGoal" placeholder="场景目标，如 confession" />
              </n-form-item>
            </n-form>
            <n-button type="primary" @click="saveScene">保存场景</n-button>
          </n-tab-pane>

          <n-tab-pane name="drafts" tab="候选">
            <n-space style="margin-bottom: 12px" align="center">
              <n-button type="primary" @click="handleGenerate" :loading="generating">生成候选</n-button>
            </n-space>

            <!-- 剧情弧线 -->
            <n-card v-if="plotArcs.length > 0" size="small" title="剧情弧线" style="margin-bottom: 16px">
              <n-space vertical>
                <n-card v-for="arc in plotArcs" :key="arc.id" size="small" :bordered="false" embedded>
                  <n-space justify="space-between" align="center">
                    <n-text strong>{{ arc.name }}</n-text>
                    <n-space>
                      <n-tag size="tiny" :type="arc.type === 'main' ? 'error' : 'default'">{{ arc.type === 'main' ? '主线' : '支线' }}</n-tag>
                      <n-tag size="tiny" :type="arc.status === 'active' ? 'success' : arc.status === 'completed' ? 'default' : 'warning'">{{ arc.status }}</n-tag>
                    </n-space>
                  </n-space>
                  <n-progress :percentage="arc.progress" :show-indicator="false" :height="6" style="margin: 8px 0" />
                  <n-text depth="3" style="font-size: 12px">当前：{{ arc.currentStage || '未知' }} | 目标：{{ arc.nextGoal || '待定' }}</n-text>
                </n-card>
              </n-space>
            </n-card>

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

            <n-empty v-if="drafts.length === 0" description="暂无候选，点击生成" />
            <n-card v-for="draft in drafts" :key="draft.id" size="small" style="margin-bottom: 12px">
              <template #header>
                <n-space align="center">
                  <span style="font-weight: 600">{{ formatDraftTitle(draft) }}</span>
                  <n-tag :type="draft.status === 'selected' ? 'success' : 'default'" size="small">{{ draft.status }}</n-tag>
                </n-space>
              </template>
              <n-p style="white-space: pre-wrap; line-height: 1.8">{{ expandedDrafts[draft.id] ? draft.content : (draft.content?.slice(0, 300) || '内容为空') + (draft.content?.length > 300 ? '...' : '') }}</n-p>
              <n-space style="margin-top: 8px">
                <n-button v-if="draft.content?.length > 300" size="small" @click="toggleExpand(draft.id)">
                  {{ expandedDrafts[draft.id] ? '收起' : '查看全文' }}
                </n-button>
                <n-button size="small" type="primary" @click="selectDraft(draft.id)">采用并填入正文</n-button>
              </n-space>
            </n-card>
          </n-tab-pane>

          <n-tab-pane name="content" tab="正文">
            <n-input v-model:value="editForm.content" type="textarea" :rows="20" placeholder="章节正文..." />
            <n-space style="margin-top: 12px">
              <n-button type="primary" @click="saveContent">保存正文</n-button>
              <n-button @click="archiveChapter">归档</n-button>
            </n-space>
          </n-tab-pane>
        </n-tabs>
      </n-drawer-content>
    </n-drawer>

    <!-- Prompt Preview Modal -->
    <n-modal v-model:show="showPreviewModal" title="Prompt 预览确认" preset="card" style="width: 720px; max-height: 80vh">
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

        <n-card size="small" title="Prompt 预览（前 2000 字符）" :bordered="false">
          <n-input
            type="textarea"
            :value="previewData?.preview || ''"
            :rows="12"
            readonly
          />
        </n-card>
      </n-space>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showPreviewModal = false">取消</n-button>
          <n-button type="primary" @click="confirmGenerate" :loading="generating">确认生成</n-button>
        </n-space>
      </template>
    </n-modal>

    <n-modal v-model:show="showModal" title="新建章节" preset="card" style="width: 500px">
      <n-form :model="form" label-placement="left" label-width="80">
        <n-form-item label="标题" required>
          <n-input v-model:value="form.title" placeholder="章节标题" />
        </n-form-item>
        <n-form-item label="大纲">
          <n-input v-model:value="form.outline" type="textarea" placeholder="章节大纲" />
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showModal = false">取消</n-button>
          <n-button type="primary" @click="handleCreate">创建</n-button>
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
  NDrawer, NDrawerContent, NTabs, NTabPane, NCard, NP, NTag, NEmpty, NProgress,
  useMessage,
  type DataTableColumns
} from 'naive-ui'
import { chaptersApi, draftsApi } from '../api/chapters'
import { plotArcApi } from '../api/plot-arc'

const route = useRoute()
const chapters = ref<any[]>([])
const loading = ref(false)
const showModal = ref(false)
const drawerVisible = ref(false)
const currentChapter = ref<any>(null)
const drafts = ref<any[]>([])
const message = useMessage()
const generating = ref(false)
const expandedDrafts = ref<Record<string, boolean>>({})
const tokenStats = ref<{ systemTokens: number; userTokens: number; totalTokens: number } | null>(null)
const layerStats = ref<{ name: string; tokens: number; budget: number; truncated: boolean }[]>([])
const plotArcs = ref<any[]>([])
const showPreviewModal = ref(false)
const previewData = ref<any>(null)
const MODEL_MAX_TOKENS = 64000

const form = ref({ title: '', outline: '' })
const editForm = ref({ outline: '', content: '', sceneLocation: '', sceneMood: '', sceneGoal: '' })

const columns: DataTableColumns<any> = [
  { title: '序号', key: 'number', width: 70 },
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
  editForm.value = {
    outline: row.outline || '',
    content: row.content || '',
    sceneLocation: row.sceneLocation || '',
    sceneMood: row.sceneMood || '',
    sceneGoal: row.sceneGoal || ''
  }
  drawerVisible.value = true
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

async function handleCreate() {
  if (!route.params.storyId || !form.value.title) return
  await chaptersApi.create(route.params.storyId as string, form.value)
  showModal.value = false
  form.value = { title: '', outline: '' }
  await loadChapters()
}

async function handleDelete(id: string) {
  await chaptersApi.remove(id)
  await loadChapters()
}

async function saveOutline() {
  if (!currentChapter.value) return
  await chaptersApi.update(currentChapter.value.id, { outline: editForm.value.outline })
}

async function saveContent() {
  if (!currentChapter.value) return
  await chaptersApi.update(currentChapter.value.id, { content: editForm.value.content })
}

async function saveScene() {
  if (!currentChapter.value) return
  await chaptersApi.update(currentChapter.value.id, {
    sceneLocation: editForm.value.sceneLocation,
    sceneMood: editForm.value.sceneMood,
    sceneGoal: editForm.value.sceneGoal
  })
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
    message.error(e.response?.data?.error || e.message || '生成超时，请重试')
    generating.value = false
  }
}

function formatDraftTitle(draft: any): string {
  const version = draft.version || ''
  const params = JSON.parse(draft.params || '{}')
  const temp = params.temperature ?? '?'
  const styleMap: Record<number, string> = {
    0: '偏保守', 1: '偏平衡', 2: '偏创意'
  }
  const idx = version.endsWith('c') ? 2 : version.endsWith('b') ? 1 : 0
  return `${version} (temp=${typeof temp === 'number' ? temp.toFixed(2) : temp} · ${styleMap[idx]})`
}

function toggleExpand(draftId: string) {
  expandedDrafts.value[draftId] = !expandedDrafts.value[draftId]
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
    }
  } catch (e: any) {
    message.error(e.response?.data?.error || '采用失败')
  } finally {
    generating.value = false
  }
}

async function archiveChapter() {
  if (!currentChapter.value) return
  await chaptersApi.archive(currentChapter.value.id)
  drawerVisible.value = false
  await loadChapters()
}

watch(() => route.params.storyId, loadChapters)

onMounted(() => {
  if (route.params.storyId) loadChapters()
})
</script>
