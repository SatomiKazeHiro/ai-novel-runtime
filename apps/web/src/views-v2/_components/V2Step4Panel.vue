<template>
  <div class="cap-card">
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px">
      <h2 class="cap-eyebrow" style="margin: 0">4. AI 分析</h2>
      <n-space>
        <n-button
          v-if="chapter.status === 'analyzing'"
          size="small"
          type="warning"
          @click="onRevert"
          :loading="reverting"
        >撤销分析</n-button>
        <n-button
          v-if="chapter.status === 'draft'"
          size="small"
          type="primary"
          @click="emit('run-analyze')"
          :loading="analyzeRunning"
          :disabled="analyzeRunning || !chapter.content"
        >分析</n-button>
        <n-button
          v-if="chapter.status === 'analyzing'"
          size="small"
          type="primary"
          @click="emit('run-analyze')"
          :loading="analyzeRunning"
          :disabled="analyzeRunning"
        >重新分析</n-button>
      </n-space>
    </div>

    <p v-if="chapter.status === 'draft' && !analyzeRunning" class="cap-body-sm" style="color: var(--text-tertiary); margin-bottom: 12px">
      点击"分析"将并行调用 AI 提取角色、记忆、剧情弧线、时间线、图谱信息。
    </p>

    <div v-if="chapter.analysisId" class="analysis-status" style="margin-bottom: 12px; font-size: 12px; color: var(--text-tertiary)">
      分析版本：
      <span :style="{ color: chapter.analysisId === chapter.contentHash ? 'var(--color-positive)' : 'var(--color-negative)' }">
        {{ chapter.analysisId.substring(0, 8) + '...' }}
      </span>
      <span v-if="chapter.analysisId !== chapter.contentHash" style="color: var(--color-negative); margin-left: 8px">正文已修改，分析可能过时</span>
    </div>

    <n-tabs v-if="analysis" v-model:value="analysisActiveTab" type="segment" animated>
      <n-tab-pane v-for="item in analyzerItems" :key="item.key" :name="item.key">
        <template #tab>
          <span style="display: flex; align-items: center; gap: 4px; font-size: 12px">
            {{ item.label }}
            <span v-if="item.status === 'loading'" class="analyzer-item__tag is-loading">分析中...</span>
            <span v-else-if="item.status === 'success'" class="analyzer-item__tag is-success">已完成</span>
            <span v-else-if="item.status === 'failed'" class="analyzer-item__tag is-failed">失败</span>
          </span>
        </template>
        <div class="analyzer-tab-content">
          <template v-if="item.status === 'failed'">
            <div class="analyzer-item__error">{{ item.error }}</div>
          </template>
          <template v-else-if="item.status === 'success' && editableAnalysis">
            <!-- 角色 -->
            <template v-if="item.key === 'characters'">
              <div v-if="!getAnalyzerData('characters')?.items?.length" class="analyzer-idle">未提取到角色</div>
              <div v-else class="char-list">
                <div v-for="(c, ci) in getAnalyzerData('characters').items" :key="ci" class="char-row">
                  <div class="char-row__head">
                    <strong>{{ c.name }}</strong>
                    <span class="char-row__slug">{{ c.slug }}</span>
                    <n-tag v-if="c.isNew" type="warning" size="tiny" :bordered="false">新角色</n-tag>
                    <n-tag v-else type="info" size="tiny" :bordered="false">匹配: {{ c.matchedCharacterId?.substring(0, 8) }}</n-tag>
                    <n-popconfirm @positive-click="getAnalyzerData('characters').items.splice(ci, 1)">
                      <template #trigger>
                        <n-button size="tiny" type="error">删除</n-button>
                      </template>
                      确定删除该角色「{{ c.name }}」吗？该章节将不再记录此角色。
                    </n-popconfirm>
                  </div>
                  <div class="char-row__field"><span class="tag-label">身份</span><n-dynamic-tags v-model:value="c.identity" /></div>
                  <div class="char-row__field"><span class="tag-label">外貌</span><n-dynamic-tags v-model:value="c.appearance" /></div>
                  <div class="char-row__field"><span class="tag-label">气质</span><n-dynamic-tags v-model:value="c.temperament" /></div>
                  <div class="char-row__field"><span class="tag-label">性格</span><n-dynamic-tags v-model:value="c.personality" /></div>
                  <div class="char-row__field"><span class="tag-label">说话</span><n-dynamic-tags v-model:value="c.speechStyle" /></div>
                  <div class="char-row__field">
                    <span class="tag-label">关系变化</span>
                    <n-input v-model:value="c.relationshipsText" type="textarea" :rows="2" size="small" placeholder='{"张三": "因某事变为敌人"}' style="font-family: monospace; font-size: 12px" />
                  </div>
                  <div class="char-row__field">
                    <span class="tag-label">状态变化</span>
                    <n-input v-model:value="c.statusText" type="textarea" :rows="2" size="small" placeholder='{"修为": "突破到金丹期"}' style="font-family: monospace; font-size: 12px" />
                  </div>
                </div>
              </div>
            </template>

            <!-- 记忆 -->
            <template v-else-if="item.key === 'memories'">
              <div class="mem-section">
                <h4 class="mem-section__title">章节记忆 <span class="mem-count">{{ getAnalyzerData('memories')?.chapterMemories?.length || 0 }}</span></h4>
                <div v-if="!getAnalyzerData('memories')?.chapterMemories?.length" class="analyzer-idle">无</div>
                <div v-for="(m, mi) in getAnalyzerData('memories').chapterMemories" :key="'c'+mi" class="mem-row">
                  <div class="mem-row__head">
                    <n-select v-model:value="m.category" :options="memCatOptions" size="tiny" style="width: 100px" />
                    <n-input-number v-model:value="m.importance" :min="0" :max="10" size="tiny" style="width: 80px" />
                    <span class="mem-row__imp-label">重要度</span>
                    <n-popconfirm @positive-click="getAnalyzerData('memories').chapterMemories.splice(mi, 1)">
                      <template #trigger>
                        <n-button size="tiny" type="error">删除</n-button>
                      </template>
                      确定删除该章节记忆「{{ (m.content || '').slice(0, 30) || '(空)' }}」吗？
                    </n-popconfirm>
                  </div>
                  <n-input v-model:value="m.content" type="textarea" :rows="2" size="small" style="font-size: 13px; line-height: 1.6" />
                  <n-input v-model:value="m.participants" size="small" placeholder="参与者（逗号分隔）" style="margin-top: 4px" />
                </div>
                <n-button size="tiny" dashed @click="getAnalyzerData('memories').chapterMemories.push({ type:'chapter', category:'event_memory', content:'', importance:4, participants:'' })">+ 添加章节记忆</n-button>
              </div>
              <div class="mem-section">
                <h4 class="mem-section__title">全局记忆 <span class="mem-count">{{ getAnalyzerData('memories')?.globalMemories?.length || 0 }}</span></h4>
                <div v-if="!getAnalyzerData('memories')?.globalMemories?.length" class="analyzer-idle">无</div>
                <div v-for="(m, mi) in getAnalyzerData('memories').globalMemories" :key="'g'+mi" class="mem-row">
                  <div class="mem-row__head">
                    <n-select v-model:value="m.category" :options="memCatOptions" size="tiny" style="width: 100px" />
                    <n-input-number v-model:value="m.importance" :min="0" :max="10" size="tiny" style="width: 80px" />
                    <span class="mem-row__imp-label">重要度</span>
                    <n-popconfirm @positive-click="getAnalyzerData('memories').globalMemories.splice(mi, 1)">
                      <template #trigger>
                        <n-button size="tiny" type="error">删除</n-button>
                      </template>
                      确定删除该全局记忆「{{ (m.content || '').slice(0, 30) || '(空)' }}」吗？
                    </n-popconfirm>
                  </div>
                  <n-input v-model:value="m.content" type="textarea" :rows="2" size="small" style="font-size: 13px; line-height: 1.6" />
                  <n-input v-model:value="m.participants" size="small" placeholder="参与者（逗号分隔）" style="margin-top: 4px" />
                </div>
                <n-button size="tiny" dashed @click="getAnalyzerData('memories').globalMemories.push({ type:'global', category:'event_memory', content:'', importance:4, participants:'' })">+ 添加全局记忆</n-button>
              </div>
              <div class="mem-section">
                <h4 class="mem-section__title">场景记忆 <span class="mem-count">{{ getAnalyzerData('memories')?.sceneMemories?.length || 0 }}</span></h4>
                <div v-if="!getAnalyzerData('memories')?.sceneMemories?.length" class="analyzer-idle">无</div>
                <div v-for="(m, mi) in getAnalyzerData('memories').sceneMemories" :key="'s'+mi" class="mem-row">
                  <div class="mem-row__head">
                    <n-input-number v-model:value="m.importance" :min="0" :max="10" size="tiny" style="width: 80px" />
                    <span class="mem-row__imp-label">重要度</span>
                    <n-popconfirm @positive-click="getAnalyzerData('memories').sceneMemories.splice(mi, 1)">
                      <template #trigger>
                        <n-button size="tiny" type="error">删除</n-button>
                      </template>
                      确定删除该场景记忆「{{ (m.content || '').slice(0, 30) || '(空)' }}」吗？
                    </n-popconfirm>
                  </div>
                  <n-input v-model:value="m.content" type="textarea" :rows="2" size="small" style="font-size: 13px; line-height: 1.6" />
                  <n-input v-model:value="m.participants" size="small" placeholder="参与者（逗号分隔）" style="margin-top: 4px" />
                </div>
                <n-button size="tiny" dashed @click="getAnalyzerData('memories').sceneMemories.push({ type:'scene', category:'event_memory', content:'', importance:4, participants:'' })">+ 添加场景记忆</n-button>
              </div>
            </template>

            <!-- 剧情弧线 -->
            <template v-else-if="item.key === 'plotArcs'">
              <div v-if="!getAnalyzerData('plotArcs')?.arcs?.length" class="analyzer-idle">未提取到剧情弧线变化</div>
              <div v-for="(a, ai) in getAnalyzerData('plotArcs').arcs" :key="ai" class="arc-row">
                <div class="arc-row__head">
                  <n-select v-model:value="a.action" :options="arcActionOptions" size="tiny" style="width: 80px" />
                  <n-input v-model:value="a.title" size="small" style="flex:1; font-weight: 500" />
                  <n-checkbox v-model:checked="a.isMainline" size="small">主线</n-checkbox>
                  <n-select v-model:value="a.status" :options="arcStatusOptions" size="tiny" style="width: 90px" />
                  <n-popconfirm @positive-click="getAnalyzerData('plotArcs').arcs.splice(ai, 1)">
                    <template #trigger>
                      <n-button size="tiny" type="error">删除</n-button>
                    </template>
                    确定删除该弧线「{{ a.title || '(未命名)' }}」吗？
                  </n-popconfirm>
                </div>
                <n-input v-model:value="a.description" type="textarea" :rows="2" size="small" placeholder="描述..." style="font-size: 13px; margin-top: 4px" />
                <n-input v-if="a.action === 'close'" v-model:value="a.mergeInfo" size="small" placeholder="合并到哪条弧线..." style="margin-top: 4px" />
              </div>
              <n-button size="tiny" dashed @click="getAnalyzerData('plotArcs').arcs.push({ action:'create', title:'', description:'', status:'active', isMainline:false })">+ 添加弧线</n-button>
            </template>

            <!-- 时间线 -->
            <template v-else-if="item.key === 'timeline'">
              <div v-if="!getAnalyzerData('timeline')?.events?.length" class="analyzer-idle">未提取到时间线事件</div>
              <div v-else class="time-list">
                <div class="time-summary" style="font-size: 12px; color: var(--text-tertiary); margin-bottom: 8px">
                  时间轴：{{ getAnalyzerData('timeline').defaultAnchorName || '主线' }} · {{ getAnalyzerData('timeline').events.length }} 个事件
                </div>
                <div v-for="(ev, ei) in getAnalyzerData('timeline').events" :key="ei" class="time-row">
                  <div class="time-row__order">{{ String(ev.narrativeOrder || ei + 1).padStart(2, '0') }}</div>
                  <div class="time-row__body">
                    <div class="time-row__head">
                      <n-input v-model:value="ev.title" size="small" style="font-weight: 500" />
                      <n-tag :type="ev.importance === 'major' ? 'error' : ev.importance === 'minor' ? 'default' : 'info'" size="tiny" :bordered="false">{{ ev.importance === 'major' ? '重要' : ev.importance === 'minor' ? '次要' : '常规' }}</n-tag>
                      <n-popconfirm @positive-click="getAnalyzerData('timeline').events.splice(ei, 1)">
                        <template #trigger>
                          <n-button size="tiny" type="error">删除</n-button>
                        </template>
                        确定删除该时间线事件「{{ ev.title || '(未命名)' }}」吗？
                      </n-popconfirm>
                    </div>
                    <n-input v-model:value="ev.summary" type="textarea" :rows="2" size="small" style="font-size: 13px; margin-top: 4px" placeholder="事件摘要..." />
                    <div class="time-row__meta">
                      <n-input v-model:value="ev.participants" size="tiny" placeholder="参与者（逗号分隔）" style="flex: 1" />
                      <n-input v-model:value="ev.location" size="tiny" placeholder="地点" style="flex: 1" />
                    </div>
                    <div v-if="ev.timeExpression" class="time-row__time">
                      <span class="tag-label">时间</span><n-tag size="tiny" :bordered="false">{{ ev.timeExpression.type }}</n-tag>
                      <span v-if="ev.timeExpression.raw" style="font-size: 12px; color: var(--text-secondary)">{{ ev.timeExpression.raw }}</span>
                      <span class="tag-label" style="margin-left: 8px">置信度</span>
                      <n-tag :type="ev.timeExpression.confidence === 'high' ? 'success' : ev.timeExpression.confidence === 'low' ? 'warning' : 'default'" size="tiny" :bordered="false">{{ ev.timeExpression.confidence }}</n-tag>
                    </div>
                  </div>
                </div>
                <n-button size="tiny" dashed @click="getAnalyzerData('timeline').events.push({ title:'', summary:'', participants:'', location:'', importance:'normal', timeExpression:{ raw:'', type:'none', confidence:'medium' }, narrativeOrder: getAnalyzerData('timeline').events.length + 1 })">+ 添加事件</n-button>
              </div>
            </template>

            <!-- 图谱 -->
            <template v-else>
              <div v-if="!getAnalyzerData('graph')?.chapterGraph?.nodes?.length && !getAnalyzerData('graph')?.mergedGraph?.nodes?.length" class="analyzer-idle">未提取到图谱数据</div>
              <template v-else>
                <!-- 本章图谱迷你画布 -->
                <div class="graph-mini-header">
                  <span>本章图谱</span>
                  <span class="mem-count">{{ (getAnalyzerData('graph')?.chapterGraph?.nodes || []).length }} 节点 / {{ (getAnalyzerData('graph')?.chapterGraph?.edges || []).length }} 边</span>
                </div>
                <div ref="analysisCyContainer" class="graph-mini-canvas" />
                <!-- 图例 -->
                <div class="graph-mini-types">
                  <span v-for="(cnt, type) in chapterTypeStats" :key="type" class="graph-type-chip">
                    <span class="graph-type-dot" :style="{ background: GRAPH_NODE_COLORS_V2[type] || GRAPH_NODE_COLORS_V2.other }"></span>
                    {{ GRAPH_NODE_LABELS[type] || type }}: {{ cnt }}
                  </span>
                </div>
                <!-- 可折叠编辑区 -->
                <div style="margin-top: 8px">
                  <n-button size="tiny" quaternary @click="showGraphEditor = !showGraphEditor">{{ showGraphEditor ? '收起编辑' : '展开编辑' }}</n-button>
                </div>
                <template v-if="showGraphEditor">
                  <div class="graph-section">
                    <div class="graph-sub-title">节点</div>
                    <div v-for="(n, ni) in getAnalyzerData('graph').chapterGraph.nodes" :key="'gn'+ni" class="graph-node-row">
                      <n-select v-model:value="n.type" :options="graphTypeOptions" size="tiny" style="width: 80px" />
                      <n-input v-model:value="n.key" size="tiny" style="width: 100px" placeholder="key" />
                      <n-input v-model:value="n.label" size="tiny" style="width: 100px" placeholder="名称" />
                      <n-input-number v-model:value="n.importance" :min="1" :max="10" size="tiny" style="width: 65px" />
                      <n-popconfirm @positive-click="getAnalyzerData('graph').chapterGraph.nodes.splice(ni, 1); refreshAnalysisGraph()">
                        <template #trigger>
                          <n-button size="tiny" type="error">删除</n-button>
                        </template>
                        确定删除该图谱节点「{{ n.label || n.key || '(未命名)' }}」吗？
                      </n-popconfirm>
                    </div>
                    <div class="graph-sub-title" style="margin-top: 6px">边</div>
                    <div v-for="(e, ei) in getAnalyzerData('graph').chapterGraph.edges" :key="'ge'+ei" class="graph-edge-row">
                      <n-input v-model:value="e.fromKey" size="tiny" style="width: 100px" placeholder="fromKey" />
                      <span class="graph-edge-arrow">→</span>
                      <n-input v-model:value="e.relation" size="tiny" style="width: 70px" placeholder="关系" />
                      <span class="graph-edge-arrow">→</span>
                      <n-input v-model:value="e.toKey" size="tiny" style="width: 100px" placeholder="toKey" />
                      <n-popconfirm @positive-click="getAnalyzerData('graph').chapterGraph.edges.splice(ei, 1); refreshAnalysisGraph()">
                        <template #trigger>
                          <n-button size="tiny" type="error">删除</n-button>
                        </template>
                        确定删除该图谱边「{{ e.fromKey || '?' }} → {{ e.toKey || '?' }} ({{ e.relation || '?' }})」吗？
                      </n-popconfirm>
                    </div>
                    <div style="margin-top: 6px; display: flex; gap: 6px">
                      <n-button size="tiny" dashed @click="getAnalyzerData('graph').chapterGraph.nodes.push({ type:'character', key:'', label:'', importance:5 }); refreshAnalysisGraph()">+ 节点</n-button>
                      <n-button size="tiny" dashed @click="getAnalyzerData('graph').chapterGraph.edges.push({ fromKey:'', toKey:'', relation:'关联' }); refreshAnalysisGraph()">+ 边</n-button>
                    </div>
                  </div>
                </template>
                <!-- 总图谱摘要 -->
                <div class="graph-section" style="margin-top: 10px">
                  <h4 class="mem-section__title">总图谱 <span class="mem-count">{{ (getAnalyzerData('graph')?.mergedGraph?.nodes || []).length }} 节点 / {{ (getAnalyzerData('graph')?.mergedGraph?.edges || []).length }} 边</span></h4>
                  <div class="graph-merged-types">
                    <span v-for="(cnt, type) in mergedTypeStats" :key="type" class="graph-type-chip">
                      <span class="graph-type-dot" :style="{ background: GRAPH_NODE_COLORS_V2[type] || GRAPH_NODE_COLORS_V2.other }"></span>
                      {{ GRAPH_NODE_LABELS[type] || type }}: {{ cnt }}
                    </span>
                  </div>
                </div>
              </template>
            </template>

            <div style="margin-top: 12px; display: flex; gap: 8px; align-items: center" v-if="chapter.status !== 'archived'">
              <n-button size="tiny" @click="saveEdits" :loading="savingEdits">保存调整</n-button>
              <n-button size="tiny" quaternary @click="emit('regenerate-single', item.key)" :loading="regenerating === item.key" :disabled="analyzeRunning">重新生成</n-button>
            </div>
          </template>
        </div>
      </n-tab-pane>
    </n-tabs>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onUnmounted, toRef } from 'vue'
import { NButton, NInput, NTag, NSpace, NCheckbox, NSelect, NInputNumber, NTabs, NTabPane, NDynamicTags, NPopconfirm } from 'naive-ui'
import { GRAPH_NODE_COLORS_V2, GRAPH_NODE_LABELS } from '../../api-v2/graph'
import { useCytoscapeLifecycle, type GraphData as CyGraphData } from '../../composables/graph/useCytoscapeLifecycle'

const props = defineProps<{
  /** 来自父级的 chapter 对象（reactive proxy，响应式同步） */
  chapter: any
  /** 当前 analysis ref，父级在 runAnalyze / revertAnalysis 后修改 */
  analysis: any
  /** 当前 analyze 操作状态（父级控制） */
  analyzeRunning: boolean
  /** 当前 regenerate 单路状态（父级控制） */
  regenerating: string | null
  /** revert 操作状态（父级控制） */
  reverting: boolean
  /** archive 错误集合（父级 run preArchive 后填） */
  archiveErrors: Record<string, string> | null
  /** 父级 showToast 函数 */
  showToast: (msg: string, type?: 'success' | 'error' | 'warning') => void
}>()

const emit = defineEmits<{
  'run-analyze': []
  'regenerate-single': [string]
  'revert': []
  'save-edits': [any]
}>()

// ── 分析 state ──
const editableAnalysis = ref<any>(null)
const savingEdits = ref(false)
const showGraphEditor = ref(false)
const analysisActiveTab = ref<string>('characters')
const analysisCyContainer = ref<HTMLDivElement>()
const newCharacters = ref<any[]>([])  // archive 准备阶段用

const graphTypeOptions = [
  { label: '角色', value: 'character' }, { label: '势力', value: 'faction' },
  { label: '事件', value: 'event' }, { label: '物品', value: 'item' },
  { label: '地点', value: 'location' }, { label: '其他', value: 'other' }
]

const analyzerLabels: Record<string, string> = {
  characters: '角色', memories: '记忆', plotArcs: '剧情弧线', timeline: '时间线', graph: '图谱'
}

const memCatOptions = [
  { label: '关系变化', value: 'relationship_change' },
  { label: '伏笔', value: 'foreshadowing' },
  { label: '情感变化', value: 'emotional_change' },
  { label: '事件记忆', value: 'event_memory' },
]
const arcActionOptions = [
  { label: '新增', value: 'create' }, { label: '更新', value: 'update' }, { label: '关闭', value: 'close' },
]
const arcStatusOptions = [
  { label: '活跃', value: 'active' }, { label: '中断', value: 'interrupted' },
  { label: '完成', value: 'completed' }, { label: '关闭', value: 'closed' },
]

function getAnalyzerData(key: string) {
  return editableAnalysis.value?.[key] || {}
}

const chapterTypeStats = computed(() => {
  const stats: Record<string, number> = {}
  const nodes = getAnalyzerData('graph')?.chapterGraph?.nodes
  if (nodes) {
    for (const n of nodes) { stats[n.type] = (stats[n.type] || 0) + 1 }
  }
  return stats
})

const mergedTypeStats = computed(() => {
  const stats: Record<string, number> = {}
  const nodes = getAnalyzerData('graph')?.mergedGraph?.nodes
  if (nodes) {
    for (const n of nodes) { stats[n.type] = (stats[n.type] || 0) + 1 }
  }
  return stats
})

const analyzerItems = computed(() => {
  return Object.keys(analyzerLabels).map(key => {
    const data = props.analysis?.[key]
    const status: string = data?.status || 'idle'
    let summary = '', error = ''
    if (status === 'success') {
      switch (key) {
        case 'characters': { const items = data.items || []; const newCount = items.filter((c: any) => c.isNew).length; summary = `${items.length} 个角色${newCount > 0 ? `（${newCount} 个新角色）` : ''}`; break }
        case 'memories': { const c = (data.chapterMemories || []).length; const g = (data.globalMemories || []).length; const s = (data.sceneMemories || []).length; summary = `章节记忆 ${c} + 全局记忆 ${g} + 场景记忆 ${s}`; break }
        case 'plotArcs': { const arcs = data.arcs || []; const create = arcs.filter((a: any) => a.action === 'create').length; const update = arcs.filter((a: any) => a.action === 'update').length; summary = `新增 ${create} + 更新 ${update}`; break }
        case 'timeline': { const evts = data.events || []; const major = evts.filter((e: any) => e.importance === 'major').length; summary = `${evts.length} 个事件${major > 0 ? `（${major} 重要）` : ''}`; break }
        case 'graph': {
          const cg = data.chapterGraph || {}
          const mg = data.mergedGraph || {}
          summary = `本章 ${(cg.nodes || []).length} 节点/${(cg.edges || []).length} 边 · 总图谱 ${(mg.nodes || []).length} 节点/${(mg.edges || []).length} 边`
          break
        }
      }
    } else if (status === 'failed') { error = data.error || 'AI 调用失败' }
    return { key, label: analyzerLabels[key], status, summary, error }
  })
})

// ── cytoscape 子图 ──
function toAnalysisCyData(): CyGraphData | null {
  const cg = getAnalyzerData('graph')?.chapterGraph
  if (!cg?.nodes?.length) return null
  const keyToType = new Map<string, string>()
  for (const n of cg.nodes) { keyToType.set(n.key, n.type) }
  return {
    nodes: cg.nodes.map((n: any) => ({ id: `${n.type}:${n.key}`, type: n.type, key: n.key, label: n.label, ...n.data })),
    edges: cg.edges.map((e: any) => ({
      source: `${keyToType.get(e.fromKey) || 'other'}:${e.fromKey}`,
      target: `${keyToType.get(e.toKey) || 'other'}:${e.toKey}`,
      relation: e.relation,
      fromType: keyToType.get(e.fromKey) || 'other', fromKey: e.fromKey,
      toType: keyToType.get(e.toKey) || 'other', toKey: e.toKey
    }))
  }
}

function getAnalysisNodeColor(type: string): string {
  return GRAPH_NODE_COLORS_V2[type] || GRAPH_NODE_COLORS_V2.other
}

const analysisCytoscape = useCytoscapeLifecycle({
  containerRef: analysisCyContainer,
  getDisplayData: () => toAnalysisCyData(),
  getNodeColor: getAnalysisNodeColor
})

function refreshAnalysisGraph() {
  setTimeout(() => analysisCytoscape.init(), 0)
}

// 监听图谱数据变化
watch(() => getAnalyzerData('graph')?.chapterGraph, () => {
  refreshAnalysisGraph()
}, { deep: true })

// 切换到图谱 tab 时重建 cytoscape（容器 display:none 时尺寸为 0）
watch(analysisActiveTab, (tab) => {
  if (tab === 'graph') refreshAnalysisGraph()
})

// analysis 变更时 → 深拷贝派生 editableAnalysis
watch(() => props.analysis, (val) => {
  if (val) {
    const copy = JSON.parse(JSON.stringify(val))
    if (copy.characters?.items) {
      for (const c of copy.characters.items) {
        c.relationshipsText = typeof c.relationships === 'object' ? JSON.stringify(c.relationships, null, 2) : (c.relationships || '{}')
        c.statusText = typeof c.status === 'object' ? JSON.stringify(c.status, null, 2) : (c.status || '{}')
      }
    }
    editableAnalysis.value = copy
  }
}, { deep: true, immediate: true })

function toastGraphWarnings(warnings?: string[]) {
  if (!warnings || warnings.length === 0) return
  props.showToast(warnings.join('；'), 'warning')
}

async function saveEdits() {
  if (!editableAnalysis.value) return
  savingEdits.value = true
  try {
    const payload = JSON.parse(JSON.stringify(editableAnalysis.value))
    const jsonErrors: string[] = []
    if (payload.characters?.items) {
      for (const c of payload.characters.items) {
        const relText = (c.relationshipsText || '').trim()
        if (relText) {
          try { c.relationships = JSON.parse(relText) } catch {
            jsonErrors.push(`角色「${c.name}」的关系 JSON 格式错误`)
          }
        } else {
          c.relationships = {}
        }
        const statText = (c.statusText || '').trim()
        if (statText) {
          try { c.status = JSON.parse(statText) } catch {
            jsonErrors.push(`角色「${c.name}」的状态 JSON 格式错误`)
          }
        } else {
          c.status = {}
        }
      }
    }
    if (jsonErrors.length > 0) {
      props.showToast(`JSON 格式错误，无法保存: ${jsonErrors.join('；')}`, 'error')
      return
    }
    editableAnalysis.value = payload
    emit('save-edits', payload)
  } catch (err: any) {
    props.showToast(err?.message || '保存调整失败', 'error')
  } finally {
    savingEdits.value = false
  }
}

function onRevert() {
  emit('revert')
}

// 让父级读分析数据 + 设置分析数据
defineExpose({
  analysis: toRef(props, 'analysis'),
  editableAnalysis,
  analyzerItems,
  refreshAnalysisGraph,
  toastGraphWarnings,
  newCharacters,
  /** 父级在归档前主动同步当前编辑到 server，避免"删了角色但归档时又出现" */
  saveEdits
})

onUnmounted(() => {
  analysisCytoscape.destroy()
})
</script>

<style scoped>
/* === Analyze header status banner (under analyze/revert buttons) === */
.analysis-status {
  margin-bottom: 12px;
  font-size: 12px;
  color: var(--text-tertiary);
}

/* === Analyzer tab pane body === */
.analyzer-tab-content { padding: 8px 0 0; min-height: 120px; }
.analyzer-idle {
  padding: 32px 0;
  text-align: center;
  color: var(--text-tertiary);
  font-size: 13px;
  font-style: italic;
}
.analyzer-item__error {
  padding: 12px;
  background: var(--color-error-tint);
  color: var(--color-error);
  border: 1px solid rgba(185, 76, 76, 0.25);
  border-radius: var(--radius-input);
  font-size: 12px;
  margin-bottom: 8px;
}
.analyzer-item__tag {
  display: inline-flex;
  align-items: center;
  font-size: 10px;
  font-weight: var(--weight-medium);
  padding: 1px 6px;
  border-radius: var(--radius-badge);
  letter-spacing: 0.04em;
}
.analyzer-item__tag.is-loading {
  background: var(--bg-canvas);
  color: var(--text-tertiary);
}
.analyzer-item__tag.is-success {
  background: var(--color-positive-tint);
  color: var(--accent-positive);
}
.analyzer-item__tag.is-failed {
  background: var(--color-error-tint);
  color: var(--color-error);
}

/* === Tag-label chip (身份/外貌/气质/性格/说话/关系/状态/时间/置信度) === */
.tag-label {
  font-size: 11px;
  font-weight: var(--weight-medium);
  color: var(--text-secondary);
  letter-spacing: 0.04em;
  padding-top: 6px;
}

/* === Character row === */
.char-list { display: flex; flex-direction: column; gap: 16px; }
.char-row {
  border: 1px solid var(--border-default);
  border-radius: var(--radius-card);
  padding: 12px 14px;
  background: var(--bg-card);
}
.char-row__head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.char-row__slug {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-tertiary);
}
.char-row__head > .n-popconfirm { margin-left: auto; }
.char-row__field {
  display: grid;
  grid-template-columns: 64px 1fr;
  gap: 12px;
  align-items: start;
  margin-bottom: 8px;
}
.char-row__field:last-child { margin-bottom: 0; }

/* === Memory sections === */
.mem-section { margin-bottom: 20px; }
.mem-section__title {
  font-size: 13px;
  font-weight: var(--weight-semibold);
  color: var(--text-primary);
  margin: 0 0 8px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.mem-count {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: var(--weight-regular);
  color: var(--text-tertiary);
  background: var(--bg-canvas);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-badge);
  padding: 0 6px;
}
.mem-row {
  padding: 10px 12px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-input);
  margin-bottom: 8px;
  background: var(--bg-canvas);
}
.mem-row__head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
  flex-wrap: wrap;
}
.mem-row__head > .n-popconfirm { margin-left: auto; }
.mem-row__imp-label {
  font-size: 11px;
  color: var(--text-tertiary);
}

/* === Plot arc rows === */
.arc-row {
  padding: 10px 12px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-input);
  margin-bottom: 8px;
  background: var(--bg-canvas);
}
.arc-row__head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.arc-row__head > .n-input { flex: 1; min-width: 160px; }
.arc-row__head > .n-popconfirm { margin-left: auto; }

/* === Timeline list === */
.time-list { display: flex; flex-direction: column; }
.time-summary {
  font-size: 12px;
  color: var(--text-tertiary);
  margin-bottom: 8px;
}
.time-row {
  display: flex;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid var(--border-subtle);
}
.time-row:last-child { border-bottom: 0; }
.time-row__order {
  flex: 0 0 28px;
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: var(--weight-semibold);
  color: var(--text-tertiary);
  padding-top: 4px;
}
.time-row__body { flex: 1; min-width: 0; }
.time-row__head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.time-row__head > .n-input { flex: 1; min-width: 160px; }
.time-row__head > .n-popconfirm { margin-left: auto; }
.time-row__meta {
  display: flex;
  gap: 8px;
  margin-top: 6px;
}
.time-row__time {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 6px;
  font-size: 12px;
  color: var(--text-secondary);
}

/* === Graph mini canvas === */
.graph-mini-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
  font-weight: var(--weight-medium);
  color: var(--text-secondary);
  margin: 8px 0;
}
.graph-mini-canvas {
  width: 100%;
  height: 320px;
  background: var(--bg-card);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-card);
}
.graph-mini-types {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 8px;
  font-size: 11px;
  color: var(--text-secondary);
}
.graph-type-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.graph-type-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

/* === Graph editor (collapsed by default) === */
.graph-section {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--border-subtle);
}
.graph-sub-title {
  font-size: 12px;
  font-weight: var(--weight-medium);
  color: var(--text-secondary);
  margin: 6px 0 8px;
}
.graph-node-row,
.graph-edge-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  flex-wrap: wrap;
}
.graph-edge-arrow {
  font-size: 14px;
  color: var(--text-tertiary);
  padding: 0 2px;
}
.graph-merged-types {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  font-size: 11px;
  color: var(--text-secondary);
}
</style>