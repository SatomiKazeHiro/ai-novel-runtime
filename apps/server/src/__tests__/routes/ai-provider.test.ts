import { describe, it, expect, vi, beforeEach } from 'vitest'
import { aiProviderRoutes } from '../../routes/ai-provider.js'
import { createMockApp, callHandler } from '../setup.js'

// Honor Prisma's `select` projection so the mock mirrors real Prisma behavior.
// Without this, a mock that always returns the same row would mask the bug
// we're testing for (apiKey leaking in the response).
function project(row: any, select: Record<string, boolean> | undefined) {
  if (!select) return row
  const out: any = {}
  for (const k of Object.keys(select)) {
    if (select[k]) out[k] = row[k]
  }
  return out
}

describe('ai-provider routes — apiKey stripping', () => {
  let prisma: any
  let routes: Record<string, any>
  const rowList = [
    { id: '1', name: 'DeepSeek', model: 'deepseek-chat', baseUrl: null, isDefault: true, remarks: null, type: 'deepseek', maxTokens: 4096, temperature: 0.7, contextLength: 64000, apiKey: 'sk-secret', createdAt: new Date(), updatedAt: new Date() },
    { id: '2', name: 'OpenAI', model: 'gpt-4', baseUrl: null, isDefault: false, remarks: null, type: 'openai', maxTokens: 4096, temperature: 0.7, contextLength: 64000, apiKey: 'sk-another', createdAt: new Date(), updatedAt: new Date() }
  ]

  beforeEach(async () => {
    prisma = {
      aiProviderConfig: {
        findMany: vi.fn(async (args: any) => rowList.map((r) => project(r, args?.select))),
        findFirst: vi.fn(async (args: any) => {
          const r = rowList.find((x) => {
            if (!args?.where) return true
            return Object.keys(args.where).every((k) => (x as any)[k] === (args.where as any)[k])
          })
          return project(r, args?.select)
        }),
        findUnique: vi.fn()
      }
    }
    const built = createMockApp(prisma)
    await aiProviderRoutes(built.app)
    routes = built.routes
  })

  it('GET /api/ai-providers excludes apiKey from response', async () => {
    const result = await callHandler(routes, 'GET', '/api/ai-providers')

    // The route must project columns via Prisma `select` — not just delete apiKey post-hoc.
    expect(prisma.aiProviderConfig.findMany).toHaveBeenCalledTimes(1)
    const callArgs = prisma.aiProviderConfig.findMany.mock.calls[0][0]
    expect(callArgs).toHaveProperty('select')
    expect(callArgs.select).toBeDefined()
    expect(callArgs.select).not.toHaveProperty('apiKey')

    const data = result.body.data
    expect(Array.isArray(data)).toBe(true)
    expect(data).toHaveLength(2)
    data.forEach((provider: any) => {
      expect(provider).not.toHaveProperty('apiKey')
      // Useful fields must still be present
      expect(provider).toHaveProperty('id')
      expect(provider).toHaveProperty('name')
      expect(provider).toHaveProperty('model')
    })
  })

  it('GET /api/ai-providers/default excludes apiKey from response', async () => {
    const result = await callHandler(routes, 'GET', '/api/ai-providers/default')

    expect(prisma.aiProviderConfig.findFirst).toHaveBeenCalledTimes(1)
    const callArgs = prisma.aiProviderConfig.findFirst.mock.calls[0][0]
    expect(callArgs).toHaveProperty('select')
    expect(callArgs.select).toBeDefined()
    expect(callArgs.select).not.toHaveProperty('apiKey')
    expect(callArgs.where).toEqual({ isDefault: true })

    expect(result.body.data).toBeDefined()
    expect(result.body.data).not.toHaveProperty('apiKey')
    expect(result.body.data).toHaveProperty('id')
    expect(result.body.data).toHaveProperty('name')
  })
})
