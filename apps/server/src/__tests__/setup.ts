import { vi, beforeEach } from 'vitest'

// Reset all mocks before each test for isolation
beforeEach(() => {
  vi.resetAllMocks()
})

/**
 * Build a fake Fastify app that records all registered route handlers in
 * `routes` keyed as `<METHOD> <path>`. Mirrors only the surface that
 * route handlers in this project actually touch (prisma, log, HTTP verb
 * registers) — no plugins, no decorators, no Fastify internals.
 *
 * Returns `{ app, routes }` so the caller can pass `app` to the route
 * registrar (e.g. `await chapterRoutes(app)`) and then drive `routes`
 * directly via `callHandler` below.
 */
export function createMockApp(prisma: any, log: any = { info: vi.fn(), error: vi.fn(), warn: vi.fn() }) {
  const routes: Record<string, any> = {}
  const app: any = {
    prisma,
    log,
    get: (path: string, handler: any) => { routes[`GET ${path}`] = handler },
    post: (path: string, handler: any) => { routes[`POST ${path}`] = handler },
    put: (path: string, handler: any) => { routes[`PUT ${path}`] = handler },
    delete: (path: string, handler: any) => { routes[`DELETE ${path}`] = handler },
    // Mirror Fastify's register behavior for our flat-registration usage:
    // sub-route plugins receive the same app surface (no encapsulation,
    // no prefix), so calling them with the mock app is functionally equivalent.
    register: async (plugin: any) => { await plugin(app) }
  }
  return { app: app as any, routes }
}

/**
 * Drive a recorded handler with a mock request + reply. Captures both
 * forms the codebase uses:
 *   - bare `return { success: true, ... }`  → handler's return value
 *   - `return reply.send({ ... })`         → reply.send.mock.calls
 *
 * Returns `{ status, body }` so tests can assert on either form without
 * caring which pattern the route uses.
 */
export async function callHandler(
  routes: Record<string, any>,
  method: string,
  path: string,
  body?: any,
  params?: any,
  query?: any
) {
  const handler = routes[`${method} ${path}`]
  if (!handler) {
    throw new Error(`No handler registered for ${method} ${path}`)
  }
  const reply: any = {
    status: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis()
  }
  const request: any = {
    body: body || {},
    params: params || {},
    query: query || {}
  }
  // If body looks like a fake multipart request (has isMultipart fn), merge its
  // fields onto the top-level request — Fastify's @fastify/multipart decorates
  // the request object itself, not request.body.
  if (body && typeof body.isMultipart === 'function') {
    Object.assign(request, body)
  }
  const ret = await handler(request, reply)
  const sent = reply.send.mock.calls[0]?.[0]
  return {
    status: reply.status.mock.calls[0]?.[0],
    body: sent !== undefined ? sent : ret
  }
}

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
