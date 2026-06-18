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

import { countTokens } from './token-counter.js'

/**
 * 向后兼容 re-export alias:早期版本把 estimateTokens 直接定义在 runtime-compiler.ts。
 * 提取到 token-counter.ts 后,保留这个 alias 让老 import (`estimateTokens` from
 * `@novel-runtime/ai-provider`) 不破。Task 3/4 才会逐步切到 countTokens 并最终删除。
 */
export const estimateTokens = countTokens

export class RuntimePromptCompiler {
  compile(base: SharedRuntimeBase, task: WorkerTask, userMessage: string): CompiledPrompt {
    // 1. 编译 system message
    const systemParts: string[] = []
    systemParts.push(`[Identity]\n${base.identity}`)
    systemParts.push(
      `[Settings]\n` +
      `Language: ${base.settings.language || 'CN'}\n` +
      `Uncensored: ${base.settings.uncensored ? 'Yes' : 'No'}\n` +
      `Repeat: ${base.settings.repeat ? 'Yes' : 'No'}\n` +
      `Speciality: ${base.settings.speciality || 'All'}`
    )
    systemParts.push(`[Behavior]\n${base.behavior}`)
    if (base.jailbreak) {
      systemParts.push(`[Jailbreak]\n${base.jailbreak}`)
    }
    systemParts.push(`[Task: ${task.workerType}]\n${task.taskPrompt}`)

    const systemMessage = systemParts.join('\n\n')

    // 2. 计算 token
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
