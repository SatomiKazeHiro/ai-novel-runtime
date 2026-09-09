# Thinking 配置全链路实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 AI Provider 增加可持久化的三态 thinking 配置，并在所有 OpenAI-compatible 请求中统一解析和应用，默认让当前 DeepSeek 模型关闭思考。

**Architecture:** 配置值存储在 `AiProviderConfig.thinking`，取值为 `auto | enabled | disabled`。provider 层负责根据配置和模型名解析最终行为：`disabled` 或 `auto + DeepSeek` 在请求 body 中发送 `thinking: { type: 'disabled' }`，`enabled` 与未知模型的 `auto` 不发送该字段。服务端和前端只负责传递、校验和展示配置，不把模型判断扩散到业务调用方。

**Tech Stack:** Prisma + SQLite migration、Fastify/Zod、TypeScript、Vue 3、Naive UI、Vitest、pnpm workspace。

---

## 文件职责与改动范围

- Modify `prisma/schema.prisma`：给 `AiProviderConfig` 增加 `thinking String @default("auto")`。
- Create `prisma/migrations/20260731000000_add_ai_provider_thinking/migration.sql`：为已有 SQLite 表增加字段并填充 `auto`。
- Modify `packages/ai-provider/src/index.ts`：扩展 `AIProviderConfig`，实现纯函数式模型判断/配置解析，并在 `generate` 与 `generateWithRuntime` 的请求 body 中应用。
- Modify `apps/server/src/services/ai-provider-init.ts`：系统 DeepSeek 配置显式使用 `thinking: 'auto'`，provider 创建时传递该字段。
- Modify `apps/server/src/routes/ai-provider.ts`：create/update schema 校验三态并透传字段；测试接口如构造 provider，也要传递 thinking。
- Modify `apps/web/src/api/ai-provider.ts`：create/update 类型增加 `thinking`。
- Modify `apps/web/src/views/ModelManager.vue`：列表、表单、编辑和保存 payload 增加三态 thinking 控件。
- Modify `apps/server/src/__tests__/provider-non-json.test.ts` 或新增 provider 配置测试：覆盖请求 body 的 thinking 行为。
- Modify `apps/server/src/__tests__/routes/ai-provider.test.ts`：覆盖 create/update 对 thinking 的透传和校验。

> 工作区已有未提交的 v4 memory 修复；实现时只能修改上面与 thinking 相关的文件，不能重置、覆盖或提交其他改动。

### Task 1: 先写 provider thinking 解析与请求体测试

**Files:**
- Modify: `apps/server/src/__tests__/provider-non-json.test.ts`（或同目录新建专门测试文件）
- Inspect: `packages/ai-provider/src/index.ts`

- [ ] **Step 1: 增加请求 body 断言测试**

mock `fetch` 返回合法的最小 chat completion，分别构造 provider 配置：

```typescript
const baseConfig = {
  name: 'deepseek',
  apiKey: 'key',
  baseUrl: 'https://api.example.test',
  model: 'deepseek-v4-flash',
  maxTokens: 100,
  temperature: 0.7
}

it('auto disables thinking for DeepSeek models', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
    JSON.stringify({ choices: [{ message: { content: 'ok' } }], usage: {} }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  )))
  const provider = createProvider({ ...baseConfig, thinking: 'auto' })
  await provider.generate('hello')
  const body = JSON.parse((fetch as any).mock.calls[0][1].body)
  expect(body.thinking).toEqual({ type: 'disabled' })
})

it('does not disable thinking when explicitly enabled', async () => {
  // 使用同样响应，配置 thinking: 'enabled'，断言 body.thinking 未定义
})

it('disabled always sends the provider-compatible disabled object', async () => {
  // 使用非 DeepSeek 模型 + thinking: 'disabled'，断言仍发送 disabled
})

it('unknown model with auto leaves thinking unspecified', async () => {
  // 使用非 DeepSeek 模型 + thinking: 'auto'，断言 body.thinking 未定义
})
```

测试必须在 `afterEach` 中恢复 `vi.unstubAllGlobals()` 和清理 mock，避免污染已有 provider 测试。

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
pnpm --filter @novel-runtime/ai-provider build && pnpm --filter server test -- provider-non-json
```

Expected: 新增断言失败，原因是配置类型没有 `thinking` 且请求 body 没有该字段。

- [ ] **Step 3: 扩展 provider 配置类型和解析逻辑**

在 `packages/ai-provider/src/index.ts`：

```typescript
export type ThinkingMode = 'auto' | 'enabled' | 'disabled'

export interface AIProviderConfig {
  // 保留现有字段
  thinking?: ThinkingMode
}

export function shouldDisableThinking(
  model: string,
  thinking: ThinkingMode = 'auto'
): boolean {
  if (thinking === 'disabled') return true
  if (thinking === 'enabled') return false
  return /deepseek/i.test(model)
}
```

在 `callCompletions` 入口统一处理 body，避免 `generate` 与 `generateWithRuntime` 漏改：

```typescript
private async callCompletions(body: any): Promise<any> {
  const requestBody = shouldDisableThinking(this.config.model, this.config.thinking)
    ? { ...body, thinking: { type: 'disabled' } }
    : body
  // JSON.stringify(requestBody)
}
```

`thinking` 使用可选字段以兼容现有 provider 配置和测试 fixture；未提供时按 `auto` 解析。

- [ ] **Step 4: 构建并运行 provider 测试**

Run:

```bash
pnpm --filter @novel-runtime/ai-provider build && pnpm --filter server test -- provider-non-json
```

Expected: 新增 4 个 thinking 测试与原有 provider 测试全部 PASS。

### Task 2: Prisma 持久化与系统默认配置

**Files:**
- Modify: `prisma/schema.prisma:316-336`
- Create: `prisma/migrations/20260731000000_add_ai_provider_thinking/migration.sql`
- Modify: `apps/server/src/services/ai-provider-init.ts:7-15,91-116`

- [ ] **Step 1: 修改 Prisma schema**

在 `AiProviderConfig` 的模型字段中加入：

```prisma
thinking String @default("auto")
```

- [ ] **Step 2: 编写 SQLite migration**

migration 内容：

```sql
ALTER TABLE "AiProviderConfig" ADD COLUMN "thinking" TEXT NOT NULL DEFAULT 'auto';
```

- [ ] **Step 3: 传递系统配置中的 thinking**

`getProviderById` 创建 provider 时加入：

```typescript
thinking: config.thinking ?? 'auto'
```

系统初始化 create data 加入：

```typescript
thinking: 'auto'
```

已有 system config 的 env 同步 update 不覆盖用户的 thinking 选择；新数据库字段默认值会是 `auto`。

- [ ] **Step 4: 生成 Prisma client 并验证 schema**

Run:

```bash
pnpm db:generate
pnpm --filter server typecheck
```

Expected: Prisma client 生成成功，服务端类型检查通过。

### Task 3: 服务端 API 校验与路由测试

**Files:**
- Modify: `apps/server/src/routes/ai-provider.ts`
- Modify: `apps/server/src/__tests__/routes/ai-provider.test.ts`

- [ ] **Step 1: 增加 create/update 的 failing tests**

create 测试请求 body 增加 `thinking: 'disabled'`，断言 Prisma create data：

```typescript
expect(prisma.aiProviderConfig.create).toHaveBeenCalledWith(expect.objectContaining({
  data: expect.objectContaining({ thinking: 'disabled' })
}))
```

update 测试发送 `thinking: 'enabled'`，断言 update data 包含 `thinking: 'enabled'`。

另加非法值测试：`thinking: 'sometimes'` 返回 400，且 Prisma create/update 不被调用。

- [ ] **Step 2: 运行路由测试确认失败**

Run:

```bash
pnpm --filter server test -- ai-provider
```

Expected: thinking 未进入 schema/data，断言失败；非法值不会被正确拒绝。

- [ ] **Step 3: 修改路由 schema 与透传逻辑**

为 create/update body schema 增加：

```typescript
thinking: z.enum(['auto', 'enabled', 'disabled']).optional()
```

create data 增加：

```typescript
thinking: body.thinking ?? 'auto'
```

update data 使用“仅在字段出现时更新”的规则：

```typescript
if (body.thinking !== undefined) data.thinking = body.thinking
```

测试连接构造 provider 的 body 若允许 thinking，也按同一 schema 传递；它不得改变数据库配置。

- [ ] **Step 4: 运行路由测试**

Run:

```bash
pnpm --filter server test -- ai-provider
```

Expected: create/update/非法值测试全部 PASS，原有路由测试不回归。

### Task 4: Web API 与 ModelManager 三态 UI

**Files:**
- Modify: `apps/web/src/api/ai-provider.ts`
- Modify: `apps/web/src/views/ModelManager.vue`

- [ ] **Step 1: 扩展 Web API 类型**

加入共享前端类型：

```typescript
export type ThinkingMode = 'auto' | 'enabled' | 'disabled'
```

在 `AiProviderCreate` 与 `AiProviderUpdate` 中加入：

```typescript
thinking?: ThinkingMode
```

- [ ] **Step 2: 在 ModelManager 表单增加 thinking 字段**

`AiProviderConfig` 加入 `thinking: ThinkingMode`；表单加入：

```typescript
thinking: 'auto' as ThinkingMode
```

新增表单项：

```vue
<n-form-item label="思考模式">
  <n-radio-group v-model:value="form.thinking">
    <n-radio value="auto">自动</n    </n-radio>
    <n-radio value="enabled">启用</n-radio>
    <n-radio value="disabled">关闭</n    </n-radio>
  </n-radio-group>
</n-form-item>
```

旁边显示简短说明：“自动：当前 DeepSeek 模型默认关闭，其他模型遵循上游默认”。

`openCreate` 默认 `auto`；`startEdit` 使用 `row.thinking || 'auto'`；`handleSave` payload 加入 `thinking: form.value.thinking`。

列表增加“思考”列，显示实际配置值，不把 auto 显示成最终解析结果，避免把配置语义和运行时 heuristic 混淆。

- [ ] **Step 3: 运行前端类型检查和相关测试**

Run:

```bash
pnpm --filter web typecheck
pnpm --filter web test
```

Expected: Vue 模板和 API 类型通过；已有 ReviewingPanel 等测试不受影响。

### Task 5: 全链路验证与 diff 检查

**Files:**
- No source changes unless verification exposes a defect.

- [ ] **Step 1: 构建共享 provider**

```bash
pnpm --filter @novel-runtime/ai-provider build
```

Expected: PASS。

- [ ] **Step 2: 运行 thinking 与相关服务端测试**

```bash
pnpm --filter server test -- provider-non-json ai-provider
```

Expected: PASS。若旧 v3 测试失败，记录为既有 v3/v4 版本迁移问题，不修改无关测试来掩盖失败。

- [ ] **Step 3: 运行全局验证**

```bash
pnpm typecheck
pnpm lint
```

Expected: 命令完成；若失败，只修复本次 thinking 变更导致的问题，并保留用户已有改动。

- [ ] **Step 4: 检查 migration 与工作区 diff**

```bash
git diff -- prisma/schema.prisma prisma/migrations/20260731000000_add_ai_provider_thinking/migration.sql packages/ai-provider/src/index.ts apps/server/src/services/ai-provider-init.ts apps/server/src/routes/ai-provider.ts apps/web/src/api/ai-provider.ts apps/web/src/views/ModelManager.vue
git status --short
```

Expected: 只展示 thinking 相关新增/修改；不 commit、不 reset、不删除用户已有的 `bash.exe.stackdump`、截图和 v4 修复文件。

## 自检结果

- **规格覆盖：** 三态配置、DeepSeek auto heuristic、默认关闭、请求体行为、数据库 migration、服务端校验、前端展示、测试与全局验证均有对应任务。
- **占位符检查：** 无 `TBD`、`TODO` 或“稍后实现”等未完成步骤。
- **类型一致性：** 统一使用 `ThinkingMode` 与字段名 `thinking`；provider 默认值为 `auto`，路由和前端均使用相同三态字面量。
- **边界决策：** `auto` 对模型名包含 `deepseek` 的模型关闭 thinking；其他模型 auto 不发送字段；显式 enabled 不发送 disabled 参数。
- **未提交约束：** 所有步骤没有 commit 操作，最终只展示 diff 与验证结果。
