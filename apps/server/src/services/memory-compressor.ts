import type { FastifyInstance } from 'fastify'
import { RuntimePromptCompiler } from '@novel-runtime/ai-provider'
import { cleanJsonBlock } from '@novel-runtime/shared'
import { loadRuntimeBase, loadWorkerTask } from './runtime-loader.js'
import { callAIWithLog } from './ai-call-logger.js'

const COMPRESS_INTERVAL = 5 // 每 5 章压缩一次

/**
 * 检查是否需要压缩记忆，如果需要则执行压缩
 * 策略：每完成 COMPRESS_INTERVAL 章，将之前的 chapter 记忆提炼为 global 摘要
 */
export async function maybeCompressMemories(
  app: FastifyInstance,
  storyId: string,
  versionBranchId?: string
): Promise<void> {
  const prisma = app.prisma
  const vbId = versionBranchId ?? ''

  // 1. 统计已完成（selected 或 archived）的章节数（同版本）
  const completedCount = await prisma.chapter.count({
    where: { storyId, versionBranchId: vbId, status: { in: ['selected', 'archived'] } }
  })

  // 2. 只有达到 5 的倍数时才触发（5, 10, 15...）
  if (completedCount === 0 || completedCount % COMPRESS_INTERVAL !== 0) {
    return
  }

  // 3. 检查本轮是否已压缩过（避免重复）
  const alreadyCompressed = await prisma.memory.findFirst({
    where: {
      storyId,
      layer: 'global',
      tags: { contains: 'compressed-batch' }
    },
    orderBy: { createdAt: 'desc' }
  })

  if (alreadyCompressed) {
    const batchNum = extractBatchNumber(alreadyCompressed.tags)
    const expectedBatch = Math.floor(completedCount / COMPRESS_INTERVAL)
    if (batchNum >= expectedBatch) {
      app.log.info(`[MemoryCompressor] Batch ${expectedBatch} already compressed, skipping`)
      return
    }
  }

  const batchNumber = Math.floor(completedCount / COMPRESS_INTERVAL)
  app.log.info(`[MemoryCompressor] Triggering compression batch ${batchNumber} for story ${storyId}`)

  // 4. 获取本轮待压缩的 chapter 记忆（同版本）
  const memoriesToCompress = await prisma.memory.findMany({
    where: {
      storyId,
      versionBranchId: vbId,
      layer: 'chapter',
      tags: { not: { contains: 'compressed' } }
    },
    orderBy: { createdAt: 'asc' },
    take: 100 // 限制单次处理量
  })

  if (memoriesToCompress.length === 0) {
    app.log.info('[MemoryCompressor] No chapter memories to compress')
    return
  }

  // 5. 调用 AI 压缩
  const compressed = await compressWithAI(app, storyId, memoriesToCompress)
  if (!compressed || compressed.length === 0) {
    app.log.warn('[MemoryCompressor] AI compression returned empty')
    return
  }

  // 6. 保存压缩后的 global 记忆（关联到版本）
  for (const summary of compressed) {
    await prisma.memory.create({
      data: {
        storyId,
        versionBranchId: vbId,
        layer: 'global',
        content: summary,
        tags: JSON.stringify(['compressed', 'compressed-batch', `batch-${batchNumber}`]),
        importance: 8
      }
    })
  }

  // 7. 标记原始 chapter 记忆为已压缩（而不是删除，保留溯源能力）
  const memoryIds = memoriesToCompress.map(m => m.id)
  for (const id of memoryIds) {
    const mem = await prisma.memory.findUnique({ where: { id } })
    if (mem) {
      const tags = JSON.parse(mem.tags || '[]')
      if (!tags.includes('compressed')) {
        tags.push('compressed')
      }
      await prisma.memory.update({
        where: { id },
        data: { tags: JSON.stringify(tags) }
      })
    }
  }

  app.log.info(`[MemoryCompressor] Batch ${batchNumber} done: ${memoriesToCompress.length} chapter memories -> ${compressed.length} global summaries`)
}

async function compressWithAI(
  app: FastifyInstance,
  storyId: string,
  memories: any[]
): Promise<string[]> {
  const prisma = app.prisma

  const base = await loadRuntimeBase(storyId, prisma)
  const task = await loadWorkerTask(storyId, 'memory', prisma)

  const memoryTexts = memories.map(m => m.content).join('\n---\n')

  const prompt = `请对以下章节记忆进行压缩提炼。

要求：
1. 合并同一主线剧情链上的相关事件为一个整体描述
2. 删除重复、琐碎、过渡性的信息
3. 保留：关键剧情转折、角色状态变更、重要伏笔、势力格局变化
4. 输出 3-5 条精炼的全局摘要，每条 50-100 字
5. 严格 JSON 数组格式，不要 markdown 代码块

原始记忆：
${memoryTexts.slice(0, 12000)}`

  try {
    const compiler = new RuntimePromptCompiler()
    const compiled = compiler.compile(base, task, prompt)

    const raw = await callAIWithLog(app, {
      storyId, callType: 'compress',
      compiled, temperature: 0.3, maxTokens: 2048
    })
    if (!raw) {
      app.log.warn('[MemoryCompressor] No provider or AI call failed, falling back to simple merge')
      return simpleMerge(memories)
    }

    const result: string[] = JSON.parse(cleanJsonBlock(raw))
    return result.slice(0, 5)
  } catch (err: any) {
    app.log.error(`[MemoryCompressor] AI compression failed: ${err.message}`)
    return simpleMerge(memories)
  }
}

function simpleMerge(memories: any[]): string[] {
  // 降级方案：按标签分组，合并同类记忆
  const mainPlots = memories.filter(m => m.tags?.includes('main-plot')).map(m => m.content)
  const others = memories.filter(m => !m.tags?.includes('main-plot')).map(m => m.content)

  const results: string[] = []
  if (mainPlots.length > 0) {
    results.push(`主线剧情：${mainPlots.slice(0, 3).join('；')}`)
  }
  if (others.length > 0) {
    results.push(`其他事件：${others.slice(0, 3).join('；')}`)
  }
  return results
}

function extractBatchNumber(tagsJson: string): number {
  try {
    const tags = JSON.parse(tagsJson || '[]')
    const batchTag = tags.find((t: string) => t.startsWith('batch-'))
    if (batchTag) {
      return parseInt(batchTag.replace('batch-', ''), 10) || 0
    }
  } catch {}
  return 0
}
