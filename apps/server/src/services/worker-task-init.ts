import { HARDCODED_TASK_DEFAULTS } from '../setting.js'
import type { FastifyInstance } from 'fastify'


interface WorkerTaskSeed {
  name: string
  workerType: string
  taskPrompt: string
}

const DEFAULT_WORKER_TASKS: WorkerTaskSeed[] = [
  {
    name: '[系统] 章节生成',
    workerType: 'generation',
    taskPrompt: HARDCODED_TASK_DEFAULTS.generation
  },
  {
    name: '[系统] 内容评分',
    workerType: 'scoring',
    taskPrompt: HARDCODED_TASK_DEFAULTS.scoring
  },
  {
    name: '[系统] 记忆提取',
    workerType: 'memory',
    taskPrompt: HARDCODED_TASK_DEFAULTS.memory
  },
  {
    name: '[系统] 图谱提取',
    workerType: 'graph',
    taskPrompt: HARDCODED_TASK_DEFAULTS.graph
  },
  {
    name: '[系统] 时间线提取',
    workerType: 'timeline',
    taskPrompt: HARDCODED_TASK_DEFAULTS.timeline
  },
  {
    name: '[系统] 改写润色',
    workerType: 'rewrite',
    taskPrompt: HARDCODED_TASK_DEFAULTS.rewrite
  }
]

export async function initWorkerTasks(app: FastifyInstance) {
  for (const seed of DEFAULT_WORKER_TASKS) {
    const existing = await app.prisma.workerTask.findFirst({
      where: {
        storyId: null,
        workerType: seed.workerType
      }
    })

    if (existing) {
      // 迁移：旧名称前缀从 "默认-" 改为 "[系统] "
      if (existing.name && existing.name.startsWith('默认-')) {
        await app.prisma.workerTask.update({
          where: { id: existing.id },
          data: { name: seed.name }
        })
        app.log.info(`WorkerTask "${seed.name}" (${seed.workerType}) name migrated`)
      } else {
        app.log.info(`WorkerTask "${seed.name}" (${seed.workerType}) already exists, skipping`)
      }
      continue
    }

    await app.prisma.workerTask.create({
      data: {
        storyId: null,
        type: 'system',
        name: seed.name,
        workerType: seed.workerType,
        taskPrompt: seed.taskPrompt,
        enabled: true
      }
    })

    app.log.info(`WorkerTask "${seed.name}" (${seed.workerType}) initialized`)
  }
}
