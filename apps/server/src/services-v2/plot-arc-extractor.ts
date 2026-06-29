// V2 剧情弧线提取器 — 阶段 4 实现

export interface V2ExtractedPlotArc {
  action: 'create' | 'update' | 'close'
  plotArcId?: string
  title: string
  description: string
  status: 'active' | 'interrupted' | 'completed' | 'closed'
  isMainline: boolean
  mergeInfo?: string
}

export interface V2PlotArcExtractResult {
  arcs: V2ExtractedPlotArc[]
}

export async function extractPlotArcs(_content: string): Promise<V2PlotArcExtractResult> {
  throw new Error('Not implemented: extractPlotArcs — 阶段 4 实现')
}
