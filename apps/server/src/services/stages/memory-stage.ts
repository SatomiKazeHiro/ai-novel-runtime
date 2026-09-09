import type { FastifyInstance } from 'fastify'
import { RuntimePromptCompiler } from '@novel-runtime/ai-provider'
import { cleanJsonBlock, buildExtractPrompt } from '@novel-runtime/shared'
import { loadRuntimeBase, loadWorkerTask } from '../runtime-loader.js'
import { callAIWithStageRetry, type StageContext, type StageState } from './types.js'

/**
 * memory-stage 输入:对齐 buildExtractPrompt full mode 所需参数。
 *
 * - protagonistNames: 用于"本故事主角"行(影响 mainEvents 评分粒度)。
 * - existingNodeKeys: N-1 图谱里所有 type:key,让 AI 复用已有实体。
 * - previousSnapshotNodes: N-1 cumulativeGraph 节点列表(带 importance,按 desc 排序后取 top CAP)。
 */
export interface MemoryStageInput extends StageContext {
  protagonistNames: string[]
  characterNames: string[]
  existingNodeKeys: string[]
  previousSnapshotNodes: Array<{ type: string; key: string; label: string; importance?: number }>
}

/**
 * memory-stage 阶段输出。v3 设计(2026-07-30 spec D3):
 *   - 删 characterStatusChanges(归属 character-stage)
 *   - 删 timelinePosition / timelineEvents(v3 删除 TimelineEvent 表)
 *   - summary 写 Chapter.summary 列,不进 Memory 表
 *   - scenes 数组 → archive confirm 时写 layer='scene'
 */
export interface MemoryStageResult {
  mainEvents: Array<{ description: string; importance: number; participants?: string }>
  sideEvents: Array<{ description: string; importance: number; participants?: string }>
  emotions: string[]
  foreshadowing: string[]
  relationshipChanges: string[]
  scenes: Array<{ location: string; event: string; importance: number; participants?: string }>
  summary: string
}

export async function runMemoryStage(
  app: FastifyInstance,
  input: MemoryStageInput
): Promise<StageState<MemoryStageResult>> {
  const completedAt = new Date().toISOString()

  // v3 memory system 拍板 (2026-07-30 spec D1-D3):
  //   - 用 buildExtractPrompt memory-only mode: 沿用 full 的跨章注入
  //     (previousSnapshotNodes 复用 N-1 type:key), 但只输出【任务1：记忆提取】,
  //     删【任务2：实体与关系提取】(D2 — 节点/边由 graph-extract-stage 专责)。
  //   - 任务1 字段也收缩: 砍 characterStatusChanges (D3 — 归属 character-stage) /
  //     timelinePosition / timelineEvents (D3 — v3 删除 TimelineEvent 表)。
  const prompt = buildExtractPrompt(
    {
      protagonistNames: input.protagonistNames,
      existingNodeKeys: input.existingNodeKeys,
      previousSnapshotNodes: input.previousSnapshotNodes,
      content: input.content,
      outline: input.outline
    },
    { mode: 'memory-only' }
  )

  try {
    const prisma = app.prisma
    const base = await loadRuntimeBase(input.storyId, prisma)
    const task = await loadWorkerTask(input.storyId, 'memory', prisma)
    const compiler = new RuntimePromptCompiler()
    const compiled = compiler.compile(base, task, prompt)

    const raw = await callAIWithStageRetry(app, {
      storyId: input.storyId,
      chapterId: input.chapterId,
      callType: 'memory_stage',
      compiled,
      maxTokens: 4096
    })

    // memory-only mode AI 输出包成 { memories: {...} }。兼容老格式(直接 memories 字段平铺)
    const parsedRoot = JSON.parse(cleanJsonBlock(raw))
    const memBlob = parsedRoot?.memories ?? parsedRoot
    const result: MemoryStageResult = {
      mainEvents: (Array.isArray(memBlob?.mainEvents) ? memBlob.mainEvents : []).map((e: any) => ({
        description: e.description, importance: e.importance, participants: e.participants
      })),
      sideEvents: (Array.isArray(memBlob?.sideEvents) ? memBlob.sideEvents : []).map((e: any) => ({
        description: e.description, importance: e.importance, participants: e.participants
      })),
      emotions: Array.isArray(memBlob?.emotions) ? memBlob.emotions : [],
      foreshadowing: Array.isArray(memBlob?.foreshadowing) ? memBlob.foreshadowing : [],
      relationshipChanges: Array.isArray(memBlob?.relationshipChanges) ? memBlob.relationshipChanges : [],
      scenes: (Array.isArray(memBlob?.scenes) ? memBlob.scenes : []).map((s: any) => ({
        location: s.location, event: s.event, importance: s.importance, participants: s.participants
      })),
      summary: typeof memBlob?.summary === 'string' ? memBlob.summary : ''
    }

    return { status: 'success', result, completedAt }
  } catch (err: any) {
    app.log.error(`[MemoryStage] ${err.message}`)
    return { status: 'failed', errorMessage: err.message, completedAt }
  }
}
