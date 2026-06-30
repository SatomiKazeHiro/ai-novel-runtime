import type { V2ExtractedPlotArc } from './plot-arc-extractor.js'

export interface V2PlotArcMergeInput {
  newArcs: V2ExtractedPlotArc[]
  existingArcs: { id: string; title: string; description: string; status: string; isMainline: boolean }[]
}

export interface V2PlotArcMergeResult {
  mergedArcs: { id?: string; action: string; title: string; description: string; status: string; isMainline: boolean; mergeTargetId?: string }[]
}

export function mergePlotArcs(input: V2PlotArcMergeInput): V2PlotArcMergeResult {
  const mergedArcs = input.newArcs.map(arc => {
    // 查找匹配的已有弧线
    let matchedExisting: typeof input.existingArcs[0] | undefined

    if (arc.plotArcId) {
      matchedExisting = input.existingArcs.find(a => a.id === arc.plotArcId)
    }

    return {
      id: matchedExisting?.id,
      action: arc.action,
      title: arc.title,
      description: arc.description,
      status: arc.status,
      isMainline: arc.isMainline,
      mergeTargetId: arc.mergeInfo || undefined
    }
  })

  return { mergedArcs }
}
