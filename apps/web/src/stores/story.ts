import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { storiesApi } from '../api/stories'

const STORAGE_KEY = 'novel-runtime:selected-story'

export const useStoryStore = defineStore('story', () => {
  // State
  const stories = ref<any[]>([])
  const selectedStoryId = ref<string | null>(localStorage.getItem(STORAGE_KEY))
  const loaded = ref(false)

  // Getters
  const storyOptions = computed(() =>
    stories.value.map(s => ({ label: s.title, value: s.id }))
  )

  const selectedStory = computed(() =>
    stories.value.find(s => s.id === selectedStoryId.value) || null
  )

  // Actions
  async function loadStories() {
    const res = await storiesApi.list()
    stories.value = res.data.data
    loaded.value = true

    // 如果当前选中的小说不在列表中，清空选择
    if (selectedStoryId.value && !stories.value.some(s => s.id === selectedStoryId.value)) {
      selectedStoryId.value = null
      localStorage.removeItem(STORAGE_KEY)
    }
  }

  function selectStory(id: string | null) {
    selectedStoryId.value = id
    if (id) {
      localStorage.setItem(STORAGE_KEY, id)
    } else {
      localStorage.removeItem(STORAGE_KEY)
    }
  }

  return {
    stories,
    selectedStoryId,
    loaded,
    storyOptions,
    selectedStory,
    loadStories,
    selectStory
  }
})
