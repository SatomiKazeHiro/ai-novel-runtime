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
        // PUT/POST-default read full row for the type==='system' 403 check;
        // mock mirrors that (no projection).
        findUnique: vi.fn(async (args: any) => {
          const r = rowList.find((x) => x.id === (args?.where as any)?.id)
          return r
        }),
        // Write-path mocks: when the route passes `select`, project to mirror
        // real Prisma behavior. If the route forgets `select`, the mock
        // returns the full row — which is exactly the leak we're guarding.
        create: vi.fn(async (args: any) => project({
          id: '1', name: 'NewProvider', model: 'm', baseUrl: null,
          isDefault: false, remarks: null, type: 'user',
          maxTokens: 4096, temperature: 0.7, contextLength: 64000,
          apiKey: 'sk-LEAKED-create', createdAt: new Date(), updatedAt: new Date()
        }, args?.select)),
        update: vi.fn(async (args: any) => project({
          id: '1', name: 'DeepSeek', model: 'deepseek-chat', baseUrl: null,
          isDefault: false, remarks: null, type: 'user',
          maxTokens: 4096, temperature: 0.7, contextLength: 64000,
          apiKey: 'sk-LEAKED-update', createdAt: new Date(), updatedAt: new Date()
        }, args?.select)),
        updateMany: vi.fn(async () => ({ count: 0 })),
        delete: vi.fn()
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

  it('POST /api/ai-providers — response does not contain apiKey', async () => {
    const result = await callHandler(
      routes,
      'POST',
      '/api/ai-providers',
      { name: 'NewProvider', model: 'm', apiKey: 'sk-test' }
    )

    expect(prisma.aiProviderConfig.create).toHaveBeenCalledTimes(1)
    const callArgs = prisma.aiProviderConfig.create.mock.calls[0][0]
    expect(callArgs).toHaveProperty('select')
    expect(callArgs.select).not.toHaveProperty('apiKey')

    expect(result.body.success).toBe(true)
    expect(result.body.data).toBeDefined()
    expect(result.body.data).not.toHaveProperty('apiKey')
    expect(result.body.data).toHaveProperty('id')
    expect(result.body.data).toHaveProperty('name')
    // Belt-and-suspenders: serialized body must never carry the leaked value.
    expect(JSON.stringify(result.body)).not.toContain('sk-LEAKED-create')
  })

  it('PUT /api/ai-providers/:id — response does not contain apiKey', async () => {
    const result = await callHandler(
      routes,
      'PUT',
      '/api/ai-providers/:id',
      { name: 'Renamed' },
      { id: '1' }
    )

    expect(result.body.success).toBe(true)
    expect(prisma.aiProviderConfig.update).toHaveBeenCalledTimes(1)
    const callArgs = prisma.aiProviderConfig.update.mock.calls[0][0]
    expect(callArgs).toHaveProperty('select')
    expect(callArgs.select).not.toHaveProperty('apiKey')

    expect(result.body.data).toBeDefined()
    expect(result.body.data).not.toHaveProperty('apiKey')
    expect(result.body.data).toHaveProperty('id')
    expect(JSON.stringify(result.body)).not.toContain('sk-LEAKED-update')
  })

  it('POST /api/ai-providers/:id/default — response does not contain apiKey', async () => {
    const result = await callHandler(
      routes,
      'POST',
      '/api/ai-providers/:id/default',
      {},
      { id: '1' }
    )

    expect(result.body.success).toBe(true)
    // The final `update` that returns the config must use select.
    const updateCalls = prisma.aiProviderConfig.update.mock.calls
    expect(updateCalls.length).toBeGreaterThanOrEqual(1)
    const lastUpdate = updateCalls[updateCalls.length - 1][0]
    expect(lastUpdate).toHaveProperty('select')
    expect(lastUpdate.select).not.toHaveProperty('apiKey')

    expect(result.body.data).toBeDefined()
    expect(result.body.data).not.toHaveProperty('apiKey')
    expect(result.body.data).toHaveProperty('id')
    expect(JSON.stringify(result.body)).not.toContain('sk-LEAKED-update')
  })
})

describe('ai-provider routes — thinking 配置透传', () => {
  let prisma: any
  let routes: Record<string, any>
  const rowList = [
    {
      id: '1', name: 'DeepSeek', model: 'deepseek-v4-flash', baseUrl: null,
      isDefault: true, remarks: null, type: 'deepseek',
      maxTokens: 4096, temperature: 0.7, contextLength: 64000,
      thinking: 'auto',
      apiKey: 'sk-secret', createdAt: new Date(), updatedAt: new Date()
    },
    {
      id: '2', name: 'OpenAI', model: 'gpt-4o', baseUrl: null,
      isDefault: false, remarks: null, type: 'openai',
      maxTokens: 4096, temperature: 0.7, contextLength: 64000,
      thinking: 'enabled',
      apiKey: 'sk-another', createdAt: new Date(), updatedAt: new Date()
    }
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
        findUnique: vi.fn(async (args: any) => rowList.find((x) => x.id === (args?.where as any)?.id)),
        create: vi.fn(async (args: any) => project({
          id: '1', name: 'NewProvider', model: 'm', baseUrl: null,
          isDefault: false, remarks: null, type: 'user',
          maxTokens: 4096, temperature: 0.7, contextLength: 64000,
          thinking: args?.data?.thinking ?? 'auto',
          apiKey: 'sk-LEAKED-create', createdAt: new Date(), updatedAt: new Date()
        }, args?.select)),
        update: vi.fn(async (args: any) => project({
          id: '1', name: 'DeepSeek', model: 'deepseek-v4-flash', baseUrl: null,
          isDefault: false, remarks: null, type: 'user',
          maxTokens: 4096, temperature: 0.7, contextLength: 64000,
          thinking: args?.data?.thinking ?? 'auto',
          apiKey: 'sk-LEAKED-update', createdAt: new Date(), updatedAt: new Date()
        }, args?.select)),
        updateMany: vi.fn(async () => ({ count: 0 })),
        delete: vi.fn()
      }
    }
    const built = createMockApp(prisma)
    await aiProviderRoutes(built.app)
    routes = built.routes
  })

  it('GET 列表 / 默认 都返回 thinking 字段', async () => {
    const list = await callHandler(routes, 'GET', '/api/ai-providers')
    expect(list.body.data[0]).toHaveProperty('thinking', 'auto')
    expect(list.body.data[1]).toHaveProperty('thinking', 'enabled')

    const def = await callHandler(routes, 'GET', '/api/ai-providers/default')
    expect(def.body.data).toHaveProperty('thinking', 'auto')
  })

  it('POST 显式 thinking=disabled 写入 prisma.create.data', async () => {
    const result = await callHandler(
      routes, 'POST', '/api/ai-providers',
      { name: 'NewProvider', model: 'm', apiKey: 'sk-test', thinking: 'disabled' }
    )
    expect(result.body.success).toBe(true)
    const args = prisma.aiProviderConfig.create.mock.calls[0][0]
    expect(args.data).toHaveProperty('thinking', 'disabled')
    // 响应也带回 thinking（mock 不会主动带，因为 args.data.thinking 是 'disabled'）
    // 但我们的 mock 透传 args?.data?.thinking，所以验证即可
    expect(result.body.data).toHaveProperty('thinking', 'disabled')
  })

  it('POST 不传 thinking 默认 auto', async () => {
    await callHandler(routes, 'POST', '/api/ai-providers',
      { name: 'NewProvider', model: 'm', apiKey: 'sk-test' })
    const args = prisma.aiProviderConfig.create.mock.calls[0][0]
    expect(args.data.thinking).toBe('auto')
  })

  it('POST 非法 thinking 返回 400 且不调 prisma.create', async () => {
    const result = await callHandler(
      routes, 'POST', '/api/ai-providers',
      { name: 'NewProvider', model: 'm', apiKey: 'sk-test', thinking: 'sometimes' }
    )
    expect(result.status).toBe(400)
    expect(result.body).toHaveProperty('success', false)
    expect(prisma.aiProviderConfig.create).not.toHaveBeenCalled()
  })

  it('PUT 显式 thinking=enabled 写入 prisma.update.data', async () => {
    const result = await callHandler(
      routes, 'PUT', '/api/ai-providers/:id',
      { thinking: 'enabled' },
      { id: '1' }
    )
    expect(result.body.success).toBe(true)
    const args = prisma.aiProviderConfig.update.mock.calls[0][0]
    expect(args.data).toHaveProperty('thinking', 'enabled')
  })

  it('PUT 不传 thinking 不动 data.thinking', async () => {
    await callHandler(
      routes, 'PUT', '/api/ai-providers/:id',
      { name: 'Renamed' },
      { id: '1' }
    )
    const args = prisma.aiProviderConfig.update.mock.calls[0][0]
    expect(args.data).not.toHaveProperty('thinking')
  })

  it('PUT 非法 thinking 返回 400 且不调 prisma.update', async () => {
    const result = await callHandler(
      routes, 'PUT', '/api/ai-providers/:id',
      { thinking: 'always-on' },
      { id: '1' }
    )
    expect(result.status).toBe(400)
    expect(result.body).toHaveProperty('success', false)
    expect(prisma.aiProviderConfig.update).not.toHaveBeenCalled()
  })
})
