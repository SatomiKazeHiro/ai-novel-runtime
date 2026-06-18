# P1: token-counting 收口 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `js-tiktoken` 7 处直接装收口到 `packages/ai-provider` 一处;3 套 token 实现统一调用 `countTokens(text: string): number`(从 `runtime-compiler.ts` 抽出到独立 `token-counter.ts`)。3 commit,纯重构。

**Architecture:** 单文件 + 改名 + import 改写 + package.json 收口。不改 API contract,不改 UI 体验,不改数据 schema。

**Tech Stack:** TypeScript, js-tiktoken (cl100k_base), pnpm workspace, vitest。

---

## 前置知识(必读)

- **本 phase 的 spec(总路线图第 5 节)**:`docs/superpowers/specs/2026-06-18-decoupling-roadmap-design.md` 第 158-188 行(`## Phase 1: token-counting 收口`)
- **当前状态**:
  - `js-tiktoken` 在 7 个 `package.json` 装了(根 + server + web + 4 packages)
  - 现有 token 实现全在 `packages/ai-provider/src/runtime-compiler.ts:32-34` 的 `estimateTokens`,已有 re-export(`packages/ai-provider/src/index.ts:3`)
  - 实际使用方:`apps/server/src/routes/chapters.ts:12, 428-429` + `apps/server/src/services/combined-extractor.ts:2, 241`
  - `packages/prompt-runtime` / `packages/memory-engine` / `packages/shared` / `apps/web` 装包但**可能没直接 import**(需 Step 1 grep 验证)
- **不要做的事**:
  - 不动 `PromptAssembler` / `RuntimePromptCompiler` 等对外 API
  - 不改测试断言值(`estimateTokens` 行为不变,值不变)
  - 不动 `computeContentCharBudget` 位置(留 combined-extractor,只是内部用 `countTokens` 替换 `estimateTokens`)
  - 不引入新库(0 新库守门)

---

## Task 1: 建 `countTokens` + 测试 + 让 `estimateTokens` re-export 它(向后兼容)

**Files:**
- Create: `packages/ai-provider/src/token-counter.ts`
- Create: `packages/ai-provider/src/__tests__/token-counter.test.ts`
- Modify: `packages/ai-provider/src/index.ts:3` (re-export `countTokens`)
- Modify: `packages/ai-provider/src/runtime-compiler.ts:28-34` (删 `js-tiktoken` import + `enc`,改用 `countTokens`)

- [ ] **Step 1: 写 `countTokens` 失败测试**

创建 `packages/ai-provider/src/__tests__/token-counter.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { countTokens } from '../token-counter.js'

describe('countTokens — pure helper (TDD anchor)', () => {
  it('empty string → 0', () => {
    expect(countTokens('')).toBe(0)
  })

  it('single ASCII char → 1 token (cl100k_base default)', () => {
    expect(countTokens('a')).toBe(1)
  })

  it('Chinese 1 char (mixed) → 1-3 tokens (cl100k_base multi-byte)', () => {
    // 不锁死确切值,只验证 > 0
    const n = countTokens('中')
    expect(n).toBeGreaterThan(0)
    expect(n).toBeLessThanOrEqual(4)
  })

  it('English sentence → roughly word count (cl100k heuristic)', () => {
    // "hello world" 在 cl100k_base 下是 2 tokens
    expect(countTokens('hello world')).toBe(2)
  })

  it('returns same value for same input (pure / no side effects)', () => {
    const text = 'a b c d e f g h i j'
    expect(countTokens(text)).toBe(countTokens(text))
  })
})
```

- [ ] **Step 2: 跑测试,确认失败**

```bash
pnpm --filter @novel-runtime/ai-provider test 2>&1 | tail -10
```

**预期**:FAIL,`countTokens` 未定义(因为还没实现)。

(如果 `ai-provider` 没 test 脚本,跑 `pnpm --filter @novel-runtime/ai-provider typecheck`,确认 ts 文件不存在导致 import 错。)

- [ ] **Step 3: 实现 `countTokens`**

创建 `packages/ai-provider/src/token-counter.ts`:

```ts
import { getEncoding } from 'js-tiktoken'

const enc = getEncoding('cl100k_base')

/**
 * 计算文本的 token 数。cl100k_base 模型(deepseek 默认)。
 * 这是项目里 token 计数的唯一入口 —— 不要在别处 import js-tiktoken。
 *
 * @param text 任意文本
 * @returns token 数
 */
export function countTokens(text: string): number {
  return enc.encode(text).length
}
```

- [ ] **Step 4: 跑测试,确认通过**

```bash
pnpm --filter @novel-runtime/ai-provider test 2>&1 | tail -10
```

**预期**:5/5 PASS。

如果 `ai-provider` 没 vitest 配置,在 `packages/ai-provider/package.json` 加:
```json
"scripts": { "test": "vitest run" }
```
然后 `pnpm install` 一次。

- [ ] **Step 5: 让 `runtime-compiler.ts` 用 `countTokens`,并从 `index.ts` re-export**

修改 `packages/ai-provider/src/runtime-compiler.ts`:

1. 删 line 28: `import { getEncoding } from 'js-tiktoken'`
2. 删 line 30: `const enc = getEncoding('cl100k_base')`
3. 删 line 32-34:整个 `estimateTokens` 函数
4. 在文件顶部(line 1 附近)加: `import { countTokens } from './token-counter.js'`
5. line 57-58 的 `estimateTokens(...)` 改成 `countTokens(...)`

修改 `packages/ai-provider/src/index.ts:3`:

从:
```ts
export { CompiledPrompt, RuntimePromptCompiler, SharedRuntimeBase, WorkerTask, estimateTokens } from './runtime-compiler.js'
```

改为:
```ts
export { CompiledPrompt, RuntimePromptCompiler, SharedRuntimeBase, WorkerTask } from './runtime-compiler.js'
export { countTokens } from './token-counter.js'
```

**注意**:`estimateTokens` 在 runtime-compiler.ts line 57-58 内部被用,**这是 Task 3 才彻底切换外部使用方**;Task 1 只做"新建 countTokens + 让 runtime-compiler 内部用",**不动**其它文件。

- [ ] **Step 6: typecheck + server test 验证向后兼容**

```bash
pnpm typecheck 2>&1 | tail -15
```

**预期**:8/8 Done。

```bash
pnpm --filter server test 2>&1 | tail -5
```

**预期**:115/115 PASS(测试还在用 `estimateTokens` re-export,Task 1 保留 re-export 即可)。

等等:**Task 5 删了 `estimateTokens` 的 re-export**!这会破坏 `apps/server/src/routes/chapters.ts:12` 和 `combined-extractor.ts:2` 的 `import { estimateTokens } from '@novel-runtime/ai-provider'`。

**修正**:Task 1 Step 5 **保留** `estimateTokens` 的 re-export,但底层委托给 `countTokens`:

修改 `packages/ai-provider/src/runtime-compiler.ts` 改为:

```ts
import { countTokens } from './token-counter.js'

// 保留 estimateTokens 作为向后兼容 alias(老代码还在用)
export const estimateTokens = countTokens
```

然后 `index.ts:3` 不变,`estimateTokens` 继续 re-export。

这样:
- 新代码用 `countTokens`(Task 3 切换)
- 老代码继续用 `estimateTokens`(re-export 不变,测试不破)
- 实际底层都是同一个 `countTokens`,值不变

- [ ] **Step 7: 跑测试,确认仍全绿**

```bash
pnpm typecheck 2>&1 | tail -15
pnpm --filter server test 2>&1 | tail -5
```

**预期**:8/8 Done + 115/115 PASS。

- [ ] **Step 8: 确认 token-counter.ts 与 runtime-compiler.ts 内部一致**

跑:

```bash
grep -n "countTokens\|estimateTokens" packages/ai-provider/src/runtime-compiler.ts
```

**预期**:
```
2:import { countTokens } from './token-counter.js'
5:export const estimateTokens = countTokens
57:    const systemTokens = countTokens(systemMessage)
58:    const userTokens = countTokens(userMessage)
```

(行号以实际文件为准)

- [ ] **Step 9: commit**

**先** `git status` 确认范围只有以下文件:

```bash
git status
```

**预期**:
```
modified:   packages/ai-provider/src/index.ts
modified:   packages/ai-provider/src/runtime-compiler.ts
new file:   packages/ai-provider/src/__tests__/token-counter.test.ts
new file:   packages/ai-provider/src/token-counter.ts
```

(以及可能的 `packages/ai-provider/package.json` 修改,如果加 test script)

**如果出现其它文件,立刻 `git restore <file>`**。

然后:

```bash
git add packages/ai-provider/src/token-counter.ts packages/ai-provider/src/__tests__/token-counter.test.ts packages/ai-provider/src/index.ts packages/ai-provider/src/runtime-compiler.ts
git commit -m "$(cat <<'EOF'
refactor(ai-provider): extract countTokens to dedicated token-counter.ts

P1 token-counting 收口第 1 步:把 runtime-compiler.ts:32-34 的
estimateTokens 抽出到独立 token-counter.ts,作为项目 token 计数的
唯一入口。

向后兼容:estimateTokens 继续 re-export(底层委托给 countTokens),
老代码不破。Task 3 才会把外部使用方切换到 countTokens。

新增 5 个纯函数测试(countTokens 测试锚点),跑现有 115 测试全绿。

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: 收 7 个 package.json 的 js-tiktoken 直接装 + 锁 pnpm overrides

**Files:**
- Modify: `package.json` (root)
- Modify: `apps/server/package.json`
- Modify: `apps/web/package.json`
- Modify: `packages/prompt-runtime/package.json`
- Modify: `packages/memory-engine/package.json`
- Modify: `packages/shared/package.json`
- Modify: `packages/ai-provider/package.json` (保留 + 锁版本)
- Modify: `pnpm-lock.yaml` (重生成)

- [ ] **Step 1: 确认 7 处现状**

跑:

```bash
grep -l "js-tiktoken" package.json apps/*/package.json packages/*/package.json
```

**预期输出**(7 个文件):
```
apps/server/package.json
apps/web/package.json
package.json
packages/ai-provider/package.json
packages/memory-engine/package.json
packages/prompt-runtime/package.json
packages/shared/package.json
```

记录下来。

- [ ] **Step 2: 看根 `package.json` 当前结构,准备加 pnpm overrides**

跑:

```bash
cat package.json
```

找:
- `dependencies` 段(有 `js-tiktoken: ^1.0.21`)
- `devDependencies` 段(没有 js-tiktoken)
- `pnpm` 段(可能没有,需要加)

如果 `pnpm` 段不存在,在根 `package.json` **末尾**(最后一个 `}` 之前)加:

```json
,
"pnpm": {
  "overrides": {
    "js-tiktoken": "^1.0.21"
  }
}
```

(锁版本防止 transitive 装包时漂到 1.x 别的 patch)

如果 `pnpm` 段已存在,只加/改 `overrides`。

- [ ] **Step 3: 从根 `package.json` 删 `js-tiktoken` 直接装**

在根 `package.json` 的 `dependencies` 段找到 `"js-tiktoken": "^1.0.21"` 一行,**整行删掉**(包括前面的换行/逗号,保持 JSON 合法)。

- [ ] **Step 4: 从 5 个 package.json 删 `js-tiktoken` 直接装**

这 5 个的 `dependencies` 段都有 `"js-tiktoken": "^1.0.21"`:
- `apps/server/package.json`
- `apps/web/package.json`
- `packages/prompt-runtime/package.json`
- `packages/memory-engine/package.json`
- `packages/shared/package.json`

每个文件删对应行(用 Edit 工具,精确匹配 `"js-tiktoken": "^1.0.21",\n` 删)。

**`packages/ai-provider/package.json` 保留不动**(它是唯一直接装,见 Task 1 验证)。

- [ ] **Step 5: 重装 + 验证 transitive 装包**

```bash
pnpm install 2>&1 | tail -10
```

**预期**:无 error,lockfile 重写。

然后:

```bash
pnpm list js-tiktoken -r 2>&1 | head -20
```

**预期**:7 个包都装了(根 + 6 个),但**直接装只有 ai-provider**。验证:

```bash
grep -l "\"js-tiktoken\":" package.json apps/*/package.json packages/*/package.json
```

**预期**:**只剩 1 个文件**:
```
packages/ai-provider/package.json
```

如果不是这个结果(说明某处还在直接装),`git restore` 全部 package.json + lockfile,排查后重做。

- [ ] **Step 6: 跑全套验证**

```bash
pnpm typecheck 2>&1 | tail -15
pnpm --filter server test 2>&1 | tail -5
```

**预期**:8/8 Done + 115/115 PASS(纯依赖变更,不应破任何代码逻辑)。

- [ ] **Step 7: commit**

**先** `git status` 确认范围:

```bash
git status
```

**预期**:
```
modified:   package.json
modified:   pnpm-lock.yaml
modified:   apps/server/package.json
modified:   apps/web/package.json
modified:   packages/prompt-runtime/package.json
modified:   packages/memory-engine/package.json
modified:   packages/shared/package.json
```

(`packages/ai-provider/package.json` **不应该** modified,因为它本就是直接装,内容没变。)

**如果出现其它文件,立刻 `git restore <file>`**。

```bash
git add package.json pnpm-lock.yaml apps/server/package.json apps/web/package.json packages/prompt-runtime/package.json packages/memory-engine/package.json packages/shared/package.json
git commit -m "$(cat <<'EOF'
refactor(deps): consolidate js-tiktoken to packages/ai-provider only

P1 token-counting 收口第 2 步:7 个 package.json 都直接装了
js-tiktoken,根 pnpm overrides 锁版本,只 packages/ai-provider 保留
直接装,其它 5 个改 transitive 依赖。

改动:
- root package.json: 删 js-tiktoken 直接装 + 加 pnpm.overrides 锁 ^1.0.21
- apps/server, apps/web, packages/{prompt-runtime,memory-engine,shared}: 删直接装
- packages/ai-provider: 保留直接装(token 计数唯一入口)
- pnpm-lock.yaml: 重生成

验证: pnpm list js-tiktoken -r 仍 7 处 transitive 装,grep js-tiktoken
in package.json 只剩 ai-provider 一处。typecheck + 115 测试全绿。

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: 外部使用方 `estimateTokens` → `countTokens`

**Files:**
- Modify: `apps/server/src/routes/chapters.ts:12, 428-429` (2 处调用)
- Modify: `apps/server/src/services/combined-extractor.ts:2, 241` (1 处调用)
- Modify: `apps/server/src/services/runtime-compiler.ts`(无,只读 — 确认无 `js-tiktoken` 直接 import)
- (可能) Modify: `apps/web/src/**/*` 移除直接 `js-tiktoken` import(如无则跳过)

- [ ] **Step 1: 找全部 `estimateTokens` / 直接 `js-tiktoken` 使用**

```bash
grep -rn "estimateTokens\|js-tiktoken" apps/ packages/ --include="*.ts" --include="*.vue" | grep -v node_modules | grep -v __tests__ | grep -v "/dist/"
```

**预期输出**:
```
apps/server/src/routes/chapters.ts:12:import { estimateTokens } from '@novel-runtime/ai-provider'
apps/server/src/routes/chapters.ts:428:      const systemTokens = estimateTokens(parsed.data.systemMessage)
apps/server/src/routes/chapters.ts:429:      const userTokens = estimateTokens(parsed.data.userMessage)
apps/server/src/services/combined-extractor.ts:2:import { estimateTokens } from '@novel-runtime/ai-provider'
apps/server/src/services/combined-extractor.ts:241:      const actualContentTokens = estimateTokens(truncatedContent)
```

(应该就这 5 行 + 可能的 ai-provider 内部)

如果发现额外文件(比如 web / 其他 service),**也加入 Task 3 改动范围**。

- [ ] **Step 2: 改 `apps/server/src/routes/chapters.ts`**

Edit 1 — line 12 import:

旧:
```ts
import { RuntimePromptCompiler, estimateTokens } from '@novel-runtime/ai-provider'
```

新:
```ts
import { RuntimePromptCompiler, countTokens } from '@novel-runtime/ai-provider'
```

Edit 2 — line 428-429(同一处改 2 个 `estimateTokens`):

旧:
```ts
const systemTokens = estimateTokens(parsed.data.systemMessage)
const userTokens = estimateTokens(parsed.data.userMessage)
```

新:
```ts
const systemTokens = countTokens(parsed.data.systemMessage)
const userTokens = countTokens(parsed.data.userMessage)
```

- [ ] **Step 3: 改 `apps/server/src/services/combined-extractor.ts`**

Edit 1 — line 2 import:

旧:
```ts
import { RuntimePromptCompiler, estimateTokens } from '@novel-runtime/ai-provider'
```

新:
```ts
import { RuntimePromptCompiler, countTokens } from '@novel-runtime/ai-provider'
```

Edit 2 — line 241:

旧:
```ts
const actualContentTokens = estimateTokens(truncatedContent)
```

新:
```ts
const actualContentTokens = countTokens(truncatedContent)
```

- [ ] **Step 4: 检查 web/apps 是否有直接 `js-tiktoken` import**

```bash
grep -rn "js-tiktoken" apps/web/src/ 2>&1 | head -5
```

**预期**:无输出(web 不直接 import,只装包但用 transitive)。

如果有,改 import 走 `@novel-runtime/ai-provider` 的 `countTokens`。但**很可能没有**——web 装 `js-tiktoken` 是历史遗留,实际未消费。

- [ ] **Step 5: 检查 `apps/server` 是否有别处直接 import `js-tiktoken`**

```bash
grep -rn "from 'js-tiktoken'\|require('js-tiktoken')" apps/server/src/ 2>&1
```

**预期**:无输出。

- [ ] **Step 6: 跑全套验证**

```bash
pnpm typecheck 2>&1 | tail -15
pnpm --filter server test 2>&1 | tail -5
```

**预期**:8/8 Done + 115/115 PASS(`countTokens` 行为与 `estimateTokens` 一致,值不变,测试断言不变)。

- [ ] **Step 7: 最终验证 — 仓库内直接 import `js-tiktoken` 只剩 1 处**

```bash
grep -rn "from 'js-tiktoken'\|require('js-tiktoken')" apps/ packages/ --include="*.ts" --include="*.vue" | grep -v node_modules
```

**预期**:**只剩 1 行**:
```
packages/ai-provider/src/token-counter.ts:1:import { getEncoding } from 'js-tiktoken'
```

这是**唯一**直接 import,是 spec 要求的"单一 source of truth"。

- [ ] **Step 8: commit**

**先** `git status`:

```bash
git status
```

**预期**:
```
modified:   apps/server/src/routes/chapters.ts
modified:   apps/server/src/services/combined-extractor.ts
```

(可能还有 web 文件如果 Step 4 有,加进去)

**如果出现其它文件,立刻 `git restore <file>`**。

```bash
git add apps/server/src/routes/chapters.ts apps/server/src/services/combined-extractor.ts
git commit -m "$(cat <<'EOF'
refactor(server): switch estimateTokens → countTokens at call sites

P1 token-counting 收口第 3 步:外部使用方从 estimateTokens(老
re-export alias)切换到 countTokens(项目 token 计数唯一入口)。

改动:
- apps/server/src/routes/chapters.ts (1 import + 2 调用)
- apps/server/src/services/combined-extractor.ts (1 import + 1 调用)

estimateTokens 仍保留为 re-export alias(向后兼容),不在本 commit
删除 —— 留给后续 commit 清理老 alias。

验证: 仓库直接 import 'js-tiktoken' 只剩 token-counter.ts 一处。
typecheck + 115 测试全绿。

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: 清理 `estimateTokens` 老 alias

**Files:**
- Modify: `packages/ai-provider/src/runtime-compiler.ts`(删 `export const estimateTokens = countTokens`)

- [ ] **Step 1: 确认无任何代码再用 `estimateTokens`**

```bash
grep -rn "estimateTokens" apps/ packages/ --include="*.ts" --include="*.vue" | grep -v node_modules
```

**预期**:**只剩 1 行**:
```
packages/ai-provider/src/runtime-compiler.ts:5:export const estimateTokens = countTokens
```

(re-export 自身)

如果还有外部使用,说明 Task 3 漏改了某个文件,**回 Task 3 补全再回来**。

- [ ] **Step 2: 删 `runtime-compiler.ts` 里的 `estimateTokens` re-export**

Edit:

旧:
```ts
import { countTokens } from './token-counter.js'

// 保留 estimateTokens 作为向后兼容 alias(老代码还在用)
export const estimateTokens = countTokens
```

新:
```ts
import { countTokens } from './token-counter.js'
```

(删 `estimateTokens` re-export 行,只留 import)

- [ ] **Step 3: typecheck + test**

```bash
pnpm typecheck 2>&1 | tail -15
pnpm --filter server test 2>&1 | tail -5
```

**预期**:8/8 Done + 115/115 PASS(删除 re-export 不影响行为,因为已无外部使用)。

- [ ] **Step 4: commit**

```bash
git status
git add packages/ai-provider/src/runtime-compiler.ts
git commit -m "$(cat <<'EOF'
refactor(ai-provider): remove estimateTokens back-compat alias

P1 token-counting 收口收尾:Task 3 切换完所有外部使用方后,
estimateTokens 这个临时 re-export alias 不再需要,删除。

仓库内不再有 estimateTokens 引用,只有 countTokens 这一个 token
计数入口。

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**1. Spec coverage:**

| Spec 第 5 节要求 | 对应 task |
|---|---|
| 7 个 package.json 收口 | Task 2 |
| 1 新函数 `countTokens` 落 `packages/ai-provider` | Task 1 |
| 6+ ts 文件改 import | Task 3 |
| 1 新测试文件 | Task 1 |
| pnpm overrides 锁版本 | Task 2 |
| `pnpm typecheck` 8/8 Done | Task 1-4 每步都跑 |
| `pnpm --filter server test` 115+/115+ 通过 | Task 1-4 每步都跑 |
| `grep js-tiktoken` 只剩 ai-provider 一处 | Task 2 Step 5 + Task 3 Step 7 |
| `computeContentCharBudget` 位置不动,只换 estimateTokens | Task 3 Step 3 |

✓ 全部覆盖。

**2. Placeholder scan:** 无 "TBD" / "TODO" / "待补" / "implement later"。

**3. Type consistency:**
- `countTokens(text: string): number` 全篇一致
- 文件路径全用相对路径 / workspace 路径
- 验证命令一致(`pnpm typecheck` + `pnpm --filter server test`)

**4. Scope check:** 4 task,3-5 commit,在路线图 spec 估算的 3-5 commit 范围内。

**5. Ambiguity check:**
- Task 1 Step 6 内部修正(用 `export const estimateTokens = countTokens` 而不是删 re-export)在 spec 里已用注释说明
- Task 2 Step 5 验证标准明确
- Task 3 Step 4/5 检查"无直接 js-tiktoken import"在 web/server 都给了 fallback
- Task 4 是"清理 alias"独立 task,失败可独立回退

---

## 关键风险

| 风险 | 缓解 |
|---|---|
| Task 2 重装 pnpm lockfile 后某些包版本漂 | Step 5 跑 pnpm list 验证 js-tiktoken 一致 + typecheck 兜底 |
| Task 3 漏改某个 estimateTokens 调用 | Step 1 用 grep 全文找;Step 7 验证"仓库内 import 'js-tiktoken' 只剩 1 处" |
| 切到 countTokens 后 token 值变化(行为应一致但底层 API 路径变) | Task 3 Step 6 跑全套测试断言,任何失败立即回滚 |
| Task 4 删 alias 后遗漏 | Step 1 二次 grep 确认 estimateTokens 仓库内 0 引用 |
