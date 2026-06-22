import { readdirSync, readFileSync } from 'fs'
import { resolve } from 'path'
import type { FastifyInstance } from 'fastify'
import { loadYaml, WorkerTaskYamlSchema } from '@novel-runtime/shared'

const TASKS_DIR = resolve(process.cwd(), '../../seeds/worker-tasks')

/**
 * 从 docs/worker-tasks/*.yaml 启动导入 WorkerTask 到 DB (type='system').
 *
 * 与 runtime-profile-init 行为对称: fail-fast, 已存在 skip (改 YAML 后
 * 需手动删 DB 行才能重新导入, 防止 DB 编辑被 YAML 静默覆盖).
 *
 * workerType 枚举由 WorkerTaskYamlSchema 的 z.enum 钉死, YAML 写错直接抛.
 */
export async function initWorkerTasks(app: FastifyInstance): Promise<void> {
  let files: string[]

  try {
    files = readdirSync(TASKS_DIR).filter(f => f.endsWith('.yaml'))
  } catch (err: any) {
    throw new Error(
      `WorkerTasks directory not found: ${TASKS_DIR}. ` +
      `Create seeds/worker-tasks/*.yaml first.`
    )
  }

  if (files.length === 0) {
    throw new Error(
      `No worker-task YAML files found in ${TASKS_DIR}. ` +
      `At least one seeds/worker-tasks/*.yaml is required.`
    )
  }

  for (const file of files) {
    const filePath = resolve(TASKS_DIR, file)
    const raw = readFileSync(filePath, 'utf-8')

    const seed = loadYaml({
      text: raw,
      schema: WorkerTaskYamlSchema,
      source: file
    })

    const existing = await app.prisma.workerTask.findFirst({
      where: {
        storyId: null,
        workerType: seed.workerType
      }
    })

    if (existing) {
      // 兼容旧名称: "默认-xxx" → "[系统] xxx"
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
        enabled: seed.enabled
      }
    })

    app.log.info(`WorkerTask "${seed.name}" (${seed.workerType}) initialized from ${file}`)
  }
}
