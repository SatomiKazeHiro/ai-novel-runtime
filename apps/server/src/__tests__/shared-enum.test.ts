import { describe, it, expect } from 'vitest'
import { ChapterStatus } from '@novel-runtime/shared'

describe('ChapterStatus enum', () => {
  it('contains all 8 expected values matching Prisma', () => {
    const expected = ['draft', 'generating', 'generated', 'scored', 'selected', 'reviewing', 'archived', 'rejected']
    const actual = Object.values(ChapterStatus).sort()
    expect(actual).toEqual(expected.sort())
  })

  it('exports TypeScript type with correct values', () => {
    // Compile-time check: this line wouldn't compile if type is wrong
    const s: typeof ChapterStatus[keyof typeof ChapterStatus] = 'reviewing'
    expect(s).toBe('reviewing')
  })
})
