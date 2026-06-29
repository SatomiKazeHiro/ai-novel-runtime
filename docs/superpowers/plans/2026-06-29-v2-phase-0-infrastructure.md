# Phase 0: V2 基础设施 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 搭建 V2 骨架：Prisma 表迁移 + 后端路由注册 + 服务空骨架 + 前端路由 + Layout 空壳 + API 封装，完成后各页面显示"V2 开发中"占位。

**Architecture:** 后端新建 `routes-v2/` + `services-v2/`，统一 prefix `/api/v2` 注册到 Fastify。前端新建 `views-v2/` + `api-v2/` + `composables-v2/`，路由 `/novel-design-v2/:storyId`。V2 表以 `V2` 前缀命名，与 V1 表同库但无 Prisma 级 relation 耦合。

**Tech Stack:** Fastify + Prisma + SQLite / Vue 3 + Naive UI + Vue Router + Axios

---

### Task 1: Prisma — 添加 V2 模型并迁移

**Files:**
- Modify: `prisma/schema.prisma` (追加 V2 模型到文件末尾)
- Create: `prisma/migrations/20260629000000_v2_initial_tables/migration.sql` (由 `pnpm db:migrate` 自动生成)

**说明:** V2 表与 V1 表同库但零 Prisma relation 耦合。`storyId` 用裸 `String`，不加 `@relation`。枚举名加 `V2` 前缀避免与 V1 枚举冲突。

- [ ] **Step 1: 在 schema.prisma 末尾追加 V2 模型定义**

在 `prisma/schema.prisma` 文件末尾（第 401 行 `}` 之后）追加以下内容：

```prisma
// ============================================================
// V2 模型 — 物理隔离，与 V1 表无 Prisma relation
// ============================================================

enum V2MemoryType {
  global
  chapter
  scene
  temporary
}

enum V2MemoryCategory {
  relationship_change
  foreshadowing
  emotional_change
  event_memory
}

enum V2PlotArcStatus {
  active
  interrupted
  completed
  closed
}

enum V2ChapterStatus {
  draft
  generating
  analyzing
  archived
}

model V2Character {
  id            String   @id @default(uuid())
  storyId       String
  slug          String
  name          String
  isProtagonist Boolean  @default(false)
  appearance    String?
  temperament   String?
  personality   String?
  speechStyle   String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  snapshots     V2CharacterSnapshot[]

  @@unique([storyId, slug])
  @@index([storyId])
}

model V2CharacterSnapshot {
  id            String   @id @default(uuid())
  characterId   String
  chapterNumber Int
  identity      String?
  appearance    String?
  temperament   String?
  personality   String?
  speechStyle   String?
  relationships String?
  status        String?
  createdAt     DateTime @default(now())

  character     V2Character @relation(fields: [characterId], references: [id], onDelete: Cascade)

  @@index([characterId, chapterNumber])
}

model V2Memory {
  id                  String           @id @default(uuid())
  storyId             String
  type                V2MemoryType
  category            V2MemoryCategory
  content             String
  importance          Int              @default(4)
  participants        String?
  originChapterNumber Int?
  isActive            Boolean          @default(true)
  createdAt           DateTime         @default(now())
  updatedAt           DateTime         @updatedAt

  @@index([storyId, type])
  @@index([storyId, category])
  @@index([storyId, isActive])
}

model V2MemoryMergeLog {
  id              String   @id @default(uuid())
  storyId         String
  chapterNumber   Int
  inputMemoryIds  String
  outputMemoryIds String
  createdAt       DateTime @default(now())

  @@index([storyId, chapterNumber])
}

model V2PlotArc {
  id                      String          @id @default(uuid())
  storyId                 String
  title                   String
  description             String
  status                  V2PlotArcStatus @default(active)
  isMainline              Boolean         @default(false)
  firstChapterNumber      Int
  lastUpdateChapterNumber Int
  createdAt               DateTime        @default(now())
  updatedAt               DateTime        @updatedAt

  @@index([storyId, status])
}

model V2PlotArcDraft {
  id          String          @id @default(uuid())
  plotArcId   String?
  chapterId   String
  action      String
  title       String
  description String
  status      V2PlotArcStatus
  isMainline  Boolean
  mergeInfo   String?
  createdAt   DateTime        @default(now())
}

model V2Chapter {
  id          String          @id @default(uuid())
  storyId     String
  number      Float
  title       String
  content     String          @default("")
  contentHash String          @default("")
  status      V2ChapterStatus @default(draft)
  analysisId  String?
  config      String          @default("{}")
  createdAt   DateTime        @default(now())
  updatedAt   DateTime        @updatedAt

  drafts      V2Draft[]

  @@unique([storyId, number])
  @@index([storyId, status])
}

model V2Draft {
  id        String   @id @default(uuid())
  chapterId String
  content   String   @default("")
  status    String   @default("generating")
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  chapter   V2Chapter @relation(fields: [chapterId], references: [id], onDelete: Cascade)

  @@index([chapterId])
}

model V2TimelineAnchor {
  id       String @id @default(uuid())
  storyId  String
  position Float
  label    String

  events   V2TimelineEvent[]

  @@index([storyId])
}

model V2TimelineEvent {
  id             String @id @default(uuid())
  anchorId       String
  chapterNumber  Int
  description    String

  anchor         V2TimelineAnchor @relation(fields: [anchorId], references: [id], onDelete: Cascade)

  @@index([anchorId])
}
```

- [ ] **Step 2: 生成 Prisma Client + 运行迁移**

```bash
pnpm db:generate
```

Expected: 无错误，`node_modules/.prisma/client` 更新，包含所有 `V2*` 模型类型。

```bash
pnpm db:migrate
```

Expected: 创建迁移文件 `prisma/migrations/20260629000000_v2_initial_tables/migration.sql`，新建 10 张 V2 表，已有 V1 表不受影响。输出 `Your database is now in sync with your schema.`

- [ ] **Step 3: 验证 — TypeCheck**

```bash
pnpm typecheck
```

Expected: server + web 均通过，V2 模型类型已正确生成。

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260629000000_v2_initial_tables/
git commit -m "feat(v2): add V2 Prisma models and initial migration

10 tables: V2Character, V2CharacterSnapshot, V2Memory,
V2MemoryMergeLog, V2PlotArc, V2PlotArcDraft, V2Chapter,
V2Draft, V2TimelineAnchor, V2TimelineEvent.
Zero relations to V1 models — storyId is bare String."
```

---

### Task 2: Backend — 创建 V2 路由桩文件

**Files:**
- Create: `apps/server/src/routes-v2/characters.ts`
- Create: `apps/server/src/routes-v2/characters-analysis.ts`
- Create: `apps/server/src/routes-v2/memories.ts`
- Create: `apps/server/src/routes-v2/memories-analysis.ts`
- Create: `apps/server/src/routes-v2/plot-arcs.ts`
- Create: `apps/server/src/routes-v2/plot-arcs-analysis.ts`
- Create: `apps/server/src/routes-v2/chapters.ts`
- Create: `apps/server/src/routes-v2/chapters-generate.ts`
- Create: `apps/server/src/routes-v2/chapters-analysis.ts`
- Create: `apps/server/src/routes-v2/chapters-archive.ts`
- Create: `apps/server/src/routes-v2/timeline.ts`
- Create: `apps/server/src/routes-v2/graph.ts`
- Create: `apps/server/src/routes-v2/lore.ts`
- Create: `apps/server/src/routes-v2/worker-tasks.ts`
- Create: `apps/server/src/routes-v2/prompt-logs.ts`
- Create: `apps/server/src/routes-v2/index.ts`

**说明:** 所有路由文件现阶段返回占位响应 `{ success: true, data: null, message: 'V2 开发中' }`。遵循 V1 路由模式：每个文件 export async function，接收 `FastifyInstance`。

- [ ] **Step 1: 创建 routes-v2/index.ts（聚合器）**

```typescript
import type { FastifyInstance } from 'fastify'
import { v2CharacterRoutes } from './characters.js'
import { v2CharacterAnalysisRoutes } from './characters-analysis.js'
import { v2MemoryRoutes } from './memories.js'
import { v2MemoryAnalysisRoutes } from './memories-analysis.js'
import { v2PlotArcRoutes } from './plot-arcs.js'
import { v2PlotArcAnalysisRoutes } from './plot-arcs-analysis.js'
import { v2ChapterRoutes } from './chapters.js'
import { v2ChapterGenerateRoutes } from './chapters-generate.js'
import { v2ChapterAnalysisRoutes } from './chapters-analysis.js'
import { v2ChapterArchiveRoutes } from './chapters-archive.js'
import { v2TimelineRoutes } from './timeline.js'
import { v2GraphRoutes } from './graph.js'
import { v2LoreRoutes } from './lore.js'
import { v2WorkerTaskRoutes } from './worker-tasks.js'
import { v2PromptLogRoutes } from './prompt-logs.js'

export async function v2Routes(app: FastifyInstance) {
  await app.register(v2CharacterRoutes)
  await app.register(v2CharacterAnalysisRoutes)
  await app.register(v2MemoryRoutes)
  await app.register(v2MemoryAnalysisRoutes)
  await app.register(v2PlotArcRoutes)
  await app.register(v2PlotArcAnalysisRoutes)
  await app.register(v2ChapterRoutes)
  await app.register(v2ChapterGenerateRoutes)
  await app.register(v2ChapterAnalysisRoutes)
  await app.register(v2ChapterArchiveRoutes)
  await app.register(v2TimelineRoutes)
  await app.register(v2GraphRoutes)
  await app.register(v2LoreRoutes)
  await app.register(v2WorkerTaskRoutes)
  await app.register(v2PromptLogRoutes)
}
```

- [ ] **Step 2: 创建各路由桩文件**

以 `characters.ts` 为模板，其他文件同理（仅路由路径和函数名不同）：

```typescript
// apps/server/src/routes-v2/characters.ts
import type { FastifyInstance } from 'fastify'

export async function v2CharacterRoutes(app: FastifyInstance) {
  app.get('/characters', async (_request, reply) => {
    return { success: true, data: null, message: 'V2 开发中' }
  })

  app.get('/characters/:charId', async (_request, reply) => {
    return { success: true, data: null, message: 'V2 开发中' }
  })

  app.post('/characters', async (_request, reply) => {
    return { success: true, data: null, message: 'V2 开发中' }
  })

  app.put('/characters/:charId', async (_request, reply) => {
    return { success: true, data: null, message: 'V2 开发中' }
  })

  app.delete('/characters/:charId', async (_request, reply) => {
    return { success: true, data: null, message: 'V2 开发中' }
  })
}
```

其余 14 个路由桩文件按以下表创建：

| 文件 | 函数名 | 注册路径 |
|------|--------|----------|
| `characters-analysis.ts` | `v2CharacterAnalysisRoutes` | `/chapters/:chapterId/analyze/characters` (POST-only) |
| `memories.ts` | `v2MemoryRoutes` | `/memories` (GET), `/memories/temporary` (POST), `/memories/temporary/:memId` (PUT/DELETE) |
| `memories-analysis.ts` | `v2MemoryAnalysisRoutes` | `/chapters/:chapterId/analyze/memories` (POST-only) |
| `plot-arcs.ts` | `v2PlotArcRoutes` | `/plot-arcs` (GET), `/plot-arcs/:arcId` (GET) |
| `plot-arcs-analysis.ts` | `v2PlotArcAnalysisRoutes` | `/chapters/:chapterId/analyze/plot-arcs` (POST-only) |
| `chapters.ts` | `v2ChapterRoutes` | `/chapters` (GET/POST), `/chapters/:chapterId` (GET/PUT/DELETE) |
| `chapters-generate.ts` | `v2ChapterGenerateRoutes` | `/chapters/:chapterId/generate-stream` (GET SSE) |
| `chapters-analysis.ts` | `v2ChapterAnalysisRoutes` | `/chapters/:chapterId/analysis-status` (GET) |
| `chapters-archive.ts` | `v2ChapterArchiveRoutes` | `/chapters/:chapterId/archive` (POST) |
| `timeline.ts` | `v2TimelineRoutes` | `/timeline` (GET, 返回 `{ nodes: [], edges: [] }`) |
| `graph.ts` | `v2GraphRoutes` | `/graph` (GET, 返回 `[]`) |
| `lore.ts` | `v2LoreRoutes` | `/lore` (GET/POST), `/lore/:loreId` (PUT/DELETE) |
| `worker-tasks.ts` | `v2WorkerTaskRoutes` | `/worker-tasks` (GET) |
| `prompt-logs.ts` | `v2PromptLogRoutes` | `/prompt-logs` (GET) |

**注意:** V2 路由路径不含 `/api/v2/` 前缀——前缀在 app.ts 注册时统一加。各文件内路径相对于 `/api/v2`。

- [ ] **Step 3: Verify — TypeCheck**

```bash
pnpm typecheck
```

Expected: server typecheck 通过。

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/routes-v2/
git commit -m "feat(v2): add 15 V2 route stub files with placeholder responses"
```

---

### Task 3: Backend — 创建 services-v2/ 空骨架

**Files:**
- Create: `apps/server/src/services-v2/ai-provider.ts`
- Create: `apps/server/src/services-v2/ai-call-logger.ts`
- Create: `apps/server/src/services-v2/character-extractor.ts`
- Create: `apps/server/src/services-v2/memory-extractor.ts`
- Create: `apps/server/src/services-v2/memory-merger.ts`
- Create: `apps/server/src/services-v2/plot-arc-extractor.ts`
- Create: `apps/server/src/services-v2/plot-arc-merger.ts`
- Create: `apps/server/src/services-v2/plot-arc-interrupt.ts`
- Create: `apps/server/src/services-v2/config-defaults.ts`
- Create: `apps/server/src/services-v2/prompt-assembler.ts`
- Create: `apps/server/src/services-v2/hash.ts`

**说明:** 所有文件只导出占位函数（抛出 "Not implemented"），为后续阶段提供接口契约。

- [ ] **Step 1: 创建 services-v2/ 骨架文件**

以 `ai-provider.ts` 为例：

```typescript
// apps/server/src/services-v2/ai-provider.ts
// V2 AI 调用封装 — 阶段 4 实现
export interface V2AiCallOptions {
  systemMessage: string
  userMessage: string
  temperature?: number
  maxTokens?: number
}

export interface V2AiCallResult {
  content: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  durationMs: number
}

export async function aiCall(opts: V2AiCallOptions): Promise<V2AiCallResult> {
  throw new Error('Not implemented: aiCall — 阶段 4 实现')
}
```

其余 10 个文件各导出 1 个占位函数，函数名和文件名的对应：

| 文件 | 导出函数 | 抛出信息 |
|------|---------|---------|
| `ai-call-logger.ts` | `logAiCall(params)` | `'Not implemented: logAiCall'` |
| `character-extractor.ts` | `extractCharacters(content)` | `'Not implemented: extractCharacters'` |
| `memory-extractor.ts` | `extractMemories(content)` | `'Not implemented: extractMemories'` |
| `memory-merger.ts` | `mergeMemories(new, old)` | `'Not implemented: mergeMemories'` |
| `plot-arc-extractor.ts` | `extractPlotArcs(content)` | `'Not implemented: extractPlotArcs'` |
| `plot-arc-merger.ts` | `mergePlotArcs(new, old)` | `'Not implemented: mergePlotArcs'` |
| `plot-arc-interrupt.ts` | `detectInterruptedArcs(storyId)` | `'Not implemented: detectInterruptedArcs'` |
| `config-defaults.ts` | `getDefaultConfig()` | `'Not implemented: getDefaultConfig'` |
| `prompt-assembler.ts` | `assemblePrompt(config)` | `'Not implemented: assemblePrompt'` |
| `hash.ts` | `sha256(content: string): string` | 直接实现（无依赖，不需要 AI），见下方代码 |

`hash.ts` 是唯一非占位的骨架文件——SHA256 哈希逻辑简单且无需外部依赖：

```typescript
// apps/server/src/services-v2/hash.ts
import { createHash } from 'node:crypto'

export function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex')
}
```

`config-defaults.ts` 骨架（含接口定义，为后续阶段提供类型契约）：

```typescript
// apps/server/src/services-v2/config-defaults.ts
export interface V2PromptConfig {
  characterIds: string[]
  memoryTypeIds: { type: string; category: string; id: string }[]
  plotArcIds: string[]
  loreIds: string[]
  outline?: string
  styleNotes?: string
}

export function getDefaultConfig(_storyId: string): V2PromptConfig {
  throw new Error('Not implemented: getDefaultConfig — 阶段 6 实现')
}
```

- [ ] **Step 2: Verify — TypeCheck**

```bash
pnpm typecheck
```

Expected: server typecheck 通过。

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/services-v2/
git commit -m "feat(v2): add 11 service skeleton files with stub exports"
```

---

### Task 4: Backend — 在 app.ts 注册 V2 路由

**Files:**
- Modify: `apps/server/src/app.ts` (加 2 行：import + register)

- [ ] **Step 1: 添加 V2 路由注册**

在 `apps/server/src/app.ts` 的 import 区末尾（第 28 行后）追加：

```typescript
import { v2Routes } from './routes-v2/index.js'
```

在路由注册区末尾（第 84 行 `await app.register(promptLogRoutes)` 之后，第 86 行 error handler 之前）追加：

```typescript
  // V2 routes — 物理隔离，prefix /api/v2
  await app.register(v2Routes, { prefix: '/api/v2' })
```

- [ ] **Step 2: Verify — TypeCheck**

```bash
pnpm typecheck
```

Expected: server + web 均通过。

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/app.ts
git commit -m "feat(v2): register /api/v2 routes in app.ts"
```

---

### Task 5: Frontend — 创建 api-v2/ HTTP 封装

**Files:**
- Create: `apps/web/src/api-v2/index.ts`

**说明:** 复用 V1 的 axios 实例（`utils/api.ts`），封装 V2 专用的请求方法。这是 spec 允许的"复用 HTTP 实例"。

- [ ] **Step 1: 创建 api-v2/index.ts**

```typescript
// apps/web/src/api-v2/index.ts
// V2 API 封装 — 复用 V1 axios 实例，对接 /api/v2/*
import { api } from '../utils/api'

const V2_PREFIX = '/api/v2'

export const v2Api = {
  get<T = any>(path: string, params?: Record<string, any>) {
    return api.get<{ success: boolean; data: T; message?: string }>(
      `${V2_PREFIX}${path}`,
      { params }
    )
  },

  post<T = any>(path: string, body?: any) {
    return api.post<{ success: boolean; data: T; message?: string }>(
      `${V2_PREFIX}${path}`,
      body
    )
  },

  put<T = any>(path: string, body?: any) {
    return api.put<{ success: boolean; data: T; message?: string }>(
      `${V2_PREFIX}${path}`,
      body
    )
  },

  delete<T = any>(path: string) {
    return api.delete<{ success: boolean; data: T; message?: string }>(
      `${V2_PREFIX}${path}`
    )
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/api-v2/
git commit -m "feat(v2): add api-v2 HTTP wrapper reusing V1 axios instance"
```

---

### Task 6: Frontend — 创建占位视图文件

**Files:**
- Create: `apps/web/src/views-v2/V2Characters.vue`
- Create: `apps/web/src/views-v2/V2LoreBook.vue`
- Create: `apps/web/src/views-v2/V2Chapters.vue`
- Create: `apps/web/src/views-v2/V2ChapterDesign.vue`
- Create: `apps/web/src/views-v2/V2ChapterReader.vue`
- Create: `apps/web/src/views-v2/V2PlotArcs.vue`
- Create: `apps/web/src/views-v2/V2Memory.vue`
- Create: `apps/web/src/views-v2/V2Graph.vue`
- Create: `apps/web/src/views-v2/V2Timeline.vue`
- Create: `apps/web/src/views-v2/V2StoryWorkerTask.vue`
- Create: `apps/web/src/views-v2/V2PromptLogs.vue`

**说明:** 所有占位视图显示统一的 "V2 开发中" 占位，保持与 V1 一致的页面结构风格。

- [ ] **Step 1: 创建所有占位视图文件**

每个文件结构一致（以 `V2Characters.vue` 为例）：

```vue
<!-- apps/web/src/views-v2/V2Characters.vue -->
<template>
  <div>
    <header class="page-head">
      <div class="page-head__text">
        <span class="cap-eyebrow">V2</span>
        <h1 class="page-head__title">角色管理</h1>
        <p class="page-head__lede cap-body-sm">V2 开发中，敬请期待。</p>
      </div>
    </header>
  </div>
</template>

<script setup lang="ts">
// V2 角色管理 — 阶段 1 实现
</script>
```

其余 10 个文件同理，仅改标题文字：

| 文件 | 标题 | lede |
|------|------|------|
| `V2LoreBook.vue` | 世界观 | V2 开发中，敬请期待。 |
| `V2Chapters.vue` | 章节工作台 | V2 开发中，敬请期待。 |
| `V2ChapterDesign.vue` | 章节设计 | V2 开发中，敬请期待。 |
| `V2ChapterReader.vue` | 阅读 | V2 开发中，敬请期待。 |
| `V2PlotArcs.vue` | 剧情弧线 | V2 开发中，敬请期待。 |
| `V2Memory.vue` | 记忆管理 | V2 开发中，敬请期待。 |
| `V2Graph.vue` | 知识图谱 | V2 开发中，敬请期待。 |
| `V2Timeline.vue` | 时间线 | V2 开发中，敬请期待。 |
| `V2StoryWorkerTask.vue` | 任务模板 | V2 开发中，敬请期待。 |
| `V2PromptLogs.vue` | 调用日志 | V2 开发中，敬请期待。 |

- [ ] **Step 2: Verify — TypeCheck**

```bash
pnpm typecheck
```

Expected: web typecheck 通过。

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/views-v2/
git commit -m "feat(v2): add 11 placeholder view files for V2 modules"
```

---

### Task 7: Frontend — 创建 NovelDesignV2Layout.vue

**Files:**
- Create: `apps/web/src/views-v2/NovelDesignV2Layout.vue`

**说明:** 参考 V1 的 `NovelDesignLayout.vue` 结构，侧栏菜单增加"剧情弧线"项，所有路由指向 V2 页面。复用 NavBar + story store + CSS tokens。

- [ ] **Step 1: 创建 NovelDesignV2Layout.vue**

```vue
<!-- apps/web/src/views-v2/NovelDesignV2Layout.vue -->
<template>
  <n-layout class="novel-design-layout">
    <NavBar />
    <n-layout has-sider class="novel-design-layout__body">
      <n-layout-sider
        bordered
        collapse-mode="width"
        :collapsed="collapsed"
        :collapsed-width="64"
        :width="240"
        show-trigger="arrow-circle"
        class="novel-design-layout__sider"
        @update:collapsed="(v: boolean) => (collapsed = v)"
      >
        <div v-if="!collapsed" class="novel-design-layout__sider-head">
          <span class="cap-eyebrow">STORY · V2</span>
          <div class="novel-design-layout__story-title">
            {{ currentStory?.title || '未知小说' }}
          </div>
        </div>
        <n-menu
          class="novel-design-layout__menu"
          :collapsed="collapsed"
          :collapsed-width="64"
          :collapsed-icon-size="22"
          :indent="18"
          :options="menuOptions"
          :value="activeKey"
          @update:value="handleMenuSelect"
        />
      </n-layout-sider>
      <n-layout-content class="novel-design-layout__content">
        <div class="cap-page cap-shell">
          <router-view />
        </div>
      </n-layout-content>
    </n-layout>
  </n-layout>
</template>

<script setup lang="ts">
import { h, ref, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  NLayout, NLayoutSider, NLayoutContent,
  NMenu, NIcon, type MenuOption
} from 'naive-ui'
import {
  PeopleOutline, GlobeOutline, CreateOutline,
  AnalyticsOutline, LibraryOutline, TimerOutline,
  HammerOutline, CodeWorkingOutline, BookOutline,
  GitBranchOutline
} from '@vicons/ionicons5'
import NavBar from '../components/NavBar.vue'
import { useStoryStore } from '../stores/story'

const route = useRoute()
const router = useRouter()
const storyStore = useStoryStore()
const collapsed = ref(false)

const storyId = computed(() => route.params.storyId as string)

const currentStory = computed(() =>
  storyStore.stories.find(s => s.id === storyId.value) || null
)

watch(storyId, async (id) => {
  if (!id) return
  if (!storyStore.loaded) {
    await storyStore.loadStories()
  }
  storyStore.selectStory(id)
}, { immediate: true })

function renderIcon(icon: any) {
  return () => h(NIcon, null, { default: () => h(icon) })
}

const menuOptions: MenuOption[] = [
  { label: '角色管理',   key: 'V2Characters',      icon: renderIcon(PeopleOutline) },
  { label: '世界观',     key: 'V2LoreBook',        icon: renderIcon(GlobeOutline) },
  { label: '章节工作台', key: 'V2Chapters',        icon: renderIcon(CreateOutline) },
  { label: '阅读',       key: 'V2ChapterReader',   icon: renderIcon(BookOutline) },
  { label: '剧情弧线',   key: 'V2PlotArcs',        icon: renderIcon(GitBranchOutline) },
  { label: '记忆管理',   key: 'V2Memory',          icon: renderIcon(LibraryOutline) },
  { label: '知识图谱',   key: 'V2Graph',           icon: renderIcon(AnalyticsOutline) },
  { label: '时间线',     key: 'V2Timeline',        icon: renderIcon(TimerOutline) },
  { label: '任务模板',   key: 'V2StoryWorkerTasks', icon: renderIcon(HammerOutline) },
  { label: '调用日志',   key: 'V2PromptLogs',      icon: renderIcon(CodeWorkingOutline) }
]

const activeKey = computed(() => route.name?.toString() || '')

function handleMenuSelect(key: string) {
  const sid = storyId.value
  if (!sid) return
  const map: Record<string, string> = {
    V2Characters:      `/novel-design-v2/${sid}/characters`,
    V2LoreBook:        `/novel-design-v2/${sid}/lore`,
    V2Chapters:        `/novel-design-v2/${sid}/chapters`,
    V2ChapterReader:   `/novel-design-v2/${sid}/reader`,
    V2PlotArcs:        `/novel-design-v2/${sid}/plot-arcs`,
    V2Memory:          `/novel-design-v2/${sid}/memory`,
    V2Graph:           `/novel-design-v2/${sid}/graph`,
    V2Timeline:        `/novel-design-v2/${sid}/timeline`,
    V2StoryWorkerTasks: `/novel-design-v2/${sid}/worker-tasks`,
    V2PromptLogs:      `/novel-design-v2/${sid}/prompt-logs`
  }
  const path = map[key]
  if (path) router.push(path)
}
</script>

<style scoped>
.novel-design-layout {
  height: 100vh;
  background: var(--bg-canvas);
  overflow: visible;
}
.novel-design-layout > :deep(.n-layout-scroll-container) {
  display: flex;
  flex-direction: column;
}
.novel-design-layout__body {
  flex: 1;
  overflow: auto;
}
.novel-design-layout :deep(.n-layout-scroll-container) {
  overflow: visible;
}

.novel-design-layout__sider {
  background: var(--color-pure-white) !important;
  border-right: 1px solid var(--border-default) !important;
  position: relative;
  display: flex;
  flex-direction: column;
}
.novel-design-layout__sider-head {
  padding: 18px 20px 16px;
  border-bottom: 1px solid var(--border-default);
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex-shrink: 0;
}
.novel-design-layout__story-title {
  font-size: 14px;
  font-weight: var(--weight-semibold);
  color: var(--color-ink-black);
  line-height: 1.3;
  letter-spacing: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.novel-design-layout__menu {
  padding: 10px 8px;
  flex: 1;
  min-height: 0;
}
.novel-design-layout__menu.n-menu--collapsed :deep(.n-menu-item-content) {
  padding-left: 13px !important;
}
.novel-design-layout__menu :deep(.n-menu-item-content--selected) .n-menu-item-content__icon,
.novel-design-layout__menu :deep(.n-menu-item-content--selected:hover) .n-menu-item-content__icon,
.novel-design-layout__menu :deep(.n-menu-item-content--selected) .n-menu-item-content-header,
.novel-design-layout__menu :deep(.n-menu-item-content--selected:hover) .n-menu-item-content-header {
  color: var(--accent) !important;
}

.novel-design-layout :deep(.n-layout-toggle-button) {
  width: 28px;
  height: 28px;
  border: 1px solid var(--border-default);
  background: var(--color-pure-white);
  color: var(--text-tertiary);
  box-shadow: none;
  transition: color 0.15s ease, border-color 0.15s ease, background 0.15s ease;
}
.novel-design-layout :deep(.n-layout-toggle-button:hover) {
  color: var(--color-ink-black);
  border-color: var(--color-mid-gray);
  background: var(--color-stone-gray);
}

.novel-design-layout__content {
  overflow: auto;
}
.novel-design-layout__content > :deep(.n-layout-scroll-container) {
  min-width: 1280px;
}
</style>
```

- [ ] **Step 2: Verify — TypeCheck**

```bash
pnpm typecheck
```

Expected: web typecheck 通过。

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/views-v2/NovelDesignV2Layout.vue
git commit -m "feat(v2): add NovelDesignV2Layout with sidebar menu"
```

---

### Task 8: Frontend — 注册 V2 路由

**Files:**
- Modify: `apps/web/src/router/index.ts`

- [ ] **Step 1: 在 router/index.ts 添加 V2 路由**

在 `apps/web/src/router/index.ts` 中：

第 3 行后追加 import：
```typescript
import NovelDesignV2Layout from '../views-v2/NovelDesignV2Layout.vue'
```

第 4-16 行的 V1 import 区后追加 V2 view imports：
```typescript
import V2Characters from '../views-v2/V2Characters.vue'
import V2LoreBook from '../views-v2/V2LoreBook.vue'
import V2Chapters from '../views-v2/V2Chapters.vue'
import V2ChapterDesign from '../views-v2/V2ChapterDesign.vue'
import V2ChapterReader from '../views-v2/V2ChapterReader.vue'
import V2PlotArcs from '../views-v2/V2PlotArcs.vue'
import V2Memory from '../views-v2/V2Memory.vue'
import V2Graph from '../views-v2/V2Graph.vue'
import V2Timeline from '../views-v2/V2Timeline.vue'
import V2StoryWorkerTask from '../views-v2/V2StoryWorkerTask.vue'
import V2PromptLogs from '../views-v2/V2PromptLogs.vue'
```

在 `routes` 数组中（V1 `/novel-design/:storyId` 路由块之后，`// 旧路由重定向` 注释之前）追加：

```typescript
  {
    path: '/novel-design-v2/:storyId',
    component: NovelDesignV2Layout,
    children: [
      { path: 'characters',   name: 'V2Characters',      component: V2Characters },
      { path: 'lore',         name: 'V2LoreBook',        component: V2LoreBook },
      { path: 'chapters',     name: 'V2Chapters',        component: V2Chapters },
      { path: 'chapters/:chapterId/design', name: 'V2ChapterDesign', component: V2ChapterDesign },
      { path: 'reader',       name: 'V2ChapterReader',   component: V2ChapterReader },
      { path: 'plot-arcs',    name: 'V2PlotArcs',        component: V2PlotArcs },
      { path: 'memory',       name: 'V2Memory',          component: V2Memory },
      { path: 'graph',        name: 'V2Graph',           component: V2Graph },
      { path: 'timeline',     name: 'V2Timeline',        component: V2Timeline },
      { path: 'worker-tasks', name: 'V2StoryWorkerTasks', component: V2StoryWorkerTask },
      { path: 'prompt-logs',  name: 'V2PromptLogs',      component: V2PromptLogs }
    ]
  },
```

- [ ] **Step 2: Verify — TypeCheck**

```bash
pnpm typecheck
```

Expected: web typecheck 通过。

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/router/index.ts
git commit -m "feat(v2): register /novel-design-v2/:storyId routes in router"
```

---

### Task 9: 集成验证 — TypeCheck + Lint + Dev Server

**说明:** 确保全栈 typecheck + lint 通过，dev server 可启动，V2 路由可访问。

- [ ] **Step 1: 全栈 TypeCheck**

```bash
pnpm typecheck
```

Expected: 零错误。

- [ ] **Step 2: Lint**

```bash
pnpm lint
```

Expected: 零 warning / error。

- [ ] **Step 3: 启动 dev server 验证路由**

```bash
pnpm dev
```

手动验证：
1. 打开 `http://localhost:5173/novel-design-v2/<任意 storyId>/characters` → 显示 "V2 开发中" 占位
2. 侧栏菜单切换各模块 → 均显示对应占位
3. V1 路由 `http://localhost:5173/novel-design/<id>/characters` → 正常显示 V1 页面
4. `curl http://localhost:3000/api/v2/characters` → 返回 `{"success":true,"data":null,"message":"V2 开发中"}`

- [ ] **Step 4: Commit（如有 lint fix）**

```bash
git add -A
git commit -m "chore(v2): lint fixes for phase 0"
```

> 若无 lint fix 则跳过此 step。

---

### Task 10: Final Commit — Phase 0 完成标记

- [ ] **Step 1: 验证 git status 干净**

```bash
git status
```

Expected: clean。

- [ ] **Step 2: 打轻量 tag**

```bash
git tag v2-p0-complete
```

---

## Phase 0 完成标准

- [x] 10 张 V2 Prisma 表已迁移（migration SQL 落盘）
- [x] 15 个 V2 路由桩文件就位，`/api/v2/*` 返回占位响应
- [x] 11 个 services-v2/ 骨架文件就位（hash.ts 已可用）
- [x] `app.ts` 已注册 V2 路由
- [x] `api-v2/` HTTP 封装就位
- [x] 11 个占位视图 + NovelDesignV2Layout 就位
- [x] Router 已注册 `/novel-design-v2/:storyId` 路由树
- [x] `pnpm typecheck` + `pnpm lint` 全绿
- [x] V1 路由不受影响，V2 路由可访问
