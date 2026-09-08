/**
 * v3 pendingArchiveData 形状 ↔ v2 本地 LocalData 形状适配层。
 * ReviewingPanel.vue 内部使用 v2 形态(沿用 v2 的 n-input / n-select / n-slider 编辑链路),
 * 但对父组件暴露 v3 入参和 v3 出参,以便与后端 4-stage 抽取结果对齐。
 */

export interface V3PendingArchiveData {
  version: 3
  stages: {
    character?: { status: string; result?: any; errorMessage?: string; completedAt?: string }
    memory?:    { status: string; result?: any; errorMessage?: string; completedAt?: string }
    plotArc?:   { status: string; result?: any; errorMessage?: string; completedAt?: string }
    graph?:     { status: string; result?: any; errorMessage?: string; completedAt?: string }
  }
  meta: { extractedAt?: string; chapterNumber?: number | string }
}

export interface LocalMemoryRow {
  content: string
  tags: string[]            // 'main-plot' | 'side-plot'
  importance: number
  fromChapterNumber: number
}

export interface LocalCharacterState {
  characterId: string | null
  name: string
  key: string
  status: string            // JSON 字符串
  relationships: string     // JSON 字符串
  isNew: boolean
}

export interface LocalData {
  summary: string
  memories: {
    memories: LocalMemoryRow[]
    characterStates: LocalCharacterState[]
    emotions: string[]
    foreshadowing: string[]
    relationshipChanges: string[]
  }
  plotArcs: any[]
  graph: {
    chapterGraph: { nodes: any[]; edges: any[] }
  }
}

/**
 * 把后端返回的 v3 pendingArchiveData 转为 v2 形态(供 ReviewingPanel 内部 v-model 绑定)。
 * 空字段安全降级,不会崩。
 */
export function fromV3(pending: V3PendingArchiveData | null | undefined): LocalData {
  const stages = pending?.stages ?? {}
  const mem = stages.memory?.result ?? {}
  const chr = stages.character?.result ?? {}
  const plot = stages.plotArc?.result ?? {}
  const graph = stages.graph?.result ?? {}

  const chNum = Number(pending?.meta?.chapterNumber ?? 0)

  const toMemory = (ev: any, tags: string[]): LocalMemoryRow => ({
    content: ev?.description ?? '',
    tags,
    importance: typeof ev?.importance === 'number' ? ev.importance : 5,
    fromChapterNumber: chNum
  })

  /**
   * v3 character-stage 返回的 status / relationships 是 JSON object;
   * v2 ReviewingPanel 用 n-input 当文本编辑,需要 JSON 字符串。
   * 这里安全 stringify,失败回退到空串(避免 Vue warn)。
   */
  const stringifyJson = (v: unknown): string => {
    if (typeof v === 'string') return v
    if (v === null || v === undefined) return ''
    try { return JSON.stringify(v, null, 2) } catch { return '' }
  }

  const characterStates: LocalCharacterState[] = (Array.isArray(chr.characterStates) ? chr.characterStates : []).map((s: any) => ({
    characterId: s?.characterId ?? null,
    name: s?.name ?? '',
    key: s?.key ?? '',
    status: stringifyJson(s?.status),
    relationships: stringifyJson(s?.relationships),
    isNew: !!s?.isNew
  }))

  return {
    summary: typeof mem.summary === 'string' ? mem.summary : '',
    memories: {
      memories: [
        ...(Array.isArray(mem.mainEvents) ? mem.mainEvents : []).map((e: any) => toMemory(e, ['main-plot'])),
        ...(Array.isArray(mem.sideEvents) ? mem.sideEvents : []).map((e: any) => toMemory(e, ['side-plot']))
      ],
      characterStates,
      emotions: Array.isArray(mem.emotions) ? mem.emotions : [],
      foreshadowing: Array.isArray(mem.foreshadowing) ? mem.foreshadowing : [],
      relationshipChanges: Array.isArray(mem.relationshipChanges) ? mem.relationshipChanges : []
    },
    plotArcs: Array.isArray(plot.plotArcs) ? plot.plotArcs : [],
    graph: {
      chapterGraph: graph.chapterGraph ?? { nodes: [], edges: [] }
    }
  }
}

/**
 * 把 v2 形态的本地编辑结果反向写回 v3 形态(供 ReviewingPanel → 父组件 save/confirm 事件)。
 * 保留 original.version / original.meta,只重写 stages 各 .result 字段。
 */
export function toV3(local: LocalData, original: V3PendingArchiveData): V3PendingArchiveData {
  const stages: V3PendingArchiveData['stages'] = JSON.parse(
    JSON.stringify(original?.stages ?? {})
  )

  // memory stage — main/side events 重新分流
  const memories = local.memories
  const mainEvents = memories.memories
    .filter((m) => m.tags?.includes('main-plot'))
    .map((m) => ({
      description: m.content,
      participants: [] as string[],
      importance: m.importance
    }))
  const sideEvents = memories.memories
    .filter((m) => !m.tags?.includes('main-plot'))
    .map((m) => ({
      description: m.content,
      participants: [] as string[],
      importance: m.importance
    }))

  if (!stages.memory) stages.memory = { status: 'success' }
  stages.memory.result = {
    ...(stages.memory.result ?? {}),
    summary: local.summary,
    mainEvents,
    sideEvents,
    emotions: memories.emotions,
    foreshadowing: memories.foreshadowing,
    relationshipChanges: memories.relationshipChanges
  }

  // character stage — 把 v2 编辑后的 JSON 字符串解析回 object
  if (!stages.character) stages.character = { status: 'success' }
  const parseJson = (v: string): any => {
    if (typeof v !== 'string') return v
    const trimmed = v.trim()
    if (!trimmed) return {}
    try { return JSON.parse(trimmed) } catch { return {} }
  }
  stages.character.result = {
    characterStates: memories.characterStates.map((s) => ({
      characterId: s.characterId,
      name: s.name,
      key: s.key,
      status: parseJson(s.status),
      relationships: parseJson(s.relationships),
      isNew: s.isNew
    }))
  }

  // plotArc stage
  if (!stages.plotArc) stages.plotArc = { status: 'success' }
  stages.plotArc.result = {
    plotArcs: local.plotArcs
  }

  // graph stage
  if (!stages.graph) stages.graph = { status: 'success' }
  stages.graph.result = {
    chapterGraph: local.graph.chapterGraph
  }

  return {
    version: 3,
    stages,
    meta: original?.meta ?? {}
  }
}