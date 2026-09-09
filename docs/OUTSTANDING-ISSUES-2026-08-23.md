# 剩余问题清单（2026-08-23 code-review 之后）

> 本次 code-review 报告的 25 个问题全部过完（P1 5/5、P2 24/24），整理仍需后续处理的事项。

## 架构类议题（需深入讨论）

### 1. `workerType` 字符串化贯穿边界
- DB 列是 `String`，路由 body 也是自由字符串
- 枚举只在 YAML seed 加载时被 `z.enum` 钉死
- 未知 workerType 会通过 `HARDCODED_TASK_DEFAULTS: Record<string,string>` 静默拿到泛泛兜底 prompt（"执行 XX 工作"），而非 fail-fast
- 建议：把 workerType 收敛为共享常量/枚举贯穿 schema→DB→路由；未知值应 fail-fast

### 2. `memory_organize` 历史兼容枚举值
- 仍留在 `WORKER_TYPES` 和 `WorkerTask` union 中
- 但无 seed、无 `HARDCODED_TASK_DEFAULTS` 项、前端 `getCallType` 显式当 unknown 兜底
- 是刻意的"漂移值兼容"，但长期应在 DB 清理旧行后从枚举移除

## 修复过程中的 TODO

### runtime-loader 兜底日志（commit `88ea77b`）
- 当前用 `console.warn`，消除完全静默
- TODO：后续增强为 `app.log.warn`（走 Fastify logger，可进监控）
- 需给 `loadRuntimeBase` / `loadWorkerTask` 加 app 参数（影响所有调用点）

## 之前被搁置的

### worker 层单测缺失
- `generate-processor.ts` 的 TOCTOU 修复和「查状态移进 try」修复没有直接 worker 层单测保护
- 现有覆盖都是 route 层（select/generate 端点）
- 要补可以统一做（需要 mock AI 调用）

### Worker 中 `rejected` 状态为死状态
- select 不再生产 `rejected`（见 `5416aa1`，候选是素材库不再废弃）
- worker 的 `SKIP_STATUSES = ['rejected', 'completed', 'failed']` 里 `'rejected'` 现在没有生产者
- 无害死状态，清理需删 schema 枚举值 + 改前端 mock，单独做

## 相关 commit 索引（本次会话）

| commit | 主题 |
|---|---|
| `fa1e5fe` | P1-1 CharacterBranchState 加 storyId（跨故事隔离） |
| `e9cf2c1` | P1-2 级联删除事务化 + 不吞错 |
| `17eb90c` | P1-3 select 不允许选空/未完成候选 |
| `08b23fd` | P1-4 codeMerge 边 weight 累加重置修复 |
| `c629e93` | P1-5 retry-stage 不再喂终态弧线 |
| `f3df255` | 并发竞态三连：乐观锁 |
| `dc70338` | stage 校验 + participants 保留 |
| `b5f785e` | optimizer 同 originUid 合并 + randomBytes(4) |
| `076c9f3` | isEnd 窗口粘滞 |
| `5416aa1` | select 不再废弃其他候选 |
| `5b3045a` | worker 查状态移进 try |
| `518655a` | 前端清理 409 死代码 |
| `2cc6a24` | generate 「最新章」门槛 + getLastChapter 排除番外 |
| `07a01f2` | 无 Provider 时标 failed |
| `242b976` | cumulativeGraph 主线回退死代码清理 |
| `2f26f04` | reviewing 期换正文加 warning |
| `92232a8` | memories POST 补 category/participants + 枚举校验 |
| `88ea77b` | runtime-loader 兜底加 warn + TODO |
