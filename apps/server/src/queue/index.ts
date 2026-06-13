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

// 处理器注册（同时支持 MemoryQueue 和 BullQueue Worker）
let generateProcessor: Function | null = null

export function registerGenerateProcessor(fn: Function) {
  generateProcessor = fn
  // 内存队列：直接绑定 handler
  if (!redis) {
    (generateQueue as MemoryQueue).on('generate-chapter', fn)
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
    if (!generateProcessor) {
      throw new Error('Generate processor not registered')
    }
    return await generateProcessor(job)
  }, { connection: redis })

  return { generateWorker }
}
