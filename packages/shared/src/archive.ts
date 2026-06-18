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
 */
export interface PendingTimelineEventWrite {
  storyId: string
  fromChapterNumber: number
  day: number
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
  day: z.number(),
  events: z.string()
})

export const PendingMemoriesSchema = z.object({
  memories: z.array(PendingMemoryWriteSchema),
  characterStates: z.array(PendingCharacterStateWriteSchema),
  timelineEvents: z.array(PendingTimelineEventWriteSchema),
  summary: z.string().nullable()
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
