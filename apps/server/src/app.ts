import Fastify from 'fastify'
import cors from '@fastify/cors'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import staticPlugin from '@fastify/static'
import { UPLOADS_ROOT } from './config/paths.js'
import { prismaPlugin } from './plugins/prisma.js'
import { uploadPlugin } from './plugins/upload.js'
import { healthRoutes } from './routes/health.js'
import { storyRoutes } from './routes/stories.js'
import { coverRoutes } from './routes/covers.js'
import { characterRoutes } from './routes/characters.js'
import { loreRoutes } from './routes/lore.js'
import { timelineRoutes } from './routes/timeline.js'
import { chapterRoutes } from './routes/chapters.js'
import { promptLogRoutes } from './routes/prompt-logs.js'
import { draftRoutes } from './routes/drafts.js'
import { graphRoutes } from './routes/graph.js'
import { memoryRoutes } from './routes/memories.js'
import { scoreRoutes } from './routes/scores.js'
import { runtimeProfileRoutes } from './routes/runtime-profile.js'
import { workerTaskRoutes } from './routes/worker-task.js'
import { aiProviderRoutes } from './routes/ai-provider.js'
import { initAiProviderConfig } from './services/ai-provider-init.js'
import { initRuntimeProfile } from './services/runtime-profile-init.js'
import { initWorkerTasks } from './services/worker-task-init.js'
import { createGenerateProcessor } from './services/generate-processor.js'
import { registerGenerateProcessor } from './queue/index.js'
import { v2Routes } from './routes-v2/index.js'

export async function buildApp() {
  const app = Fastify({
    logger: true
  })

  // Plugins
  await app.register(cors, { origin: true })
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'AI 小说工坊 API',
        description: 'AI 小说工坊 的 API 文档',
        version: '0.1.0'
      }
    }
  })
  await app.register(swaggerUi, { routePrefix: '/documentation' })
  await app.register(prismaPlugin)
  await app.register(uploadPlugin)

  // 暴露上传的封面图片
  await app.register(staticPlugin, {
    root: UPLOADS_ROOT,
    prefix: '/uploads/',
    decorateReply: false
  })

  // Init AI Provider config from env
  await initAiProviderConfig(app)

  // Init default Runtime Profile from JSON
  await initRuntimeProfile(app)

  // Init default Worker Tasks (global defaults)
  await initWorkerTasks(app)

  // Register queue processors
  registerGenerateProcessor(createGenerateProcessor(app))

  // Routes
  await app.register(healthRoutes, { prefix: '/api/health' })
  await app.register(storyRoutes, { prefix: '/api/stories' })
  await app.register(coverRoutes)
  await app.register(characterRoutes)
  await app.register(loreRoutes)
  await app.register(timelineRoutes)
  await app.register(chapterRoutes)
  await app.register(draftRoutes)
  await app.register(graphRoutes)
  await app.register(memoryRoutes)
  await app.register(scoreRoutes)
  await app.register(runtimeProfileRoutes)
  await app.register(workerTaskRoutes)
  await app.register(aiProviderRoutes)
  await app.register(promptLogRoutes)

  // V2 routes — 物理隔离，prefix /api/v2
  await app.register(v2Routes, { prefix: '/api/v2' })

  // Global error handler
  app.setErrorHandler((error: any, request, reply) => {
    app.log.error(error)
    reply.status(error.statusCode || 500).send({
      success: false,
      error: error.message || 'Internal Server Error'
    })
  })

  return app
}
