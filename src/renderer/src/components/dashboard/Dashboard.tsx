/**
 * Dashboard - Home screen summarizing what needs attention
 *
 * Three column layout with scrollable lists for upgrades, collections, and series.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { MediaDetails } from '../library/MediaDetails'
import { useSources } from '../../contexts/SourceContext'
import {
  emitDismissUpgrade,
  emitDismissCollectionMovie,
} from '../../utils/dismissEvents'
import { useDashboardData } from './hooks/useDashboardData'
import { UpgradesColumn } from './UpgradesColumn'
import { CollectionsColumn, SeriesColumn, ArtistColumn } from './CompletenessColumns'
import { EmptyDashboard } from './EmptyDashboard'
import { DashboardSkeleton } from './DashboardSkeleton'
import {
  MOVIE_ITEM_HEIGHT,
  MUSIC_ITEM_HEIGHT,
  COLLAPSED_HEIGHT,
  COLLAPSED_HEIGHT_ARTIST,
  EXPANDED_MARGIN,
  EXPANDED_ITEM_HEIGHT,
  ITEM_GAP
} from './constants'
import {
  parseMissingMovies,
  groupEpisodesBySeason,
  parseMissingAlbums,
  parseMissingEpisodes
} from './dashboardUtils'
import type { DashboardProps, UpgradeTab, MissingMovie, MissingEpisode, MissingAlbumItem } from './types'

export function Dashboard({
  onAddSource,
  sidebarCollapsed = false,
  hasMovies = false,
  hasTV = false,
  hasMusic = false
}: DashboardProps) {
  const { sources, activeSourceId } = useSources()
  const {
    movieUpgrades, setMovieUpgrades,
    tvUpgrades, setTvUpgrades,
    musicUpgrades, setMusicUpgrades,
    collections,
    series,
    artists,
    isLoading, error,
    upgradeSortBy, setUpgradeSortBy,
    collectionSortBy, setCollectionSortBy,
    seriesSortBy, setSeriesSortBy,
    artistSortBy, setArtistSortBy,
    loadDashboardData,
    includeEps, includeSingles
  } = useDashboardData(activeSourceId)

  // Default to first available library type
  const [upgradeTab, setUpgradeTab] = useState<UpgradeTab>(() =>
    hasMovies ? 'movies' : hasTV ? 'tv' : hasMusic ? 'music' : 'movies'
  )
  const [upgradeListHeight, setUpgradeListHeight] = useState(400)
  const [collectionsListHeight, setCollectionsListHeight] = useState(400)
  const [seriesListHeight, setSeriesListHeight] = useState(400)
  const [artistsListHeight, setArtistsListHeight] = useState(400)
  const containerRef = useRef<HTMLDivElement>(null)
  const upgradeListRef = useRef<HTMLDivElement>(null)
  const collectionsListRef = useRef<HTMLDivElement>(null)
  const seriesListRef = useRef<HTMLDivElement>(null)
  const artistsListRef = useRef<HTMLDivElement>(null)

  // Detail modal state
  const [selectedMediaId, setSelectedMediaId] = useState<number | null>(null)
  const [expandedRecommendations, setExpandedRecommendations] = useState<Set<number>>(new Set())

  // Toggle recommendation expansion
  const toggleRecommendation = useCallback((mediaId: number) => {
    setExpandedRecommendations(prev => {
      const next = new Set(prev)
      next.has(mediaId) ? next.delete(mediaId) : next.add(mediaId)
      return next
    })
  }, [])

  // Expanded state for expandable rows
  const [expandedCollections, setExpandedCollections] = useState<Set<number>>(new Set())
  const [expandedSeries, setExpandedSeries] = useState<Set<number>>(new Set())
  const [expandedArtists, setExpandedArtists] = useState<Set<number>>(new Set())

  // VariableSizeList refs for resetting cached sizes on expand/collapse
  const upgradeListInstanceRef = useRef<any>(null)
  const collectionsListInstanceRef = useRef<any>(null)
  const seriesListInstanceRef = useRef<any>(null)
  const artistsListInstanceRef = useRef<any>(null)

  // Reset virtual list caches when data changes or tabs switch
  useEffect(() => {
    upgradeListInstanceRef.current?.resetAfterIndex(0)
  }, [movieUpgrades, tvUpgrades, musicUpgrades, upgradeTab, isLoading])

  useEffect(() => {
    collectionsListInstanceRef.current?.resetAfterIndex(0)
  }, [collections, isLoading])

  useEffect(() => {
    seriesListInstanceRef.current?.resetAfterIndex(0)
  }, [series, isLoading])

  useEffect(() => {
    artistsListInstanceRef.current?.resetAfterIndex(0)
  }, [artists, isLoading])

  // Measure list container heights
  useEffect(() => {
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const height = entry.contentRect.height
        if (entry.target === upgradeListRef.current) setUpgradeListHeight(height)
        else if (entry.target === collectionsListRef.current) setCollectionsListHeight(height)
        else if (entry.target === seriesListRef.current) setSeriesListHeight(height)
        else if (entry.target === artistsListRef.current) setArtistsListHeight(height)
      }
    })

    if (upgradeListRef.current) resizeObserver.observe(upgradeListRef.current)
    if (collectionsListRef.current) resizeObserver.observe(collectionsListRef.current)
    if (seriesListRef.current) resizeObserver.observe(seriesListRef.current)
    if (artistsListRef.current) resizeObserver.observe(artistsListRef.current)

    return () => resizeObserver.disconnect()
  }, [hasMovies, hasTV, hasMusic, isLoading])

  // Height calculation functions
  const getCollectionRowHeight = useCallback((index: number) => {
    const collection = collections[index]
    if (!collection || !expandedCollections.has(index)) return COLLAPSED_HEIGHT
    const missing = parseMissingMovies(collection as any)
    if (missing.length === 0) return COLLAPSED_HEIGHT
    let height = COLLAPSED_HEIGHT + EXPANDED_MARGIN
    height += missing.length * EXPANDED_ITEM_HEIGHT
    if (missing.length > 1) height += (missing.length - 1) * ITEM_GAP
    return height
  }, [collections, expandedCollections])

  const getSeriesRowHeight = useCallback((index: number) => {
    const s = series[index]
    if (!s || !expandedSeries.has(index)) return COLLAPSED_HEIGHT
    const episodes = parseMissingEpisodes(s as any)
    if (episodes.length === 0) return COLLAPSED_HEIGHT
    const seasons = groupEpisodesBySeason(s as any)
    let height = COLLAPSED_HEIGHT + EXPANDED_MARGIN
    height += seasons.length * 28
    height += episodes.length * EXPANDED_ITEM_HEIGHT
    if (episodes.length + seasons.length > 1) height += (episodes.length + seasons.length - 1) * ITEM_GAP
    return height
  }, [series, expandedSeries])

  const getArtistRowHeight = useCallback((index: number) => {
    const artist = artists[index]
    if (!artist || !expandedArtists.has(index)) return COLLAPSED_HEIGHT_ARTIST
    const missing = parseMissingAlbums(artist as any, includeEps, includeSingles)
    if (missing.length === 0) return COLLAPSED_HEIGHT_ARTIST
    let height = COLLAPSED_HEIGHT_ARTIST + EXPANDED_MARGIN
    height += missing.length * EXPANDED_ITEM_HEIGHT
    if (missing.length > 1) height += (missing.length - 1) * ITEM_GAP
    return height
  }, [artists, expandedArtists, includeEps, includeSingles])

  const getUpgradeRowHeight = useCallback((index: number) => {
    if (upgradeTab === 'music') return MUSIC_ITEM_HEIGHT
    const list = upgradeTab === 'movies' ? movieUpgrades : tvUpgrades
    const item = list[index]
    if (!item) return MOVIE_ITEM_HEIGHT
    return expandedRecommendations.has(item.id as any) ? 280 : MOVIE_ITEM_HEIGHT
  }, [upgradeTab, movieUpgrades, tvUpgrades, expandedRecommendations])

  // Handlers
  const toggleCollectionExpand = useCallback((index: number) => {
    setExpandedCollections(prev => {
      const next = new Set(prev)
      next.has(index) ? next.delete(index) : next.add(index)
      return next
    })
    collectionsListInstanceRef.current?.resetAfterIndex(index)
  }, [])

  const toggleSeriesExpand = useCallback((index: number) => {
    setExpandedSeries(prev => {
      const next = new Set(prev)
      next.has(index) ? next.delete(index) : next.add(index)
      return next
    })
    seriesListInstanceRef.current?.resetAfterIndex(index)
  }, [])

  const toggleArtistExpand = useCallback((index: number) => {
    setExpandedArtists(prev => {
      const next = new Set(prev)
      next.has(index) ? next.delete(index) : next.add(index)
      return next
    })
    artistsListInstanceRef.current?.resetAfterIndex(index)
  }, [])

  const dismissMovieUpgrade = useCallback((index: number) => {
    const item = movieUpgrades[index]
    if (item?.id) {
      emitDismissUpgrade({ mediaId: item.id })
      setMovieUpgrades(prev => prev.filter((_, i) => i !== index))
    }
  }, [movieUpgrades, setMovieUpgrades])

  const dismissTvUpgrade = useCallback((index: number) => {
    const item = tvUpgrades[index]
    if (item?.id) {
      emitDismissUpgrade({ mediaId: item.id })
      setTvUpgrades(prev => prev.filter((_, i) => i !== index))
    }
  }, [tvUpgrades, setTvUpgrades])

  const dismissMusicUpgrade = useCallback((index: number) => {
    const item = musicUpgrades[index]
    if (item?.id) {
      emitDismissUpgrade({ mediaId: item.id })
      setMusicUpgrades(prev => prev.filter((_, i) => i !== index))
    }
  }, [musicUpgrades, setMusicUpgrades])

  const dismissSeriesEpisode = useCallback((_index: number, episode: MissingEpisode) => {
    if (episode.tmdb_id) {
      window.electronAPI.addExclusion(
        'missing_episode',
        undefined,
        `${episode.season_number}x${episode.episode_number}`,
        episode.tmdb_id.toString(),
        episode.episode_title || `${episode.series_title} S${episode.season_number}E${episode.episode_number}`
      )
      loadDashboardData()
    }
  }, [loadDashboardData])

  const dismissArtistAlbum = useCallback((_index: number, album: MissingAlbumItem) => {
    window.electronAPI.addExclusion(
      'missing_album',
      undefined,
      album.musicbrainz_id,
      album.artist_mbid,
      album.title
    )
    loadDashboardData()
  }, [loadDashboardData])

  const handleDismissCollectionMovie = useCallback((_index: number, movie: MissingMovie) => {
    emitDismissCollectionMovie({ collectionId: '', tmdbId: movie.tmdb_id?.toString() || '' })
    loadDashboardData()
  }, [loadDashboardData])

  const hasNothing = !hasMovies && !hasTV && !hasMusic || (
    movieUpgrades.length === 0 && tvUpgrades.length === 0 && musicUpgrades.length === 0 &&
    collections.length === 0 && series.length === 0 && artists.length === 0
  )

  if (error) {
    return (
      <div
        ref={containerRef}
        className="fixed top-[88px] bottom-4 flex flex-col items-center justify-center transition-[left,right] duration-300 ease-out"
        style={{ left: sidebarCollapsed ? '96px' : '288px', right: '16px' }}
      >
        <div className="text-destructive mb-4">{error}</div>
        <button onClick={loadDashboardData} className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors">Try Again</button>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className="fixed top-[88px] bottom-4 flex flex-col overflow-hidden transition-[left,right] duration-300 ease-out"
      style={{ left: sidebarCollapsed ? '96px' : '288px', right: '16px' }}
    >
      {isLoading ? (
        <DashboardSkeleton hasMovies={hasMovies} hasTV={hasTV} hasMusic={hasMusic} />
      ) : hasNothing ? (
        <EmptyDashboard sourcesLength={sources.length} onAddSource={onAddSource} />
      ) : (
        <div className="flex-1 flex gap-4 px-4 pb-4 overflow-x-auto overflow-y-hidden">
          <UpgradesColumn
            upgradeTab={upgradeTab} setUpgradeTab={setUpgradeTab}
            movieUpgrades={movieUpgrades} tvUpgrades={tvUpgrades} musicUpgrades={musicUpgrades}
            upgradeSortBy={upgradeSortBy} setUpgradeSortBy={setUpgradeSortBy}
            hasMovies={hasMovies} hasTV={hasTV} hasMusic={hasMusic}
            listHeight={upgradeListHeight} itemSize={getUpgradeRowHeight} listRef={upgradeListInstanceRef}
            onSelect={setSelectedMediaId}
            onDismissMovie={dismissMovieUpgrade} onDismissTv={dismissTvUpgrade} onDismissMusic={dismissMusicUpgrade}
            expandedRecommendations={expandedRecommendations} toggleRecommendation={toggleRecommendation}
          />

          {hasMovies && (
            <CollectionsColumn
              collections={collections} sortBy={collectionSortBy} setSortBy={setCollectionSortBy}
              listHeight={collectionsListHeight} itemSize={getCollectionRowHeight} listRef={collectionsListInstanceRef}
              expandedCollections={expandedCollections} toggleExpand={toggleCollectionExpand} onDismiss={handleDismissCollectionMovie}
            />
          )}

          {hasTV && (
            <SeriesColumn
              series={series} sortBy={seriesSortBy} setSortBy={setSeriesSortBy}
              listHeight={seriesListHeight} itemSize={getSeriesRowHeight} listRef={seriesListInstanceRef}
              expandedSeries={expandedSeries} toggleExpand={toggleSeriesExpand} onDismiss={dismissSeriesEpisode}
            />
          )}

          {hasMusic && (
            <ArtistColumn
              artists={artists} sortBy={artistSortBy} setSortBy={setArtistSortBy}
              listHeight={artistsListHeight} itemSize={getArtistRowHeight} listRef={artistsListInstanceRef}
              expandedArtists={expandedArtists} toggleExpand={toggleArtistExpand} onDismiss={dismissArtistAlbum}
              includeEps={includeEps} includeSingles={includeSingles}
            />
          )}
        </div>
      )}

      {selectedMediaId !== null && (
        <MediaDetails
          mediaId={selectedMediaId}
          onClose={() => setSelectedMediaId(null)}
          onDismissUpgrade={(mediaId) => {
            const mIdx = movieUpgrades.findIndex(m => m.id === mediaId)
            if (mIdx !== -1) { dismissMovieUpgrade(mIdx); setSelectedMediaId(null); return }
            const tIdx = tvUpgrades.findIndex(e => e.id === mediaId)
            if (tIdx !== -1) { dismissTvUpgrade(tIdx); setSelectedMediaId(null); return }
            const muIdx = musicUpgrades.findIndex(m => m.id === mediaId)
            if (muIdx !== -1) { dismissMusicUpgrade(muIdx); setSelectedMediaId(null); return }
            window.electronAPI.addExclusion('media_upgrade', mediaId)
            setSelectedMediaId(null)
          }}
        />
      )}
    </div>
  )
}
