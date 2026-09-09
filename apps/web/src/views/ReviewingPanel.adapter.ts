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
  // 累计图谱数据, reviewing 期间只活在 pendingArchiveData.cumulativeGraph。
  // AI 生成时由后端 cumulative-graph/build 端点写入, 用户编辑后保存时由 toV3 写回。
  cumulativeGraph?: { nodes: any[]; edges: any[]; timestamp?: string }
  cumulativeGraphGeneratedAt?: string
  meta: { extractedAt?: string; chapterNumber?: number | string }
}

export interface LocalMemoryRow {
  content: string
  tags: string[]            // 'main-plot' | 'side-plot'
  importance: number
  fromChapterNumber: number
  participants?: string     // 参与者姓名，逗号分隔；有则填、无留空
}

export interface LocalCharacterState {
  characterId: string | null
  name: string
  key: string
  status: string            // JSON 字符串
  relationships: string     // JSON 字符串
  costume?: string          // v4: 衣着快照(留空表示未描写)
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
  // 累计图谱, 与 chapterGraph 走同一个 localData 流, 不再独立 ref。
  cumulativeGraph?: { nodes: any[]; edges: any[]; timestamp?: string }
  cumulativeGraphGeneratedAt?: string
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
    },
    cumulativeGraph: pending?.cumulativeGraph ?? { nodes: [], edges: [] },
    cumulativeGraphGeneratedAt: pending?.cumulativeGraphGeneratedAt
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
      importance: m.importance
    }))
  const sideEvents = memories.memories
    .filter((m) => !m.tags?.includes('main-plot'))
    .map((m) => ({
      description: m.content,
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
    cumulativeGraph: local.cumulativeGraph,
    cumulativeGraphGeneratedAt: local.cumulativeGraphGeneratedAt,
    meta: original?.meta ?? {}
  }
}

// v4 形态：memory 拆为原始抽取与优化两个阶段。
export interface V4PendingArchiveData {
  version: 4
  stages: {
    character?: { status: string; result?: any; errorMessage?: string; completedAt?: string }
    memoryExtract?: { status: string; result?: any; errorMessage?: string; completedAt?: string }
    memoryOptimize?: { status: string; result?: any; errorMessage?: string; completedAt?: string }
    plotArc?: { status: string; result?: any; errorMessage?: string; completedAt?: string }
    graph?: { status: string; result?: any; errorMessage?: string; completedAt?: string }
  }
  cumulativeGraph?: { nodes: any[]; edges: any[]; timestamp?: string }
  cumulativeGraphGeneratedAt?: string
  meta: { extractedAt?: string; chapterNumber?: number | string }
}

export function fromV4(pending: V4PendingArchiveData | null | undefined): LocalData {
  const stages = pending?.stages ?? {}
  const extract = stages.memoryExtract?.result ?? {}
  const chr = stages.character?.result ?? {}
  const plot = stages.plotArc?.result ?? {}
  const graph = stages.graph?.result ?? {}
  const chapterNumber = Number(pending?.meta?.chapterNumber ?? 0)
  const toMemory = (event: any, tags: string[]): LocalMemoryRow => ({
    content: event?.description ?? '', tags,
    importance: typeof event?.importance === 'number' ? event.importance : 5,
    fromChapterNumber: chapterNumber,
    participants: typeof event?.participants === 'string' ? event.participants : undefined
  })
  const stringifyJson = (value: unknown): string => {
    if (typeof value === 'string') return value
    if (value === null || value === undefined) return ''
    try { return JSON.stringify(value, null, 2) } catch { return '' }
  }
  const characterStates: LocalCharacterState[] = (Array.isArray(chr.characterStates) ? chr.characterStates : []).map((state: any) => ({
    characterId: state?.characterId ?? null,
    name: state?.name ?? '', key: state?.key ?? '',
    status: stringifyJson(state?.status), relationships: stringifyJson(state?.relationships),
    costume: typeof state?.costume === 'string' ? state.costume : '',
    isNew: !!state?.isNew
  }))
  return {
    summary: typeof extract.summary === 'string' ? extract.summary : '',
    memories: {
      memories: [
        ...(Array.isArray(extract.mainEvents) ? extract.mainEvents : []).map((event: any) => toMemory(event, ['main-plot'])),
        ...(Array.isArray(extract.sideEvents) ? extract.sideEvents : []).map((event: any) => toMemory(event, ['side-plot']))
      ],
      characterStates,
      emotions: Array.isArray(extract.emotions) ? extract.emotions : [],
      foreshadowing: Array.isArray(extract.foreshadowing) ? extract.foreshadowing : [],
      relationshipChanges: Array.isArray(extract.relationshipChanges) ? extract.relationshipChanges : []
    },
    plotArcs: Array.isArray(plot.plotArcs) ? plot.plotArcs : [],
    graph: { chapterGraph: graph.chapterGraph ?? { nodes: [], edges: [] } },
    cumulativeGraph: pending?.cumulativeGraph ?? { nodes: [], edges: [] },
    cumulativeGraphGeneratedAt: pending?.cumulativeGraphGeneratedAt
  }
}

export function toV4(local: LocalData, original: V4PendingArchiveData): V4PendingArchiveData {
  const stages: V4PendingArchiveData['stages'] = JSON.parse(JSON.stringify(original?.stages ?? {}))
  const memories = local.memories
  const mainEvents = memories.memories.filter((memory) => memory.tags?.includes('main-plot'))
    .map((memory) => ({ description: memory.content, importance: memory.importance, participants: memory.participants }))
  const sideEvents = memories.memories.filter((memory) => !memory.tags?.includes('main-plot'))
    .map((memory) => ({ description: memory.content, importance: memory.importance, participants: memory.participants }))
  if (!stages.memoryExtract) stages.memoryExtract = { status: 'success' }
  stages.memoryExtract.result = {
    ...(stages.memoryExtract.result ?? {}), summary: local.summary, mainEvents, sideEvents,
    emotions: memories.emotions, foreshadowing: memories.foreshadowing,
    relationshipChanges: memories.relationshipChanges
  }
  const parseJson = (value: string): any => {
    if (typeof value !== 'string') return value
    const trimmed = value.trim()
    if (!trimmed) return {}
    try { return JSON.parse(trimmed) } catch { return {} }
  }
  if (!stages.character) stages.character = { status: 'success' }
  stages.character.result = {
    characterStates: memories.characterStates.map((state) => ({
      characterId: state.characterId, name: state.name, key: state.key,
      status: parseJson(state.status), relationships: parseJson(state.relationships),
      costume: state.costume ?? '',
      isNew: state.isNew
    }))
  }
  if (!stages.plotArc) stages.plotArc = { status: 'success' }
  stages.plotArc.result = { plotArcs: local.plotArcs }
  if (!stages.graph) stages.graph = { status: 'success' }
  stages.graph.result = { chapterGraph: local.graph.chapterGraph }
  return {
    version: 4, stages, cumulativeGraph: local.cumulativeGraph,
    cumulativeGraphGeneratedAt: local.cumulativeGraphGeneratedAt,
    meta: original?.meta ?? {}
  }
}
