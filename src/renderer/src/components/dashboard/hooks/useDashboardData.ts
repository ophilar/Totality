import { useState, useEffect, useCallback } from 'react'
import type { MediaItem, MovieCollectionData, SeriesCompletenessData, ArtistCompletenessData } from '../../library/types'
import type { MusicAlbumUpgrade, MissingMovie, MissingEpisode, UpgradeSortBy, CollectionSortBy, SeriesSortBy, ArtistSortBy } from '../types'

export function useDashboardData(activeSourceId: string | null) {
  const [movieUpgrades, setMovieUpgrades] = useState<MediaItem[]>([])
  const [tvUpgrades, setTvUpgrades] = useState<MediaItem[]>([])
  const [musicUpgrades, setMusicUpgrades] = useState<MusicAlbumUpgrade[]>([])
  const [collections, setCollections] = useState<MovieCollectionData[]>([])
  const [series, setSeries] = useState<SeriesCompletenessData[]>([])
  const [artists, setArtists] = useState<ArtistCompletenessData[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [includeEps, setIncludeEps] = useState(true)
  const [includeSingles, setIncludeSingles] = useState(true)

  const [upgradeSortBy, setUpgradeSortBy] = useState<UpgradeSortBy>('quality')
  const [collectionSortBy, setCollectionSortBy] = useState<CollectionSortBy>('completeness')
  const [seriesSortBy, setSeriesSortBy] = useState<SeriesSortBy>('completeness')
  const [artistSortBy, setArtistSortBy] = useState<ArtistSortBy>('completeness')

  const getCreatedAt = (item: unknown): string => ((item as Record<string, unknown>).created_at as string) || ''

  const loadDashboardData = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const sourceId = activeSourceId || undefined

      const [epsSettingVal, singlesSettingVal, upgSort, collSort, serSort, artSort] = await Promise.all([
        window.electronAPI.getSetting('completeness_include_eps'),
        window.electronAPI.getSetting('completeness_include_singles'),
        window.electronAPI.getSetting('dashboard_upgrade_sort'),
        window.electronAPI.getSetting('dashboard_collection_sort'),
        window.electronAPI.getSetting('dashboard_series_sort'),
        window.electronAPI.getSetting('dashboard_artist_sort'),
      ])
      
      const epsEnabled = epsSettingVal !== 'false'
      const singlesEnabled = singlesSettingVal !== 'false'
      setIncludeEps(epsEnabled)
      setIncludeSingles(singlesEnabled)
      if (upgSort) setUpgradeSortBy(upgSort as UpgradeSortBy)
      if (collSort) setCollectionSortBy(collSort as CollectionSortBy)
      if (serSort) setSeriesSortBy(serSort as SeriesSortBy)
      if (artSort) setArtistSortBy(artSort as ArtistSortBy)

      const [movieUpgradeData, tvUpgradeData, musicUpgradeData, collectionsData, seriesData, artistsData, storageWasteData] = await Promise.all([
        window.electronAPI.getMediaItems({
          needsUpgrade: true,
          type: 'movie',
          sortBy: 'tier_score',
          sortOrder: 'asc',
          sourceId
        }) as Promise<MediaItem[]>,
        window.electronAPI.getMediaItems({
          needsUpgrade: true,
          type: 'episode',
          sortBy: 'tier_score',
          sortOrder: 'asc',
          sourceId
        }) as Promise<MediaItem[]>,
        window.electronAPI.musicGetAlbumsNeedingUpgrade(undefined, sourceId) as Promise<MusicAlbumUpgrade[]>,
        window.electronAPI.collectionsGetIncomplete(sourceId) as Promise<MovieCollectionData[]>,
        window.electronAPI.seriesGetIncomplete(sourceId) as Promise<SeriesCompletenessData[]>,
        window.electronAPI.musicGetAllArtistCompleteness(sourceId) as Promise<ArtistCompletenessData[]>,
        window.electronAPI.getMediaItems({
          sortBy: 'storage_debt',
          sortOrder: 'desc',
          limit: 50,
          sourceId
        }) as Promise<MediaItem[]>,
      ])

      const [collectionExclusions, seriesExclusions, artistExclusions, upgradeExclusions, cleanupExclusions] = await Promise.all([
        window.electronAPI.getExclusions('collection_movie'),
        window.electronAPI.getExclusions('series_episode'),
        window.electronAPI.getExclusions('artist_album'),
        window.electronAPI.getExclusions('media_upgrade'),
        window.electronAPI.getExclusions('cleanup_radar'),
      ])

      const excludedCollectionMovies = new Set(collectionExclusions.map(e => `${e.parent_key}:${e.reference_key}`))
      const excludedSeriesEpisodes = new Set(seriesExclusions.map(e => `${e.parent_key}:${e.reference_key}`))
      const excludedArtistAlbums = new Set(artistExclusions.map(e => `${e.parent_key}:${e.reference_key}`))
      const excludedUpgradeIds = new Set(upgradeExclusions.map(e => e.reference_id))
      const excludedCleanupIds = new Set(cleanupExclusions.map(e => e.reference_id))

      const movieWaste = storageWasteData.filter(m => m.type === 'movie' && !excludedCleanupIds.has(m.id))
      const tvWaste = storageWasteData.filter(m => m.type === 'episode' && !excludedCleanupIds.has(m.id))
      
      const allMovieUpgrades = [...movieUpgradeData.filter(m => !excludedUpgradeIds.has(m.id))]
      movieWaste.forEach(mw => {
        if (!allMovieUpgrades.some(m => m.id === mw.id)) allMovieUpgrades.push(mw)
      })

      const allTvUpgrades = [...tvUpgradeData.filter(e => !excludedUpgradeIds.has(e.id))]
      tvWaste.forEach(tw => {
        if (!allTvUpgrades.some(e => e.id === tw.id)) allTvUpgrades.push(tw)
      })

      setMovieUpgrades(allMovieUpgrades.sort((a, b) => {
        if (upgSort === 'efficiency') return (b.storage_debt_bytes ?? 0) - (a.storage_debt_bytes ?? 0)
        if (upgSort === 'quality') return (a.tier_score ?? 100) - (b.tier_score ?? 100)
        if (upgSort === 'recent') return getCreatedAt(b).localeCompare(getCreatedAt(a))
        return a.title.localeCompare(b.title)
      }))
      
      setTvUpgrades(allTvUpgrades.sort((a, b) => {
        if (upgSort === 'efficiency') return (b.storage_debt_bytes ?? 0) - (a.storage_debt_bytes ?? 0)
        if (upgSort === 'quality') return (a.tier_score ?? 100) - (b.tier_score ?? 100)
        if (upgSort === 'recent') return getCreatedAt(b).localeCompare(getCreatedAt(a))
        return (a.series_title || a.title).localeCompare(b.series_title || b.title)
      }))
      
      setMusicUpgrades((musicUpgradeData || []).filter(m => !excludedUpgradeIds.has(m.id)).sort((a, b) => {
        if (upgSort === 'efficiency') return (b.storage_debt_bytes ?? 0) - (a.storage_debt_bytes ?? 0)
        if (upgSort === 'quality') return (a.tier_score ?? 100) - (b.tier_score ?? 100)
        if (upgSort === 'recent') return getCreatedAt(b).localeCompare(getCreatedAt(a))
        return a.title.localeCompare(b.title)
      }))

      const filteredCollections = collectionsData
        .map(c => {
          try {
            const missing = JSON.parse(c.missing_movies || '[]') as MissingMovie[]
            const filtered = missing.filter(m => !excludedCollectionMovies.has(`${c.tmdb_collection_id}:${m.tmdb_id}`))
            if (filtered.length !== missing.length) {
              const excludedCount = missing.length - filtered.length
              const newTotal = c.total_movies - excludedCount
              const pct = newTotal > 0 ? (c.owned_movies / newTotal) * 100 : 100
              return { ...c, missing_movies: JSON.stringify(filtered), total_movies: newTotal, completeness_percentage: pct }
            }
          } catch { /* keep original */ }
          return c
        })
        .filter(c => c.total_movies > 1 && c.completeness_percentage < 100)
        .sort((a, b) => {
          if (collSort === 'completeness') return b.completeness_percentage - a.completeness_percentage
          if (collSort === 'recent') return getCreatedAt(b).localeCompare(getCreatedAt(a))
          return a.collection_name.localeCompare(b.collection_name)
        })
      setCollections(filteredCollections)

      const sortedSeries = seriesData
        .map(s => {
          try {
            const missing = JSON.parse(s.missing_episodes || '[]') as MissingEpisode[]
            const parentKey = s.tmdb_id || s.series_title
            const filtered = missing.filter(ep => !excludedSeriesEpisodes.has(`${parentKey}:S${ep.season_number}E${ep.episode_number}`))
            if (filtered.length !== missing.length) {
              const owned = s.total_episodes - filtered.length
              const pct = s.total_episodes > 0 ? (owned / s.total_episodes) * 100 : 100
              return { ...s, missing_episodes: JSON.stringify(filtered), owned_episodes: owned, completeness_percentage: pct }
            }
          } catch { /* keep original */ }
          return s
        })
        .sort((a, b) => {
          if (serSort === 'completeness') return b.completeness_percentage - a.completeness_percentage
          if (serSort === 'recent') return getCreatedAt(b).localeCompare(getCreatedAt(a))
          return a.series_title.localeCompare(b.series_title)
        })
      setSeries(sortedSeries)

      const incompleteArtists = (artistsData || [])
        .map(a => {
          const parentKey = a.musicbrainz_id || a.artist_name
          const filterJson = (json: string | undefined): { filtered: string; removedCount: number } => {
            try {
              const parsed = JSON.parse(json || '[]') as Array<{ musicbrainz_id?: string }>
              const filtered = parsed.filter(item => !excludedArtistAlbums.has(`${parentKey}:${item.musicbrainz_id}`))
              if (filtered.length !== parsed.length) {
                return { filtered: JSON.stringify(filtered), removedCount: parsed.length - filtered.length }
              }
            } catch { /* keep original */ }
            return { filtered: json || '[]', removedCount: 0 }
          }
          const albums = filterJson(a.missing_albums)
          const eps = filterJson(a.missing_eps)
          const singles = filterJson(a.missing_singles)

          const adjTotalAlbums = a.total_albums - albums.removedCount
          const adjTotalEps = a.total_eps - eps.removedCount
          const adjTotalSingles = a.total_singles - singles.removedCount
          const totalItems = adjTotalAlbums + (epsEnabled ? adjTotalEps : 0) + (singlesEnabled ? adjTotalSingles : 0)
          const ownedItems = a.owned_albums + (epsEnabled ? a.owned_eps : 0) + (singlesEnabled ? a.owned_singles : 0)
          const pct = totalItems > 0 ? Math.round((ownedItems / totalItems) * 100) : 100

          return {
            ...a,
            missing_albums: albums.filtered,
            missing_eps: eps.filtered,
            missing_singles: singles.filtered,
            completeness_percentage: pct,
          }
        })
        .filter(a => a.completeness_percentage < 100)
        .sort((a, b) => {
          if (artSort === 'completeness') return b.completeness_percentage - a.completeness_percentage
          return a.artist_name.localeCompare(b.artist_name)
        })
      setArtists(incompleteArtists)
    } catch (err) {
      window.electronAPI.log.error('[DashboardData]', 'Failed to load dashboard data:', err)
      setError('Failed to load dashboard data. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }, [activeSourceId])

  useEffect(() => {
    loadDashboardData()
  }, [loadDashboardData])

  useEffect(() => {
    const cleanup = window.electronAPI.onSettingsChanged?.((data) => {
      if (data.key === 'completeness_include_eps' || data.key === 'completeness_include_singles') {
        loadDashboardData()
      }
    })
    return () => cleanup?.()
  }, [loadDashboardData])

  useEffect(() => {
    const cleanup = window.electronAPI.onScanCompleted?.(() => {
      loadDashboardData()
    })
    return () => cleanup?.()
  }, [loadDashboardData])

  useEffect(() => {
    const handler = () => loadDashboardData()
    window.addEventListener('exclusions-changed', handler)
    return () => window.removeEventListener('exclusions-changed', handler)
  }, [loadDashboardData])

  return {
    movieUpgrades,
    setMovieUpgrades,
    tvUpgrades,
    setTvUpgrades,
    musicUpgrades,
    setMusicUpgrades,
    collections,
    setCollections,
    series,
    setSeries,
    artists,
    setArtists,
    isLoading,
    error,
    upgradeSortBy,
    setUpgradeSortBy,
    collectionSortBy,
    setCollectionSortBy,
    seriesSortBy,
    setSeriesSortBy,
    artistSortBy,
    setArtistSortBy,
    loadDashboardData,
    includeEps,
    includeSingles
  }
}
