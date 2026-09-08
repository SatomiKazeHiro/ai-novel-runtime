import type { FastifyInstance } from 'fastify'
import { buildCumulativeGraph } from '../cumulative-graph.js'
import type { GraphSnapshot } from '../graph-snapshot.js'

export interface BuildAndSaveInput {
  storyId: string
  chapterId: string
  chapterNumber: number
  chapterGraph: GraphSnapshot
  prevCumulativeGraph: GraphSnapshot | null
}

export interface BuildAndSaveResult {
  graph: GraphSnapshot
  generatedAt: string
  aiCalled: boolean
}

/**
 * 包装 buildCumulativeGraph: 调 AI dedup, 把结果 + generatedAt 返回给路由层落库。
 * 不在这里写 prisma.update, 以便路由层控制 transaction 边界。
 */
export async function buildAndSaveCumulativeGraph(
  _app: FastifyInstance,
  input: BuildAndSaveInput,
): Promise<BuildAndSaveResult> {
  const result = await buildCumulativeGraph(_app as any, {
    storyId: input.storyId,
    chapterId: input.chapterId,
    chapterNumber: input.chapterNumber,
    chapterGraph: input.chapterGraph,
    prevCumulativeGraph: input.prevCumulativeGraph,
  })
  return {
    graph: result.cumulativeGraph,
    generatedAt: new Date().toISOString(),
    aiCalled: result.aiCalled,
  }
}