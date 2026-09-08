# 记忆管理重构（Memory Redesign）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给记忆系统加语义分类 `category` + 参与者 `participants`，layer 转 enum，并把 temporary 接上「当前章节生成注入」。

**Architecture:** Memory 表加 category（enum）/participants；memory-stage 抽取时事件类字段输出 participants；落库时按字段来源映射 category；optimizer 的 type 归并为 category；生成时显式注入本章 temporary。

**Tech Stack:** TypeScript、Prisma（SQLite）、Fastify、Vitest（server）、Vue 3 + Naive UI（web）

**Spec:** `docs/superpowers/specs/2026-08-14-memory-redesign-design.md`

**注意：** 用户确认「不考虑数据迁移，数据少可清」。migration 给 category 加 default，避免清空数据的复杂回填。

---

## 文件结构

- 修改 `prisma/schema.prisma` — Memory 加 category/participants、layer 转 enum
- 修改 `packages/shared/src/extract-prompt.ts` — memory-only prompt 加 participants 输出
- 修改 `apps/server/src/services/stages/memory-stage.ts` — 解析 participants + 输出结构
- 修改 `apps/server/src/services/memory-optimizer.ts` — type 归并为 category
- 修改 `apps/server/src/routes/chapters-archive.ts` — 落库写 category/participants
- 修改 `packages/memory-engine/src/index.ts` — MemoryEntry 加 category/participants
- 修改 `apps/server/src/routes/chapters-generate.ts` — 生成时注入本章 temporary
- 修改 `apps/server/src/routes/memories.ts` — temporary CRUD（含 chapterId）
- 修改 `apps/web/src/views/Memory.vue` — 展示 category/participants + temporary 编辑

---

## Task 1: Schema 变更

**Files:**
- Modify: `prisma/schema.prisma`（Memory 模型 + 新增两个 enum）

### Step 1: 替换 Memory 模型 + 新增 enum

在 `prisma/schema.prisma` 中，在 Memory 模型之前加两个 enum，并把 `model Memory`（约 158-177 行）替换为：

```prisma
enum MemoryLayer {
  global
  chapter
  scene
  temporary
}

enum MemoryCategory {
  relationship_change
  foreshadowing
  emotional_change
  event_memory
  state
}

// 记忆
model Memory {
  id                String          @id @default(uuid())
  storyId           String
  chapterId         String?
  fromChapterNumber Float?          // 来源章节序号（archive 时标记）
  originUid         String?         // 事件起始UID，如 "1#A3F2"
  layer             MemoryLayer
  category          MemoryCategory  @default(event_memory)
  content           String
  tags              String          @default("[]") // JSON string array（只留来源标记）
  importance        Int             @default(5)    // 1-10
  participants      String?         // 参与者姓名，逗号分隔
  createdAt         DateTime        @default(now())
  updatedAt         DateTime        @updatedAt

  story             Story           @relation(fields: [storyId], references: [id], onDelete: Cascade)
  chapter           Chapter?        @relation(fields: [chapterId], references: [id], onDelete: Cascade)

  @@index([storyId, layer])
  @@index([storyId, category])
  @@index([storyId, fromChapterNumber])
  @@index([storyId, originUid])
}
```

### Step 2: 生成 migration

Run: `pnpm exec prisma migrate dev --name memory_redesign --create-only`（可能因 layer 转 enum 报错，若报错则手动创建 migration 文件）

Expected: 生成 migration（加 category/participants 列、layer 类型改 enum、加 category 索引）。category 有 default，无需清空数据。

### Step 3: 应用 + 重新生成 client

Run: `pnpm exec prisma migrate deploy && pnpm db:generate`

Expected: 成功。

### Step 4: Commit

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "refactor(memory): schema — category + participants + layer enum"
```

---

## Task 2: memory-stage 抽取 participants

**Files:**
- Modify: `packages/shared/src/extract-prompt.ts`（memory-only prompt 加 participants）
- Modify: `apps/server/src/services/stages/memory-stage.ts`（解析 participants）

### Step 1: 改 MemoryStageResult 类型

`memory-stage.ts` 的 `MemoryStageResult` 里，给 mainEvents / sideEvents / scenes 的元素加 `participants`：

```typescript
export interface MemoryStageResult {
  mainEvents: Array<{ description: string; importance: number; participants?: string }>
  sideEvents: Array<{ description: string; importance: number; participants?: string }>
  emotions: string[]
  foreshadowing: string[]
  relationshipChanges: string[]
  scenes: Array<{ location: string; event: string; importance: number; participants?: string }>
  summary: string
}
```

### Step 2: 改 memory-stage 解析

`memory-stage.ts` 的 result 构造（约 79-87 行），对 mainEvents / sideEvents / scenes 解析 `participants`：

```typescript
    const result: MemoryStageResult = {
      mainEvents: (Array.isArray(memBlob?.mainEvents) ? memBlob.mainEvents : []).map((e: any) => ({
        description: e.description, importance: e.importance, participants: e.participants
      })),
      sideEvents: (Array.isArray(memBlob?.sideEvents) ? memBlob.sideEvents : []).map((e: any) => ({
        description: e.description, importance: e.importance, participants: e.participants
      })),
      emotions: Array.isArray(memBlob?.emotions) ? memBlob.emotions : [],
      foreshadowing: Array.isArray(memBlob?.foreshadowing) ? memBlob.foreshadowing : [],
      relationshipChanges: Array.isArray(memBlob?.relationshipChanges) ? memBlob.relationshipChanges : [],
      scenes: (Array.isArray(memBlob?.scenes) ? memBlob.scenes : []).map((s: any) => ({
        location: s.location, event: s.event, importance: s.importance, participants: s.participants
      })),
      summary: typeof memBlob?.summary === 'string' ? memBlob.summary : ''
    }
```

### Step 3: 改 prompt（extract-prompt.ts）

在 `packages/shared/src/extract-prompt.ts` 的 memory-only 输出格式里，给 mainEvents / sideEvents / scenes 加 participants 说明（「有参与者时填姓名，逗号分隔，无则留空」）。找到 mainEvents/sideEvents/scenes 的字段说明处，补充 participants 字段说明。

### Step 4: 跑现有 memory 测试

Run: `pnpm --filter server exec vitest run src/__tests__/services/stages-memory.test.ts`

Expected: 通过（participants 是可选字段，现有 fixture 不带 participants 也能过）。

### Step 5: Commit

```bash
git add packages/shared/src/extract-prompt.ts apps/server/src/services/stages/memory-stage.ts
git commit -m "feat(memory): extract participants for events/scenes"
```

---

## Task 3: optimizer type 归并为 category

**Files:**
- Modify: `apps/server/src/services/memory-optimizer.ts`

### Step 1: OptimizedMemory 的 type 改为 category 语义

把 `OptimizedMemory` 的 `type: 'event' | 'state'` 保留（AI 仍输出 event/state），但在注释里明确落库时映射：`type='event'→category='event_memory'`、`type='state'→category='state'`。

（本 task 不改类型定义，只加注释说明映射关系；实际映射在 Task 4 落库时做。）

### Step 2: 跑 memory-optimizer 测试

Run: `pnpm --filter server exec vitest run src/__tests__/services/memory-optimizer.test.ts`

Expected: 通过。

### Step 3: Commit（如只改注释）

```bash
git add apps/server/src/services/memory-optimizer.ts
git commit -m "docs(memory): note type → category mapping"
```

（若 Step 1 无实际代码改动，可跳过本 commit，合并进 Task 4。）

---

## Task 4: 落库写 category / participants

**Files:**
- Modify: `apps/server/src/routes/chapters-archive.ts`

### Step 1: 写 category 映射 helper

在 `chapters-archive.ts` archive route 的落库段（约 704-744 行），加一个 category 映射：

```typescript
    const CATEGORY = {
      event: 'event_memory', emotional: 'emotional_change',
      foreshadowing: 'foreshadowing', relationship: 'relationship_change', state: 'state'
    } as const
```

### Step 2: pushChapterRow 加 category

把 `pushChapterRow`（约 708-718 行）改为接受 category：

```typescript
    const pushChapterRow = (content: string, importance: number, category: string, extraTags: string[] = [], participants?: string) => {
      chapterRows.push({
        storyId: chapter.storyId, chapterId, fromChapterNumber, layer: 'chapter',
        category, content, tags: JSON.stringify(['auto-extracted', ...extraTags]),
        importance, participants: participants ?? null
      })
    }
```

mainEvents 传 `CATEGORY.event`，sideEvents 传 `CATEGORY.event`，emotions 传 `CATEGORY.emotional`，foreshadowing 传 `CATEGORY.foreshadowing`，relationshipChanges 传 `CATEGORY.relationship`。

### Step 3: sceneRows / globalRows 加 category

```typescript
    const sceneRows = scenes.filter(s => s?.location).map(s => ({
      storyId: chapter.storyId, chapterId, fromChapterNumber, layer: 'scene',
      category: CATEGORY.event, content: `${s.location} | ${s.event || ''}`,
      tags: JSON.stringify(['auto-extracted', 'scene-memory']),
      importance: typeof s.importance === 'number' ? s.importance : 5,
      participants: s.participants ?? null
    }))

    const globalRows = optimized.filter(m => m?.content).map(m => ({
      storyId: chapter.storyId, chapterId, fromChapterNumber, layer: 'global',
      category: m.type === 'state' ? CATEGORY.state : CATEGORY.event,
      content: m.content,
      tags: JSON.stringify(['auto-extracted']),
      importance: typeof m.importance === 'number' ? m.importance : 5,
      originUid: m.originUid === 'NEW' ? `${fromChapterNumber}#${newUidHex()}` : m.originUid
    }))
```

### Step 4: 跑 archive 测试

Run: `pnpm --filter server exec vitest run src/__tests__/routes/archive-confirm-v4.test.ts`

Expected: 通过（现有断言只查 tags/content/layer，不查 category/participants，故不破坏；如需，补一条 category 断言）。

### Step 5: Commit

```bash
git add apps/server/src/routes/chapters-archive.ts
git commit -m "feat(memory): write category + participants on archive confirm"
```

---

## Task 5: memory-engine 召回带 category / participants

**Files:**
- Modify: `packages/memory-engine/src/index.ts`

### Step 1: MemoryEntry 加字段

`MemoryEntry` 接口加 `category?: string`、`participants?: string`。

### Step 2: searchRelevant / formatForPrompt 透传

`searchRelevant` 返回的 entry（约 165-173 行）加 `category: m.category`、`participants: m.participants`。

### Step 3: 跑 memory-engine 相关测试

Run: `pnpm --filter server exec vitest run src/__tests__/routes/chapters-generate-character-fallback.test.ts`

Expected: 通过。

### Step 4: 重建 shared/memory-engine 包

Run: `pnpm --filter @novel-runtime/memory-engine build && pnpm --filter @novel-runtime/shared build`

Expected: 成功（server 依赖这些包，改动后需重建）。

### Step 5: Commit

```bash
git add packages/memory-engine/src/index.ts
git commit -m "feat(memory): surface category + participants in recall"
```

---

## Task 6: temporary 显式注入

**Files:**
- Modify: `apps/server/src/routes/chapters-generate.ts`
- Modify: `apps/server/src/routes/memories.ts`

### Step 1: memories 路由 temporary CRUD 加 chapterId

`memories.ts` 的 POST（约 24-39 行）已经写 chapterId；补一个「生成时查本章 temporary」的 helper 或直接复用。确认 POST 已接受 `chapterId`（已有，无需改）。

### Step 2: chapters-generate 注入本章 temporary

在 `chapters-generate.ts` 的 preview/generate 路由，`searchRelevant` 调用之后，加：

```typescript
    // 本章 temporary 记忆：用户手动加、只本章生效
    const temporaryMemories = await prisma.memory.findMany({
      where: { storyId, layer: 'temporary', chapterId },
      orderBy: { createdAt: 'asc' }
    })
    const temporaryText = temporaryMemories.map(m => `- [临时] ${m.content}`).join('\n')
```

并在 `pipeline.run({ ... })` 的 `memory` 层拼上：`memory: [memoryManager.formatForPrompt(relevantMemories), temporaryText].filter(Boolean).join('\n')`。

### Step 3: 跑 generate 测试

Run: `pnpm --filter server exec vitest run src/__tests__/routes/chapters-generate-character-fallback.test.ts`

Expected: 通过。

### Step 4: Commit

```bash
git add apps/server/src/routes/chapters-generate.ts apps/server/src/routes/memories.ts
git commit -m "feat(memory): inject chapter temporary memories on generate"
```

---

## Task 7: Memory.vue 改造

**Files:**
- Modify: `apps/web/src/views/Memory.vue`

### Step 1: 表格加 category / participants 列

在 `columns`（约 65-81 行）加两列：

```typescript
  { title: '分类', key: 'category', width: 100 },
  { title: '参与者', key: 'participants', width: 120 },
```

### Step 2: 分类中文映射

加一个 category 中文 label 的 helper：

```typescript
function categoryLabel(category: string): string {
  return {
    relationship_change: '关系变化', foreshadowing: '伏笔',
    emotional_change: '情绪变化', event_memory: '事件', state: '状态'
  }[category] ?? category
}
```

并在 category 列的 `render` 里用 `categoryLabel(row.category)`。

### Step 3: temporary 创建时选章节

临时记忆的创建 form 加「关联章节」字段（`chapterId`），POST 时带上 chapterId。

### Step 4: typecheck

Run: `pnpm --filter web typecheck`

Expected: 通过。

### Step 5: Commit

```bash
git add apps/web/src/views/Memory.vue
git commit -m "feat(memory): show category + participants, temporary chapter binding"
```

---

## 完成验证

所有 Task 完成后：

1. `pnpm --filter server test` 全量通过。
2. `pnpm typecheck` 全仓通过。
3. 浏览器走通：归档 → Memory.vue 看到 category/participants → 建 temporary 绑定章节 → 生成该章看 prompt 注入。
