import { vi, beforeEach } from 'vitest'

// Reset all mocks before each test for isolation
beforeEach(() => {
  vi.resetAllMocks()
})

// Shared mock factory for Prisma client
export function createMockPrisma(overrides: Record<string, any> = {}) {
  return {
    chapter: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn()
    },
    draft: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn()
    },
    aiProviderConfig: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn()
    },
    story: { findUnique: vi.fn() },
    loreItem: { findMany: vi.fn() },
    timelineEvent: { findMany: vi.fn() },
    plotArc: { findMany: vi.fn() },
    graphNode: { findUnique: vi.fn(), create: vi.fn() },
    graphEdge: { create: vi.fn() },
    memory: { findMany: vi.fn(), create: vi.fn() },
    characterBranchState: { findMany: vi.fn(), create: vi.fn() },
    $transaction: vi.fn((fn) => fn(overrides.tx || {})),
    ...overrides
  }
}
