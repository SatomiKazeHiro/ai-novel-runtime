import { Queue as BullQueue, Worker as BullWorker, type Job } from 'bullmq'
import IORedis from 'ioredis'

let redis: any = null

async function createRedisConnection(): Promise<any> {
  const client = new (IORedis as any)(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
    lazyConnect: true,
    connectTimeout: 2000,
    retryStrategy: () => null
  })
  client.on('error', () => { /* ignore connection errors */ })
  try {
    await client.connect()
    await client.ping()
    console.log('Redis connected')
    return client
  } catch {
    await client.disconnect()
    console.log('Redis not available, using in-memory queue fallback')
    return null
  }
}

redis = await createRedisConnection()

// In-memory fallback
class MemoryQueue {
  name: string
  jobs: Map<string, any> = new Map()
  handlers: Map<string, Function> = new Map()
  constructor(name: string) { this.name = name }
  async add(name: string, data: any, opts?: any) {
    const id = `mem-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const job = { id, name, data, opts, progress: 0, state: 'waiting' }
    this.jobs.set(id, job)
    setTimeout(() => this.processJob(job), 100)
    return job
  }
  async processJob(job: any) {
    job.state = 'active'
    const handler = this.handlers.get(job.name)
    if (handler) {
      try {
        await handler(job)
        job.state = 'completed'
      } catch (e) {
        job.state = 'failed'
        job.failedReason = String(e)
        console.error(`[Queue:${this.name}] Job failed:`, e)
      }
    } else {
      console.warn(`[Queue:${this.name}] No handler registered for job type: ${job.name}`)
    }
  }
  on(event: string, handler: Function) {
    this.handlers.set(event, handler)
  }
  async getJob(id: string) { return this.jobs.get(id) }
}

export const generateQueue = redis
  ? new BullQueue('generate', { connection: redis })
  : new MemoryQueue('generate') as any

export const scoreQueue = redis
  ? new BullQueue('score', { connection: redis })
  : new MemoryQueue('score') as any

export const memoryQueue = redis
  ? new BullQueue('memory', { connection: redis })
  : new MemoryQueue('memory') as any

// 处理器注册（同时支持 MemoryQueue 和 BullQueue Worker）
let generateProcessor: Function | null = null
let scoreProcessor: Function | null = null
let memoryProcessor: Function | null = null

export function registerGenerateProcessor(fn: Function) {
  generateProcessor = fn
  // 内存队列：直接绑定 handler
  if (!redis) {
    (generateQueue as MemoryQueue).on('generate-chapter', fn)
  }
}

export function registerScoreProcessor(fn: Function) {
  scoreProcessor = fn
  if (!redis) {
    (scoreQueue as MemoryQueue).on('score-draft', fn)
  }
}

export function registerMemoryProcessor(fn: Function) {
  memoryProcessor = fn
  if (!redis) {
    (memoryQueue as MemoryQueue).on('update-memory', fn)
  }
}

// Workers
export function startWorkers() {
  if (!redis) {
    // MemoryQueue processes inline via registered handlers
    return
  }

  const generateWorker = new BullWorker('generate', async (job: Job) => {
    console.log('Processing generate job', job.id, job.data)
    if (generateProcessor) {
      return await generateProcessor(job)
    }
    await new Promise(r => setTimeout(r, 2000))
    return { draftId: 'placeholder' }
  }, { connection: redis })

  const scoreWorker = new BullWorker('score', async (job: Job) => {
    console.log('Processing score job', job.id)
    if (scoreProcessor) {
      return await scoreProcessor(job)
    }
    await new Promise(r => setTimeout(r, 1000))
    return { score: 85 }
  }, { connection: redis })

  const memoryWorker = new BullWorker('memory', async (job: Job) => {
    console.log('Processing memory job', job.id)
    if (memoryProcessor) {
      return await memoryProcessor(job)
    }
    await new Promise(r => setTimeout(r, 500))
    return { updated: true }
  }, { connection: redis })

  return { generateWorker, scoreWorker, memoryWorker }
}
