import { describe, it, expect } from 'vitest'
import {
  CALL_TYPES,
  CALL_STATUSES,
  getCallType,
  getCallStatus
} from '../prompt-log-types'

/**
 * CALL_TYPES / CALL_STATUSES 完整性保障 — 治本测试.
 *
 * 约束:
 *   1) 所有 Prisma PromptLog.callType enum 值都在配置表里
 *      (schema 注释: generate | memory_extract | graph_extract |
 *       plot_extract | combined_extract | compress)
 *   2) 所有 Prisma PromptLog.status enum 值都在配置表里
 *      (schema 注释: success | error)
 *   3) 每个定义都有完整字段 (id / label / tone / order).
 *   4) tone 必须是 6 种 ChapterTone 之一.
 *   5) ids 唯一, order 严格递增.
 *   6) getCallType / getCallStatus 找不到时返回中性占位, 不抛.
 */

const PRISMA_CALL_TYPE_VALUES = [
  'generate',
  'character_stage',
  'memory_stage',
  'memory_optimize',
  'graph_extract_stage',
  'cumulative_dedup',
  'plot_consolidate',
  'score'
]

const PRISMA_CALL_STATUS_VALUES = ['success', 'error']

const VALID_TONES = ['neutral', 'warm', 'cool', 'positive', 'review', 'error']

describe('CALL_TYPES structure', () => {
  it('covers all Prisma PromptLog.callType enum values', () => {
    const ids = new Set(CALL_TYPES.map(t => t.id))
    for (const v of PRISMA_CALL_TYPE_VALUES) {
      expect(ids.has(v), `missing callType "${v}" — 加新 callType 时必须同步到 CALL_TYPES`).toBe(true)
    }
  })

  it('every entry has a complete shape', () => {
    for (const t of CALL_TYPES) {
      expect(typeof t.id).toBe('string')
      expect(t.id.length).toBeGreaterThan(0)
      expect(typeof t.label).toBe('string')
      expect(t.label.length).toBeGreaterThan(0)
      expect(VALID_TONES).toContain(t.tone)
      expect(typeof t.order).toBe('number')
      expect(Number.isFinite(t.order)).toBe(true)
    }
  })

  it('ids are unique (no accidental duplicates)', () => {
    const ids = CALL_TYPES.map(t => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('order is strictly increasing (filter 下拉排序可预期)', () => {
    const orders = CALL_TYPES.map(t => t.order)
    for (let i = 1; i < orders.length; i++) {
      expect(orders[i]).toBeGreaterThan(orders[i - 1])
    }
  })

  it('labels are all Chinese (no English in display name)', () => {
    for (const t of CALL_TYPES) {
      // 检查不含 ASCII 字母 (避免漏配中英文)
      expect(t.label, `${t.id} label "${t.label}" 包含英文, 应使用纯中文`).not.toMatch(/[a-zA-Z]/)
    }
  })
})

describe('CALL_STATUSES structure', () => {
  it('covers all Prisma PromptLog.status enum values', () => {
    const ids = new Set(CALL_STATUSES.map(s => s.id))
    for (const v of PRISMA_CALL_STATUS_VALUES) {
      expect(ids.has(v), `missing callStatus "${v}" — 加新 status 时必须同步到 CALL_STATUSES`).toBe(true)
    }
  })

  it('every entry has a complete shape', () => {
    for (const s of CALL_STATUSES) {
      expect(typeof s.id).toBe('string')
      expect(s.id.length).toBeGreaterThan(0)
      expect(typeof s.label).toBe('string')
      expect(s.label.length).toBeGreaterThan(0)
      expect(VALID_TONES).toContain(s.tone)
    }
  })

  it('ids are unique (no accidental duplicates)', () => {
    const ids = CALL_STATUSES.map(s => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('getCallType lookup', () => {
  it('returns the matching entry by id', () => {
    const generate = getCallType('generate')
    expect(generate.id).toBe('generate')
    expect(generate.label).toBe('章节生成')
    expect(generate.tone).toBe('warm')
  })

  it('cumulative_dedup uses neutral tone', () => {
    expect(getCallType('cumulative_dedup').tone).toBe('neutral')
  })

  it('returns neutral placeholder for unknown id (no throw)', () => {
    const u = getCallType('not-a-real-call-type')
    expect(u.tone).toBe('neutral')
    expect(u.id).toBe('not-a-real-call-type')
  })

  it('returns neutral placeholder for undefined', () => {
    const u = getCallType(undefined)
    expect(u.tone).toBe('neutral')
    expect(u.id).toBe('unknown')
    expect(u.label).toBe('未知')
  })

  it('memory_organize (历史漂移值) fallback to unknown — 不再混入下拉', () => {
    const u = getCallType('memory_organize')
    expect(u.tone).toBe('neutral')
    expect(u.label).toBe('memory_organize')
  })
})

describe('getCallStatus lookup', () => {
  it('returns the matching entry by id', () => {
    const success = getCallStatus('success')
    expect(success.id).toBe('success')
    expect(success.label).toBe('成功')
    expect(success.tone).toBe('positive')
  })

  it('error uses error tone', () => {
    expect(getCallStatus('error').tone).toBe('error')
  })

  it('returns neutral placeholder for unknown id (no throw)', () => {
    const u = getCallStatus('pending')
    expect(u.tone).toBe('neutral')
    expect(u.id).toBe('pending')
  })

  it('returns neutral placeholder for undefined', () => {
    const u = getCallStatus(undefined)
    expect(u.tone).toBe('neutral')
    expect(u.id).toBe('unknown')
  })
})
