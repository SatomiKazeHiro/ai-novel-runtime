/**
 * 章节状态机 — 单一配置源.
 *
 * Reason: 章节工作台 / 章节图 / 章节编辑器顶部状态徽章 / 知识图谱的章节
 * 选择器 (ChapterReel) / 新的阅读页都要展示 ChapterStatus, 如果各组件
 * 自行维护映射, 就得四处改, 极易漏改导致 UI 显示 'unknown' placeholder.
 *
 * v2 状态机只有 3 值: draft / reviewing / archived (draft.status 6 值与此正交).
 *
 * 字段语义:
 *   id     Prisma enum 值 (ChapterStatus)
 *   label  中文显示名 (去除英文前缀, 配置表已经够紧凑, 标题旁不重复英文)
 *   tone   视觉色调, 见 ChapterTone 注释
 *   order  UI 排序权重 (供未来排序, 不在 UI 强制生效)
 */

export type ChapterTone =
  | 'neutral'   // 默认灰 (草稿)
  | 'warm'      // 暖色 terracotta
  | 'cool'      // 链接色
  | 'positive'  // sage (已归档)
  | 'review'    // 紫 (审阅中)
  | 'error'     // 错误

export interface ChapterStatusDef {
  id: string
  label: string
  tone: ChapterTone
  order: number
}

export const CHAPTER_STATUSES: ChapterStatusDef[] = [
  { id: 'draft',      label: '草稿',   tone: 'neutral',  order: 10 },
  { id: 'reviewing',  label: '审阅中', tone: 'review',   order: 50 },
  { id: 'archived',   label: '已归档', tone: 'positive', order: 60 },
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
