/**
 * Timeline position 编码 (单点真源)
 *
 * 数据库存的是单精度浮点数,含义:
 *   - 整数位 = 年 (正数=纪元后, 负数=纪元前, 0=无意义)
 *   - 小数位 = 5 位 DDDHH (年内第 1-365 天 + 0-23 时)
 *
 * 例:
 *   1.00106  → 第 1 年第 1 天 06 时
 *   1.10012  → 第 1 年第 100 天 12 时
 *   1.36522  → 第 1 年第 365 天 22 时
 *  -2.05018  → 前 2 年第 50 天 18 时
 *
 * 设计动机 (见 docs/superpowers/specs/2026-06-26-timeline-position-encoding-completion-design.md §0.2):
 *   旧版 `day: int` 只能存年内顺序, 跨章对比要先取 `chapterNumber`
 *   再换算。新版让数据库里 position 本身就能排序、对比、筛选,
 *   SQL 侧 `ORDER BY position ASC` 直接给出时序结果。
 *
 * 调用边界:
 *   - server 端 (chapters-generate / chapters-archive / timeline route):
 *     用 `formatTimelinePosition` 渲染 prompt + 响应
 *   - web 端 (Timeline.vue / ReviewingPanel.vue): 也用同一个函数
 *     (从 `@ai-novel-runtime/shared` 导入),避免重复实现漂移
 *   - 数据库写入:用 `encodeTimelinePosition(year, day, hour)` 校验
 *     后再 `Prisma.timelineEvent.create({position})`,不在 raw 数值
 *     上手算(避免浮点误差)
 */

export interface TimelinePositionParts {
  year: number
  day: number  // 1-365 (或 1-366 平年不考虑,闰年允许但 current decoder 不校验)
  hour: number // 0-23
}

const DAY_MIN = 1
const DAY_MAX = 365
const HOUR_MIN = 0
const HOUR_MAX = 23

/**
 * 把 year / day / hour 编码成 Y.DDDHH 浮点数。
 * 入参越界返回 null,不在异常路径上抛 — 让 caller 决定怎么处理(记日志、丢弃、回退)。
 */
export function encodeTimelinePosition(year: number, day: number, hour: number): number | null {
  if (!Number.isInteger(year)) return null
  if (!Number.isInteger(day) || day < DAY_MIN || day > DAY_MAX) return null
  if (!Number.isInteger(hour) || hour < HOUR_MIN || hour > HOUR_MAX) return null

  const sign = year < 0 ? -1 : 1
  const absYear = Math.abs(year)
  // 5 位小数:DDD (3 位 0-pad) + HH (2 位 0-pad)
  const fraction = (day * 100 + hour) / 100000
  return sign * (absYear + fraction)
}

/**
 * 解析 Y.DDDHH 浮点数回 year / day / hour。
 * 入参非法 (NaN / 非有限数) 返回 null。
 * 解析规则:
 *   - 整数位 = year (含负号语义)
 *   - 小数位必须恰好 5 位有效数字 (DDDHH),其余位数用 0 补齐
 *   - day 必须在 [1, 365] (年边界超 365 一律 clamp 到 365)
 *   - hour 必须在 [0, 23] (越界 clamp 到 0)
 */
export function decodeTimelinePosition(position: number): TimelinePositionParts | null {
  if (!Number.isFinite(position)) return null

  const sign = position < 0 ? -1 : 1
  const abs = Math.abs(position)
  const [intPart, decPart = ''] = abs.toString().split('.')
  const year = parseInt(intPart, 10)
  if (!Number.isFinite(year)) return null

  // 把小数位 0-pad 到 5 位
  const padded = (decPart + '00000').slice(0, 5)
  const day = parseInt(padded.slice(0, 3), 10)
  const hour = parseInt(padded.slice(3, 5), 10)

  return {
    year: sign * year,
    day: Math.min(DAY_MAX, Math.max(DAY_MIN, day)),
    hour: Math.min(HOUR_MAX, Math.max(HOUR_MIN, hour))
  }
}

/**
 * 渲染 position 为人类可读字符串,跟旧 day/Int 字段的"第 N 天"语法兼容。
 *   1.00106 → "第1年第1天 06时"
 *  -2.05018 → "前2年第50天 18时"
 */
export function formatTimelinePosition(position: number): string {
  const parts = decodeTimelinePosition(position)
  if (!parts) return `位置 ${position}`

  // 负年用 "前 N 年",正年用 "第 N 年"
  const absYear = Math.abs(parts.year)
  const yearLabel = parts.year < 0 ? `前${absYear}年` : `第${absYear}年`
  const hh = String(parts.hour).padStart(2, '0')
  return `${yearLabel}第${parts.day}天 ${hh}时`
}

/**
 * 校验 position 是否合法 Y.DDDHH 编码。
 * 用途:server 写库前 / ReviewingPanel 回写前 / AI 返回后 sanitize。
 * 不抛 — 返回 boolean + 错误消息字符串便于 caller 上报。
 */
export function validateTimelinePosition(
  position: unknown
): { ok: true } | { ok: false; reason: string } {
  if (typeof position !== 'number' || !Number.isFinite(position)) {
    return { ok: false, reason: 'position 必须是有限数字' }
  }
  const parts = decodeTimelinePosition(position)
  if (!parts) return { ok: false, reason: 'position 无法解析为 Y.DDDHH' }
  if (parts.day < DAY_MIN || parts.day > DAY_MAX) {
    return { ok: false, reason: `day 越界 (${parts.day}, 应在 1-${DAY_MAX})` }
  }
  if (parts.hour < HOUR_MIN || parts.hour > HOUR_MAX) {
    return { ok: false, reason: `hour 越界 (${parts.hour}, 应在 ${HOUR_MIN}-${HOUR_MAX})` }
  }
  return { ok: true }
}