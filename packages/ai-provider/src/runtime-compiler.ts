import Mustache from 'mustache'
import { countTokens } from './token-counter.js'

export interface SharedRuntimeBase {
  identity: string
  settings: {
    language?: string
    uncensored?: boolean
    repeat?: boolean
    speciality?: string
  }
  behavior: string
  jailbreak?: string
}

export interface WorkerTask {
  workerType: 'generation' | 'scoring' | 'memory' | 'graph' | 'timeline' | 'rewrite' | 'memory_organize'
  taskPrompt: string
}

export interface CompiledPrompt {
  systemMessage: string
  userMessage: string
  meta: {
    systemTokens: number
    userTokens: number
    totalTokens: number
  }
}

/**
 * System message 模板 — Mustache 占位符 + jailbreak section.
 *
 * 段落分割用双换行 (\n\n), 跟原 ad-hoc join('\n\n') 的输出一致。
 * {{#jailbreak}}...{{/jailbreak}} 是 inline section（不独立成行）,
 * 因此 mustache 不会 strip 前后换行 — 空字符串/null/undefined 触发跳过时,
 * 原本用于分隔 [Behavior] 与 [Task] 的空行得以保留。
 */
const SYSTEM_TEMPLATE = `[Identity]
{{identity}}

[Settings]
Language: {{language}}
Uncensored: {{uncensoredLabel}}
Repeat: {{repeatLabel}}
Speciality: {{speciality}}

[Behavior]
{{behavior}}

{{#jailbreak}}[Jailbreak]
{{jailbreak}}

{{/jailbreak}}[Task: {{workerType}}]
{{taskPrompt}}`

interface SystemViewModel {
  identity: string
  language: string
  uncensoredLabel: 'Yes' | 'No'
  repeatLabel: 'Yes' | 'No'
  speciality: string
  behavior: string
  jailbreak: string
  workerType: WorkerTask['workerType']
  taskPrompt: string
}

/**
 * Settings 兜底 + Yes/No 格式化都在 viewmodel 准备阶段完成,
 * 模板只负责字段插入。改 "uncensoredLabel" 这种格式化规则只需改这里,
 * 模板不动。
 */
function buildViewModel(base: SharedRuntimeBase, task: WorkerTask): SystemViewModel {
  const settings = base.settings ?? {}
  return {
    identity: base.identity,
    language: settings.language || 'CN',
    uncensoredLabel: settings.uncensored ? 'Yes' : 'No',
    repeatLabel: settings.repeat ? 'Yes' : 'No',
    speciality: settings.speciality?.trim() || 'All',
    behavior: base.behavior,
    // mustache section 对空字符串/null/undefined 视为 falsy, 触发跳过。
    jailbreak: base.jailbreak ?? '',
    workerType: task.workerType,
    taskPrompt: task.taskPrompt
  }
}

export class RuntimePromptCompiler {
  /**
   * 编译 RuntimeProfile + WorkerTask → 最终 system/user message.
   *
   * system 用 Mustache 模板渲染, viewmodel 阶段处理默认值和布尔格式化;
   * user message 原样透传 (pipeline 层已组装好, 见 packages/prompt-runtime).
   */
  compile(base: SharedRuntimeBase, task: WorkerTask, userMessage: string): CompiledPrompt {
    const view = buildViewModel(base, task)
    const systemMessage = Mustache.render(SYSTEM_TEMPLATE, view).trimEnd()

    const systemTokens = countTokens(systemMessage)
    const userTokens = countTokens(userMessage)

    return {
      systemMessage,
      userMessage,
      meta: {
        systemTokens,
        userTokens,
        totalTokens: systemTokens + userTokens
      }
    }
  }
}