import { ref, computed, reactive } from 'vue'
import { api } from '../utils/api'

export interface VersionBranch {
  id: string
  name: string
}

export function useVersionBranches(
  storyId: () => string | undefined,
  includeAll: boolean = false
) {
  const versionBranches = ref<VersionBranch[]>([])
  const selectedVersionBranchId = ref('')

  async function loadVersionBranches() {
    const sid = storyId()
    if (!sid) {
      versionBranches.value = []
      return
    }
    const res = await api.get(`/api/stories/${sid}/version-branches`)
    versionBranches.value = res.data.data || []
  }

  const versionBranchOptions = computed(() => {
    const options = versionBranches.value.map((vb) => ({
      label: vb.name,
      value: vb.id
    }))
    if (includeAll) {
      options.unshift({ label: '全部', value: '' })
    }
    return options
  })

  return reactive({
    versionBranches,
    selectedVersionBranchId,
    loadVersionBranches,
    versionBranchOptions
  })
}
