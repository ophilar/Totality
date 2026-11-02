import { useState, useEffect, useCallback, useRef } from 'react'
import type { MediaItem, MovieCollection, SeriesCompleteness, ArtistCompleteness, DashboardDataSection, DashboardSummary, MusicAlbum } from '@main/types/database'

const ALL_DASHBOARD_SECTIONS: DashboardDataSection[] = ['upgrades', 'collections', 'series', 'artists']

function sectionsForAnalysisTask(task: { type: string; result?: { outcomes?: Array<{ stage: string }>; analysis?: { outcomes?: Array<{ stage: string }> } } }): DashboardDataSection[] {
  if (task.type === 'quality-analysis') return ['upgrades']
  if (task.type === 'series-completeness') return ['series']
  if (task.type === 'collection-completeness') return ['collections']
  if (task.type === 'music-completeness') return ['artists']
  if (task.type !== 'analysis') return []

  const sections = new Set<DashboardDataSection>()
  for (const outcome of task.result?.analysis?.outcomes ?? task.result?.outcomes ?? []) {
    if (outcome.stage === 'quality' || outcome.stage === 'music-quality') sections.add('upgrades')
    if (outcome.stage === 'series-completeness') sections.add('series')
    if (outcome.stage === 'collection-completeness') sections.add('collections')
    if (outcome.stage === 'music-completeness' || outcome.stage === 'artist-completeness' || outcome.stage === 'owned-album-completeness') sections.add('artists')
  }
  return [...sections]
}

export function useDashboardData(activeSourceId: string | null) {
  const [movieUpgrades, setMovieUpgrades] = useState<MediaItem[]>([])
  const [tvUpgrades, setTvUpgrades] = useState<MediaItem[]>([])
  const [musicUpgrades, setMusicUpgrades] = useState<MusicAlbum[]>([])
  const [collections, setCollections] = useState<MovieCollection[]>([])
  const [series, setSeries] = useState<SeriesCompleteness[]>([])
  const [artists, setArtists] = useState<ArtistCompleteness[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const hasLoadedData = useRef(false)
  const activeSourceRef = useRef(activeSourceId)
  activeSourceRef.current = activeSourceId
  const sectionVersions = useRef(new Map<DashboardDataSection, number>())
  const pendingRefreshSections = useRef(new Set<DashboardDataSection>())
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Sort/Setting states
  const [upgradeSortBy, setUpgradeSortBy] = useState('quality')
  const [upgradeSortOrder, setUpgradeSortOrderState] = useState<'asc' | 'desc'>('desc')
  const [collectionSortBy, setCollectionSortBy] = useState('completeness')
  const [seriesSortBy, setSeriesSortBy] = useState('completeness')
  const [artistSortBy, setArtistSortBy] = useState('completeness')
  const [collectionSortOrder, setCollectionSortOrder] = useState<'asc' | 'desc'>('desc')
  const [seriesSortOrder, setSeriesSortOrder] = useState<'asc' | 'desc'>('desc')
  const [artistSortOrder, setArtistSortOrder] = useState<'asc' | 'desc'>('desc')
  const [includeEps, setIncludeEps] = useState(true)
  const [includeSingles, setIncludeSingles] = useState(true)

  const loadDashboardData = useCallback(async (sections: DashboardDataSection[] = ALL_DASHBOARD_SECTIONS) => {
    const requestSourceId = activeSourceId
    const isFullRefresh = ALL_DASHBOARD_SECTIONS.every(section => sections.includes(section))
    const isInitialLoad = !hasLoadedData.current && isFullRefresh
    const requestVersions = new Map<DashboardDataSection, number>()
    for (const section of sections) {
      const version = (sectionVersions.current.get(section) ?? 0) + 1
      sectionVersions.current.set(section, version)
      requestVersions.set(section, version)
    }
    if (isInitialLoad) {
      setIsLoading(true)
      setError(null)
    }
    try {
      const summary = await window.electronAPI.getDashboardSummary({ sourceId: requestSourceId || undefined, sections }) as DashboardSummary
      if (activeSourceRef.current !== requestSourceId) return
      const isCurrent = (section: DashboardDataSection) => sectionVersions.current.get(section) === requestVersions.get(section)

      if (sections.includes('upgrades') && isCurrent('upgrades')) {
        setMovieUpgrades(summary.movieUpgrades)
        setTvUpgrades(summary.tvUpgrades)
        setMusicUpgrades(summary.musicUpgrades)
      }
      if (sections.includes('collections') && isCurrent('collections')) setCollections(summary.incompleteCollections)
      if (sections.includes('series') && isCurrent('series')) setSeries(summary.incompleteSeries)
      if (sections.includes('artists') && isCurrent('artists')) setArtists(summary.incompleteArtists)
      
      // Update local setting states to reflect DB state
      setUpgradeSortBy(summary.settings.upgradeSort)
      setCollectionSortBy(summary.settings.collectionSort)
      setSeriesSortBy(summary.settings.seriesSort)
      setArtistSortBy(summary.settings.artistSort)
      setCollectionSortOrder(summary.settings.collectionSortOrder)
      setSeriesSortOrder(summary.settings.seriesSortOrder)
      setArtistSortOrder(summary.settings.artistSortOrder)
      setIncludeEps(summary.settings.includeEps)
      setIncludeSingles(summary.settings.includeSingles)
      if (isFullRefresh) hasLoadedData.current = true
      if (activeSourceRef.current === requestSourceId) setRefreshError(null)
    } catch (err) {
      window.electronAPI.log.error('Dashboard', 'Failed to load dashboard summary:', err)
      if (activeSourceRef.current === requestSourceId) {
        if (isInitialLoad) setError('Failed to load dashboard data. Please try again.')
        else setRefreshError('Some dashboard information could not be refreshed. Existing results are still shown.')
      }
    } finally {
      if (isInitialLoad && activeSourceRef.current === requestSourceId) setIsLoading(false)
    }
  }, [activeSourceId])

  const scheduleDashboardRefresh = useCallback((sections: DashboardDataSection[]) => {
    for (const section of sections) pendingRefreshSections.current.add(section)
    if (pendingRefreshSections.current.size === 0 || refreshTimer.current) return
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null
      const pending = [...pendingRefreshSections.current]
      pendingRefreshSections.current.clear()
      void loadDashboardData(pending)
    }, 250)
  }, [loadDashboardData])

  useEffect(() => () => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current)
  }, [])

  useEffect(() => {
    window.electronAPI.getSetting('dashboard_upgrade_sort_order').then(value => {
      if (value === 'asc' || value === 'desc') setUpgradeSortOrderState(value)
    })
  }, [])

  const setUpgradeSortOrder = useCallback((order: 'asc' | 'desc') => {
    setUpgradeSortOrderState(order)
    void window.electronAPI.setSetting('dashboard_upgrade_sort_order', order)
  }, [])

  useEffect(() => {
    queueMicrotask(() => { void loadDashboardData() })
  }, [loadDashboardData])

  useEffect(() => {
    const cleanup = window.electronAPI.onSettingsChanged?.((data) => {
      const sectionBySetting: Record<string, DashboardDataSection> = {
        dashboard_upgrade_sort: 'upgrades',
        dashboard_collection_sort: 'collections',
        dashboard_series_sort: 'series',
        dashboard_artist_sort: 'artists',
        completeness_include_eps: 'artists',
        completeness_include_singles: 'artists',
      }
      const section = sectionBySetting[data.key]
      if (section) scheduleDashboardRefresh([section])
    })
    return () => cleanup?.()
  }, [scheduleDashboardRefresh])

  useEffect(() => {
    const cleanup = window.electronAPI.onScanCompleted?.((scan) => {
      if (!scan.sourceId || !scan.libraryId) {
        scheduleDashboardRefresh(ALL_DASHBOARD_SECTIONS)
        return
      }
      void window.electronAPI.sourcesGetLibrariesWithStatus(scan.sourceId).then(libraries => {
        const library = libraries.find(item => item.id === scan.libraryId)
        if (!library) throw new Error(`Scanned library ${scan.libraryId} is missing from source ${scan.sourceId}`)
        switch (library.type) {
          case 'movie': scheduleDashboardRefresh(['upgrades', 'collections']); break
          case 'show': scheduleDashboardRefresh(['upgrades', 'series']); break
          case 'music': scheduleDashboardRefresh(['upgrades', 'artists']); break
          case 'mixed': scheduleDashboardRefresh(ALL_DASHBOARD_SECTIONS); break
          default: throw new Error(`Scanned library ${library.name} has unsupported dashboard type ${library.type}`)
        }
      }).catch(err => {
        window.electronAPI.log.error('Dashboard', 'Could not map scan completion to dashboard sections:', err)
        setRefreshError('Scan finished, but its dashboard sections could not be refreshed.')
      })
    })
    return () => cleanup?.()
  }, [scheduleDashboardRefresh])

  useEffect(() => {
    const cleanup = window.electronAPI.onTaskQueueTaskComplete?.((taskValue) => {
      const task = taskValue as unknown as { type: string; result?: { outcomes?: Array<{ stage: string }>; analysis?: { outcomes?: Array<{ stage: string }> } } }
      scheduleDashboardRefresh(sectionsForAnalysisTask(task))
    })
    return () => cleanup?.()
  }, [scheduleDashboardRefresh])

  useEffect(() => {
    const handler = () => { void loadDashboardData() }
    window.addEventListener('exclusions-changed', handler)
    return () => window.removeEventListener('exclusions-changed', handler)
  }, [loadDashboardData])

  return {
    movieUpgrades, setMovieUpgrades,
    tvUpgrades, setTvUpgrades,
    musicUpgrades, setMusicUpgrades,
    collections, setCollections,
    series, setSeries,
    artists, setArtists,
    isLoading, error,
    refreshError,
    upgradeSortBy, setUpgradeSortBy, upgradeSortOrder, setUpgradeSortOrder,
    collectionSortBy, setCollectionSortBy,
    seriesSortBy, setSeriesSortBy,
    artistSortBy, setArtistSortBy,
    collectionSortOrder, setCollectionSortOrder, seriesSortOrder, setSeriesSortOrder, artistSortOrder, setArtistSortOrder,
    loadDashboardData,
    includeEps, includeSingles
  }
}
