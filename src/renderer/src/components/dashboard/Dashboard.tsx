/**
 * Dashboard - Home screen summarizing what needs attention
 *
 * Three column layout with scrollable lists for upgrades, collections, and series.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import * as ReactWindow from 'react-window'
import { Sparkles, Tv, Film, Music, CircleFadingArrowUp, Plus } from 'lucide-react'
import { MediaDetails } from '../library/MediaDetails'
import { useSources } from '../../contexts/SourceContext'
import {
  emitDismissUpgrade,
  emitDismissCollectionMovie,
} from '../../utils/dismissEvents'
import { useDashboardData } from './hooks/useDashboardData'
import { MovieUpgradeRow, TvUpgradeRow, MusicUpgradeRow } from './UpgradeRows'
import { CollectionRow, SeriesRow, ArtistRow } from './CompletenessRows'
import {
  MOVIE_ITEM_HEIGHT,
  MUSIC_ITEM_HEIGHT,
  COLLAPSED_HEIGHT,
  COLLAPSED_HEIGHT_ARTIST,
  EXPANDED_MARGIN,
  EXPANDED_ITEM_HEIGHT,
  ITEM_GAP,
  SECTION_HEADER_HEIGHT,
  TYPE_SECTION_GAP
} from './constants'
import {
  parseMissingMovies,
  groupEpisodesBySeason,
  parseMissingAlbums,
  parseMissingEpisodes
} from './dashboardUtils'
import type { DashboardProps, UpgradeTab, MissingMovie, MissingEpisode, MissingAlbumItem } from './types'

// VariableSizeList type for casting
const { VariableSizeList } = ReactWindow as any

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
    collections, setCollections,
    series, setSeries,
    artists, setArtists,
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
    const groups = groupEpisodesBySeason(s as any)
    if (groups.length === 0) return COLLAPSED_HEIGHT
    let height = COLLAPSED_HEIGHT + EXPANDED_MARGIN
    height += groups.length * EXPANDED_ITEM_HEIGHT
    if (groups.length > 1) height += (groups.length - 1) * ITEM_GAP
    return height
  }, [series, expandedSeries])

  const getArtistRowHeight = useCallback((index: number) => {
    const artist = artists[index]
    if (!artist || !expandedArtists.has(index)) return COLLAPSED_HEIGHT_ARTIST
    const allMissing = parseMissingAlbums(artist, includeEps, includeSingles)
    if (allMissing.length === 0) return COLLAPSED_HEIGHT_ARTIST
    const albums = allMissing.filter(m => m.album_type === 'album')
    const eps = allMissing.filter(m => m.album_type === 'ep')
    const singles = allMissing.filter(m => m.album_type === 'single')
    let height = COLLAPSED_HEIGHT_ARTIST + EXPANDED_MARGIN
    const nonEmptyGroups = [albums, eps, singles].filter(g => g.length > 0)
    nonEmptyGroups.forEach(group => {
      height += SECTION_HEADER_HEIGHT
      height += group.length * EXPANDED_ITEM_HEIGHT
      if (group.length > 1) height += (group.length - 1) * ITEM_GAP
    })
    if (nonEmptyGroups.length > 1) height += (nonEmptyGroups.length - 1) * TYPE_SECTION_GAP
    return height
  }, [artists, expandedArtists, includeEps, includeSingles])

  const getUpgradeRowHeight = useCallback((index: number) => {
    const type = upgradeTab
    let base = type === 'music' ? MUSIC_ITEM_HEIGHT : MOVIE_ITEM_HEIGHT
    let mediaId: number | undefined
    if (type === 'movies') mediaId = movieUpgrades[index]?.id
    else if (type === 'tv') mediaId = tvUpgrades[index]?.id
    else if (type === 'music') mediaId = musicUpgrades[index]?.id
    if (mediaId && expandedRecommendations.has(mediaId)) base += 130
    return base
  }, [upgradeTab, movieUpgrades, tvUpgrades, musicUpgrades, expandedRecommendations])

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

  // Dismiss handlers
  const dismissMovieUpgrade = useCallback(async (index: number) => {
    const item = movieUpgrades[index]
    if (!item) return
    await window.electronAPI.addExclusion('media_upgrade', item.id as any, undefined, undefined, item.title)
    setMovieUpgrades(prev => prev.filter((_, i) => i !== index))
    emitDismissUpgrade({ mediaId: item.id as any })
  }, [movieUpgrades, setMovieUpgrades])

  const dismissTvUpgrade = useCallback(async (index: number) => {
    const item = tvUpgrades[index]
    if (!item) return
    await window.electronAPI.addExclusion('media_upgrade', item.id as any, undefined, undefined, `${item.series_title} S${item.season_number}E${item.episode_number}`)
    setTvUpgrades(prev => prev.filter((_, i) => i !== index))
    emitDismissUpgrade({ mediaId: item.id as any })
  }, [tvUpgrades, setTvUpgrades])

  const dismissMusicUpgrade = useCallback(async (index: number) => {
    const album = musicUpgrades[index]
    if (!album) return
    await window.electronAPI.addExclusion('media_upgrade', album.id as any, undefined, undefined, `${album.artist_name} - ${album.title}`)
    setMusicUpgrades(prev => prev.filter((_, i) => i !== index))
  }, [musicUpgrades, setMusicUpgrades])

  const dismissCollectionMovie = useCallback(async (collectionIndex: number, movie: MissingMovie) => {
    const collection = collections[collectionIndex]
    if (!collection) return
    await window.electronAPI.addExclusion('collection_movie', undefined, movie.tmdb_id, collection.tmdb_collection_id, movie.title)
    setCollections(prev => prev.map((c, i) => {
      if (i !== collectionIndex) return c
      const missing = parseMissingMovies(c as any)
      const filtered = missing.filter(m => m.tmdb_id !== movie.tmdb_id)
      const newTotal = c.total_movies - 1
      return {
        ...c,
        missing_movies: JSON.stringify(filtered),
        total_movies: newTotal,
        completeness_percentage: newTotal > 0 ? c.owned_movies / newTotal * 100 : 100
      }
    }).filter(c => c.total_movies > 1))
    collectionsListInstanceRef.current?.resetAfterIndex(0)
    emitDismissCollectionMovie({ collectionId: collection.tmdb_collection_id, tmdbId: movie.tmdb_id })
  }, [collections, setCollections])

  const dismissSeriesEpisode = useCallback(async (seriesIndex: number, episode: MissingEpisode) => {
    const s = series[seriesIndex]
    if (!s) return
    const refKey = `S${episode.season_number}E${episode.episode_number}`
    await window.electronAPI.addExclusion('series_episode', undefined, refKey, s.tmdb_id || s.series_title, `${s.series_title} ${refKey}`)
    setSeries(prev => prev.map((ser, i) => {
      if (i !== seriesIndex) return ser
      const missing = parseMissingEpisodes(ser as any)
      const filtered = missing.filter(ep => !(ep.season_number === episode.season_number && ep.episode_number === episode.episode_number))
      return { ...ser, missing_episodes: JSON.stringify(filtered) }
    }))
  }, [series, setSeries])

  const dismissArtistAlbum = useCallback(async (artistIndex: number, album: MissingAlbumItem) => {
    const artist = artists[artistIndex]
    if (!artist) return
    await window.electronAPI.addExclusion('artist_album', undefined, album.musicbrainz_id, artist.musicbrainz_id || artist.artist_name, album.title)
    setArtists(prev => prev.map((a, i) => {
      if (i !== artistIndex) return a
      const removeFromJson = (json: string | undefined): string => {
        try {
          const parsed = JSON.parse(json || '[]') as Array<{ musicbrainz_id?: string; title?: string }>
          return JSON.stringify(parsed.filter(item => item.musicbrainz_id !== album.musicbrainz_id))
        } catch { return json || '[]' }
      }
      if (album.album_type === 'album') return { ...a, missing_albums: removeFromJson(a.missing_albums) }
      if (album.album_type === 'ep') return { ...a, missing_eps: removeFromJson(a.missing_eps) }
      if (album.album_type === 'single') return { ...a, missing_singles: removeFromJson(a.missing_singles) }
      return a
    }))
  }, [artists, setArtists])

  // Virtual list row renderers with context
  const movieRow = ({ index, style }: any) => (
    <MovieUpgradeRow
      index={index}
      style={style}
      item={movieUpgrades[index] as any}
      isExpanded={expandedRecommendations.has(movieUpgrades[index].id as any)}
      onToggleExpand={toggleRecommendation}
      onSelect={setSelectedMediaId}
      onDismiss={dismissMovieUpgrade}
    />
  )

  const tvRow = ({ index, style }: any) => (
    <TvUpgradeRow
      index={index}
      style={style}
      item={tvUpgrades[index] as any}
      isExpanded={expandedRecommendations.has(tvUpgrades[index].id as any)}
      onToggleExpand={toggleRecommendation}
      onSelect={setSelectedMediaId}
      onDismiss={dismissTvUpgrade}
    />
  )

  const musicRow = ({ index, style }: any) => (
    <MusicUpgradeRow
      index={index}
      style={style}
      album={musicUpgrades[index] as any}
      onSelect={setSelectedMediaId}
      onDismiss={dismissMusicUpgrade}
    />
  )

  const collectionRow = ({ index, style }: any) => (
    <CollectionRow
      index={index}
      style={style}
      collection={collections[index] as any}
      isExpanded={expandedCollections.has(index)}
      onToggleExpand={toggleCollectionExpand}
      onDismiss={dismissCollectionMovie}
    />
  )

  const seriesRow = ({ index, style }: any) => (
    <SeriesRow
      index={index}
      style={style}
      s={series[index] as any}
      isExpanded={expandedSeries.has(index)}
      onToggleExpand={toggleSeriesExpand}
      onDismiss={dismissSeriesEpisode}
    />
  )

  const artistRow = ({ index, style }: any) => (
    <ArtistRow
      index={index}
      style={style}
      artist={artists[index]}
      isExpanded={expandedArtists.has(index)}
      includeEps={includeEps}
      includeSingles={includeSingles}
      onToggleExpand={toggleArtistExpand}
      onDismiss={dismissArtistAlbum}
    />
  )

  const hasNothing = !hasMovies && !hasTV && !hasMusic || (
    movieUpgrades.length === 0 && tvUpgrades.length === 0 && musicUpgrades.length === 0 &&
    collections.length === 0 && series.length === 0 && artists.length === 0
  )

  if (isLoading) {
    return (
      <div
        ref={containerRef}
        className="fixed top-[88px] bottom-4 flex items-center justify-center transition-[left,right] duration-300 ease-out"
        style={{ left: sidebarCollapsed ? '96px' : '288px', right: '16px' }}
      >
        <div className="text-muted-foreground">Loading dashboard...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div
        ref={containerRef}
        className="fixed top-[88px] bottom-4 flex flex-col items-center justify-center transition-[left,right] duration-300 ease-out"
        style={{ left: sidebarCollapsed ? '96px' : '288px', right: '16px' }}
      >
        <div className="text-destructive mb-4">{error}</div>
        <button
          onClick={loadDashboardData}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
        >
          Try Again
        </button>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className="fixed top-[88px] bottom-4 flex flex-col overflow-hidden transition-[left,right] duration-300 ease-out"
      style={{ left: sidebarCollapsed ? '96px' : '288px', right: '16px' }}
    >
      {hasNothing && (
        <div className="flex-1 flex flex-col items-center justify-center py-20 text-center">
          {sources.length === 0 ? (
            <>
              <h2 className="text-xl font-medium mb-2">Add a Media Source</h2>
              <p className="text-muted-foreground max-w-md mb-6">Connect your media library to start tracking quality and completeness.</p>
              {onAddSource && (
                <button onClick={onAddSource} className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors">
                  <Plus className="w-5 h-5" /> Add Source
                </button>
              )}
            </>
          ) : (
            <>
              <Sparkles className="w-16 h-16 text-accent/50 mb-4" />
              <h2 className="text-xl font-medium mb-2">All caught up!</h2>
              <p className="text-muted-foreground max-w-md">Your library is in great shape. No urgent upgrades needed and all your collections and series are complete.</p>
            </>
          )}
        </div>
      )}

      {!hasNothing && (
        <div className="flex-1 flex gap-4 px-4 pb-4 overflow-x-auto overflow-y-hidden">
          {/* Upgrades Column */}
          <div className="flex-1 min-w-[280px] flex flex-col bg-sidebar-gradient rounded-2xl shadow-xl overflow-hidden">
            <div className="shrink-0 p-4 border-b border-border/30">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <CircleFadingArrowUp className="w-4 h-4 text-muted-foreground" />
                  <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Upgrades</h2>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={upgradeSortBy}
                    onChange={e => { const v = e.target.value as any; setUpgradeSortBy(v); window.electronAPI.setSetting('dashboard_upgrade_sort', v) }}
                    className="text-xs bg-background text-foreground border border-border/50 rounded px-2 py-0.5 cursor-pointer focus:outline-hidden"
                  >
                    <option value="quality">Quality</option>
                    <option value="efficiency">Efficiency</option>
                    <option value="recent">Recent</option>
                    <option value="title">Title</option>
                  </select>
                </div>
              </div>
              <div className="flex flex-wrap gap-1 justify-center">
                {hasMovies && <button onClick={() => setUpgradeTab('movies')} className={`px-3 py-1.5 rounded-md text-xs font-medium ${upgradeTab === 'movies' ? 'bg-primary text-primary-foreground' : 'bg-muted/50'}`}>Movies</button>}
                {hasTV && <button onClick={() => setUpgradeTab('tv')} className={`px-3 py-1.5 rounded-md text-xs font-medium ${upgradeTab === 'tv' ? 'bg-primary text-primary-foreground' : 'bg-muted/50'}`}>TV</button>}
                {hasMusic && <button onClick={() => setUpgradeTab('music')} className={`px-3 py-1.5 rounded-md text-xs font-medium ${upgradeTab === 'music' ? 'bg-primary text-primary-foreground' : 'bg-muted/50'}`}>Music</button>}
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-hidden pr-0.5 relative">
              <div ref={upgradeListRef} className="absolute inset-0">
                {upgradeTab === 'movies' && movieUpgrades.length > 0 && (
                  <VariableSizeList ref={upgradeListInstanceRef} height={upgradeListHeight} itemCount={movieUpgrades.length} itemSize={getUpgradeRowHeight} width="100%">{movieRow}</VariableSizeList>
                )}
                {upgradeTab === 'tv' && tvUpgrades.length > 0 && (
                  <VariableSizeList ref={upgradeListInstanceRef} height={upgradeListHeight} itemCount={tvUpgrades.length} itemSize={getUpgradeRowHeight} width="100%">{tvRow}</VariableSizeList>
                )}
                {upgradeTab === 'music' && musicUpgrades.length > 0 && (
                  <VariableSizeList ref={upgradeListInstanceRef} height={upgradeListHeight} itemCount={musicUpgrades.length} itemSize={getUpgradeRowHeight} width="100%">{musicRow}</VariableSizeList>
                )}
              </div>
            </div>
          </div>

          {/* Collections Column */}
          {hasMovies && (
            <div className="flex-1 min-w-[280px] flex flex-col bg-sidebar-gradient rounded-2xl shadow-xl overflow-hidden">
              <div className="shrink-0 p-4 border-b border-border/30 flex items-center justify-between">
                <div className="flex items-center gap-2"><Film className="w-4 h-4 text-muted-foreground" /><h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Collections</h2></div>
                <select value={collectionSortBy} onChange={e => { const v = e.target.value as any; setCollectionSortBy(v); window.electronAPI.setSetting('dashboard_collection_sort', v) }} className="text-xs bg-background border border-border/50 rounded px-2 py-0.5 cursor-pointer">
                  <option value="completeness">Completeness</option><option value="name">Name</option><option value="recent">Recent</option>
                </select>
              </div>
              <div className="flex-1 min-h-0 overflow-hidden pr-0.5 relative">
                <div ref={collectionsListRef} className="absolute inset-0">
                  {collections.length > 0 && <VariableSizeList ref={collectionsListInstanceRef} height={collectionsListHeight} itemCount={collections.length} itemSize={getCollectionRowHeight} width="100%">{collectionRow}</VariableSizeList>}
                </div>
              </div>
            </div>
          )}

          {/* Series Column */}
          {hasTV && (
            <div className="flex-1 min-w-[280px] flex flex-col bg-sidebar-gradient rounded-2xl shadow-xl overflow-hidden">
              <div className="shrink-0 p-4 border-b border-border/30 flex items-center justify-between">
                <div className="flex items-center gap-2"><Tv className="w-4 h-4 text-muted-foreground" /><h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">TV Series</h2></div>
                <select value={seriesSortBy} onChange={e => { const v = e.target.value as any; setSeriesSortBy(v); window.electronAPI.setSetting('dashboard_series_sort', v) }} className="text-xs bg-background border border-border/50 rounded px-2 py-0.5 cursor-pointer">
                  <option value="completeness">Completeness</option><option value="name">Name</option><option value="recent">Recent</option>
                </select>
              </div>
              <div className="flex-1 min-h-0 overflow-hidden pr-0.5 relative">
                <div ref={seriesListRef} className="absolute inset-0">
                  {series.length > 0 && <VariableSizeList ref={seriesListInstanceRef} height={seriesListHeight} itemCount={series.length} itemSize={getSeriesRowHeight} width="100%">{seriesRow}</VariableSizeList>}
                </div>
              </div>
            </div>
          )}

          {/* Music Column */}
          {hasMusic && (
            <div className="flex-1 min-w-[280px] flex flex-col bg-sidebar-gradient rounded-2xl shadow-xl overflow-hidden">
              <div className="shrink-0 p-4 border-b border-border/30 flex items-center justify-between">
                <div className="flex items-center gap-2"><Music className="w-4 h-4 text-muted-foreground" /><h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Music</h2></div>
                <select value={artistSortBy} onChange={e => { const v = e.target.value as any; setArtistSortBy(v); window.electronAPI.setSetting('dashboard_artist_sort', v) }} className="text-xs bg-background border border-border/50 rounded px-2 py-0.5 cursor-pointer">
                  <option value="completeness">Completeness</option><option value="name">Name</option>
                </select>
              </div>
              <div className="flex-1 min-h-0 overflow-hidden pr-0.5 relative">
                <div ref={artistsListRef} className="absolute inset-0">
                  {artists.length > 0 && <VariableSizeList ref={artistsListInstanceRef} height={artistsListHeight} itemCount={artists.length} itemSize={getArtistRowHeight} width="100%">{artistRow}</VariableSizeList>}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {selectedMediaId !== null && (
        <MediaDetails
          mediaId={selectedMediaId}
          onClose={() => setSelectedMediaId(null)}
          onDismissUpgrade={(mediaId, title) => {
            const mIdx = movieUpgrades.findIndex(m => m.id === mediaId)
            if (mIdx !== -1) { dismissMovieUpgrade(mIdx); setSelectedMediaId(null); return }
            const tIdx = tvUpgrades.findIndex(e => e.id === mediaId)
            if (tIdx !== -1) { dismissTvUpgrade(tIdx); setSelectedMediaId(null); return }
            const muIdx = musicUpgrades.findIndex(m => m.id === mediaId)
            if (muIdx !== -1) { dismissMusicUpgrade(muIdx); setSelectedMediaId(null); return }
            window.electronAPI.addExclusion('media_upgrade', mediaId, undefined, undefined, title)
            setSelectedMediaId(null)
          }}
        />
      )}
    </div>
  )
}
