
import React, { createContext, useContext, useState, useCallback, ReactNode, useEffect, useRef } from 'react'
import type { MediaViewType, ViewType, QualityFilter } from '../components/library/types'

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
  
  // Detail Panel State
  selectedItemId: number | null
  selectedItemType: 'movie' | 'episode' | 'track' | null
  setSelectedMedia: (id: number | null, type?: 'movie' | 'episode' | 'track') => void
  
  // Navigation State (Current Selections)
  selectedShow: string | null
  setSelectedShow: (title: string | null) => void
  selectedArtist: any | null
  setSelectedArtist: (artist: any | null) => void
  selectedAlbum: any | null
  setSelectedAlbum: (album: any | null) => void
  
  // Sort State
  sortBy: string
  setSortBy: (sort: string) => void
  
  // Selection
  activeSourceId: string | null
  setActiveSourceId: (id: string | null) => void
}

const LibraryContext = createContext<LibraryContextType | undefined>(undefined)

export function LibraryProvider({ children, initialTab }: { children: ReactNode, initialTab?: MediaViewType }) {
  const [view, setView] = useState<MediaViewType>(initialTab || 'movies')
  const [searchQuery, setSearchQuery] = useState('')
  const [qualityFilter, setQualityFilter] = useState<QualityFilter>('all')
  const [gridScale, setGridScaleState] = useState(4)
  const [viewType, setViewTypeState] = useState<ViewType>('grid')
  const [sortBy, setSortBy] = useState('title')
  const [activeSourceId, setActiveSourceId] = useState<string | null>(null)
  
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null)
  const [selectedItemType, setSelectedItemType] = useState<'movie' | 'episode' | 'track' | null>(null)

  const [selectedShow, setSelectedShow] = useState<string | null>(null)
  const [selectedArtist, setSelectedArtist] = useState<any | null>(null)
  const [selectedAlbum, setSelectedAlbum] = useState<any | null>(null)

  // Persist view preferences
  const viewPrefsRef = useRef<Record<string, { viewType: ViewType, gridScale: number }>>({})

  useEffect(() => {
    window.electronAPI.getSetting('library_view_prefs').then(val => {
      if (val) {
        try {
          viewPrefsRef.current = JSON.parse(val)
          const current = viewPrefsRef.current[view]
          if (current) {
            setViewTypeState(current.viewType)
            setGridScaleState(current.gridScale)
          }
        } catch (e) { /* ignore */ }
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
      selectedItemId, selectedItemType, setSelectedMedia,
      selectedShow, setSelectedShow,
      selectedArtist, setSelectedArtist,
      selectedAlbum, setSelectedAlbum,
      sortBy, setSortBy,
      activeSourceId, setActiveSourceId
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
