<template>
  <div>
    <!-- ========== 分支树视图 ========== -->
    <div v-if="!editMode">
      <n-space justify="space-between" align="center" style="margin-bottom: 16px">
        <n-h1>章节工作台</n-h1>
        <n-button type="primary" @click="openCreateRoot">新建根章节</n-button>
      </n-space>

      <n-card v-if="loading" size="small">
        <n-skeleton text :repeat="3" />
      </n-card>

      <n-empty v-else-if="chapterTree.length === 0" description="暂无章节，点击新建根章节开始创作" />

      <ChapterBranchTree
        v-else
        :tree-data="chapterTree"
        :selected-id="selectedChapterId"
        @select="onNodeSelect"
        @develop="onDevelop"
        @edit="openEdit"
        @delete="onDelete"
      />
    </div>

    <!-- ========== 编辑子页面 ========== -->
    <div v-else>
      <!-- 顶部导航 -->
      <n-space align="center" style="margin-bottom: 24px">
        <n-button @click="backToTree">
          <template #icon><n-icon><ArrowBackOutline /></n-icon></template>
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

      <!-- Step 1: 配置区 -->
      <n-card title="Step 1：配置区" style="margin-bottom: 24px">
        <!-- 写作人格 -->
        <n-form-item label="写作人格" label-placement="left" label-width="80">
          <n-select
            v-model:value="selectedProfileId"
            :options="profileOptions"
            style="width: 280px"
            placeholder="选择写作人格"
          />
        </n-form-item>

        <n-divider />

        <!-- 剧情弧线 -->
        <n-grid v-if="plotArcs.length > 0" :cols="3" :x-gap="12" :y-gap="12" style="margin-bottom: 16px">
          <n-grid-item v-for="arc in plotArcs" :key="arc.id">
            <n-card size="small" :bordered="false" embedded>
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

        <!-- 大纲 -->
        <n-form label-placement="left" label-width="60">
          <n-form-item label="大纲">
            <n-input v-model:value="editForm.outline" type="textarea" :rows="6" placeholder="输入章节大纲..." />
          </n-form-item>
        </n-form>
        <n-button type="primary" @click="saveOutline" size="small">保存大纲</n-button>

        <n-divider />

        <!-- 场景 -->
        <n-form label-placement="left" label-width="60">
          <n-grid :cols="3" :x-gap="16">
            <n-grid-item>
              <n-form-item label="地点"><n-input v-model:value="editForm.sceneLocation" placeholder="场景地点" /></n-form-item>
            </n-grid-item>
            <n-grid-item>
              <n-form-item label="氛围"><n-input v-model:value="editForm.sceneMood" placeholder="如 tension" /></n-form-item>
            </n-grid-item>
            <n-grid-item>
              <n-form-item label="目标"><n-input v-model:value="editForm.sceneGoal" placeholder="如 confession" /></n-form-item>
            </n-grid-item>
          </n-grid>
        </n-form>
        <n-button type="primary" @click="saveScene" size="small">保存场景</n-button>
      </n-card>

      <!-- Step 2: 生成区 -->
      <n-card title="Step 2：生成区" style="margin-bottom: 24px">
        <!-- 生成 Prompt 预览 -->
        <n-form-item label="生成 Prompt">
          <n-input v-model:value="editablePrompt" type="textarea" :rows="12" placeholder="生成 Prompt..." />
        </n-form-item>
        <n-space>
          <n-button @click="resetPrompt" size="small">重置 Prompt</n-button>
          <n-button type="info" @click="handlePreview" size="small" :loading="previewLoading">预览 Prompt</n-button>
        </n-space>

        <n-divider />

        <!-- 候选生成 -->
        <n-space align="center" style="margin-bottom: 16px">
          <n-button type="primary" @click="handleGenerateDefault" :loading="generating" :disabled="generating">
            {{ generating ? '生成中...' : '生成默认候选 (×3)' }}
          </n-button>
          <n-button @click="showCustomModal = true" :disabled="generating">生成自定义候选 (×1)</n-button>
          <n-text v-if="generating" depth="3">AI 正在创作中，请耐心等待</n-text>
        </n-space>

        <!-- 预算仪表盘 -->
        <n-card v-if="tokenStats" size="small" style="margin-bottom: 16px" :bordered="false">
          <n-space vertical>
            <n-space justify="space-between" align="center">
              <n-text strong>Prompt 预算</n-text>
              <n-space>
                <n-tag size="small" :type="tokenStats.totalTokens > DANGER_THRESHOLD ? 'error' : tokenStats.totalTokens > WARN_THRESHOLD ? 'warning' : 'success'">
                  {{ tokenStats.totalTokens.toLocaleString() }} / {{ MODEL_MAX_TOKENS.toLocaleString() }} tokens
                </n-tag>
                <n-tag v-if="layerStats.some(l => l.truncated)" size="small" type="error">⚠️ 有层被截断</n-tag>
              </n-space>
            </n-space>
            <n-progress
              :percentage="Math.min(100, Math.round((tokenStats.totalTokens / MODEL_MAX_TOKENS) * 100))"
              :status="tokenStats.totalTokens > CRITICAL_THRESHOLD ? 'error' : tokenStats.totalTokens > WARN_THRESHOLD ? 'warning' : 'success'"
              :show-indicator="false"
              :height="12"
            />
          </n-space>
        </n-card>

        <!-- 候选展示 -->
        <n-grid v-if="drafts.length > 0" :cols="3" :x-gap="12" :y-gap="12">
          <n-grid-item v-for="draft in drafts" :key="draft.id">
            <n-card size="small" style="display: flex; flex-direction: column" :bordered="true">
              <template #header>
                <n-space align="center" justify="space-between" style="width: 100%">
                  <n-text strong>{{ draft.version }}</n-text>
                  <n-tag :type="draftStatusType(draft.status)" size="small">{{ draft.status }}</n-tag>
                </n-space>
              </template>

              <!-- 候选内容 Tab -->
              <n-tabs type="segment" size="small" style="flex: 1">
                <n-tab-pane name="content" tab="结果">
                  <n-scrollbar style="max-height: 280px">
                    <n-space v-if="draft.status === 'generating'" vertical align="center" style="padding: 40px 0">
                      <n-spin size="medium" />
                      <n-text depth="3" style="font-size: 12px">AI 正在创作中...</n-text>
                    </n-space>
                    <n-space v-else-if="draft.status === 'failed'" vertical align="center" style="padding: 20px 0">
                      <n-text type="error" style="font-size: 13px">生成失败</n-text>
                      <n-text depth="3" style="font-size: 12px">{{ draft.errorMessage || '未知错误' }}</n-text>
                    </n-space>
                    <n-p v-else style="white-space: pre-wrap; line-height: 1.8; font-size: 13px">{{ draft.content || '暂无内容' }}</n-p>
                  </n-scrollbar>
                </n-tab-pane>
                <n-tab-pane name="prompt" tab="Prompt">
                  <n-scrollbar style="max-height: 280px">
                    <n-p style="white-space: pre-wrap; font-size: 12px; color: #666">{{ formatCompiledPrompt(draft.compiledPrompt) }}</n-p>
                  </n-scrollbar>
                </n-tab-pane>
                <n-tab-pane name="params" tab="参数">
                  <n-space vertical size="small" style="font-size: 12px">
                    <n-text>temperature: {{ draft.temperature }}</n-text>
                    <n-text>maxTokens: {{ draft.maxTokens }}</n-text>
                    <n-text>model: {{ formatParams(draft.params).model }}</n-text>
                    <n-text>耗时: {{ formatParams(draft.params).durationMs }}ms</n-text>
                  </n-space>
                </n-tab-pane>
              </n-tabs>

              <template #footer>
                <n-space>
                  <n-button size="small" type="primary" @click="selectDraft(draft.id)" :disabled="draft.status === 'generating' || !draft.content">采用</n-button>
                  <n-button size="small" @click="scoreDraft(draft.id)" :disabled="!draft.content">评分</n-button>
                  <n-button size="small" @click="deleteDraft(draft.id)">删除</n-button>
                </n-space>
              </template>
            </n-card>
          </n-grid-item>
        </n-grid>
      </n-card>

      <!-- Step 3: 正文与归档 -->
      <n-card title="Step 3：正文与归档" v-if="drafts.length > 0 && drafts.some(d => d.status === 'completed' || d.status === 'selected')">
        <n-input v-model:value="editForm.content" type="textarea" :rows="20" placeholder="章节正文..." style="margin-bottom: 12px" />
        <n-space align="center">
          <n-button type="primary" @click="saveContent">保存正文</n-button>
          <n-button @click="archiveChapter" :disabled="!editForm.content?.trim()">
            归档{{ !editForm.content?.trim() ? '（需先填写正文）' : '' }}
          </n-button>
        </n-space>
      </n-card>

      <!-- Step 4: 本章图谱变化（仅归档后展示） -->
      <n-card v-if="currentChapter?.status === 'archived' && graphDelta" title="本章图谱变化" style="margin-top: 24px">
        <n-space vertical>
          <n-alert :type="graphDelta.addedNodes.length || graphDelta.addedEdges.length ? 'info' : 'default'" :title="graphDelta.summary" />

          <n-collapse v-if="graphDelta.addedNodes.length > 0">
            <n-collapse-item title="新增节点">
              <n-space>
                <n-tag v-for="node in graphDelta.addedNodes" :key="node.key" :type="node.type === 'character' ? 'error' : node.type === 'faction' ? 'warning' : 'default'">
                  {{ node.label }} ({{ node.type }})
                </n-tag>
              </n-space>
            </n-collapse-item>
          </n-collapse>

          <n-collapse v-if="graphDelta.updatedNodes.length > 0">
            <n-collapse-item title="更新节点">
              <n-space vertical size="small">
                <n-card v-for="item in graphDelta.updatedNodes" :key="item.node.key" size="small" :bordered="false" embedded>
                  <n-text strong>{{ item.node.label }} ({{ item.node.type }})</n-text>
                  <n-ul style="margin: 4px 0; padding-left: 16px; font-size: 12px">
                    <n-li v-for="change in item.changes" :key="change">{{ change }}</n-li>
                  </n-ul>
                </n-card>
              </n-space>
            </n-collapse-item>
          </n-collapse>

          <n-collapse v-if="graphDelta.addedEdges.length > 0">
            <n-collapse-item title="新增关系">
              <n-space vertical size="small">
                <n-text v-for="edge in graphDelta.addedEdges" :key="`${edge.fromKey}-${edge.relation}-${edge.toKey}`" style="font-size: 12px">
                  {{ edge.fromLabel || edge.fromKey }} → [{{ edge.relation }}] → {{ edge.toLabel || edge.toKey }}
                </n-text>
              </n-space>
            </n-collapse-item>
          </n-collapse>
        </n-space>
      </n-card>
    </div>

    <!-- ========== 新建根章节弹窗 ========== -->
    <n-modal v-model:show="showCreateModal" title="新建根章节" preset="card" style="width: 500px">
      <n-form :model="createForm" label-placement="left" label-width="80">
        <n-form-item label="标题" required>
          <n-input v-model:value="createForm.title" placeholder="章节标题" />
        </n-form-item>
        <n-form-item>
          <n-checkbox v-model:checked="createForm.isSideStory">番外章节</n-checkbox>
        </n-form-item>
        <n-form-item label="大纲">
          <n-input v-model:value="createForm.outline" type="textarea" placeholder="章节大纲" />
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showCreateModal = false">取消</n-button>
          <n-button type="primary" @click="handleCreateRoot">创建</n-button>
        </n-space>
      </template>
    </n-modal>

    <!-- ========== 发展弹窗 ========== -->
    <n-modal v-model:show="showDevelopModal" title="发展下一章" preset="card" style="width: 500px">
      <n-form :model="developForm" label-placement="left" label-width="80">
        <n-form-item label="标题">
          <n-input v-model:value="developForm.title" placeholder="章节标题" />
        </n-form-item>
        <n-form-item>
          <n-checkbox v-model:checked="developForm.isSideStory">番外 / IF 线</n-checkbox>
        </n-form-item>
        <n-form-item v-if="developForm.isSideStory" label="分支名称">
          <n-input v-model:value="developForm.branchName" placeholder="如：黑化路线" />
        </n-form-item>
        <n-form-item label="大纲">
          <n-input v-model:value="developForm.outline" type="textarea" placeholder="章节大纲" />
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showDevelopModal = false">取消</n-button>
          <n-button type="primary" @click="handleDevelop">创建</n-button>
        </n-space>
      </template>
    </n-modal>

    <!-- ========== 自定义候选弹窗 ========== -->
    <n-modal v-model:show="showCustomModal" title="自定义候选生成" preset="card" style="width: 400px">
      <n-form label-placement="left" label-width="100">
        <n-form-item label="Temperature">
          <n-slider v-model:value="customTemp" :min="0" :max="2" :step="0.05" />
          <n-text>{{ customTemp.toFixed(2) }}</n-text>
        </n-form-item>
        <n-form-item label="Max Tokens">
          <n-input-number v-model:value="customMaxTokens" :min="512" :max="8192" :step="256" />
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showCustomModal = false">取消</n-button>
          <n-button type="primary" @click="handleGenerateCustom" :loading="generating">生成</n-button>
        </n-space>
      </template>
    </n-modal>

    <!-- ========== Prompt Preview Modal ========== -->
    <n-modal v-model:show="showPreviewModal" title="Prompt 预览" preset="card" style="width: 800px; max-height: 80vh">
      <n-space vertical>
        <n-card size="small" :bordered="false">
          <n-space vertical>
            <n-space justify="space-between" align="center">
              <n-text strong>预算概览</n-text>
              <n-space>
                <n-tag size="small" :type="(previewData?.tokens?.totalTokens || 0) > DANGER_THRESHOLD ? 'error' : (previewData?.tokens?.totalTokens || 0) > WARN_THRESHOLD ? 'warning' : 'success'">
                  {{ previewData?.tokens?.totalTokens?.toLocaleString() || 0 }} / {{ MODEL_MAX_TOKENS.toLocaleString() }} tokens
                </n-tag>
              </n-space>
            </n-space>
            <n-progress
              :percentage="Math.min(100, Math.round(((previewData?.tokens?.totalTokens || 0) / MODEL_MAX_TOKENS) * 100))"
              :status="(previewData?.tokens?.totalTokens || 0) > CRITICAL_THRESHOLD ? 'error' : (previewData?.tokens?.totalTokens || 0) > WARN_THRESHOLD ? 'warning' : 'success'"
              :show-indicator="false"
              :height="12"
            />
          </n-space>
        </n-card>
        <n-card size="small" title="Prompt 预览" :bordered="false">
          <n-scrollbar style="max-height: 400px">
            <n-p v-if="previewData?.preview" style="white-space: pre-wrap; font-size: 13px; line-height: 1.8">{{ previewData.preview }}</n-p>
            <n-empty v-else description="Prompt 内容为空" />
          </n-scrollbar>
        </n-card>
      </n-space>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showPreviewModal = false">关闭</n-button>
        </n-space>
      </template>
    </n-modal>

    <!-- ========== 评分结果弹窗 ========== -->
    <n-modal v-model:show="showScoreModal" title="评分结果" preset="card" style="width: 520px">
      <n-space v-if="scoreResult" vertical size="large">
        <n-space justify="center" align="center" vertical style="padding: 8px 0">
          <n-text style="font-size: 48px; font-weight: 700; color: #1890ff">{{ scoreResult.totalScore }}</n-text>
        </n-space>
        <n-divider />
        <n-space vertical size="small">
          <n-space justify="space-between" align="center">
            <n-text>文风接近度</n-text>
            <n-progress :percentage="scoreResult.styleSimilarity" :show-indicator="false" style="width: 200px" />
            <n-text strong>{{ scoreResult.styleSimilarity }}</n-text>
          </n-space>
          <n-space justify="space-between" align="center">
            <n-text>大纲符合度</n-text>
            <n-progress :percentage="scoreResult.outlineAdherence" :show-indicator="false" style="width: 200px" />
            <n-text strong>{{ scoreResult.outlineAdherence }}</n-text>
          </n-space>
          <n-space justify="space-between" align="center">
            <n-text>场景符合度</n-text>
            <n-progress :percentage="scoreResult.sceneMatch" :show-indicator="false" style="width: 200px" />
            <n-text strong>{{ scoreResult.sceneMatch }}</n-text>
          </n-space>
          <n-space justify="space-between" align="center">
            <n-text>写作人格一致性</n-text>
            <n-progress :percentage="scoreResult.profileConsistency" :show-indicator="false" style="width: 200px" />
            <n-text strong>{{ scoreResult.profileConsistency }}</n-text>
          </n-space>
          <n-space justify="space-between" align="center">
            <n-text>文笔质量</n-text>
            <n-progress :percentage="scoreResult.proseQuality" :show-indicator="false" style="width: 200px" />
            <n-text strong>{{ scoreResult.proseQuality }}</n-text>
          </n-space>
          <n-space justify="space-between" align="center">
            <n-text>情感张力</n-text>
            <n-progress :percentage="scoreResult.emotionalTension" :show-indicator="false" style="width: 200px" />
            <n-text strong>{{ scoreResult.emotionalTension }}</n-text>
          </n-space>
          <n-space justify="space-between" align="center">
            <n-text>节奏把控</n-text>
            <n-progress :percentage="scoreResult.pacing" :show-indicator="false" style="width: 200px" />
            <n-text strong>{{ scoreResult.pacing }}</n-text>
          </n-space>
        </n-space>
        <n-divider />
        <n-card v-if="scoreResult.comment" size="small" :bordered="false">
          <n-text depth="3" style="font-size: 13px">{{ scoreResult.comment }}</n-text>
        </n-card>
      </n-space>
      <n-empty v-else description="暂无评分数据" />
      <template #footer>
        <n-space justify="end">
          <n-button @click="showScoreModal = false">关闭</n-button>
        </n-space>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch, computed } from 'vue'
import { useRoute } from 'vue-router'
import {
  NH1, NSpace, NButton, NModal, NForm, NFormItem, NInput, NCard, NP, NTag, NEmpty,
  NGrid, NGridItem, NProgress, NText, NDivider, NIcon, NSelect, NSlider, NInputNumber,
  NSkeleton, NTabs, NTabPane, NScrollbar, NSpin, NAlert, NCollapse, NCollapseItem,
  NUl, NLi, NCheckbox,
  useMessage
} from 'naive-ui'
import { ArrowBackOutline } from '@vicons/ionicons5'
import { chaptersApi, draftsApi } from '../api/chapters'
import { plotArcApi } from '../api/plot-arc'
import { aiProviderApi } from '../api/ai-provider'
import { runtimeApi as runtimeProfileApi } from '../api/runtime'
import ChapterBranchTree from '../components/ChapterBranchTree.vue'

const route = useRoute()
const message = useMessage()

// ========== 分支树状态 ==========
const chapterTree = ref<any[]>([])
const loading = ref(false)
const editMode = ref(false)
const selectedChapterId = ref('')
const currentChapter = ref<any>(null)

// ========== 编辑状态 ==========
const editTitle = ref('')
const selectedProfileId = ref<string | null>(null)
const profileOptions = ref<any[]>([])
const editForm = ref({ outline: '', content: '', sceneLocation: '', sceneMood: '', sceneGoal: '' })
const editablePrompt = ref('')
const defaultPrompt = ref('')

// ========== 生成状态 ==========
const generating = ref(false)
const drafts = ref<any[]>([])
const tokenStats = ref<any>(null)
const layerStats = ref<any[]>([])
const previewData = ref<any>(null)
const showPreviewModal = ref(false)
const previewLoading = ref(false)
const showScoreModal = ref(false)
const scoreResult = ref<any>(null)
const showCustomModal = ref(false)
const customTemp = ref(0.75)
const customMaxTokens = ref(4096)
const plotArcs = ref<any[]>([])
const pollInterval = ref<any>(null)
const graphDelta = ref<any>(null)

// ========== 弹窗状态 ==========
const showCreateModal = ref(false)
const showDevelopModal = ref(false)
const createForm = ref({ title: '', outline: '', isSideStory: false })
const developForm = ref({ title: '', outline: '', isSideStory: false, branchName: '' })
const developParentId = ref('')

// ========== 模型配置 ==========
const defaultModel = ref<any>(null)
const MODEL_MAX_TOKENS = computed(() => defaultModel.value?.contextLength || 64000)
const WARN_THRESHOLD = computed(() => Math.floor(MODEL_MAX_TOKENS.value * 0.625))
const DANGER_THRESHOLD = computed(() => Math.floor(MODEL_MAX_TOKENS.value * 0.78))
const CRITICAL_THRESHOLD = computed(() => Math.floor(MODEL_MAX_TOKENS.value * 0.86))

// ========== 生命周期 ==========
onMounted(() => {
  loadDefaultModel()
  loadProfiles()
  if (route.params.storyId) loadChapterTree()
})

watch(() => route.params.storyId, () => {
  backToTree()
  loadChapterTree()
})

// ========== 加载数据 ==========
async function loadDefaultModel() {
  try { defaultModel.value = (await aiProviderApi.getDefault()).data.data } catch { /* ignore */ }
}

async function loadProfiles() {
  try {
    const res = await runtimeProfileApi.list()
    profileOptions.value = (res.data.data || []).map((p: any) => ({
      label: p.name + (p.isDefault ? ' (默认)' : ''),
      value: p.id
    }))
  } catch { /* ignore */ }
}

async function loadChapterTree() {
  if (!route.params.storyId) { chapterTree.value = []; return }
  loading.value = true
  try {
    const res = await chaptersApi.getTree(route.params.storyId as string)
    chapterTree.value = res.data.data || []
  } catch (e: any) {
    message.error(e.response?.data?.error || '加载失败')
  } finally {
    loading.value = false
  }
}

// ========== 分支树操作 ==========
function onNodeSelect(node: any) {
  selectedChapterId.value = node.id
}

function onDevelop(node: any) {
  developParentId.value = node.id
  developForm.value = { title: '', outline: '', isSideStory: false, branchName: '' }
  showDevelopModal.value = true
}

async function handleDevelop() {
  if (!developParentId.value) return
  try {
    const res = await chaptersApi.develop(developParentId.value, {
      title: developForm.value.title,
      outline: developForm.value.outline,
      isSideStory: developForm.value.isSideStory,
      branchName: developForm.value.branchName || (developForm.value.isSideStory ? '番外' : undefined)
    })
    showDevelopModal.value = false
    message.success('新章节已创建')
    await loadChapterTree()
    // 自动进入编辑
    if (res.data.data) openEdit(res.data.data)
  } catch (e: any) {
    message.error(e.response?.data?.error || '创建失败')
  }
}

async function onDelete(node: any) {
  try {
    await chaptersApi.remove(node.id)
    message.success('已删除')
    await loadChapterTree()
  } catch (e: any) {
    message.error(e.response?.data?.error || '删除失败')
  }
}

function openCreateRoot() {
  createForm.value = { title: '', outline: '', isSideStory: false }
  showCreateModal.value = true
}

async function handleCreateRoot() {
  if (!route.params.storyId || !createForm.value.title) return
  try {
    const res = await chaptersApi.create(route.params.storyId as string, createForm.value)
    showCreateModal.value = false
    message.success('章节已创建')
    await loadChapterTree()
    if (res.data.data) openEdit(res.data.data)
  } catch (e: any) {
    message.error(e.response?.data?.error || '创建失败')
  }
}

// ========== 编辑子页面 ==========
async function openEdit(row: any) {
  currentChapter.value = row
  selectedChapterId.value = row.id
  editTitle.value = row.title || ''
  selectedProfileId.value = row.runtimeProfileId || null
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
    drafts.value = res.data.data || []
    // 如果有 generating 状态的 draft，启动轮询
    if (drafts.value.some((d: any) => d.status === 'generating')) {
      startPollingDrafts(row.id)
    }
  }
  // 加载剧情弧线
  if (route.params.storyId) {
    try { plotArcs.value = (await plotArcApi.list(route.params.storyId as string)).data.data || [] } catch { plotArcs.value = [] }
  }
  // 加载 Prompt（如果有）
  let promptText = row.compiledPrompt ? formatCompiledPrompt(row.compiledPrompt) : ''
  // 如果 chapter 没有 compiledPrompt，尝试从最新的 completed draft 获取
  if (!promptText && drafts.value.length > 0) {
    const latestDraft = drafts.value.find((d: any) => d.compiledPrompt)
    if (latestDraft) promptText = formatCompiledPrompt(latestDraft.compiledPrompt)
  }
  editablePrompt.value = promptText
  defaultPrompt.value = promptText

  // 加载图谱变化（如果是已归档章节）
  graphDelta.value = null
  if (row.status === 'archived' && row.graphDelta) {
    try { graphDelta.value = JSON.parse(row.graphDelta) } catch { graphDelta.value = null }
  }
}

async function backToTree() {
  stopPollingDrafts()
  editMode.value = false
  currentChapter.value = null
  selectedChapterId.value = ''
  drafts.value = []
  plotArcs.value = []
  tokenStats.value = null
  layerStats.value = []
  graphDelta.value = null
  // 刷新章节树，确保下次进入编辑时拿到最新数据
  await loadChapterTree()
}

function formatCompiledPrompt(cp: string | null): string {
  if (!cp) return ''
  try {
    const obj = JSON.parse(cp)
    return `[System]\n${obj.systemMessage || ''}\n\n[User]\n${obj.userMessage || ''}`
  } catch { return cp }
}

function formatParams(p: string): any {
  try { return JSON.parse(p || '{}') } catch { return {} }
}

// ========== 保存操作 ==========
async function saveTitle() {
  if (!currentChapter.value) return
  if (editTitle.value !== currentChapter.value.title) {
    await chaptersApi.update(currentChapter.value.id, { title: editTitle.value })
    currentChapter.value.title = editTitle.value
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
  currentChapter.value.content = editForm.value.content
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

function resetPrompt() {
  editablePrompt.value = defaultPrompt.value
}

// ========== 生成候选 ==========
async function handleGenerateDefault() {
  if (!currentChapter.value || !route.params.storyId) return
  await doGenerate([0.6, 0.75, 0.9])
}

async function handleGenerateCustom() {
  if (!currentChapter.value || !route.params.storyId) return
  showCustomModal.value = false
  await doGenerate([customTemp.value], customMaxTokens.value)
}

async function doGenerate(temperatures: number[], maxTokens?: number) {
  generating.value = true
  try {
    const res = await chaptersApi.generate(currentChapter.value.id, {
      storyId: route.params.storyId as string,
      candidateCount: temperatures.length,
      temperatures,
      maxTokens,
      runtimeProfileId: selectedProfileId.value
    })
    drafts.value = res.data.data.drafts || []
    tokenStats.value = res.data.data.tokens || null
    layerStats.value = res.data.data.layers || []
    message.success(`已提交 ${drafts.value.length} 个候选生成任务`)
    // 启动轮询
    startPollingDrafts(currentChapter.value.id)
  } catch (e: any) {
    message.error(e.response?.data?.error || e.message || '生成失败')
  } finally {
    generating.value = false
  }
}

function startPollingDrafts(chapterId: string) {
  stopPollingDrafts()
  pollInterval.value = setInterval(async () => {
    try {
      const res = await draftsApi.list(chapterId)
      const newDrafts = res.data.data || []
      drafts.value = newDrafts
      // 检查是否全部完成
      const allDone = newDrafts.every((d: any) => d.status === 'completed' || d.status === 'failed')
      if (allDone) {
        stopPollingDrafts()
        const completed = newDrafts.filter((d: any) => d.status === 'completed').length
        const failed = newDrafts.filter((d: any) => d.status === 'failed').length
        if (completed > 0) message.success(`${completed} 个候选生成完成`)
        if (failed > 0) message.warning(`${failed} 个候选生成失败`)
      }
    } catch {
      // 轮询出错不中断
    }
  }, 2000)
}

function stopPollingDrafts() {
  if (pollInterval.value) {
    clearInterval(pollInterval.value)
    pollInterval.value = null
  }
}

async function handlePreview() {
  if (!currentChapter.value || !route.params.storyId) return
  previewLoading.value = true
  try {
    const res = await chaptersApi.preview(currentChapter.value.id, {
      storyId: route.params.storyId as string,
      runtimeProfileId: selectedProfileId.value
    })
    previewData.value = res.data.data
    showPreviewModal.value = true
  } catch (e: any) {
    message.error(e.response?.data?.error || '预览失败')
  } finally {
    previewLoading.value = false
  }
}

// ========== 候选操作 ==========
async function selectDraft(draftId: string) {
  if (!currentChapter.value) return
  try {
    await chaptersApi.selectDraft(currentChapter.value.id, draftId)
    const draft = drafts.value.find(d => d.id === draftId)
    if (draft?.content) editForm.value.content = draft.content
    // 刷新 drafts 列表以更新状态
    const res = await draftsApi.list(currentChapter.value.id)
    drafts.value = res.data.data || []
    message.success('已采用')
  } catch (e: any) {
    message.error(e.response?.data?.error || '采用失败')
  }
}

async function scoreDraft(draftId: string) {
  try {
    const res = await draftsApi.score(draftId)
    scoreResult.value = res.data.data?.score || null
    showScoreModal.value = true
    message.success('评分完成')
  } catch (e: any) {
    message.error(e.response?.data?.error || '评分失败')
  }
}

async function deleteDraft(draftId: string) {
  try {
    await draftsApi.remove(draftId)
    drafts.value = drafts.value.filter(d => d.id !== draftId)
    message.success('已删除')
  } catch (e: any) {
    message.error('删除失败')
  }
}

async function archiveChapter() {
  if (!currentChapter.value) return
  if (!editForm.value.content?.trim()) {
    message.warning('正文为空，无法归档')
    return
  }
  // 先保存正文
  await chaptersApi.update(currentChapter.value.id, { content: editForm.value.content })
  await chaptersApi.archive(currentChapter.value.id)
  message.success('已归档')
  backToTree()
  await loadChapterTree()
}

// ========== 辅助函数 ==========
function statusTagType(status?: string) {
  switch (status) {
    case 'archived': return 'success'
    case 'selected': return 'info'
    case 'generated': return 'warning'
    case 'generating': return 'warning'
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

function draftStatusType(status?: string) {
  switch (status) {
    case 'completed': return 'success'
    case 'candidate': return 'success'
    case 'selected': return 'info'
    case 'generating': return 'warning'
    case 'failed': return 'error'
    case 'rejected': return 'default'
    default: return 'default'
  }
}
</script>
