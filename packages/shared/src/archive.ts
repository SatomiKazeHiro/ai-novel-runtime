// Shared archive pipeline types (used by server + web)
//
// This is the single source of truth for the shape of the JSON payload
// stored in `Chapter.pendingArchiveData` (TEXT column) and round-tripped
// between server and web during the "reviewing" phase of the archive
// lifecycle. Both apps must agree on this shape, or the user's edits
// will silently desync.

import { z } from 'zod'

/**
 * A single memory write prepared by `prepareMemoryWrites`. Mirrors the
 * server-side `MemoryWrite` row that will be inserted in phase 3.
 */
export interface PendingMemoryWrite {
  storyId: string
  chapterId: string
  fromChapterNumber: number
  layer: string
  content: string
  tags: string
  importance: number
  originUid?: string
}

/**
 * A character state write — `status` and `relationships` are stored as
 * JSON-encoded strings to match the Prisma `String` columns.
 */
export interface PendingCharacterStateWrite {
  characterId: string
  fromChapterNumber: number
  status: string
  relationships: string
}

/**
 * A timeline event write. `events` is a JSON-encoded string array.
 * `position` is the YYYY.MMDD.HH 实数编码 (整数位=年, 小数位依次为月/日/时).
 */
export interface PendingTimelineEventWrite {
  storyId: string
  fromChapterNumber: number
  position: number
  events: string
}

/**
 * All memory-related writes bundled together. Matches the server-side
 * `ArchiveMemoryData` from `apps/server/src/services/memory-extractor.ts`.
 */
export interface PendingMemories {
  memories: PendingMemoryWrite[]
  characterStates: PendingCharacterStateWrite[]
  timelineEvents: PendingTimelineEventWrite[]
  summary: string | null
  timelinePosition: number | null
}

/**
 * A node in the knowledge graph. Matches the server-side
 * `GraphNodeSnapshot` from `apps/server/src/services/graph-snapshot.ts`.
 */
export interface PendingGraphNode {
  type: string
  key: string
  label: string
  data: Record<string, any>
}

/**
 * An edge in the knowledge graph. Matches `GraphEdgeSnapshot` from the
 * server. `weight` defaults to 1 in the DB layer.
 */
export interface PendingGraphEdge {
  fromType: string
  fromKey: string
  toType: string
  toKey: string
  relation: string
  weight: number
}

/**
 * A graph snapshot (chapter-level delta or cumulative merged).
 *
 * `timestamp` is required. The server's `organizeGraph` always stamps
 * it on freshly extracted snapshots, and the frontend's
 * `normalizePendingData` / `onGraphUpdate` carry it forward when they
 * rebuild a snapshot in memory.
 */
export interface PendingGraphSnapshot {
  nodes: PendingGraphNode[]
  edges: PendingGraphEdge[]
  timestamp: string
}

/**
 * A plot-arc write. Matches the server-side `PlotArcWrite` from
 * `apps/server/src/services/plot-extractor.ts`. JSON-encoded string
 * fields (`stages`, `unresolved`) match the Prisma schema.
 */
export interface PendingPlotArcWrite {
  storyId: string
  name: string
  type: string
  status: string
  progress: number
  stages: string
  currentStage: string
  nextGoal: string
  unresolved: string
  summary: string
  isNew: boolean
  existingId?: string
  // Distinguishes AI updates from carry-forward writes so commit can
  // refresh `lastTouchedChapter` only for the former.
  source?: 'ai-update' | 'carry-forward'
  // When status is 'closed', why the AI closed this arc.
  closedReason?: string
  // When status is 'closed' as a duplicate, points at the arc it merged into.
  closedTargetArcId?: string
  // Jaccard tag from dedup fallback: similar existing arc ids, JSON-encoded array.
  similarToExistingIds?: string
}

/**
 * Metadata about when the payload was extracted. Used by the frontend
 * to show "extracted N seconds ago" hints and by the server for
 * staleness checks.
 */
export interface PendingArchiveMeta {
  extractedAt: string
  chapterNumber: number
}

/**
 * The full payload parked in `Chapter.pendingArchiveData` during the
 * "reviewing" phase. The frontend edits this in `ReviewingPanel.vue`
 * and POSTs it back via `chaptersApi.archive`; the server replays it
 * inside a single `prisma.$transaction` in phase 3.
 */
export interface PendingArchiveData {
  memories: PendingMemories
  graph: {
    mergedGraph: PendingGraphSnapshot
    chapterGraph: PendingGraphSnapshot
  }
  plotArcs: PendingPlotArcWrite[]
  meta: PendingArchiveMeta
}

// =================================================================
// Zod 版 schema(P2a 引入,与 interface 平行存在)
// 用途:
//   1. P2b wire-up:在 chapters.ts archive route 用 schema.parse() 校验
//      Chapter.pendingArchiveData(round-trip JSON)
//   2. 文档化:PendingArchiveData 字段允许什么类型 / 哪些必填 / 哪些可选
// 与 interface 关系:
//   - interface 保留,下游 5 处引用(ReviewingPanel / chapters.ts /
//     combined-extractor) 继续用 interface
//   - zod schema 推导出的 type 是 "strict source of truth" — P2b
//     wire-up 时可以 `type PendingArchiveDataFromZod = z.infer<...>`
//     替换 interface,本 commit 不替换(避免大爆炸改动)
// 设计取舍:
//   - `.passthrough()` (不 .strict()):ReviewingPanel 编辑时可能添加
//     临时字段,不应被 zod 静默 strip
//   - `data: z.record(z.string(), z.any())` 兼容 graph node 任意结构
//   - `status/relationships/events/stages/unresolved` 是 z.string()
//     (Prisma 列是 TEXT,前端要 JSON.stringify 存)
// =================================================================

export const PendingMemoryWriteSchema = z.object({
  storyId: z.string(),
  chapterId: z.string(),
  fromChapterNumber: z.number(),
  layer: z.string(),
  content: z.string(),
  tags: z.string(),
  importance: z.number(),
  originUid: z.string().optional()
})

export const PendingCharacterStateWriteSchema = z.object({
  characterId: z.string(),
  fromChapterNumber: z.number(),
  status: z.string(),
  relationships: z.string()
})

export const PendingTimelineEventWriteSchema = z.object({
  storyId: z.string(),
  fromChapterNumber: z.number(),
  position: z.number(),
  events: z.string()
})

export const PendingMemoriesSchema = z.object({
  memories: z.array(PendingMemoryWriteSchema),
  characterStates: z.array(PendingCharacterStateWriteSchema),
  timelineEvents: z.array(PendingTimelineEventWriteSchema),
  summary: z.string().nullable(),
  timelinePosition: z.number().nullable()
})

export const PendingGraphNodeSchema = z.object({
  type: z.string(),
  key: z.string(),
  label: z.string(),
  data: z.record(z.string(), z.any())
}).passthrough()

export const PendingGraphEdgeSchema = z.object({
  fromType: z.string(),
  fromKey: z.string(),
  toType: z.string(),
  toKey: z.string(),
  relation: z.string(),
  weight: z.number()
})

export const PendingGraphSnapshotSchema = z.object({
  nodes: z.array(PendingGraphNodeSchema),
  edges: z.array(PendingGraphEdgeSchema),
  timestamp: z.string()
})

export const PendingPlotArcWriteSchema = z.object({
  storyId: z.string(),
  name: z.string(),
  type: z.string(),
  status: z.string(),
  progress: z.number(),
  stages: z.string(),
  currentStage: z.string(),
  nextGoal: z.string(),
  unresolved: z.string(),
  summary: z.string(),
  isNew: z.boolean(),
  existingId: z.string().optional()
})

export const PendingArchiveMetaSchema = z.object({
  extractedAt: z.string(),
  chapterNumber: z.number()
})

export const PendingArchiveDataSchema = z.object({
  memories: PendingMemoriesSchema,
  graph: z.object({
    mergedGraph: PendingGraphSnapshotSchema,
    chapterGraph: PendingGraphSnapshotSchema
  }),
  plotArcs: z.array(PendingPlotArcWriteSchema),
  meta: PendingArchiveMetaSchema
}).passthrough()

// TypeScript 类型(zod 推导),与上面 interface 平行
export type PendingMemoryWriteZ = z.infer<typeof PendingMemoryWriteSchema>
export type PendingCharacterStateWriteZ = z.infer<typeof PendingCharacterStateWriteSchema>
export type PendingTimelineEventWriteZ = z.infer<typeof PendingTimelineEventWriteSchema>
export type PendingMemoriesZ = z.infer<typeof PendingMemoriesSchema>
export type PendingGraphNodeZ = z.infer<typeof PendingGraphNodeSchema>
export type PendingGraphEdgeZ = z.infer<typeof PendingGraphEdgeSchema>
export type PendingGraphSnapshotZ = z.infer<typeof PendingGraphSnapshotSchema>
export type PendingPlotArcWriteZ = z.infer<typeof PendingPlotArcWriteSchema>
export type PendingArchiveMetaZ = z.infer<typeof PendingArchiveMetaSchema>
export type PendingArchiveDataZ = z.infer<typeof PendingArchiveDataSchema>

// =================================================================
// v3 shape (2026-07-25 引入)
// 把单一 PendingArchiveData 拆为 4 个独立 stage 状态。
// 老 v1/v2 blob 无 `version` 字段 → 前端检测为老 shape,提示用户重新 prepare-archive。
// =================================================================

export interface PendingStageState {
  status: 'pending' | 'running' | 'success' | 'failed'
  result?: unknown
  errorMessage?: string
  completedAt?: string
}

export interface PendingArchiveDataV3 {
  version: 3
  stages: {
    character: PendingStageState
    memory: PendingStageState
    plotArc: PendingStageState
    graph: PendingStageState
  }
  // 累计图谱数据 (AI 生成 + 用户编辑) 在 reviewing 期间只活在 pendingArchiveData 这两个字段,
  // Chapter.cumulativeGraph / cumulativeGraphGeneratedAt 列始终为 null,
  // archive confirm 时从这俩字段拷到列。知识图谱页面只查 archived, 读列即可。
  cumulativeGraph?: PendingGraphSnapshot
  cumulativeGraphGeneratedAt?: string
  meta: {
    extractedAt: string
    chapterNumber: number
  }
}

export const PendingStageStateSchema = z.object({
  status: z.enum(['pending', 'running', 'success', 'failed']),
  result: z.unknown().optional(),
  errorMessage: z.string().optional(),
  completedAt: z.string().optional()
}).passthrough()

export const PendingArchiveDataV3Schema = z.object({
  version: z.literal(3),
  stages: z.object({
    character: PendingStageStateSchema,
    memory: PendingStageStateSchema,
    plotArc: PendingStageStateSchema,
    graph: PendingStageStateSchema
  }),
  cumulativeGraph: PendingGraphSnapshotSchema.optional(),
  cumulativeGraphGeneratedAt: z.string().optional(),
  meta: z.object({
    extractedAt: z.string(),
    chapterNumber: z.number()
  })
}).passthrough()

export type PendingArchiveDataV3Z = z.infer<typeof PendingArchiveDataV3Schema>
