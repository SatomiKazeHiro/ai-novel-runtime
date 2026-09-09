import { describe, it, expect } from 'vitest'
import { ChapterStatus } from '@novel-runtime/shared'

describe('ChapterStatus enum', () => {
  it('contains all 3 expected values matching Prisma', () => {
    const expected = ['draft', 'reviewing', 'archived']
    const actual = Object.values(ChapterStatus).sort()
    expect(actual).toEqual(expected.sort())
  })

  it('exports TypeScript type with correct values', () => {
    const s: typeof ChapterStatus[keyof typeof ChapterStatus] = 'reviewing'
    expect(s).toBe('reviewing')
  })
})
