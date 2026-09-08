<template>
  <!-- v3 改造:水平 4 列网格取代原来的纵向卡片栈；统一由 .rp-desk 提供外框 -->
  <section v-if="pending" class="rp-desk cap-card">
    <header class="rp-header">
      <span class="cap-eyebrow">ARCHIVE REVIEW</span>
      <h2>归档审查</h2>
      <p class="rp-meta">
        提取于 {{ pending.meta?.extractedAt || '未知' }} · 章节 #{{ pending.meta?.chapterNumber ?? '?' }}
      </p>
    </header>

    <div class="rp-grid">
      <div
        v-for="stageName in STAGE_ORDER"
        :key="stageName"
        class="rp-col"
      >
        <StageCard
          :stage-name="stageName"
          :state="pending.stages?.[stageName]"
          @delete-row="(section: string, index: number) => onDeleteRow(stageName, section, index)"
        >
          <template #default="{ result }">
            <StageResultView
              :stage-name="stageName"
              :result="result"
              @delete-row="(section: string, index: number) => onDeleteRow(stageName, section, index)"
            />
          </template>
        </StageCard>
      </div>
    </div>

    <footer class="rp-footer">
      <button class="cap-pill is-ghost" @click="emit('reprepare')">再校 · 重新解析</button>
      <button class="cap-pill is-ghost" @click="emit('cancel')">撤 · 撤销审查</button>
      <span v-if="!allSuccess" class="rp-hint">未通过：{{ failedNames }}</span>
      <button
        class="cap-pill is-primary"
        :disabled="!allSuccess"
        @click="emit('archive')"
      >定稿 · 确认归档</button>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import StageCard from './StageCard.vue'
import StageResultView from './StageResultView.vue'

const STAGE_ORDER = ['character', 'memory', 'plotArc', 'graph'] as const
type StageName = typeof STAGE_ORDER[number]

const STAGE_TITLE: Record<StageName, string> = {
  character: '角色',
  memory: '记忆',
  plotArc: '剧情',
  graph: '图谱'
}

interface StageState {
  status: string
  result?: any
  errorMessage?: string
}

interface Pending {
  version: 3
  stages?: Record<StageName, StageState>
  meta?: { extractedAt?: string; chapterNumber?: number | string }
}

const props = defineProps<{
  pending: Pending | null
}>()

const emit = defineEmits<{
  (e: 'reprepare'): void
  (e: 'cancel'): void
  (e: 'archive'): void
  (e: 'update-stage', stageName: StageName, result: unknown): void
}>()

const allSuccess = computed(() => {
  const stages = props.pending?.stages
  if (!stages) return false
  return STAGE_ORDER.every(name => stages[name]?.status === 'success')
})

const failedNames = computed(() => {
  const stages = props.pending?.stages
  if (!stages) return STAGE_ORDER.map(name => STAGE_TITLE[name]).join(' / ')
  return STAGE_ORDER
    .filter(name => stages[name]?.status !== 'success')
    .map(name => STAGE_TITLE[name])
    .join(' / ')
})

/**
 * 用户在 StageResultView 点 × 时,删掉 pending.stages[stageName].result[section][index],
 * 同步 deepest-clone 后 emit('update-stage') 给父组件持久化。
 * graph 阶段没有 × 按钮,此函数不会在 graph 上被触发。
 */
function onDeleteRow(stageName: StageName, section: string, index: number) {
  if (!props.pending?.stages?.[stageName]) return
  const stage = props.pending.stages[stageName]
  const cloned = JSON.parse(JSON.stringify(stage.result ?? {})) as Record<string, unknown>
  const arr = cloned[section]
  if (!Array.isArray(arr)) return
  if (index < 0 || index >= arr.length) return
  arr.splice(index, 1)
  emit('update-stage', stageName, cloned)
}
</script>

<style scoped>
/* === 面板外壳：单层 1px 外框 + 圆角 ；4 个 column 共享此框 === */
.rp-desk {
  margin-top: 16px;
}

.rp-header {
  padding: var(--space-5) var(--space-5) var(--space-4);
  border-bottom: 1px solid var(--border-default);
}
.rp-header h2 {
  margin: 4px 0 4px 0;
  font-size: 18px;
  font-weight: var(--weight-semibold);
}
.rp-meta {
  margin: 0;
  font-size: 12px;
  color: var(--text-tertiary);
}

/* === 网格 === */
.rp-grid {
  display: grid;
  grid-template-columns: 1fr;
}
@media (min-width: 640px) {
  .rp-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (min-width: 1024px) {
  .rp-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }
}

.rp-col {
  min-width: 0;
  border-right: 1px solid var(--border-default);
  border-bottom: 1px solid var(--border-default);
}
.rp-col:last-child { border-right: none; }

/* 偶数列 在 <1024px 下要去掉底边以避免重复 === */
@media (max-width: 639px) {
  .rp-col { border-right: none; }
}
@media (min-width: 640px) and (max-width: 1023px) {
  .rp-col:nth-child(2n) { border-right: none; }
  .rp-col:nth-last-child(-n+2) { border-bottom: none; }
}
@media (min-width: 1024px) {
  .rp-col:nth-last-child(-n+1) { border-bottom: none; }
}

/* 列级别状态提升 */

/* 数据状态交给内部 StageCard 的 [data-status] 处理标题加粗与降透明度 */
.rp-col :deep(.stage-card[data-status='failed']) {
  border-bottom: 2px solid var(--color-error);
}

/* === footer === */
.rp-footer {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  justify-content: flex-end;
  padding: var(--space-4) var(--space-5);
  border-top: 1px solid var(--border-default);
}
.rp-footer button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.rp-hint {
  font-size: 12px;
  color: var(--color-muted-ash);
  margin-right: auto;
  letter-spacing: 0.02em;
}
</style>
