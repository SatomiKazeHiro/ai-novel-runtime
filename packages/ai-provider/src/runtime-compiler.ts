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
