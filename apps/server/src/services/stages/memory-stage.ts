import type { FastifyInstance } from 'fastify'
import { RuntimePromptCompiler } from '@novel-runtime/ai-provider'
import { cleanJsonBlock } from '@novel-runtime/shared'
import { loadRuntimeBase, loadWorkerTask } from '../runtime-loader.js'
import { callAIWithStageRetry, type StageContext, type StageState } from './types.js'

/**
 * memory-stage 输出形状对齐 MemoryExtractionResult，但**移除**
 * characterStatusChanges（归属 character-stage）。
 */
export interface MemoryStageInput extends StageContext {
  characterNames: string[]
  characterKeys: string[]
}

export interface MemoryStageResult {
  mainEvents: Array<{ description: string; participants: string[]; importance: number }>
  sideEvents: Array<{ description: string; participants: string[]; importance: number }>
  emotions: string[]
  foreshadowing: string[]
  relationshipChanges: string[]
  scenes: Array<{ location: string; event: string; importance: number }>
  timelinePosition: number | null
  summary: string
  timelineEvents?: Array<{ position: number | null; description: string }>
}

export async function runMemoryStage(
  app: FastifyInstance,
  input: MemoryStageInput
): Promise<StageState<MemoryStageResult>> {
  const completedAt = new Date().toISOString()
  const charList = input.characterNames.length ? input.characterNames.join('、') : '无明确角色'
  const charKeyList = input.characterKeys.length ? input.characterKeys.join(', ') : '（空）'

  const prompt = `请分析以下小说章节，提取关键信息并以严格 JSON 格式返回。不要返回 markdown 代码块，只返回纯 JSON。

本故事角色：${charList}
graph key 列表（已存在，可复用）：${charKeyList}

提取字段：
- mainEvents：主要事件（对象数组，description / participants / importance 5-8）
- sideEvents：次要事件（对象数组，同上）
- emotions：主要角色的情绪变化（字符串数组）
- foreshadowing：新埋下的伏笔（字符串数组）
- relationshipChanges：角色关系变化（字符串数组）
- timelinePosition：本章开篇时间锚点（Y.DDDHH 编码，不能确定则 null）
- summary：本章一句话摘要（50字以内）
- scenes：场景记忆数组（{location, event, importance 1-10}）
- timelineEvents：章内不同时间点的事件（可选，[{position, description}]）

注意：不要返回 characterStatusChanges（归属 character-stage）。

章节内容：
${input.content.slice(0, 8000)}`

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
      maxTokens: 2048
    })

    const parsed = JSON.parse(cleanJsonBlock(raw))
    const result: MemoryStageResult = {
      mainEvents: parsed.mainEvents ?? [],
      sideEvents: parsed.sideEvents ?? [],
      emotions: parsed.emotions ?? [],
      foreshadowing: parsed.foreshadowing ?? [],
      relationshipChanges: parsed.relationshipChanges ?? [],
      scenes: parsed.scenes ?? [],
      timelinePosition: parsed.timelinePosition ?? null,
      summary: parsed.summary ?? '',
      timelineEvents: parsed.timelineEvents
    }

    return { status: 'success', result, completedAt }
  } catch (err: any) {
    app.log.error(`[MemoryStage] ${err.message}`)
    return { status: 'failed', errorMessage: err.message, completedAt }
  }
}
