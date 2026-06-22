/**
 * 章节状态机 — 单一配置源.
 *
 * Reason: 章节工作台 / 章节图 / 章节编辑器顶部状态徽章 / 知识图谱的章节
 * 选择器 (ChapterReel) / 新的阅读页都要展示 ChapterStatus, 如果各组件
 * 自行维护映射, 新增一个状态 (如 'scored') 就得四处改, 极易漏改导致 UI
 * 显示 'unknown' 或 'draft · 草稿' 这种 placeholder.
 *
 * 字段语义:
 *   id     Prisma enum 值 (ChapterStatus), 'failed' 是历史兼容项
 *   label  中文显示名 (去除英文前缀, 配置表已经够紧凑, 标题旁不重复英文)
 *   tone   视觉色调, 见 ChapterTone 注释
 *   pulse  true = 在 dot 上加脉冲动画, 仅用于 'generating'
 *   order  UI 排序权重 (供未来排序, 不在 UI 强制生效)
 *
 * 同步约束:
 *   - 加新 enum 值时, 必须同时改 Prisma schema + 后端写入处 + 此处, 然后
 *     vitest (chapter-status.spec.ts) 钉死的 key 完整性会自动触发断言.
 */

export type ChapterTone =
  | 'neutral'   // 默认灰 (草稿)
  | 'warm'      // 暖色 terracotta (生成中)
  | 'cool'      // 链接色 (已选 / 已评分)
  | 'positive'  // sage (已生成 / 已归档)
  | 'review'    // 紫 (审阅中)
  | 'error'     // 失败 / 驳回

export interface ChapterStatusDef {
  id: string
  label: string
  tone: ChapterTone
  pulse?: boolean
  order: number
}

export const CHAPTER_STATUSES: ChapterStatusDef[] = [
  { id: 'draft',      label: '草稿',   tone: 'neutral',  order: 10 },
  { id: 'generating', label: '生成中', tone: 'warm',     pulse: true, order: 20 },
  { id: 'generated',  label: '已生成', tone: 'positive', order: 30 },
  { id: 'scored',     label: '已评分', tone: 'cool',     order: 35 },
  { id: 'selected',   label: '已选',   tone: 'cool',     order: 40 },
  { id: 'reviewing',  label: '审阅中', tone: 'review',   order: 50 },
  { id: 'archived',   label: '已归档', tone: 'positive', order: 60 },
  { id: 'rejected',   label: '驳回',   tone: 'error',    order: 70 },
  // defensive fallback: Prisma schema 未声明, 但 ChapterBranchTree 旧代码
  // 曾用, 留作防御. 后端 generate-processor 写的是 Draft.status='failed',
  // 不影响 Chapter, 但 UI 仍以 neutral 兜底, 避免 'unknown' 显示.
  { id: 'failed',     label: '失败',   tone: 'error',    order: 75 },
]

const STATUS_BY_ID = new Map(CHAPTER_STATUSES.map(s => [s.id, s]))

/**
 * 查表: 找不到时返回 neutral 占位 (不抛错), 调用方渲染不会断.
 * 为什么不抛: 状态徽章是辅助元素, 不应让一个未知值把整行 UI 炸掉.
 */
export function getChapterStatus(id?: string): ChapterStatusDef {
  if (id && STATUS_BY_ID.has(id)) return STATUS_BY_ID.get(id)!
  return { id: id || 'unknown', label: id || '未知', tone: 'neutral', order: 999 }
}

/** 取章节预览文本 (摘要 → 大纲), 找不到返回空串. */
export function getChapterPreview(node: { summary?: string | null; outline?: string | null }): string {
  return (node.summary?.trim() || node.outline?.trim() || '')
}
