# v2 状态机重构 Design Spec

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `ChapterStatus` 从 8 个状态简化为 3 个 (`draft` / `reviewing` / `archived`)，让候选生成（`Draft`）与章节业务状态正交。删除为"生成锁"引入的所有补丁（`preLockStatus`、worker 抢锁状态恢复、路由状态翻转），让 archive 并发场景不再依赖跨字段的脆弱耦合。

**Architecture:** 单分支 `v2/state-machine` 内 5 个语义化 commit，每 commit 单点可回滚。无新库，依赖既有 Prisma + Fastify + Vitest + Pinia 工具链。

**Tech Stack:** 不引入新库。

---

## 关联

- **当前状态机现状**:`docs/DESIGN.md` §状态机、`Process.md` §Chapter Lifecycle
- **本次重构的"前置一致化"**:`docs/superpowers/specs/2026-06-17-regenerate-from-non-draft-states-design.md`(commit `pending`) 当时为缓解 GENERATING 状态写不下，引入了 review 路由把生成门槛推到 GENERATED 之后 —— v2 直接去掉 GENERATED / GENERATING 整组状态，绕过该缓解路径
- **路线图骨架**:`docs/superpowers/specs/2026-06-18-decoupling-roadmap-design.md` 提到的"chapters.ts 已按职责拆 route"是本 spec 的前置条件（已满足）
- **章节视图拆分**:`docs/superpowers/specs/2026-06-18-p4-chapters-view-split.md` 已落地的组件边界保护本次前端改动不会扩散到无关模块

---

## 用户决策记录(2026-07-24)

| # | 议题 | 用户决策 |
|---|------|----------|
| D1 | 状态收口目标 | 8 → 3 (draft/reviewing/archived) |
| D2 | archived 章节能否 generate | 不能；UI 隐藏按钮，路由兜底 400 |
| D3 | 候选与归档的并发 | 已入队的候选继续跑完；worker 仅检查 Draft.status（selected/rejected/completed/failed 跳过），不读 chapter.status |
| D4 | "select" 数据模型 | **不**新增 `Chapter.selectedDraftId`；只标记 `Draft.status='selected'` + 可选覆盖 `chapter.content` |
| D5 | DB 迁移策略 | UPDATE + enum 收口单次完成；可重入 |
| D6 | select draft 时 chapter.content 已存在 | 默认覆盖；弹确认窗（若新内容与现有内容不同） |
| D7 | prepare-archive 失败回退 | 统一回退到 `draft` |
| D8 | 实施路径 | 单分支 + 5 个 commit（schema → backend → frontend → cleanup → polish） |
| D9 | 测试范围 | 后端必做（vitest 路由/service 测试）；前端可选（composable 单测） |

---

## 哲学层

### Chapter = 环境快照容器

- 章节是"小说这个大环境"在某一点的**快照**:大纲 / 正文 / 角色状态 / 时间线 / 知识图谱 / 剧情弧线
- 章节状态反映"这份快照处于什么生命周期":
  - `draft` — 快照正在被编辑(可改大纲/正文,可发起新一轮候选)
  - `reviewing` — AI 已提取出新的快照(`pendingArchiveData`),等人审
  - `archived` — 快照已落库,只读,作为下一章 prompt 输入

### 候选生成 = 抽卡

- 候选(`Draft`)是用户对"下一份快照长什么样"的**几种可能**;与章节是否在编辑无关
- 用户可以反复抽(generate 多份),可以选一张(select),也可以一张都不选
- 候选是否被选中、是否完成、是否失败,**完全是 Draft 层语义**,不应污染 chapter 层

### 解耦的代价

- 失去"章节正在生成中"的全局可见信号 → UI 改用 Draft 层聚合(`allDraftsDone`、`anyDraftSelected`)
- 单向 archived → "取消归档"语义不存在,需要回退就删章节 + 级联清快照(与现状一致)

---

## 数据模型

### `ChapterStatus` enum: 8 → 3

**Before**(8 值):

```prisma
enum ChapterStatus {
  draft
  generating
  generated
  scored
  selected
  reviewing
  archived
  rejected
}
```

**After**(3 值):

```prisma
enum ChapterStatus {
  draft      // 可编辑：用户改大纲/正文、起抽卡
  reviewing  // AI 已抽出 pendingArchiveData，等待人工审
  archived   // 只读：作为下一章 prompt 输入
}
```

### Chapter 表字段调整

- **保留**:`status`、`content`、`outline`、`pendingArchiveData`、`summary`、`timelinePosition`、`graphSnapshot`、`graphDelta`、`isSideStory`、`parentChapterId`、`number` 等
- **删除**(commit 4 清理):
  - `Chapter.isGenerating` —— 历史冗余字段(v2 后无对应语义)
  - `Chapter.generatingAt` —— 同上
- **不新增**:`Chapter.selectedDraftId`(已决策 D4)

### Draft 表:保持不变

```prisma
enum DraftStatus {
  pending       // 历史字段, route 已不用, 保留兼容
  generating    // route 创建 draft 时的初始态
  completed     // AI 已生成
  failed        // AI 调用失败
  selected      // 用户已选
  rejected      // 用户选了别的, 此 draft 淘汰
}
```

候选状态完全独立于章节状态。

### 数据迁移

`prisma/migrations/<ts>_chapter_status_v2/migration.sql`:

1. **数据迁移**(先于 schema 同步):
   - `UPDATE Chapter SET status='draft' WHERE status IN ('generating','generated','scored','selected','rejected')`
   - 幂等:重复执行结果一致
2. **Schema 同步**:`enum ChapterStatus` 改 3 值,Prisma 生成 migration(SQLite/Postgres 都按字符串校验,无须 DROP VALUE)
3. **可重入**:迁移脚本幂等

---

## 后端路由

### 状态变迁矩阵(v2)

| 路由 | chapter.status 写操作 | 备注 |
|------|---------------------|------|
| `POST /api/chapters/:id/drafts`(generate) | **不再写** | 只 enqueue + 创建 `Draft.status='generating'` 行 |
| `POST /api/chapters/:id/drafts/:draftId/select` | **不再写** | 请求体 `{ overrideContent: boolean }`(默认 `true`);只更新 `Draft.status='selected'`;若 `overrideContent=true` 则把 draft.content 写入 chapter.content |
| `POST /api/chapters/:id/prepare-archive` | `draft → reviewing` | reviewing 的唯一入口;`reviewing → reviewing`(重试) |
| `POST /api/chapters/:id/archive`(confirm) | `reviewing → archived` | 单向;不再回退 |
| `PUT /api/chapters/:id`(更新大纲/正文) | 不变 | 仅允许 `draft` 状态编辑;其他返回 400 |
| `DELETE /api/chapters/:id` | 删除行 | archived 走 cascade;非 archived 直接 delete |

### generate-processor.ts 重构

**删除**:
- `job.data.preLockStatus` 字段(chapters-generate route 不再传)
- 末尾"恢复 chapter.status"那段 `updateMany where status='generating'`(当前 line 100-104)
- 注释里关于"worker 抢锁前章节状态"的整段叙事

**保留**:
```ts
const SKIP_STATUSES = ['selected', 'rejected', 'completed', 'failed']
const current = await prisma.draft.findUnique({ where: { id: draftId }, select: { status: true } })
if (!current || SKIP_STATUSES.includes(current.status)) continue
```
—— 候选是否"用户已决定 / 已完成"是 Draft 层语义,这段判断仍然正确。

### chapters-archive.ts lock 条件更新

```ts
// prepare-archive 锁
where: { id: chapterId, status: { in: ['draft', 'reviewing'] } }
//   原 ['selected', 'reviewing'], v2 改为 ['draft', 'reviewing']
//   - draft: 首次进入
//   - reviewing: 重试已失败的 prepare-archive
```

### chapters-generate.ts 删除"生成锁"

```ts
// 删除这段(已无意义:chapter.status 不再变 generating):
if (chapter.status !== 'draft') {
  return reply.status(400).send({ success: false, error: '...正在生成中...' })
}

// 替换为更轻的校验:
if (chapter.status === 'archived') {
  return reply.status(400).send({ success: false, error: '已归档章节不能生成新草稿' })
}
// 'reviewing' 仍允许(与"候选独立于章节状态"的哲学一致)
```

### chapters-crud.ts 更新校验

```ts
// PUT 大纲/正文:仅 draft 允许
if (chapter.status !== 'draft') {
  return reply.status(400).send({ success: false, error: `当前状态 ${chapter.status} 不允许编辑` })
}
```

### prepare-archive 失败回退

按 D7,失败时统一 `reviewing → draft`:

```ts
// prepare-archive 失败:
await prisma.chapter.update({
  where: { id: chapterId },
  data: { status: 'draft', pendingArchiveData: null }
})
// 不再需要 preLockStatus 区分 'selected' vs 'draft'——v2 只有 draft 一条入口
```

---

## 前端 UI

### 状态色 / 标签(`chapter-status.ts`)

```ts
export const CHAPTER_STATUSES = {
  draft:     { label: '草稿',     color: 'default', icon: '<existing-draft-icon>' },
  reviewing: { label: '待审核',   color: 'warning', icon: '<existing-reviewing-icon>' },
  archived:  { label: '已归档',   color: 'success', icon: '<existing-archived-icon>' }
} as const
// 删除: generating/generated/scored/selected/rejected/failed
// ('failed' 从未出现在 chapter 层, 仅 Draft 层; 前端防御项一并删)
```

### 章节操作按钮可见性矩阵

| 当前状态 | 编辑大纲/正文 | 生成候选 | 选候选覆盖 | Prepare Archive | Confirm Archive |
|---------|--------------|---------|-----------|-----------------|-----------------|
| `draft` | ✅ | ✅ | ✅(带确认窗) | ✅ | — |
| `reviewing` | — | — | — | — | ✅ |
| `archived` | — | — | — | — | — |

—— archived 章节下,"生成"按钮不渲染;UI 上呈现纯只读视图(章节正文 + 时间线)。

### 候选"选中"确认窗

实现位置:`useDraftManager.ts` → `selectDraft(draftId)`:

```ts
async function selectDraft(draftId: string) {
  const draft = drafts.value.find(d => d.id === draftId)
  const chapterContent = currentChapter.value.content ?? ''
  const contentDiffers = draft.content !== chapterContent

  if (contentDiffers) {
    const confirmed = await dialog.confirm({
      title: '覆盖章节正文？',
      content: '当前章节已有正文。继续将以所选候选内容覆盖。',
      positiveText: '覆盖',
      negativeText: '取消'
    })
    if (!confirmed) return
  }

  await chaptersApi.selectDraft(storyId, chapterId, draftId)
  // 刷新 chapter.content
}
```

### 删除轮询锁逻辑

`useDraftManager.ts` 当前 `isGenerating` 等 ref 来自 chapter.status 的判断,**v2 删除**:

```ts
// 删除:currentChapter.status === 'generating' / 'generated' 的判断分支
// 改为纯 Draft 层:
const allDraftsDone = computed(() =>
  drafts.value.every(d => d.status === 'completed' || d.status === 'failed')
)
const anyDraftSelected = computed(() =>
  drafts.value.some(d => d.status === 'selected')
)
```

### 章节树(`ChapterTree.vue`)

- 状态色映射随 CHAPTER_STATUSES 收敛
- 过滤下拉:"全部 / 草稿 / 待审核 / 已归档" 4 个选项(去掉 generating/generated/scored/selected/rejected 6 个)

### ReviewingPanel.vue

不变。仍然仅在 `chapter.status === 'reviewing'` 时挂载;confirm-archive / cancel-review 按钮逻辑保持。

### chapters.ts (Pinia store)

- 删除针对 `generating` / `generated` / `scored` / `selected` 的所有 `if` 分支
- `currentChapter.status` 只在 3 个值上做判断

---

## 测试策略

### 测试骨架搭建(commit 5 的一部分)

**目录结构**:
```
apps/server/
├── vitest.config.ts
├── src/
│   ├── test-utils/
│   │   ├── test-app.ts       # Fastify factory (test prisma + memory queue)
│   │   ├── test-db.ts        # 内存 SQLite + 每次测试 fresh schema
│   │   └── fixtures.ts       # chapter/draft/story 构造器
│   └── routes/
│       └── __tests__/
│           ├── chapters-generate.test.ts
│           ├── chapters-archive.test.ts
│           └── chapters-crud.test.ts
```

**`test-app.ts` 要点**:
- 用 `prisma-client-js` provider 的 SQLite `:memory:` + 跑 migration
- 注入 mock `callAIWithLog` —— 测试不应真打 AI
- 用 `MemoryQueue` 替代 BullMQ(项目已有 fallback)

### v2 关键不变量(必须被测试覆盖)

| 不变量 | 测试 |
|--------|------|
| generate 路由不改 chapter.status | before/after chapter.status 都为 'draft' |
| select draft 路由不改 chapter.status | before/after 一致 |
| worker 跑完不改 chapter.status | 跑 generate processor 后 chapter.status 仍为 'draft' |
| prepare-archive: draft → reviewing | 状态正确翻转 |
| prepare-archive 失败 → 回退到 draft | mock AI 抛错, 验证 rollback |
| archive: reviewing → archived(单向) | 状态翻转 |
| archived 章节 generate → 400 | 路由层断言 |
| 候选状态独立于章节状态 | 同一 chapter 并行 5 个 generate, 前者失败不影响后者入队 |

### TDD 推进顺序

1. **commit 1(schema + migration)之前**:
   - 先写"prepare-archive: draft → reviewing"的红测 —— 这条**今天就过**, 证明骨架可跑
2. **commit 2(路由解耦)**:每个"删除 status 翻转"前先写红测
3. **commit 4(清理死态)**:用静态扫描 + 测试覆盖率证明无外部引用
4. **commit 5(polish)**:补 useDraftManager、ChapterTree 的前端测试(可选)

### 前端测试

v2 范围内**不强制**。如果时间允许,加 1-2 个关键测试:
- `useDraftManager.ts` 的 `selectDraft` 确认窗逻辑
- `CHAPTER_STATUSES` 配置完整性

用 vitest + happy-dom(无需 @vue/test-utils 跑组件, 单测 composable 即可)。

### CI 接入

- `pnpm test` 已在 root scripts, 加进 `pnpm typecheck && pnpm lint && pnpm test` 一条 verify 命令
- 本地 pre-commit hook 可选(不强加)

---

## 文档更新

| 文档 | 改动 | 优先级 |
|------|------|--------|
| `CLAUDE.md` | Chapter Lifecycle 段落、状态机图(8 → 3) | P0 |
| `AGENTS.md` | 路由/服务表(chapters-generate 不再翻 status、generate-processor 简化) | P0 |
| `Process.md` | 章节生命周期走查(v2 版本) | P0 |
| `docs/DESIGN.md` | 新增"v2 状态机重构"决策记录 | P1 |
| `docs/LOGIC.md` | 状态机章节重写 | P1 |
| `docs/ISSUES.md` | 关闭状态机相关旧 issue; 新增 v2 重构条目 | P1 |
| `KNOWN-ISSUES.md` | 移除已修条目; 标注候选状态独立约束 | P2 |
| `README.md` | 不涉及用户可见行为变更 | — |

### CLAUDE.md 状态机图(v2)

```text
draft ──generate──┐
  ↑              ↓ (候选独立, chapter.status 不变)
  │         Draft.status: generating/completed/failed/selected/rejected
  │              ↓
  │         user select → chapter.content 覆盖(带确认窗)
  ↓              ↓
  └─prepare-archive 失败─┘
       ↓ 成功
   reviewing ──user 审 pendingArchiveData── archive 确认
       ↓                                ↓
   (失败回退到 draft)              archived (只读, 作为下一章输入)
```

### DESIGN.md 新增条目骨架

> ## v2 状态机重构(2026-07-24)
>
> **Why**: 原 8 态枚举把"候选生成锁"和"章节业务状态"两个独立维度挤进同一个字段, 导致 select/prepare-archive 失败时的回滚语义被迫引入 `preLockStatus` 等补丁字段。Worker 与路由相互等待对方写 status 的耦合让 archive 并发场景极易踩坑。
>
> **What**:
> - `ChapterStatus` 收口到 3 值:`draft` / `reviewing` / `archived`
> - 候选生成与章节状态正交: worker 不再 `updateMany` chapter.status
> - 失败的 prepare-archive 统一回退到 `draft`
> - archived 章节不可再生成新候选(UI 层隐藏按钮, 路由层兜底 400)
>
> **Trade-off**:
> - 失去"章节正在生成中"的全局可见信号;UI 改用 Draft 层聚合判断(`allDraftsDone`、`anyDraftSelected`)
> - 单向 archived 让"取消归档"语义不存在 —— 取消 = 删章节 + 级联清快照(与现状一致)
>
> **How to apply**: 未来新增章节相关功能时, 候选相关问题去 Draft 层查, 章节业务流转查 `ChapterStatus`, 两者不要混用。

---

## Git 工作流

```
master
 └── v2/state-machine   (新分支)
       ├── commit 1: schema enum 收口 + 数据迁移
       ├── commit 2: 后端路由/worker 解耦
       ├── commit 3: 前端 UI 简化
       ├── commit 4: 清理死态字段/路由分支
       └── commit 5: 测试骨架 + 文档
```

- 每个 commit 单独 `pnpm typecheck && pnpm lint && pnpm test` 通过
- 不强推 squash(保留语义化历史)
- merge 回 master 前需用户最终 review

### 发布顺序

1. 5 个 commit 全部落地 → 通知用户做最终 review
2. 用户验收 → merge v2/state-machine → master
3. **不**自动部署(项目无 CI/CD)

---

## Trade-offs

- **失去全局"正在生成"信号**: UI 须自己聚合 Draft 状态
- **archived 单向**: 不能"反归档", 错误路径 = 删章节 + 级联清理
- **migration 单步**: 老 DB 必须先迁移; 期间若有新写入按旧 enum 校验会失败, 部署窗口需协调
- **测试骨架新增**: 工程投入上升(本次必须)

## 不在 v2 范围内

- "归档中"工作流优化(用户提到但推迟到下个 phase)
- 章节 UI 组件再拆分(已在前置 spec 完成)
- Graph 编辑器重构(独立 spec)
- AI 评分维度调整(与状态机正交)

---

## Spec 自审结果

- ✅ 无 placeholder / TODO
- ✅ 各节无矛盾(数据/路由/前端/测试/文档闭环)
- ✅ 范围聚焦 5 个 commit
- ✅ 歧义已收口(覆盖、删除、保留、并发行为均有显式说明)