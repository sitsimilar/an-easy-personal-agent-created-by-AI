import { create } from 'zustand'
import type { InfoRecord, RecordListFilter, RecordType } from '@shared/types/domain'
import { recordService } from '@/services/recordService'
import { friendlyError } from '@/lib/unwrap'

interface RecordState {
  records: InfoRecord[]
  total: number
  loading: boolean
  error: string | null
  filter: RecordListFilter
  searchResults: InfoRecord[] | null
  searchLoading: boolean
  load: () => Promise<void>
  setFilter: (patch: Partial<RecordListFilter>) => void
  resetFilter: () => void
  setPage: (page: number) => void
  search: (keyword: string) => Promise<InfoRecord[]>
  clearSearch: () => void
}

const DEFAULT_FILTER: RecordListFilter = {
  page: 1,
  pageSize: 20,
  isDeleted: false,
}

/** 记录列表/筛选/分页全局 store。 */
let loadSeq = 0

export const useRecordStore = create<RecordState>((set, get) => ({
  records: [],
  total: 0,
  loading: false,
  error: null,
  filter: { ...DEFAULT_FILTER },
  searchResults: null,
  searchLoading: false,

  load: async () => {
    const { filter } = get()
    const seq = ++loadSeq // 请求序号：仅最新一次请求可写回，防旧慢请求覆盖新结果
    set({ loading: true, error: null })
    try {
      const result = await recordService.listRecords(filter)
      if (seq !== loadSeq) return
      set({ records: result.records, total: result.total, loading: false })
    } catch (err) {
      if (seq !== loadSeq) return
      set({ error: friendlyError(err), loading: false })
    }
  },

  setFilter: (patch) => {
    const next = { ...get().filter, ...patch, page: patch.page ?? 1 }
    set({ filter: next })
  },

  resetFilter: () => {
    set({ filter: { ...DEFAULT_FILTER }, searchResults: null })
  },

  setPage: (page) => {
    set({ filter: { ...get().filter, page } })
  },

  search: async (keyword) => {
    set({ searchLoading: true })
    try {
      const { filter } = get()
      const results = await recordService.search(keyword, {
        type: filter.type as RecordType | undefined,
        category: filter.category,
      })
      set({ searchResults: results, searchLoading: false })
      return results
    } catch (err) {
      set({ searchLoading: false })
      throw err
    }
  },

  clearSearch: () => set({ searchResults: null }),
}))
