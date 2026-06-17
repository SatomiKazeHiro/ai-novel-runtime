# 重新生成候选（generated / selected 状态）设计

> **状态:** 待用户 review
> **目标:** 让章节在 `generated` / `selected` 状态也能"重新生成候选",纯加法 — 不动旧候选、不动 `Chapter.content`、不动已选 draft 标记。新候选追加到列表供用户参考对比。
> **取代:** 无（新增功能,非替换）
> **关联:** Q#10 决策（`5f80270`）删除了 `generated` 状态的"重新生成"分支,本 spec 重新打开此能力,但用更窄的语义(纯加法)避免 Q#10 当时的脏窗口问题

## 1. 背景

章节状态机当前是:

```
draft → generating → generated → scored → selected → reviewing → archived
                                ↑         ↑
                                当前重生成在这两个状态被拒绝
```

### 1.1 现状(Q#10 决策的副作用)

`apps/server/src/routes/chapters.ts:353-359` 的 generate 路由:

```typescript
// 只允许 draft 状态生成候选（Q#10 决策：generated 重新生成暂不支持）
if (chapter.status !== 'draft') {
  return reply.status(400).send({
    success: false,
    error: `章节当前状态为 ${chapter.status}，只允许 draft 状态生成候选`
  })
}
```

后果:用户在 `generated` 状态看到候选不满意,在 `selected` 状态想多看几个候选对比,唯一选择是**删除整个章节**(cascade 删 memory / timeline / character-branch)→ 重建 → 重新填大纲 → 重新生成。摩擦过大,实际使用中频繁遇到。

### 1.2 Q#10 的 trade-off(为何当时删掉重生成)

旧代码(5f80270 之前)在 `generated` 状态支持重生成,流程是:

```typescript
// 旧实现（Q#10 删除）
if (chapter.status === 'generated') {
  const deleted = await prisma.draft.deleteMany({ where: { chapterId } })
  // ... 然后生成新候选
}
```

Q#10 commit message 原文:

> 双击 / 取消 / 网络重试时,"删旧 + 重建" 的两步操作没有原子性,会出现"用户选好候选 A、点重生成、瞬间只剩候选 B 的草稿"的脏窗口

### 1.3 用户现场反馈(2026-06-17)

> 在 `generated` 和 `selected` 时,提示"章节当前状态为 selected,只允许 draft 状态生成候选"。如果不满意的话,就不能生成了吗,此时好像还没到准备归档吧。

用户的设计意图(2026-06-17 已确认):
- 重新生成是**为参考对比**,**不是**为替换已选候选
- 已选 / 已保存 / 已编辑的 draft 必须保留,不能因为新候选进列表而被覆盖
- 旧候选全部保留,新候选追加
- `selected` 状态重新生成后,状态仍为 `selected`(`Chapter.content` 不动)

## 2. 目标 & 非目标

### 2.1 目标

1. **多轮候选可叠加**:`draft` / `generated` / `selected` 三态都能调 generate,新候选追加到列表
2. **Chapter.content 不被覆盖**:重新生成路径中,`Chapter.content` 只有显式 `select` 路由才能改
3. **已选状态保留**:`selected` 章节重新生成后,状态保留 `selected`,旧 selected draft 仍标 `status='selected'`
4. **零破坏性**:不删除任何 draft,不修改 `Chapter.content`,不破坏 prepare-archive 流程
5. **用户知情权**:重新生成前显示"已有 N 个候选,新生成 K 个追加,预估消耗 X tokens"

### 2.2 非目标

- **不**支持 per-chapter token budget / cost cap(超出本次范围)
- **不**支持 candidate grouping / 多轮分组展示(用户已拒绝,仅按 `createdAt desc` 排序)
- **不**改 prompt 编译逻辑(`RuntimePromptCompiler` 不变)
- **不**改 front-end 的 prompt preview 流程
- **不**修 queue job 丢失导致章节卡在 `generating` 的旧 bug(可后续 sprint 处理)
- **不**加 cron 清理超量旧 draft(用户拒绝硬上限)

## 3. 架构

### 3.1 数据流

```
┌────────────────────────────────────────────────────────────────┐
│ 用户在 Chapters.vue 点击"再生成 ×3"按钮                          │
│                                                                │
│  (1) 章节当前 status: draft | generated | selected              │
│  (2) 显示 token 成本确认对话框（draft 状态跳过,selected/         │
│      generated 状态显示"N 个候选,再生成 3 个追加,预估 X tokens")│
└────────────────────────────────────────────────────────────────┘
                              ↓
┌────────────────────────────────────────────────────────────────┐
│ POST /api/chapters/:chapterId/generate                          │
│ apps/server/src/routes/chapters.ts:335                          │
│                                                                │
│   (a) 读 chapter,捕获 preLockStatus = chapter.status            │
│   (b) 状态检查:preLockStatus ∈ {draft, generated, selected}     │
│       失败 → 400("章节当前状态为 X,不允许生成候选")              │
│   (c) 原子锁:updateMany where status ∈ {draft, generated,       │
│       selected} → status='generating'                          │
│       影响行 0 → 409(并发,现有行为)                              │
│   (d) 创建 N 个新 Draft 记录(status='generating', 附              │
│       chapterId, temperature, maxTokens, version='vN+1' 等)     │
│   (e) Chapter.compiledPrompt = 当前 compile 结果                 │
│   (f) generateQueue.add('generate-chapter', {                   │
│         draftIds, chapterId, storyId, compiled,                 │
│         temperatures, maxTokens, chapterTitle, chapterOutline,  │
│         preLockStatus   ← 新增                                  │
│       })                                                       │
└────────────────────────────────────────────────────────────────┘
                              ↓
┌────────────────────────────────────────────────────────────────┐
│ generate-processor.ts:createGenerateProcessor                  │
│ apps/server/src/services/generate-processor.ts:13               │
│                                                                │
│   读 job.data.preLockStatus                                    │
│   对每个 draftId:                                              │
│     调 AI → 写 draft.content + status='completed'               │
│     失败 → draft.status='failed' + errorMessage                │
│                                                                │
│   全部完成后:                                                  │
│     if successCount > 0:                                       │
│       chapter.status = (preLockStatus === 'draft'               │
│                          ? 'generated'                          │
│                          : preLockStatus)                       │
│       // draft     → generated  (首次生成完成)                  │
│       // generated → generated  (再生成完成,本身就在)           │
│       // selected  → selected   (再生成完成,状态保留)          │
│     else:                                                      │
│       chapter.status = preLockStatus  // 全失败,避免卡 generating│
└────────────────────────────────────────────────────────────────┘
                              ↓
┌────────────────────────────────────────────────────────────────┐
│ 前端轮询 draftsApi.list (每 2s)                                 │
│ apps/web/src/composables/useDraftManager.ts:22-42               │
│                                                                │
│   新 candidate 出现 → UI 候选 Tabs 末尾追加新 Tab                │
│   (N+1) 个 tab,按 createdAt desc 排序,selected draft 带 ✓ 标记  │
└────────────────────────────────────────────────────────────────┘
```

### 3.2 状态机扩展

```
现有状态机(保留):
  draft → generating → generated
  generated → select → selected
  selected → prepare-archive → reviewing
  reviewing → archive → archived

新增转换:
  generated → generating → generated     (再生成,纯加法)
  selected → generating → selected       (再生成,纯加法,Chapter.content 不动)
```

**不**新增的状态:`regenerating` 之类。复用现有的 `generating` 状态,`preLockStatus` 决定恢复目标。

### 3.3 变更范围

| 文件 | 变更 | 类型 |
|------|------|------|
| `apps/server/src/routes/chapters.ts` | generate 路由状态检查 + 锁扩到 [draft, generated, selected] + 捕获 preLockStatus + 透传到 job payload;select 路由锁扩到 [generated, scored, selected] | 修改 |
| `apps/server/src/services/generate-processor.ts` | 读 job.data.preLockStatus;成功后用其恢复 chapter.status;全失败也恢复 | 修改 |
| `apps/web/src/views/Chapters.vue` | 候选按钮 v-if 放宽到 [draft, generated, selected] + 按钮文案动态("默认候选 ×3" / "再生成 ×3");token 成本确认对话框(仅 generated/selected);候选 Tab 加 ✓ 标记;候选区域上方"共 N 个候选" | 修改 |
| `apps/web/src/composables/useDraftManager.ts` | 无 schema/状态变化,无需改 | 无 |
| `apps/server/src/__tests__/chapters-generate-state.test.ts` | 覆盖新 allowed 列表(3 正向 + 4 负向) | 新增 |
| `apps/server/src/__tests__/generate-processor-preLockStatus.test.ts` | 覆盖 worker 的 3 种 preLockStatus 恢复路径(全成功 + 全失败) | 新增 |

**非变更**:
- `prisma/schema.prisma` — Draft / Chapter schema 都不动
- `apps/server/src/services/runtime-loader.ts` — 不动
- `apps/server/src/services/ai-call-logger.ts` — 不动
- `apps/web/src/composables/useChapterEditor.ts` — 不动(章节内容编辑流程不变)
- `apps/web/src/components/ReviewingPanel.vue` — 不动(归档审查阶段不进入此流程)

## 4. 详细设计

### 4.1 generate 路由改动(`apps/server/src/routes/chapters.ts:334-486`)

**before**:

```typescript
// 只允许 draft 状态生成候选（Q#10 决策：generated 重新生成暂不支持）
if (chapter.status !== 'draft') {
  return reply.status(400).send({
    success: false,
    error: `章节当前状态为 ${chapter.status}，只允许 draft 状态生成候选`
  })
}

// 状态机独占锁：原子性 updateMany（防止双击并发产生 2 批 draft）
const lockResult = await prisma.chapter.updateMany({
  where: { id: chapterId, status: 'draft' },
  data: { status: 'generating' }
})
```

**after**:

```typescript
// 允许 draft / generated / selected 三态生成候选
// - draft: 首次生成
// - generated: 已有候选不满意,再生成新的(追加)
// - selected: 已选了一个,想多看几个对比(追加,Chapter.content 不动)
const GENERATE_ALLOWED_STATUSES = ['draft', 'generated', 'selected'] as const
if (!GENERATE_ALLOWED_STATUSES.includes(chapter.status as any)) {
  return reply.status(400).send({
    success: false,
    error: `章节当前状态为 ${chapter.status}，只允许 draft / generated / selected 状态生成候选`
  })
}

const preLockStatus = chapter.status   // ← 新增:抢锁前捕获,塞进 job payload

// 状态机独占锁：原子性 updateMany（防止双击并发产生 2 批 draft）
const lockResult = await prisma.chapter.updateMany({
  where: { id: chapterId, status: { in: GENERATE_ALLOWED_STATUSES as unknown as string[] } },
  data: { status: 'generating' }
})
if (lockResult.count === 0) {
  return reply.status(409).send({
    success: false,
    error: '章节正在生成中或状态不允许，请刷新后重试'
  })
}
```

**job payload 扩展**(line 472-481):

```typescript
await generateQueue.add('generate-chapter', {
  draftIds: generatingDrafts.map(d => d.id),
  chapterId,
  storyId,
  compiled,
  temperatures: generatingDrafts.map((_, i) => temperatures[i] ?? (0.6 + i * 0.15)),
  maxTokens,
  chapterTitle: chapter.title,
  chapterOutline: chapter.outline,
  preLockStatus   // ← 新增
})
```

**关键不变项**:
- **不**调用 `prisma.draft.deleteMany`(Q#10 删掉的逻辑,本次明确**不**复活)
- 新 candidate 的 `version` 字段由现有创建逻辑自动编号(见 `chapters.ts:446-455`:`版本${existingDraftCount + i + 1}(偏${style}版)`)。`existingDraftCount` 是 `prisma.draft.count({where:{chapterId}})`,包含所有历史 draft(含 failed / rejected / selected),所以第二轮生成会得到 版本4-6(假设第一批 3 个),第三轮 版本7-9,以此类推。**本次不需为 version 分配逻辑添加任何代码**
- `Chapter.content` / `Chapter.compiledPrompt` 的写入规则不变

### 4.2 queue worker 改动(`apps/server/src/services/generate-processor.ts:13-74`)

**before**(line 12-74):

```typescript
export function createGenerateProcessor(app: FastifyInstance) {
  return async (job: any) => {
    const { draftIds, chapterId, storyId, compiled, temperatures, maxTokens, chapterTitle, chapterOutline } = job.data
    // ... 遍历 draftIds 调 AI ...

    // 只要有成功完成的，就更新章节状态为 generated
    if (successCount > 0) {
      await prisma.chapter.update({
        where: { id: chapterId },
        data: { status: 'generated' }
      })
    }
    // 全失败时不动状态,章节卡在 'generating'(旧 bug,本次顺手修)
  }
}
```

**after**:

```typescript
export function createGenerateProcessor(app: FastifyInstance) {
  return async (job: any) => {
    const { draftIds, chapterId, storyId, compiled, temperatures, maxTokens,
            chapterTitle, chapterOutline, preLockStatus } = job.data
    //                                                                  ↑ 新增
    app.log.info(`[Generate] Processing ${draftIds.length} drafts for chapter ${chapterId} (preLockStatus=${preLockStatus})`)

    const prisma = app.prisma
    let successCount = 0
    let failCount = 0

    for (let i = 0; i < draftIds.length; i++) {
      // ... 调 AI + 写 draft(不变) ...
    }

    // 恢复 chapter.status:用抢锁前的状态决定,而不是写死 'generated'
    //   draft     → generated  (首次生成完成)
    //   generated → generated  (再生成完成,本身就在)
    //   selected  → selected   (再生成完成,状态保留,Chapter.content 不动)
    // 修复旧 bug:全失败时也恢复到 preLockStatus,避免章节卡在 'generating'
    const restoreStatus = preLockStatus === 'draft' ? 'generated' : preLockStatus
    await prisma.chapter.update({
      where: { id: chapterId },
      data: { status: restoreStatus }
    })

    app.log.info(`[Generate] Done for chapter ${chapterId}: ${successCount} success, ${failCount} failed, restored to ${restoreStatus}`)
    return { successCount, failCount, total: draftIds.length }
  }
}
```

**两个修复点**:
1. `preLockStatus` 决定恢复目标(核心改动)
2. 全失败时也调用 update(顺手修旧 bug)

**兼容性**:
- 旧 in-memory queue / Redis queue 都不感知 job payload schema(动态读取),无 schema 迁移成本
- 现有调用方都通过 `generateQueue.add` 走同一 payload,只要 generate 路由塞了 preLockStatus,worker 就有

### 4.3 select 路由锁扩(`apps/server/src/routes/chapters.ts:488-530`)

**before**(line 497-515):

```typescript
// 只允许 generated 状态选择候选
if (chapter.status !== 'generated') {
  return reply.status(400).send({
    success: false,
    error: `章节当前状态为 ${chapter.status}，只允许 generated 状态选择候选`
  })
}

const lockResult = await app.prisma.chapter.updateMany({
  where: { id: chapterId, status: { in: ['generated', 'scored'] } },
  data: { status: 'selected' }
})
```

**after**:

```typescript
// 允许 generated / scored / selected 三态切换候选
// - generated / scored: 首次/评分后选择
// - selected: 已选了一个,看到新生成的更好的候选想切换
// 切换路径下,UI 在 Chapters.vue:963-975 的 handleAdoptDraft 已有
// "确认覆盖 右侧正文已有内容"对话框兜底
if (chapter.status !== 'generated' &&
    chapter.status !== 'scored' &&
    chapter.status !== 'selected') {
  return reply.status(400).send({
    success: false,
    error: `章节当前状态为 ${chapter.status}，只允许 generated / scored / selected 状态选择候选`
  })
}

const lockResult = await app.prisma.chapter.updateMany({
  where: { id: chapterId, status: { in: ['generated', 'scored', 'selected'] } },
  data: { status: 'selected' }
})
```

**`tx.draft.updateMany` 行为不变**(line 523-527):

```typescript
await app.prisma.$transaction(async (tx) => {
  // 所有 draft 标 rejected
  await tx.draft.updateMany({ where: { chapterId }, data: { status: 'rejected' } })
  // 选中的 draft 标 selected
  await tx.draft.update({ where: { id: body.draftId }, data: { status: 'selected' } })
  // chapter.content 覆盖为新 draft 的内容
  await tx.chapter.update({ where: { id: chapterId }, data: { status: 'selected', content: draft.content || undefined } })
})
```

**潜在问题与缓解**:
- 切到 `selected` 状态后,前面轮次所有 `status='selected'` 的 draft 都被改成 `rejected` → 旧 selected 标记丢失
- **接受**:用户主动选新候选 = 旧的不再 selected,语义正确。如果用户后悔,可重新选回旧的(在 list 中仍是 `rejected` 但 content 存在,允许再次 `select`)
- UI 上"采用此版本"按钮对 `rejected` draft 也可用,因为 select 路由只锁 chapter.status,不查 draft.status

### 4.4 UI 改动(`apps/web/src/views/Chapters.vue:348-367`)

**变更 1:按钮 v-if + 动态文案**

```vue
<n-button
  v-if="editor.currentChapter && ['draft', 'generated', 'selected'].includes(editor.currentChapter.status)"
  type="primary"
  size="small"
  @click="handleGenerateDefault"
  :loading="drafts.generating"
  :disabled="drafts.generating"
>
  <template v-if="drafts.generating">生成中...</template>
  <template v-else-if="editor.currentChapter.status === 'draft'">默认候选 ×3</template>
  <template v-else>再生成 ×3</template>
</n-button>
```

**变更 2:handleGenerateDefault 加确认对话框(仅非 draft 状态)**

```typescript
async function handleGenerateDefault() {
  if (!editor.currentChapter || !storyId()) return;

  // 仅 generated/selected 状态弹 token 成本确认
  // draft 状态是首次生成,直接放行
  if (['generated', 'selected'].includes(editor.currentChapter.status)) {
    const existingCount = drafts.drafts.length
    const newCount = 3
    // 粗估:每候选 ~maxTokens × 1.3 (含 system prompt + 输出冗余)
    const estimatedTokens = newCount * (drafts.customMaxTokens || 4096) * 1.3
    const ok = await new Promise<boolean>(resolve => {
      dialog.warning({
        title: '生成新候选',
        content: `当前已有 ${existingCount} 个候选,本次再生成 ${newCount} 个会追加到列表(旧候选保留)。\n\n` +
                 `预估消耗约 ${Math.round(estimatedTokens / 1000)}K tokens(取决于模型 max_tokens)。\n\n` +
                 `确认开始生成?`,
        positiveText: '确认生成',
        negativeText: '取消',
        onPositiveClick: () => resolve(true),
        onNegativeClick: () => resolve(false),
        onClose: () => resolve(false)
      })
    })
    if (!ok) return
  }

  const result = await drafts.generate(
    editor.currentChapter.id,
    storyId()!,
    [0.6, 0.75, 0.9],
    editor.selectedProfileId,
  )
  if (result.success) {
    prompt.tokenStats = result.tokens
    prompt.layerStats = result.layers
  }
}
```

**变更 3:候选 Tab 的 selected 标记**

```vue
<n-tab-pane
  v-for="draft in drafts.drafts"
  :key="draft.id"
  :name="draft.id"
  :tab="draft.status === 'selected' ? `${draft.version} ✓` : draft.version"
>
```

**变更 4:候选区域上方摘要**

```vue
<n-space
  v-if="drafts.drafts.length > 0"
  align="center"
  style="margin-bottom: 8px"
>
  <n-text depth="3" style="font-size: 12px">
    共 {{ drafts.drafts.length }} 个候选
    <template v-if="editor.currentChapter?.status === 'selected'">
      ,已选 1 个(右上角带 ✓)
    </template>
  </n-text>
</n-space>
```

**约束**:
- **不**改"采用此版本"按钮的逻辑(已有"确认覆盖"对话框)
- **不**改评分 / 删除按钮(对所有 draft 一视同仁)
- **不**加新 modal / drawer,仅复用现有 dialog.warning

### 4.5 自定义 ×1 按钮

`handleGenerateCustom` 也走 generate 路由(走同样的 allowed 列表),因此**不需改动函数体**,但需要在弹窗里复用相同的确认对话框(可选;draft 状态可豁免)。

为避免改动过大,**本次不处理 `handleGenerateCustom` 的确认对话框** — 用户在 `customMaxTokens` modal 里已经手动设了参数,自然知情。如果后续需要,可在该 modal 内嵌相同确认。

## 5. 错误处理

| 场景 | 行为 | 失败恢复 |
|------|------|---------|
| 重新生成时 `preLockStatus='generated'`,部分候选失败 | chapter.status 恢复 'generated',失败 draft 标 failed,成功的显示 | UI 正常,用户可删失败的 / 重新生成 |
| 重新生成时 `preLockStatus='selected'`,全部失败 | chapter.status 恢复 'selected',用户仍可编辑已选正文 | 用户可再点"再生成"或继续编辑 |
| 重新生成时 `preLockStatus='draft'`,全失败 | chapter.status 恢复 'generated'(preLockStatus='draft' → 首次生成完成态) | 用户可重新点生成 |
| 并发重生成(双击) | updateMany lock 失败 → 409,前端 `useDraftManager.ts:75` 已 warning | 不需要再点,前一个 job 还在跑 |
| queue job 丢失(Redis 异常) | 章节卡在 'generating'(旧行为,本次不修) | 后续 sprint 处理(需要 cron / 手动 reset) |
| select 路由从 selected 状态切换候选 | 锁扩后允许,UI "确认覆盖" 对话框兜底(line 963-975) | 用户取消 → 旧 selected 保留 |
| preLockStatus 字段缺失(老 queue 残留 job) | worker 读不到 → 用默认值 'draft' 处理(保守) | 旧 job 完成后章节回到 'generated',用户可继续 |

### 5.1 旧 job 兼容性

如果 Redis 中残留旧版本 queue job(payload 无 `preLockStatus`),worker 的 `job.data.preLockStatus` 会是 `undefined`。处理:

```typescript
const preLockStatus = job.data.preLockStatus ?? 'draft'  // 兜底
const restoreStatus = preLockStatus === 'draft' ? 'generated' : preLockStatus
```

`preLockStatus=undefined` 走 'draft' 路径,恢复 'generated' — 与旧行为一致。

## 6. 测试计划

### 6.1 单元测试

**`apps/server/src/__tests__/chapters-generate-state.test.ts`**(新增):

- ✅ draft 状态可调 generate(原有行为,回归)
- ✅ generated 状态可调 generate(新能力)
- ✅ selected 状态可调 generate(新能力)
- ❌ generating 状态拒绝(并发,409 已有)
- ❌ scored 状态拒绝(不该支持)
- ❌ reviewing 状态拒绝(prepare-archive 流程,不该被打断)
- ❌ archived 状态拒绝(终态)
- ❌ rejected 状态拒绝(终态)
- ✅ preLockStatus 正确捕获并塞进 queue job payload

**`apps/server/src/__tests__/generate-processor-preLockStatus.test.ts`**(新增):

- preLockStatus='draft' + 全成功 → chapter.status='generated'
- preLockStatus='draft' + 部分成功 → chapter.status='generated'(只要有成功)
- preLockStatus='draft' + 全失败 → chapter.status='generated'(旧 bug 修复:不再卡 generating)
- preLockStatus='generated' + 全成功 → chapter.status='generated'
- preLockStatus='generated' + 部分成功 → chapter.status='generated'
- preLockStatus='generated' + 全失败 → chapter.status='generated'
- preLockStatus='selected' + 全成功 → chapter.status='selected'(核心新能力)
- preLockStatus='selected' + 部分成功 → chapter.status='selected'
- preLockStatus='selected' + 全失败 → chapter.status='selected'
- preLockStatus=undefined(旧 job 兜底) + 全成功 → chapter.status='generated'
- 全路径:Chapter.content 不被 worker 修改(关键不变项)

### 6.2 集成测试

**`apps/server/src/__tests__/chapters-regenerate.test.ts`**(新增):

- draft → generate → generated,assert preLockStatus 透传
- generated → generate → generated,assert 新 draft 追加,旧 draft 保留
- selected → generate → selected,assert 新 draft 追加,Chapter.content 不动
- selected → generate → select(新 draft),assert 切换成功(锁扩了)

### 6.3 UI 测试

手动(无可用 vitest-browser 框架):
- [ ] draft 状态:按钮显示"默认候选 ×3",不弹确认
- [ ] generated 状态:按钮显示"再生成 ×3",点弹确认对话框,确认后生成
- [ ] selected 状态:按钮显示"再生成 ×3",点弹确认,确认后生成,旧 selected draft 仍带 ✓
- [ ] 再生成后:候选 Tab 数量增加,新 Tab 在末尾(因 createdAt desc)
- [ ] selected 状态点新候选的"采用此版本":弹"确认覆盖"对话框,确认后切换

## 7. 风险与权衡

### 7.1 已知风险

- **draft 数量无上限**:用户反复点"再生成"会无限累积。可缓解(后续):
  - cron 清理:每天删除 30 天前未选中 / 未评分的 draft
  - 软上限:达到 30 个时 warn
  - 硬上限:达到 50 个时 400 拒绝
  - 本次按用户决策不做
- **token 成本粗估不精确**:`estimatedTokens = newCount × maxTokens × 1.3` 是粗估,实际取决于 system prompt 大小、输入长度等。用户实际看到的 token 消耗可能与预估偏差 ±30%。可接受:确认对话框目的是提醒,不是精确账单
- **selected 状态切换候选是隐性破坏**:`Chapter.content` 会被覆盖,虽然 UI 有"确认覆盖"对话框,但用户可能误点。已接受:与"采用此版本"按钮的现有行为一致
- **preLockStatus 通过 job payload 透传**:job payload 在 Redis 中是明文 JSON,无敏感字段(只是 status 字符串),无安全风险

### 7.2 显式不做的事

- 不修改 `Chapter.content` 在重新生成路径中的写入(本次不写入,留 select 路由独占)
- 不修改 `Draft.version` 分配逻辑(保持 v1/v2/v3 简单命名,新批仍分配新数字)
- 不加 candidate 轮次标记 / 分组(用户拒绝)
- 不加 draft 软删除(用户拒绝)
- 不修 queue job 丢失的旧 bug(后续 sprint)
- 不改 prompt 编译 / runtime-loader / ai-call-logger
- 不加 cron 清理(用户拒绝硬上限)
- 不改 archive / prepare-archive / select 路由的其它分支
- 不改 ReviewingPanel(归档审查阶段不进入此流程)
- 不改 schema(`prisma/schema.prisma` 0 改动)

## 8. 上线 checklist

- [ ] Task #66 写实现计划(writing-plans skill)
- [ ] 子任务 1:generate 路由 allowed 列表扩 [draft, generated, selected] + 捕获 preLockStatus + 透传 payload
- [ ] 子任务 2:generate-processor 读 preLockStatus + 用其恢复 chapter.status + 全失败也恢复
- [ ] 子任务 3:select 路由锁扩 [generated, scored, selected]
- [ ] 子任务 4:UI 按钮 v-if + 动态文案 + 确认对话框 + Tab ✓ 标记 + 摘要
- [ ] 子任务 5:三组测试(generate-state / processor-preLockStatus / chapters-regenerate)
- [ ] 子任务 6:`pnpm typecheck && pnpm vitest run` 全绿
- [ ] 子任务 7:手动跑一次 generated/selected 状态下的重生成,确认 Chapter.content / 已选 draft 不动

## 9. 关联

- 引用: [[ai-must-read-plan-test-cross-module]] (本次涉及 chapters.ts + generate-processor.ts + Chapters.vue 三处,跨模块影响已在第 3.3 节列出)
- 前置: Q#10 决策(`5f80270` 删 generated 重生成),本 spec 是用户 2026-06-17 现场反馈后的 reopen
- 关联: [[prioritize-robustness-over-speed]] (Q#10 的脏窗口 trade-off 在本 spec 中通过"纯加法"语义规避,而不是通过加 retry / 加锁绕过)
