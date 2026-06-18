import type { FastifyInstance } from 'fastify'
import { chapterCrudRoutes } from './chapters-crud.js'
import { chapterGenerateRoutes } from './chapters-generate.js'
import { chapterArchiveRoutes } from './chapters-archive.js'
import { chapterTreeRoutes } from './chapters-tree.js'

/**
 * Barrel — register all chapter route groups in one call.
 * App.ts and tests both use `chapterRoutes(app)` for compatibility.
 * Do not add endpoint logic here; each group lives in its own chapters-*.ts file.
 */
export async function chapterRoutes(app: FastifyInstance) {
  await app.register(chapterCrudRoutes)
  await app.register(chapterGenerateRoutes)
  await app.register(chapterArchiveRoutes)
  await app.register(chapterTreeRoutes)
}