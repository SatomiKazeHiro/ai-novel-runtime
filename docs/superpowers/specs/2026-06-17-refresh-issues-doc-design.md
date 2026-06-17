# Refresh `docs/ISSUES.md` + 解耦候选库选型设计

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把 `docs/ISSUES.md` 从 2026-06-16 的"7 P0 + 10 Q 决策"原始快照,刷新到反映**当前已修状态**(2026-06-17),并新增"解耦候选库"小节,记录**宁少勿滥**的库选型结论。

**Architecture:**
- 单文件结构(用户已选)。用 `[RESOLVED yyyy-mm-dd by <hash>]` 标已修条目,**原文不删**(审计可回看)。
- 末尾新增"## 解耦候选库"小节,4 个子节(zod / token counting / shared type / DI),每个子节给"现状 → 候选 → 推荐 → 拒了的 → 应用范围"。
- 库选型核心守门:**新引入库 = 0,只复用已装 `zod`;调研 12 个候选全部拒掉**。

**Tech Stack:** N/A(纯文档更新)。

---

## 背景

最近两周集中修复了 `ISSUES.md` 列出的几乎全部 P0 和 Q1-Q10 决策。文档自 2026-06-16 后未刷新,状态严重过期。盘库结果:

| 类别 | 旧 ISSUES.md | 当前真实状态 |
|---|---|---|
| P0 #1 user-edited 标签 | [Data loss] OPEN | RESOLVED 2026-06-16 by c98d582 |
| P0 #2 8000 字截断 | [Data loss] OPEN | RESOLVED 2026-06-17 by e077407 |
| P0 #3 useChapterEditor JSON.parse | [Crash] OPEN | RESOLVED 2026-06-16 by dba2ba1 |
| P0 #4 routes/graph.ts:18 JSON.parse | [Crash] OPEN | RESOLVED 2026-06-16 by dba2ba1 |
| P0 #5 prepare-archive 无 try/catch | [Crash] OPEN | RESOLVED 2026-06-16 by 09092ae |
| P0 #6 ai-provider apiKey 泄漏 | [Security] OPEN | RESOLVED 2026-06-16 by 092cc08 + 8b5565c |
| P0 #7 select 跨章改 draft | [Security] OPEN | RESOLVED 2026-06-16 by 116247c |
| Q1 enum 同步 | OPEN | RESOLVED 2026-06-16 (commit hash 需补) |
| Q3 assertStatus dead code | OPEN | RESOLVED 2026-06-16 by f0bb424 + 6528301 |
| Q5 safeJsonParse 统一 | OPEN | RESOLVED 2026-06-16 by dba2ba1 |
| Q6 PendingArchiveData 共享 | OPEN | RESOLVED 2026-06-16 (PendingArchiveData 现在在 `packages/shared/src/archive.ts:130`) |
| Q7 prepare-archive try/catch | OPEN | RESOLVED 2026-06-16 by 09092ae |
| Q8 select chapterId 校验 | OPEN | RESOLVED 2026-06-16 by 116247c |
| Q9 zod 接入 | OPEN | **仍 OPEN** (zod 已装但未消费) |
| Q10 状态机锁 | OPEN | RESOLVED 2026-06-16 by 510a656 + 5f80270 |
| Bonus cytoscape null | (未在 ISSUES) | RESOLVED 2026-06-17 by 4def263 |

**新发现**:
- `js-tiktoken` 在 **7 个** `package.json` 装(根、server、web、4 个 packages)
- `PromptAssembler` 在 `packages/prompt-runtime` 有一套完整 budget 实现
- `combined-extractor.computeContentCharBudget` 走自己的简化版
- → 事实上的"三套 token 实现",就是 `ISSUES.md:137` 提到的"token-counting 三套合并"在代码里的实证

---

## 用户决策记录(2026-06-17)

| # | 议题 | 用户决策 |
|---|------|----------|
| D1 | 文档形态 | 单文件 + 状态标签(不拆 `DECOUPLING-LIBRARIES.md`) |
| D2 | 调研深度 | 高粒度(每个领域 2-3 候选 + 拒了哪些 + 推荐) |
| D3 | 与解耦任务绑定 | 库调研独立,不被明天 Graph.vue 拆分任务绑定;结论可被未来多个解耦任务复用 |
| D4 | 库选型守门原则 | **通用 + 解耦 + 易读 + 扩展性,宁少勿滥**;库不是越多越好,要符合"解耦代码、提高易读性、扩展性"综合考虑 |

---

## 设计

### 1. 文档结构

```
# ISSUES (重写,文件路径不变)
- 修订说明(本文件最后刷新日期 + commit 范围,1 段)
- ## [P0 已修] (7 条,每条原文保留 + 末行标 [RESOLVED yyyy-mm-dd by <hash>])
- ## [P0 待办] (1 条:重复依赖 + 三套 token 实现)
- ## [Q 决策 - 已修] (Q1/Q3/Q5/Q6/Q7/Q8/Q10,各条末标 RESOLVED)
- ## [Q 决策 - OPEN] (Q9 zod 接入)
- ## [Bug fix 备忘] (cytoscape null - 4def263,补充记录)
- ## [解耦候选库] (新增,4 个子节,见下)
- ## 修复时间线 (按日期降序的简表,审计用)
```

### 2. 状态字段规范

- 已修:P0/Q 末追加一行 `**Status:** [RESOLVED yyyy-mm-dd by <7-char-hash>]`
- OPEN:不加任何标记,保持原文
- 新发现:`[NEW yyyy-mm-dd]` 标在条目开头
- 原文(File:line / Symptom / Repro / Root cause / Blast radius)**一字不删**

### 3. 库选型 4 个子节(末尾新增)

#### 3.1 Schema / 运行时校验 — `zod` ✅ 推荐

**现状**:`zod ^3.23.0` 已在 `apps/server` 装着,`zod ^3.25.76` 已在 `packages/shared` 装着,**重复装两份 + 版本略漂**;实际**未消费**(Q9 待做)。

**候选**:
| 库 | 评估 |
|---|---|
| **zod** (推荐) | 类型即 schema,生态成熟(OpenAPI / form / drizzle 都有适配),前后端共用一份 |
| yup | 拒;类型推导弱,API 笨重 |
| valibot | 拒;API 更现代但生态弱,tsc 推导不如 zod 稳定 |
| joi | 拒;Node-only,前端不能消费 |

**应用范围(Q9 修后)**:`/api/chapters/*` 请求体、`CompiledPrompt`、AI 响应反序列化、ZodError → 400 + 字段级错误。Schema 定义在 `packages/shared/src/<feature>.ts`,前后端 import 同一份。

#### 3.2 Token counting 统一 — 不引入新库,自建单例

**现状**:`js-tiktoken` 在 **7 个** `package.json` 装(根、server、web、4 个 packages),`PromptAssembler` 在 `packages/prompt-runtime` 有一套完整 budget 实现,`combined-extractor.computeContentCharBudget` 走自己的简化版。事实上的"三套并存"。

**候选**:
| 方案 | 评估 |
|---|---|
| **集中到 `packages/ai-provider` 一个文件,其它包 re-export** (推荐) | 零新依赖;解掉 7 处重复装和 3 套逻辑;易读 |
| 引入 `gpt-tokenizer` (纯 ESM, 快) | 拒;替换 `js-tiktoken` 收益小,行为差异风险大 |
| 引入 `tiktoken-node` | 拒;同上,且与现有 7 处装包不兼容 |

**应用范围**:把 `PromptAssembler.estimateTokens` / `PromptAssembler.assemble` 内的 token 计数 / `combined-extractor.computeContentCharBudget` / `graph-organizer` 内的 token 计算,都接到 `packages/ai-provider` 的 `countTokens(text: string): number`;7 个 package.json 的 `js-tiktoken` 改成只有 `ai-provider` 直接装,其它 transitive 依赖。

#### 3.3 跨包类型共享 / API contract — 不引入新库,继续推 `packages/shared`

**现状**:`PendingArchiveData` 已搬到 `shared/archive.ts:130`(Q6 已修)。`Draft` / `Chapter` 走 prisma generate → `@prisma/client` 自动注入,已 OK。仍部分散落:`CompiledPrompt` 在 `apps/server` 内部定义。

**候选**:
| 方案 | 评估 |
|---|---|
| **继续走 `packages/shared` + zod schema** (推荐) | 与 3.1 同步做,zod schema 就是类型源头 |
| 引入 `tRPC` | 拒;全栈类型同步,但要重写路由层(从 Fastify 切到 tRPC procedure),代价大 |
| 引入 `GraphQL` / `oRPC` | 拒;同样路由层重写,前端不直接消费 GraphQL 风格 API,过度设计 |

**应用范围**:凡是 backend route 接收的 body / 返回的 data shape,**先**在 `packages/shared` 定义 zod schema,**再**用 z.infer 派生 TS 类型。前后端 import 同一份。

#### 3.4 服务分层 / DI — 不引入 DI 容器,继续 Fastify plugin 模式

**现状**:`apps/server/src/services/*` 已按职责切分;`apps/server/src/app.ts` 用 Fastify `app.prisma` / `app.log` 做"轻量 DI"。

**候选**:
| 库 | 评估 |
|---|---|
| **继续 Fastify plugin + decorator** (推荐) | 已存在;学习成本零;Fastify 官方模式 |
| 引入 `inversify` / `tsyringe` / `awilix` | 拒;服务规模小(< 20 个 service),反射/装饰器开销 > 收益;与 Fastify 装饰器命名空间易冲突 |
| NestJS 风格 | 拒;完全替换 Fastify,代价巨大 |

**应用范围**:不动。`docs/ISSUES.md:137` 提到的"类型/服务分层"是"按领域分子包"或"按层级拆文件夹",与 DI 容器无关。

### 4. 「库数量」守门

| 项 | 数量 |
|---|---|
| 新引入库 | **0** |
| 实际复用已装库 | 1 个 (`zod` 已在 shared + server 装着) |
| 调研后被拒候选 | 12 个 (yup / valibot / joi / gpt-tokenizer / tiktoken-node / tRPC / GraphQL / oRPC / inversify / tsyringe / awilix / NestJS) |

**核心结论**:**库不是越多越好**。现状 7+ 个 `js-tiktoken` 重复装、3 套 token 实现 → 真正需要的是**收口**(集中到 1 个文件),不是**加库**。解耦 = 减负,不是加码。

---

## 范围

**In scope**:
- 重写 `docs/ISSUES.md`,按上述结构
- 7 条 P0 全部标 RESOLVED
- Q1/Q3/Q5/Q6/Q7/Q8/Q10 标 RESOLVED
- Q9 保留 OPEN,加"待办"提示
- 新增"重复依赖 + 三套 token 实现"作为 [NEW] 高优项
- 新增"解耦候选库"4 个子节
- 新增"修复时间线"简表
- 提交并 commit

**Out of scope**:
- 不实现任何库选型结论(只**记录**);3.2 的 token 收口是另一个解耦任务
- 不动 `apps/server` / `apps/web` / `packages/*` 任何代码
- 不修 Q9(zod 接入);本次只把"Q9 仍 OPEN"这件事记清楚
- 不改 `KNOWN-ISSUES.md`(它是另一份长期清单)

---

## 影响

- 文档阅读者(主要是用户 + 后续接手的人):从过期快照 → 当前真实状态,信息可信度恢复
- 库选型结论:作为**后续解耦任务的输入**,本身不引入变更
- 与明天 Graph.vue 拆分任务:互不绑定,独立交付

---

## Self-Review

**1. Spec coverage:**
- ✅ 文档结构定义(节 1)
- ✅ 状态字段规范(节 2)
- ✅ 库选型 4 个子节(节 3)
- ✅ 守门原则(节 4)
- ✅ 范围(显式 In/Out)
- ✅ 决策来源(D1-D4 表格)

**2. Placeholder scan:**
- 无 "TBD" / "TODO" / "待补" / "fill in"

**3. Type consistency:**
- "RESOLVED yyyy-mm-dd by <hash>" 在 P0/Q 末统一格式
- "## [...]" 章节前缀统一

**4. Scope check:**
- 单文档刷新,无代码变更
- 库选型只**记录**,不实现,边界清晰
- 可由单 subagent 在一个 commit 完成

**5. Ambiguity check:**
- "7-char-hash" 明确(短 hash,7 位足以区分)
- "Open status" 标 `OPEN` 不加字段,避免与 RESOLVED 形式不一致(原文已用,沿用)
- "新发现"标 `[NEW yyyy-mm-dd]`,与 P0/Q 区分清楚

---

## 待办

落 spec → commit → 用户 review → subagent-driven-development 实施(1 个 task:刷新 ISSUES.md + commit)
