import dotenv from 'dotenv'
dotenv.config({ path: '../../.env' })

import { mkdirSync } from 'fs'
import { buildApp } from './app.js'
import { startWorkers } from './queue/index.js'
import { UPLOADS_ROOT } from './config/paths.js'

const PORT = Number(process.env.PORT) || 3000
const HOST = process.env.HOST || '0.0.0.0'

async function start() {
  startWorkers()
  mkdirSync(UPLOADS_ROOT, { recursive: true })
  console.log(`[uploads] directory ready: ${UPLOADS_ROOT}`)
  const app = await buildApp()
  try {
    await app.listen({ port: PORT, host: HOST })
    app.log.info(`Server listening on http://${HOST}:${PORT}`)
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}

start()
