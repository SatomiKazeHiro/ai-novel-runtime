export interface PromptProfile {
  name: string
  identity?: string
  behavior?: string
  settings?: {
    language?: string
    uncensored?: boolean
    repeat?: boolean
  }
  speciality?: string
  style?: string[]
  systemInstruction?: string
}

export interface PromptLayers {
  style?: string
  story?: string
  lore?: string
  character?: string
  scene?: string
  memory?: string
  timeline?: string
  plotArc?: string
  output?: string
}

export interface BudgetConfig {
  total: number
  identity: number
  behavior: number
  jailbreak: number
  style: number
  story: number
  lore: number
  character: number
  scene: number
  memory: number
  timeline: number
  plotArc: number
  output: number
}

export interface LayerStat {
  name: string
  tokens: number
  budget: number
  truncated: boolean
}

export interface PipelineResult {
  text: string
  stats: LayerStat[]
  totalTokens: number
}

import { estimateTokens } from '@novel-runtime/ai-provider'

interface LayerDef {
  key: keyof PromptLayers
  label: string
  budget: number
  isArray?: boolean
}

export class PromptAssembler {
  private budget: BudgetConfig

  constructor(budget: BudgetConfig) {
    this.budget = budget
  }

  assemble(layers: PromptLayers): PipelineResult {
    const parts: string[] = []
    const stats: LayerStat[] = []
    let used = 0

    const layerDefs: LayerDef[] = [
      { key: 'style', label: 'Style', budget: this.budget.style },
      { key: 'story', label: 'Story', budget: this.budget.story },
      { key: 'lore', label: 'Lore', budget: this.budget.lore },
      { key: 'character', label: 'Character', budget: this.budget.character },
      { key: 'scene', label: 'Scene', budget: this.budget.scene },
      { key: 'memory', label: 'Memory', budget: this.budget.memory },
      { key: 'timeline', label: 'Timeline', budget: this.budget.timeline },
      { key: 'plotArc', label: 'PlotArc', budget: this.budget.plotArc },
      { key: 'output', label: 'Output', budget: this.budget.output }
    ]

    for (const def of layerDefs) {
      if (def.isArray) {
        const arr = layers[def.key] as string[] | undefined
        if (arr) {
          for (const text of arr) {
            const { trimmed, truncated } = this.trimToBudget(text, def.budget, used)
            if (trimmed) {
              parts.push(`--- ${def.label} ---\n${trimmed}`)
              const tokens = estimateTokens(trimmed)
              used += tokens
              stats.push({ name: def.label, tokens, budget: def.budget, truncated })
            }
          }
        }
      } else {
        const text = layers[def.key] as string | undefined
        if (text) {
          const { trimmed, truncated } = this.trimToBudget(text, def.budget, used)
          if (trimmed) {
            parts.push(`--- ${def.label} ---\n${trimmed}`)
            const tokens = estimateTokens(trimmed)
            used += tokens
            stats.push({ name: def.label, tokens, budget: def.budget, truncated })
          }
        }
      }
    }

    return {
      text: parts.join('\n\n'),
      stats,
      totalTokens: used
    }
  }

  private trimToBudget(text: string, layerBudget: number, used: number): { trimmed: string; truncated: boolean } {
    const remaining = this.budget.total - used
    if (remaining <= 0) return { trimmed: '', truncated: true }
    const effectiveBudget = Math.min(layerBudget, remaining)
    const tokens = estimateTokens(text)
    if (tokens <= effectiveBudget) return { trimmed: text, truncated: false }
    // rough char limit: assume ~2 chars per token for Chinese
    const charLimit = Math.floor(effectiveBudget * 2)
    return { trimmed: text.slice(0, charLimit), truncated: true }
  }
}

export class PromptPipeline {
  private assembler: PromptAssembler
  constructor(budget: BudgetConfig) {
    this.assembler = new PromptAssembler(budget)
  }

  run(layers: PromptLayers): PipelineResult {
    return this.assembler.assemble(layers)
  }
}

