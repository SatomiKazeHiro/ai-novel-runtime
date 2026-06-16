import { describe, it, expect } from 'vitest'
import { createMockPrisma } from './setup.js'

describe('test harness smoke', () => {
  it('createMockPrisma returns usable mock', () => {
    const prisma = createMockPrisma()
    expect(prisma.chapter.findUnique).toBeDefined()
    expect(typeof prisma.chapter.findUnique).toBe('function')
  })
})
