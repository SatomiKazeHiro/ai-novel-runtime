import { describe, it, expect } from 'vitest'
import {
  CHAPTER_STATUSES,
  getChapterStatus,
  getChapterPreview
} from '../chapter-status'

/**
 * CHAPTER_STATUSES 完整性保障 — 治本测试.
 *
 * 约束:
 *   1) 所有 Prisma ChapterStatus enum 值都在配置表里 (UI 不应显示 'unknown').
 *   2) 每个定义都有完整字段 (id / label / tone / order).
 *   3) tone 必须是 6 种之一 (避免漏改产生新色).
 *   4) getChapterStatus 找不到时返回中性占位.
 *   5) getChapterPreview 优先 summary, 后备 outline.
 */

const PRISMA_ENUM_VALUES = [
  'draft', 'generating', 'generated', 'scored',
  'selected', 'reviewing', 'archived', 'rejected'
]

describe('CHAPTER_STATUSES structure', () => {
  it('covers all Prisma ChapterStatus enum values', () => {
    const ids = new Set(CHAPTER_STATUSES.map(s => s.id))
    for (const v of PRISMA_ENUM_VALUES) {
      expect(ids.has(v), `missing status "${v}" — 加新 enum 时必须同步到 CHAPTER_STATUSES`).toBe(true)
    }
  })

  it('every entry has a complete shape', () => {
    for (const s of CHAPTER_STATUSES) {
      expect(typeof s.id).toBe('string')
      expect(s.id.length).toBeGreaterThan(0)
      expect(typeof s.label).toBe('string')
      expect(s.label.length).toBeGreaterThan(0)
      expect(['neutral', 'warm', 'cool', 'positive', 'review', 'error']).toContain(s.tone)
      expect(typeof s.order).toBe('number')
      expect(Number.isFinite(s.order)).toBe(true)
    }
  })

  it('ids are unique (no accidental duplicates)', () => {
    const ids = CHAPTER_STATUSES.map(s => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('order is strictly increasing (UI 排序可预期)', () => {
    const orders = CHAPTER_STATUSES.map(s => s.order)
    for (let i = 1; i < orders.length; i++) {
      expect(orders[i]).toBeGreaterThan(orders[i - 1])
    }
  })
})

describe('getChapterStatus lookup', () => {
  it('returns the matching entry by id', () => {
    const archived = getChapterStatus('archived')
    expect(archived.id).toBe('archived')
    expect(archived.label).toBe('已归档')
    expect(archived.tone).toBe('positive')
  })

  it('generating carries pulse flag (dot animation)', () => {
    const g = getChapterStatus('generating')
    expect(g.pulse).toBe(true)
  })

  it('non-generating statuses do NOT carry pulse', () => {
    const others = CHAPTER_STATUSES.filter(s => s.id !== 'generating')
    for (const s of others) {
      expect(s.pulse, `${s.id} 不应有 pulse`).toBeUndefined()
    }
  })

  it('returns neutral placeholder for unknown id (no throw)', () => {
    const u = getChapterStatus('not-a-real-status')
    expect(u.tone).toBe('neutral')
    expect(u.id).toBe('not-a-real-status')
  })

  it('returns neutral placeholder for undefined', () => {
    const u = getChapterStatus(undefined)
    expect(u.tone).toBe('neutral')
    expect(u.id).toBe('unknown')
  })
})

describe('getChapterPreview', () => {
  it('prefers summary over outline', () => {
    expect(getChapterPreview({ summary: 'A', outline: 'B' })).toBe('A')
  })

  it('falls back to outline when summary empty', () => {
    expect(getChapterPreview({ summary: '', outline: 'B' })).toBe('B')
    expect(getChapterPreview({ summary: '   ', outline: 'B' })).toBe('B')
    expect(getChapterPreview({ summary: null, outline: 'B' })).toBe('B')
    expect(getChapterPreview({ outline: 'B' })).toBe('B')
  })

  it('returns empty string when both missing', () => {
    expect(getChapterPreview({ summary: null, outline: null })).toBe('')
    expect(getChapterPreview({})).toBe('')
  })

  it('trims whitespace', () => {
    expect(getChapterPreview({ summary: '  hello  ' })).toBe('hello')
  })
})
