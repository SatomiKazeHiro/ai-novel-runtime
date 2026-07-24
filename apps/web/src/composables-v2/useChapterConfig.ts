import { ref, computed, type Ref } from 'vue'
import { v2ChaptersApi } from '../api-v2/chapters'
import { v2CharactersApi } from '../api-v2/characters'
import { v2MemoriesApi } from '../api-v2/memories'
import { v2PlotArcsApi } from '../api-v2/plotArcs'
import { v2LoreApi } from '../api-v2/lore'

/** 将 memory ID 列表转为 { type, category, id } 格式，用于 API 传输 */
function resolveMemoryTypeIds(
  memoryIds: string[],
  availableMemories: any[]
): { type: string; category: string; id: string }[] {
  return memoryIds
    .map(id => {
      const m = availableMemories.find((mem: any) => mem.id === id)
      return m ? { type: m.type, category: m.category, id: m.id } : null
    })
    .filter(Boolean) as { type: string; category: string; id: string }[]
}

export function useChapterConfig(
  storyId: () => string,
  chapterId: () => string,
  chapter: Ref<any>
) {
  // ── 可选项 ──
  const availableModels = ref<any[]>([])
  const availableCharacters = ref<any[]>([])
  const availableMemories = ref<any[]>([])
  const availablePlotArcs = ref<any[]>([])
  const availableLore = ref<any[]>([])

  const modelOptions = computed(() =>
    availableModels.value.map((m: any) => ({
      label: `${m.name} / ${m.model}` + (m.isDefault ? ' (默认)' : ''),
      value: m.id
    }))
  )

  // ── 配置状态 ──
  const configProviderId = ref<string | null>(null)
  const configTemperature = ref(0.7)
  const configMaxTokens = ref(8192)
  const configCharacterIds = ref<string[]>([])
  const configMemoryIds = ref<string[]>([])
  const configPlotArcIds = ref<string[]>([])
  const configLoreIds = ref<string[]>([])
  const searchingMemories = ref(false)

  const selectedModel = computed(() =>
    availableModels.value.find((m: any) => m.id === configProviderId.value) || null
  )

  const parsedConfig = computed(() => {
    const raw = chapter.value?.config
    if (!raw || raw === '{}') return null
    try { return typeof raw === 'string' ? JSON.parse(raw) : raw } catch (err: any) {
      console.warn(`[V2] chapter.config JSON 解析失败，使用默认配置: ${(raw as string).slice(0, 80)}`, err)
      return null
    }
  })

  /** 将已保存配置应用到本地 ref */
  function applyConfig(cfg: any) {
    if (cfg.providerConfigId) {
      configProviderId.value = cfg.providerConfigId
    } else {
      const def = availableModels.value.find((m: any) => m.isDefault)
      configProviderId.value = def?.id || null
    }
    configTemperature.value = cfg.temperature ?? (availableModels.value.find((m: any) => m.isDefault)?.temperature ?? 0.7)
    configMaxTokens.value = cfg.maxTokens ?? (availableModels.value.find((m: any) => m.isDefault)?.maxTokens ?? 8192)
    configCharacterIds.value = cfg.characterIds?.length ? cfg.characterIds : availableCharacters.value.map((c: any) => c.id)
    configMemoryIds.value = cfg.memoryTypeIds?.length ? cfg.memoryTypeIds.map((m: any) => m.id) : []
    configPlotArcIds.value = cfg.plotArcIds?.length ? cfg.plotArcIds : availablePlotArcs.value.filter((a: any) => a.status === 'active' || a.status === 'interrupted').map((a: any) => a.id)
    configLoreIds.value = cfg.loreIds?.length ? cfg.loreIds : availableLore.value.map((l: any) => l.id)
  }

  /** 构建发送给后端的生成配置 */
  function buildGenConfig(outline: string): any {
    return {
      _useBodyConfig: true,
      providerConfigId: configProviderId.value || undefined,
      temperature: configTemperature.value,
      maxTokens: configMaxTokens.value,
      characterIds: configCharacterIds.value,
      memoryTypeIds: resolveMemoryTypeIds(configMemoryIds.value, availableMemories.value),
      plotArcIds: configPlotArcIds.value,
      loreIds: configLoreIds.value,
      outline: outline || undefined
    }
  }

  /** 保存当前配置到 chapter.config JSON */
  function buildConfigForSave(): any {
    return {
      characterIds: configCharacterIds.value,
      memoryTypeIds: resolveMemoryTypeIds(configMemoryIds.value, availableMemories.value),
      plotArcIds: configPlotArcIds.value,
      loreIds: configLoreIds.value,
      providerConfigId: configProviderId.value || undefined,
      temperature: configTemperature.value,
      maxTokens: configMaxTokens.value
    }
  }

  /** 加载所有可选数据源 + 自动生成默认配置 */
  async function loadAvailableSources(): Promise<{ restoredPrompt: any | null }> {
    const sid = storyId()
    if (!sid) return { restoredPrompt: null }

    const [modelsRes, charsRes, memsRes, arcsRes, loreRes] = await Promise.all([
      v2ChaptersApi.providerConfigs(),
      v2CharactersApi.list(sid),
      v2MemoriesApi.list({ storyId: sid }),
      v2PlotArcsApi.list(sid),
      v2LoreApi.list(sid)
    ])

    availableModels.value = (modelsRes as any).data?.data || []
    availableCharacters.value = ((charsRes as any).data?.data) || []
    availableMemories.value = ((memsRes as any).data?.data) || []
    availablePlotArcs.value = ((arcsRes as any).data?.data) || []
    availableLore.value = ((loreRes as any).data?.data) || []

    const existingConfig = parsedConfig.value

    // 若配置为空，调用后端生成默认配置
    if (!existingConfig || Object.keys(existingConfig).length === 0) {
      const cid = chapterId()
      if (cid && chapter.value?.status === 'draft') {
        try {
          const genRes = await v2ChaptersApi.generateConfig(cid)
          if (genRes.data?.success && genRes.data.data) {
            const cfg = genRes.data.data
            chapter.value.config = JSON.stringify(cfg)
            applyConfig(cfg)
            return { restoredPrompt: null }
          }
        } catch (genErr: any) {
          console.warn(`[V2-Config] 自动生成默认配置失败，回退到硬编码默认: ${genErr?.message || genErr}`)
        }
      }
    }

    if (existingConfig) {
      applyConfig(existingConfig)
      const prompt = existingConfig._lastPrompt || null
      return { restoredPrompt: prompt }
    }

    // 硬编码默认
    configCharacterIds.value = availableCharacters.value.map((c: any) => c.id)
    configPlotArcIds.value = availablePlotArcs.value.filter((a: any) => a.status === 'active' || a.status === 'interrupted').map((a: any) => a.id)
    configLoreIds.value = availableLore.value.map((l: any) => l.id)
    return { restoredPrompt: null }
  }

  /** 语义搜索记忆（"系统分配"按钮） */
  async function handleMemorySearch(outline: string, onDone?: (msg: string, type: 'success' | 'error') => void) {
    const cid = chapterId()
    if (!cid || !outline.trim()) return
    searchingMemories.value = true
    try {
      const res = await v2ChaptersApi.memorySearch(cid, outline.trim())
      if (res.data?.success && res.data.data) {
        configMemoryIds.value = res.data.data.map((m: any) => m.id)
        onDone?.(`系统分配了 ${res.data.data.length} 条相关记忆`, 'success')
      }
    } catch (err: any) {
      onDone?.(err?.message || '记忆搜索失败', 'error')
    } finally {
      searchingMemories.value = false
    }
  }

  /** 进入设计页时的种子记忆：仅在 configMemoryIds 为空 + 大纲非空时静默跑一次 search。
   *  用户后续任何勾/取消/清空都不再触发，避免"过度兜底"造成系统臃肿。 */
  async function ensureInitialMemoryAssignment(outline: string) {
    if (configMemoryIds.value.length > 0) return
    if (!outline.trim() || availableMemories.value.length === 0) return
    const cid = chapterId()
    if (!cid) return
    try {
      const res = await v2ChaptersApi.memorySearch(cid, outline.trim())
      if (res.data?.success && res.data.data?.length) {
        configMemoryIds.value = res.data.data.map((m: any) => m.id)
      }
    } catch { /* silent — 失败就让 memory 层空着 */ }
  }

  return {
    // 可选数据
    availableModels,
    availableCharacters,
    availableMemories,
    availablePlotArcs,
    availableLore,
    modelOptions,
    // 配置状态
    configProviderId,
    configTemperature,
    configMaxTokens,
    configCharacterIds,
    configMemoryIds,
    configPlotArcIds,
    configLoreIds,
    searchingMemories,
    // 计算属性
    selectedModel,
    parsedConfig,
    // 方法
    applyConfig,
    buildGenConfig,
    buildConfigForSave,
    loadAvailableSources,
    handleMemorySearch,
    ensureInitialMemoryAssignment
  }
}
