/**
 * AI 调用日志 — 类型 / 状态映射单一配置源.
 *
 * 仿 chapter-status.ts 模式: 章节工作台的状态机有 6-tone 映射,
 * AI 调用日志的 callType + callStatus 也应该有同一套配置表.
 * 避免各组件 (列表行 / 详情弹窗 / 过滤下拉) 各自维护映射, 漏改导致
 * UI 显示 'unknown' 或英文残留.
 *
 * 字段语义:
 *   id     Prisma 字段值 (PromptLog.callType / PromptLog.status)
 *   label  中文显示名 (去除英文前缀, 配置表已经够紧凑)
 *   tone   视觉色调, 复用 ChapterTone (6 色板)
 *   order  UI 排序权重 (供 filter 下拉排序)
 *
 * 同步约束:
 *   - 加新 callType 时, 必须同时改 Prisma schema + 后端写入处 + 此处
 *   - vitest (prompt-log-types.spec.ts) 钉死 schema 值完整性, 自动触发断言
 */

import type { ChapterTone } from './chapter-status'

export interface CallTypeDef {
  id: string
  label: string
  tone: ChapterTone
  order: number
}

export interface CallStatusDef {
  id: string
  label: string
  tone: ChapterTone
}

export const CALL_TYPES: CallTypeDef[] = [
  { id: 'generate',         label: '章节生成', tone: 'warm',    order: 10 },
  { id: 'memory_extract',   label: '记忆提取', tone: 'cool',    order: 20 },
  { id: 'graph_extract',    label: '图谱提取', tone: 'cool',    order: 30 },
  { id: 'plot_extract',     label: '弧线提取', tone: 'cool',    order: 40 },
  { id: 'combined_extract', label: '合并提取', tone: 'review',  order: 50 },
  { id: 'compress',         label: '记忆压缩', tone: 'neutral', order: 60 },
]

export const CALL_STATUSES: CallStatusDef[] = [
  { id: 'success', label: '成功', tone: 'positive' },
  { id: 'error',   label: '失败', tone: 'error' },
]

const TYPE_BY_ID = new Map(CALL_TYPES.map(t => [t.id, t]))
const STATUS_BY_ID = new Map(CALL_STATUSES.map(s => [s.id, s]))

/**
 * 查 callType; 找不到时返回 neutral 占位 (不抛错).
 * 为什么不抛: 类型 chip 是辅助元素, 不应让一个未知值把整行 UI 炸掉.
 */
export function getCallType(id?: string): CallTypeDef {
  if (id && TYPE_BY_ID.has(id)) return TYPE_BY_ID.get(id)!
  return { id: id || 'unknown', label: id || '未知', tone: 'neutral', order: 999 }
}

/**
 * 查 callStatus; 找不到时返回 neutral 占位.
 */
export function getCallStatus(id?: string): CallStatusDef {
  if (id && STATUS_BY_ID.has(id)) return STATUS_BY_ID.get(id)!
  return { id: id || 'unknown', label: id || '未知', tone: 'neutral' }
}
