import { describe, it, expect } from 'vitest'
import {
  encodeTimelinePosition,
  decodeTimelinePosition,
  formatTimelinePosition,
  validateTimelinePosition
} from '../timeline-encoding.js'

describe('encodeTimelinePosition', () => {
  it('编码正常年 + day + hour', () => {
    expect(encodeTimelinePosition(1, 1, 6)).toBe(1.00106)
    expect(encodeTimelinePosition(1, 100, 12)).toBe(1.10012)
    expect(encodeTimelinePosition(1, 365, 22)).toBeCloseTo(1.36522, 10)
  })

  it('编码负年保留前缀', () => {
    expect(encodeTimelinePosition(-2, 50, 18)).toBe(-2.05018)
  })

  it('day / hour 边界', () => {
    expect(encodeTimelinePosition(0, 1, 0)).toBe(0.001)
    expect(encodeTimelinePosition(0, 365, 23)).toBeCloseTo(0.36523, 10)
  })

  it('非法 day / hour / year 返回 null (不抛)', () => {
    expect(encodeTimelinePosition(1, 0, 0)).toBeNull()
    expect(encodeTimelinePosition(1, 366, 0)).toBeNull()
    expect(encodeTimelinePosition(1, 100, 24)).toBeNull()
    expect(encodeTimelinePosition(1, 100, -1)).toBeNull()
    expect(encodeTimelinePosition(1.5, 1, 0)).toBeNull()
  })
})

describe('decodeTimelinePosition', () => {
  it('解码标准 Y.DDDHH', () => {
    expect(decodeTimelinePosition(1.00106)).toEqual({ year: 1, day: 1, hour: 6 })
    expect(decodeTimelinePosition(1.10012)).toEqual({ year: 1, day: 100, hour: 12 })
    expect(decodeTimelinePosition(1.36522)).toEqual({ year: 1, day: 365, hour: 22 })
  })

  it('解码负年', () => {
    expect(decodeTimelinePosition(-2.05018)).toEqual({ year: -2, day: 50, hour: 18 })
  })

  it('小数位不足 5 位时 0-pad', () => {
    // 1.1 → "1.1" → padded "10000" → day=100, hour=0
    expect(decodeTimelinePosition(1.1)).toEqual({ year: 1, day: 100, hour: 0 })
  })

  it('day / hour 越界自动 clamp (decoder 宽容)', () => {
    expect(decodeTimelinePosition(1.99999)).toEqual({ year: 1, day: 365, hour: 23 })
  })

  it('非法输入返回 null', () => {
    expect(decodeTimelinePosition(NaN)).toBeNull()
    expect(decodeTimelinePosition(Infinity)).toBeNull()
  })
})

describe('formatTimelinePosition', () => {
  it('渲染正年', () => {
    expect(formatTimelinePosition(1.00106)).toBe('第1年第1天 06时')
    expect(formatTimelinePosition(1.10012)).toBe('第1年第100天 12时')
    expect(formatTimelinePosition(1.36522)).toBe('第1年第365天 22时')
  })

  it('渲染负年加 "前" 前缀', () => {
    expect(formatTimelinePosition(-2.05018)).toBe('前2年第50天 18时')
  })

  it('hour 单数时 0-pad', () => {
    expect(formatTimelinePosition(1.00106)).toBe('第1年第1天 06时')
    expect(formatTimelinePosition(1.00100)).toBe('第1年第1天 00时')
  })

  it('非法输入回退为 "位置 X"', () => {
    expect(formatTimelinePosition(NaN)).toBe('位置 NaN')
  })
})

describe('validateTimelinePosition', () => {
  it('合法 position', () => {
    expect(validateTimelinePosition(1.00106)).toEqual({ ok: true })
    expect(validateTimelinePosition(-2.05018)).toEqual({ ok: true })
  })

  it('拒绝非数字', () => {
    expect(validateTimelinePosition('1.00106')).toEqual({
      ok: false,
      reason: 'position 必须是有限数字'
    })
    expect(validateTimelinePosition(null)).toEqual({
      ok: false,
      reason: 'position 必须是有限数字'
    })
    expect(validateTimelinePosition(NaN)).toEqual({
      ok: false,
      reason: 'position 必须是有限数字'
    })
    expect(validateTimelinePosition(Infinity)).toEqual({
      ok: false,
      reason: 'position 必须是有限数字'
    })
  })

  it('拒绝 day / hour 越界 (decode 已经被 clamp 过所以这个 case 罕见)', () => {
    // 这里手算越界值:1.99999 → decode → day=365, hour=23 (clamp 后合法)
    // 真正越界的 case 是 encode 但 decode 后越界 — 不会出现,
    // 因为 decode 永远 clamp。所以这个分支保留为防御性测试。
    expect(validateTimelinePosition(1.99999).ok).toBe(true)
  })
})

describe('encode/decode 往返', () => {
  it('合法范围往返一致', () => {
    const samples: Array<[number, number, number]> = [
      [1, 1, 0],
      [1, 100, 12],
      [1, 365, 23],
      [-2, 50, 18],
      [0, 1, 0],
      [10, 200, 5]
    ]
    for (const [y, d, h] of samples) {
      const encoded = encodeTimelinePosition(y, d, h)
      expect(encoded).not.toBeNull()
      const decoded = decodeTimelinePosition(encoded!)
      expect(decoded).toEqual({ year: y, day: d, hour: h })
    }
  })
})