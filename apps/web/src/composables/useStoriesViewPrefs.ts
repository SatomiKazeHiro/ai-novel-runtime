import { ref, watch } from 'vue'

const VIEW_KEY = 'novel-runtime:stories-view-mode'
const FILTER_KEY = 'novel-runtime:stories-cover-filter'

export type StoriesViewMode = 'table' | 'cards'
export type StoriesCoverFilter = 'all' | 'with-cover'

function readStored<T extends string>(key: string, fallback: T, allowed: readonly T[]): T {
  const raw = localStorage.getItem(key)
  return (allowed as readonly string[]).includes(raw as string) ? (raw as T) : fallback
}

export function useStoriesViewPrefs() {
  const viewMode = ref<StoriesViewMode>(
    readStored(VIEW_KEY, 'table', ['table', 'cards'] as const)
  )
  const coverFilter = ref<StoriesCoverFilter>(
    readStored(FILTER_KEY, 'all', ['all', 'with-cover'] as const)
  )

  watch(viewMode, v => localStorage.setItem(VIEW_KEY, v), { flush: 'post' })
  watch(coverFilter, v => localStorage.setItem(FILTER_KEY, v), { flush: 'post' })

  return { viewMode, coverFilter }
}
