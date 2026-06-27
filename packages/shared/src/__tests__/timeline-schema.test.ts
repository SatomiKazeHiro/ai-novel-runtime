import { describe, it, expect } from 'vitest'
import { CreateTimelineEventRequestSchema } from '../timeline.js'

describe('CreateTimelineEventRequestSchema', () => {
  const validInput = {
    fromChapterNumber: 1,
    position: 1.00106,
    events: ['许青与姜禾在山林中遇险']
  }

  it('accepts valid input (mainline chapter 1, position 1.00106, single event)', () => {
    const result = CreateTimelineEventRequestSchema.safeParse(validInput)
    expect(result.success).toBe(true)
  })

  it('accepts side-story chapter number (1.01, 1.02, etc.) — Float? column supports decimals', () => {
    const result = CreateTimelineEventRequestSchema.safeParse({
      ...validInput,
      fromChapterNumber: 1.01
    })
    expect(result.success).toBe(true)
  })

  it('accepts multiple events', () => {
    const result = CreateTimelineEventRequestSchema.safeParse({
      ...validInput,
      events: ['事件1', '事件2', '事件3']
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing fromChapterNumber (regression: 编辑期事件必须绑章节)', () => {
    const { fromChapterNumber, ...rest } = validInput
    void fromChapterNumber
    const result = CreateTimelineEventRequestSchema.safeParse(rest)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.errors.some(e => e.path.includes('fromChapterNumber'))).toBe(true)
    }
  })

  it('rejects fromChapterNumber=undefined (null in JSON body)', () => {
    const result = CreateTimelineEventRequestSchema.safeParse({
      ...validInput,
      fromChapterNumber: undefined
    })
    expect(result.success).toBe(false)
  })

  it('rejects fromChapterNumber=NaN (Float refinement)', () => {
    const result = CreateTimelineEventRequestSchema.safeParse({
      ...validInput,
      fromChapterNumber: NaN
    })
    expect(result.success).toBe(false)
  })

  it('rejects fromChapterNumber=Infinity', () => {
    const result = CreateTimelineEventRequestSchema.safeParse({
      ...validInput,
      fromChapterNumber: Infinity
    })
    expect(result.success).toBe(false)
  })

  it('rejects missing position', () => {
    const { position, ...rest } = validInput
    void position
    const result = CreateTimelineEventRequestSchema.safeParse(rest)
    expect(result.success).toBe(false)
  })

  it('rejects position=NaN (Float refine)', () => {
    const result = CreateTimelineEventRequestSchema.safeParse({
      ...validInput,
      position: NaN
    })
    expect(result.success).toBe(false)
  })

  it('rejects position=Infinity', () => {
    const result = CreateTimelineEventRequestSchema.safeParse({
      ...validInput,
      position: Infinity
    })
    expect(result.success).toBe(false)
  })

  it('accepts position with no decimal (integer-only = year + 0 天 0 时, decoder clamp 后 day=1 hour=0)', () => {
    // 历史: AI 偶尔只回一个整数, 不应被 schema 误杀, 让上层业务决定.
    const result = CreateTimelineEventRequestSchema.safeParse({
      ...validInput,
      position: 1
    })
    expect(result.success).toBe(true)
  })

  it('rejects events=[] (空数组无意义, 至少 1 条)', () => {
    const result = CreateTimelineEventRequestSchema.safeParse({
      ...validInput,
      events: []
    })
    expect(result.success).toBe(false)
  })

  it('rejects events with empty string entry (min(1) on inner string)', () => {
    const result = CreateTimelineEventRequestSchema.safeParse({
      ...validInput,
      events: ['']
    })
    expect(result.success).toBe(false)
  })

  it('rejects events missing entirely', () => {
    const { events, ...rest } = validInput
    void events
    const result = CreateTimelineEventRequestSchema.safeParse(rest)
    expect(result.success).toBe(false)
  })
})
