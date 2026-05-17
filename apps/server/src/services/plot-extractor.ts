import type { FastifyInstance } from 'fastify'
import { createProvider, RuntimePromptCompiler } from '@novel-runtime/ai-provider'
import { loadRuntimeBase, loadWorkerTask } from './runtime-loader.js'

export interface PlotArcAnalysis {
  arcs: Array<{
    name: string
    type: 'main' | 'side'
    status: 'pending' | 'active' | 'resolving' | 'completed'
    progress: number // 0-100
    currentStage: string
    nextGoal: string
    unresolved: string[]
    summary: string
  }>
}

/**
 * 分析章节内容，提取/更新剧情弧线
 */
export async function extractPlotArcs(
  app: FastifyInstance,
  storyId: string,
  chapterId: string,
  content: string,
  outline?: string
): Promise<PlotArcAnalysis | null> {
  const prisma = app.prisma

  // 1. 获取现有弧线
  const existingArcs = await prisma.plotArc.findMany({
    where: { storyId },
    orderBy: { updatedAt: 'desc' }
  })

  // 2. 获取 AI Provider
  const aiConfig = await prisma.aiProviderConfig.findFirst({ where: { isDefault: true } })
  const provider = aiConfig
    ? createProvider({
        name: aiConfig.name,
        apiKey: aiConfig.apiKey || undefined,
        baseUrl: aiConfig.baseUrl || undefined,
        model: aiConfig.model,
        maxTokens: aiConfig.maxTokens,
        temperature: aiConfig.temperature
      })
    : null

  if (!provider?.generateWithRuntime) {
    app.log.warn('[PlotExtractor] No provider configured, skipping plot arc extraction')
    return null
  }

  // 3. 构建提示
  const existingArcsText = existingArcs.length > 0
    ? existingArcs.map(a => {
        const stages = JSON.parse(a.stages || '[]')
        return `- ${a.name} (${a.type}, ${a.status}, 进度${a.progress}%): 当前阶段「${a.currentStage || '未知'}」, 下一目标「${a.nextGoal || '未知'}」`
      }).join('\n')
    : '暂无已追踪的剧情弧线'

  const extractPrompt = `请分析以下玄幻修仙小说章节，提取或更新剧情弧线（Plot Arc）。

分析原则：
1. 如果章节推进了某个已有弧线，更新其进度和阶段
2. 如果章节开启了全新剧情线，创建新弧线
3. 区分主线（推动整体故事）和支线（角色个人线/旁支）
4. 标注未解悬念（成昆逃去哪了？赵敏下一步做什么？）

现有弧线：
${existingArcsText}

章节大纲：${outline || '无大纲'}

章节内容（前5000字）：
${content.slice(0, 5000)}

返回严格 JSON，不要 markdown：
{
  "arcs": [
    {
      "name": "光明顶之战",
      "type": "main",
      "status": "active",
      "progress": 65,
      "currentStage": "六派车轮战殷天正，张无忌尚未出手",
      "nextGoal": "张无忌使用乾坤大挪移击败六派代表",
      "unresolved": ["成昆的真实去向", "赵敏在暗中谋划什么"],
      "summary": "六大门派围攻光明顶，明教高手尽失，仅剩白眉鹰王苦战"
    }
  ]
}`

  try {
    const base = await loadRuntimeBase(storyId, prisma)
    const task = await loadWorkerTask(storyId, 'memory', prisma)

    const compiler = new RuntimePromptCompiler()
    const compiled = compiler.compile(base, task, extractPrompt)

    const raw = await provider.generateWithRuntime(compiled, {
      temperature: 0.3,
      maxTokens: 2048
    })

    const jsonStr = raw.replace(/```json\s*/g, '').replace(/```\s*$/g, '').trim()
    const result: PlotArcAnalysis = JSON.parse(jsonStr)

    // 4. 保存到数据库
    for (const arc of result.arcs || []) {
      const existing = await prisma.plotArc.findFirst({
        where: { storyId, name: arc.name }
      })

      const stages = existing
        ? JSON.parse(existing.stages || '[]')
        : []

      // 如果当前阶段是新的，添加到 stages 列表
      if (arc.currentStage && !stages.some((s: any) => s.stage === arc.currentStage)) {
        stages.push({ stage: arc.currentStage, completed: arc.status === 'completed', description: arc.summary })
      }

      const data = {
        type: arc.type,
        status: arc.status,
        progress: arc.progress,
        stages: JSON.stringify(stages),
        currentStage: arc.currentStage,
        nextGoal: arc.nextGoal,
        unresolved: JSON.stringify(arc.unresolved || []),
        summary: arc.summary
      }

      if (existing) {
        await prisma.plotArc.update({ where: { id: existing.id }, data })
        app.log.info(`[PlotExtractor] Updated arc: ${arc.name} -> ${arc.status} ${arc.progress}%`)
      } else {
        await prisma.plotArc.create({
          data: {
            storyId,
            name: arc.name,
            ...data
          }
        })
        app.log.info(`[PlotExtractor] Created new arc: ${arc.name}`)
      }
    }

    return result
  } catch (err: any) {
    app.log.error(`[PlotExtractor] Failed: ${err.message}`)
    return null
  }
}

/**
 * 获取当前活跃（进行中/待收尾）的剧情弧线，用于注入 Prompt
 */
export async function getActivePlotArcs(
  prisma: any,
  storyId: string
): Promise<string> {
  const arcs = await prisma.plotArc.findMany({
    where: {
      storyId,
      status: { in: ['active', 'resolving', 'pending'] }
    },
    orderBy: [
      { type: 'asc' }, // main 在前
      { progress: 'desc' }
    ]
  })

  if (arcs.length === 0) return ''

  const lines = arcs.map((a: any) => {
    const unresolved = JSON.parse(a.unresolved || '[]')
    let text = `[${a.type === 'main' ? '主线' : '支线'}] ${a.name}（进度${a.progress}%）\n  当前：${a.currentStage || '未知'}\n  目标：${a.nextGoal || '待定'}`
    if (unresolved.length > 0) {
      text += `\n  悬念：${unresolved.join('、')}`
    }
    return text
  })

  return lines.join('\n\n')
}
