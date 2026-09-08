import type { FastifyInstance } from 'fastify'
import { RuntimePromptCompiler } from '@novel-runtime/ai-provider'
import { cleanJsonBlock } from '@novel-runtime/shared'
import { loadRuntimeBase, loadWorkerTask } from '../runtime-loader.js'
import { callAIWithStageRetry, type StageContext, type StageState } from './types.js'

export interface MatchedCharacter {
  id: string
  name: string
  key: string
  label: string
  importance: number
}

export interface CharacterStageInput extends StageContext {
  matchedCharacters: MatchedCharacter[]
}

export interface CharacterStateRow {
  characterId: string | null
  name: string
  key: string
  // status / relationships 都是 JSON 对象。Prompt 明确要求输出 JSON 对象,
  // character-stage 解析后 w.status 实际是 Object (AI 真实输出) 或 String
  // (测试 fixture / 上游已 stringify)。commitCharacterBranchStateWrites 在
  // 边界统一 JSON.stringify, 这里类型放宽以匹配实际数据, 避免类型断言失真。
  status: string | object
  relationships: string | object
  isNew: boolean
}

export interface CharacterStageResult {
  characterStates: CharacterStateRow[]
}

export async function runCharacterStage(
  app: FastifyInstance,
  input: CharacterStageInput
): Promise<StageState<CharacterStageResult>> {
  const completedAt = new Date().toISOString()
  const matched = input.matchedCharacters
  const matchedList = matched
    .map(c => `- id=${c.id} name=${c.name} key=${c.key} label=${c.label}`)
    .join('\n')

  const prompt = `你是小说角色状态助手。

【任务】基于章节内容，生成"角色状态快照"：每个角色一条记录，描述本章结束时的状态 + 与其他角色的关系。

【已有角色（从正文预匹配）】必须从以下角色中选取，新角色只允许当本章出现但未在列表中时：
${matchedList || '（空）'}

【输出 JSON】
{
  "characterStates": [
    {
      "characterId": "<已有角色 id；新角色 → null>",
      "name": "<角色名>",
      "key": "<graph key，已有角色复用已有 key，新角色用拼音小写下划线>",
      "status": {"rank":"练气","location":"楼道","realm":"凡人"},
      "relationships": {"<其他角色名>": "<关系>"},
      "isNew": <true / false>
    }
  ]
}

status / relationships 必须是 JSON 对象（不是字符串包装）。后端在写入
CharacterBranchState 表时会统一 JSON.stringify 存储。

【章节大纲】${input.outline}
【章节内容】${input.content}`

  try {
    const prisma = app.prisma
    const base = await loadRuntimeBase(input.storyId, prisma)
    const task = await loadWorkerTask(input.storyId, 'memory', prisma)
    const compiler = new RuntimePromptCompiler()
    const compiled = compiler.compile(base, task, prompt)

    const raw = await callAIWithStageRetry(app, {
      storyId: input.storyId,
      chapterId: input.chapterId,
      callType: 'character_stage',
      compiled
    })

    const parsed = JSON.parse(cleanJsonBlock(raw))
    const result: CharacterStageResult = {
      characterStates: Array.isArray(parsed.characterStates) ? parsed.characterStates : []
    }

    return { status: 'success', result, completedAt }
  } catch (err: any) {
    app.log.error(`[CharacterStage] ${err.message}`)
    return { status: 'failed', errorMessage: err.message, completedAt }
  }
}
