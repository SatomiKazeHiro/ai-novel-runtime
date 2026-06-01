import { encodingForModel } from 'js-tiktoken'
import { estimateTokens as heuristicEstimateTokens } from '@novel-runtime/shared'
import type { BudgetConfig } from './index.js'

export { BudgetConfig }

export interface TokenUsage {
  component: string
  tokens: number
  budget: number
  percent: number
}

export interface BudgetReport {
  promptTokens: number
  outputTokens: number
  totalTokens: number
  budget: BudgetConfig
  components: TokenUsage[]
  warnings: string[]
  compressed: boolean
}

const encoders: Map<string, any> = new Map()

function getEncoder(model: string) {
  if (!encoders.has(model)) {
    try {
      const modelMap: Record<string, string> = {
        'deepseek-chat': 'gpt-4',
        'deepseek-coder': 'gpt-4',
        'gpt-4': 'gpt-4',
        'gpt-3.5-turbo': 'gpt-3.5-turbo'
      }
      const encModel = modelMap[model] || 'gpt-4'
      encoders.set(model, encodingForModel(encModel as any))
    } catch {
      encoders.set(model, encodingForModel('gpt-4'))
    }
  }
  return encoders.get(model)
}

export function countTokens(text: string, model = 'deepseek-chat'): number {
  if (!text) return 0
  try {
    const encoder = getEncoder(model)
    return encoder.encode(text).length
  } catch {
    return heuristicEstimateTokens(text)
  }
}

export class ContextBudgetManager {
  private budget: BudgetConfig
  private model: string

  constructor(budget: BudgetConfig, model = 'deepseek-chat') {
    this.budget = budget
    this.model = model
  }

  analyze(prompt: string, output = ''): BudgetReport {
    const promptTokens = countTokens(prompt, this.model)
    const outputTokens = countTokens(output, this.model)
    const totalTokens = promptTokens + outputTokens

    const components = this.parseComponents(prompt)
    const warnings: string[] = []
    let compressed = false

    if (totalTokens > this.budget.total) {
      warnings.push(`总 Token 超预算: ${totalTokens}/${this.budget.total} (${(totalTokens / this.budget.total * 100).toFixed(1)}%)`)
    }

    if (promptTokens > this.budget.output) {
      warnings.push(`Prompt Token 超预算: ${promptTokens}/${this.budget.output}`)
    }

    if (outputTokens > this.budget.output) {
      warnings.push(`Output Token 超预算: ${outputTokens}/${this.budget.output}`)
    }

    for (const comp of components) {
      if (comp.tokens > comp.budget) {
        warnings.push(`${comp.component} 超预算: ${comp.tokens}/${comp.budget}`)
      }
    }

    if (totalTokens / this.budget.total > 0.8 && totalTokens <= this.budget.total) {
      warnings.push(`Token 使用接近上限: ${(totalTokens / this.budget.total * 100).toFixed(1)}%，建议压缩上下文`)
      compressed = true
    }

    return {
      promptTokens,
      outputTokens,
      totalTokens,
      budget: this.budget,
      components,
      warnings,
      compressed
    }
  }

  private parseComponents(prompt: string): TokenUsage[] {
    const parts = prompt.split(/---\s*(.+?)\s*---/)
    const components: TokenUsage[] = []
    const budgetMap: Record<string, number> = {
      'Identity': this.budget.identity,
      'Behavior': this.budget.behavior,
      'Jailbreak': this.budget.jailbreak,
      'Style': this.budget.style,
      'Story': this.budget.story,
      'Lore': this.budget.lore,
      'Character': this.budget.character,
      'Scene': this.budget.scene,
      'Memory': this.budget.memory,
      'Timeline': this.budget.timeline,
      'Output': this.budget.output
    }

    for (let i = 1; i < parts.length; i += 2) {
      const name = parts[i].trim()
      const content = parts[i + 1] || ''
      const tokens = countTokens(content, this.model)
      const budget = budgetMap[name] || this.budget.output
      components.push({
        component: name,
        tokens,
        budget,
        percent: Math.round(tokens / budget * 100)
      })
    }

    return components
  }

  compress(prompt: string, strategy: 'summary' | 'truncate' = 'truncate'): { prompt: string; compressed: string[] } {
    const compressed: string[] = []
    const compressibleLayers = ['Memory', 'Lore', 'Timeline']
    let result = prompt

    for (const layerName of compressibleLayers) {
      const regex = new RegExp(`---\\s*${layerName}\\s*---([^]*?)(?=---\\s*|$)`)
      const match = result.match(regex)
      if (match) {
        const content = match[1].trim()
        const tokens = countTokens(content, this.model)
        const budgetMap: Record<string, number> = {
          'Memory': this.budget.memory,
          'Lore': this.budget.lore,
          'Timeline': this.budget.timeline
        }
        const budget = budgetMap[layerName] || this.budget.output

        if (tokens > budget * 0.9) {
          if (strategy === 'truncate') {
            const lines = content.split('\n')
            const keepLines = Math.max(3, Math.floor(lines.length * 0.6))
            const newContent = lines.slice(0, keepLines).join('\n') + '\n...（已压缩）'
            result = result.replace(content, newContent)
            compressed.push(layerName)
          } else {
            result = result.replace(content, '...（已摘要压缩）')
            compressed.push(layerName)
          }
        }
      }
    }

    return { prompt: result, compressed }
  }
}
