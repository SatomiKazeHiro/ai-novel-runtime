import type { FastifyInstance } from 'fastify'
import { v2CharacterRoutes } from './characters.js'
import { v2CharacterAnalysisRoutes } from './characters-analysis.js'
import { v2MemoryRoutes } from './memories.js'
import { v2MemoryAnalysisRoutes } from './memories-analysis.js'
import { v2PlotArcRoutes } from './plot-arcs.js'
import { v2PlotArcAnalysisRoutes } from './plot-arcs-analysis.js'
import { v2ChapterRoutes } from './chapters.js'
import { v2ChapterGenerateRoutes } from './chapters-generate.js'
import { v2ChapterAnalysisRoutes } from './chapters-analysis.js'
import { v2ChapterArchiveRoutes } from './chapters-archive.js'
import { v2ChapterDraftsRoutes } from './chapters-drafts.js'
import { v2ProviderConfigsRoutes } from './provider-configs.js'
import { v2TimelineRoutes } from './timeline.js'
import { v2GraphRoutes } from './graph.js'
import { v2LoreRoutes } from './lore.js'
import { v2WorkerTaskRoutes } from './worker-tasks.js'
import { v2PromptLogRoutes } from './prompt-logs.js'

export async function v2Routes(app: FastifyInstance) {
  await app.register(v2CharacterRoutes)
  await app.register(v2CharacterAnalysisRoutes)
  await app.register(v2MemoryRoutes)
  await app.register(v2MemoryAnalysisRoutes)
  await app.register(v2PlotArcRoutes)
  await app.register(v2PlotArcAnalysisRoutes)
  await app.register(v2ChapterRoutes)
  await app.register(v2ChapterGenerateRoutes)
  await app.register(v2ChapterAnalysisRoutes)
  await app.register(v2ChapterArchiveRoutes)
  await app.register(v2ChapterDraftsRoutes)
  await app.register(v2ProviderConfigsRoutes)
  await app.register(v2TimelineRoutes)
  await app.register(v2GraphRoutes)
  await app.register(v2LoreRoutes)
  await app.register(v2WorkerTaskRoutes)
  await app.register(v2PromptLogRoutes)
}
