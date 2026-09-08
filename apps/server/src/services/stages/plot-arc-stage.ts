import type { FastifyInstance } from 'fastify'
import type { PendingPlotArcWrite } from '@novel-runtime/shared'
import { consolidatePlotArcs, type ExistingArcView } from '../plot-consolidator.js'
import type { StageContext, StageState } from './types.js'

export interface PlotArcStageInput extends StageContext {
  existingArcs: ExistingArcView[]
  characterNames: string[]
  latestBranchStates: Array<{
    characterId: string
    status: string
    relationships: string
  }>
}

export interface PlotArcStageResult {
  plotArcs: PendingPlotArcWrite[]
}

export async function runPlotArcStage(
  app: FastifyInstance,
  input: PlotArcStageInput
): Promise<StageState<PlotArcStageResult>> {
  const completedAt = new Date().toISOString()
  try {
    const plotArcs = await consolidatePlotArcs(
      app,
      input.storyId,
      input.chapterId,
      input.existingArcs,
      input.content,
      input.outline
    )
    return { status: 'success', result: { plotArcs }, completedAt }
  } catch (err: any) {
    app.log.error(`[PlotArcStage] ${err.message}`)
    return { status: 'failed', errorMessage: err.message, completedAt }
  }
}
