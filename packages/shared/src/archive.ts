// Shared archive pipeline types (used by server + web)
//
// This is the single source of truth for the shape of the JSON payload
// stored in `Chapter.pendingArchiveData` (TEXT column) and round-tripped
// between server and web during the "reviewing" phase of the archive
// lifecycle. Both apps must agree on this shape, or the user's edits
// will silently desync.

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
