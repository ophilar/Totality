
import { createContext, useContext, useState, useCallback, ReactNode, useEffect, useRef } from 'react'
import type { MediaViewType, ViewType, QualityFilter } from '@/components/library/types'
import { normalizeSortForType, type LibrarySortType } from '@/components/library/sortDefinitions'
import type { MusicArtist, MusicAlbum } from '@main/types/database'
import type { MediaDeepAnalysisResult } from '@preload/api/media'

interface LibraryContextType {
  view: MediaViewType
  setView: (view: MediaViewType) => void
  searchQuery: string
  setSearchQuery: (query: string) => void
  qualityFilter: QualityFilter
  setQualityFilter: (filter: QualityFilter) => void
  gridScale: number
  setGridScale: (scale: number) => void
  viewType: ViewType
  setViewType: (type: ViewType) => void
  groupByCollections: boolean
  setGroupByCollections: (groupBy: boolean) => void
  
  // Detail Panel State
  selectedItemId: number | null
  selectedItemType: 'movie' | 'episode' | 'track' | null
  setSelectedMedia: (id: number | null, type?: 'movie' | 'episode' | 'track') => void
  
  // Navigation State (Current Selections)
  selectedShow: string | null
  setSelectedShow: (title: string | null) => void
  selectedArtist: MusicArtist | null
  setSelectedArtist: (artist: MusicArtist | null) => void
  selectedAlbum: MusicAlbum | null
  setSelectedAlbum: (album: MusicAlbum | null) => void
  
  // Sort State
  sortBy: string
  setSortBy: (sort: string) => void
  sortOrder: 'asc' | 'desc'
  setSortOrder: (order: 'asc' | 'desc') => void
  
  // Selection
  activeSourceId: string | null
  setActiveSourceId: (id: string | null) => void
  deepAnalyzeMedia: (filePath: string) => Promise<MediaDeepAnalysisResult>
}

const LibraryContext = createContext<LibraryContextType | undefined>(undefined)

function getLibrarySortType(view: MediaViewType): LibrarySortType | null {
  if (view === 'movies') return 'movie'
  if (view === 'tv') return 'tv'
  if (view === 'music') return 'music'
  return null
}

export function LibraryProvider({ children, initialTab }: { children: ReactNode, initialTab?: MediaViewType }) {
  const [view, setView] = useState<MediaViewType>(initialTab || 'movies')
  const [searchQuery, setSearchQuery] = useState('')
  const [qualityFilter, setQualityFilter] = useState<QualityFilter>('all')
  const [gridScale, setGridScaleState] = useState(4)
  const [viewType, setViewTypeState] = useState<ViewType>('grid')
  const [groupByCollections, setGroupByCollectionsState] = useState<boolean>(true)
  const [sortBy, setSortBy] = useState('title')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc')
  const [activeSourceId, setActiveSourceId] = useState<string | null>(null)
  
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null)
  const [selectedItemType, setSelectedItemType] = useState<'movie' | 'episode' | 'track' | null>(null)

  const [selectedShow, setSelectedShow] = useState<string | null>(null)
  const [selectedArtist, setSelectedArtist] = useState<MusicArtist | null>(null)
  const [selectedAlbum, setSelectedAlbum] = useState<MusicAlbum | null>(null)

  const deepAnalyzeMedia = useCallback(async (filePath: string) => {
    try {
      return await window.electronAPI.mediaDeepAnalyze({ filePath })
    } catch (e) {
      window.electronAPI.log.error('[LibraryContext]', 'Deep analysis failed:', e)
      throw e
    }
  }, [])

  // Persist view preferences
  const viewPrefsRef = useRef<Record<string, { viewType: ViewType, gridScale: number, sortBy?: string, sortOrder?: 'asc' | 'desc', groupByCollections?: boolean }>>({})

  useEffect(() => {
    window.electronAPI.getSetting('library_view_prefs').then(val => {
      try {
        if (val) viewPrefsRef.current = JSON.parse(val)
        const current = viewPrefsRef.current[view]
        if (current) {
          setViewTypeState(current.viewType)
          setGridScaleState(current.gridScale)
          if (current.groupByCollections !== undefined) setGroupByCollectionsState(current.groupByCollections)
        }

        const sortType = getLibrarySortType(view)
        if (sortType) {
          const normalized = normalizeSortForType(sortType, current?.sortBy, current?.sortOrder)
          setSortBy(normalized.sortBy)
          setSortOrder(normalized.sortOrder)
        }
      } catch (e) {
        window.electronAPI.log.error('[LibraryContext]', 'Failed to parse view preferences:', e)
        const sortType = getLibrarySortType(view)
        if (sortType) {
          const normalized = normalizeSortForType(sortType, undefined, undefined)
          setSortBy(normalized.sortBy)
          setSortOrder(normalized.sortOrder)
        }
      }
    })
  }, [view])

  const setGridScale = useCallback((scale: number) => {
    setGridScaleState(scale)
    viewPrefsRef.current[view] = { ...viewPrefsRef.current[view], gridScale: scale }
    window.electronAPI.setSetting('library_view_prefs', JSON.stringify(viewPrefsRef.current))
  }, [view])

  const setViewType = useCallback((type: ViewType) => {
    setViewTypeState(type)
    viewPrefsRef.current[view] = { ...viewPrefsRef.current[view], viewType: type }
    window.electronAPI.setSetting('library_view_prefs', JSON.stringify(viewPrefsRef.current))
  }, [view])

  const setGroupByCollections = useCallback((groupBy: boolean) => {
    setGroupByCollectionsState(groupBy)
    viewPrefsRef.current[view] = { ...viewPrefsRef.current[view], groupByCollections: groupBy }
    window.electronAPI.setSetting('library_view_prefs', JSON.stringify(viewPrefsRef.current))
  }, [view])

  const updateSortOrder = useCallback((order: 'asc' | 'desc') => {
    setSortOrder(order)
    viewPrefsRef.current[view] = { ...viewPrefsRef.current[view], sortOrder: order }
    window.electronAPI.setSetting('library_view_prefs', JSON.stringify(viewPrefsRef.current))
  }, [view])

  const updateSortBy = useCallback((sort: string) => {
    setSortBy(sort)
    viewPrefsRef.current[view] = { ...viewPrefsRef.current[view], sortBy: sort }
    window.electronAPI.setSetting('library_view_prefs', JSON.stringify(viewPrefsRef.current))
  }, [view])

  const setSelectedMedia = useCallback((id: number | null, type: 'movie' | 'episode' | 'track' = 'movie') => {
    setSelectedItemId(id)
    setSelectedItemType(id ? type : null)
  }, [])

  return (
    <LibraryContext.Provider value={{
      view, setView,
      searchQuery, setSearchQuery,
      qualityFilter, setQualityFilter,
      gridScale, setGridScale,
      viewType, setViewType,
      groupByCollections, setGroupByCollections,
      selectedItemId, selectedItemType, setSelectedMedia,
      selectedShow, setSelectedShow,
      selectedArtist, setSelectedArtist,
      selectedAlbum, setSelectedAlbum,
      sortBy, setSortBy: updateSortBy,
      sortOrder, setSortOrder: updateSortOrder,
      activeSourceId, setActiveSourceId,
      deepAnalyzeMedia
    }}>
      {children}
    </LibraryContext.Provider>
  )
}

export function useLibrary() {
  const context = useContext(LibraryContext)
  if (!context) throw new Error('useLibrary must be used within a LibraryProvider')
  return context
}
