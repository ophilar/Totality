/**
 * Dashboard - Home screen summarizing what needs attention
 *
 * Three column layout with scrollable lists for upgrades, collections, and series.
 */

import { useState, useCallback } from 'react'
import { MediaDetails } from '@/components/library/MediaDetails'
import { useSources } from '@/contexts/SourceContext'
import {
  emitDismissUpgrade,
  emitDismissCollectionMovie,
} from '@/utils/dismissEvents'
import { useDashboardData } from '@/components/dashboard/hooks/useDashboardData'
import { UpgradesColumn } from '@/components/dashboard/UpgradesColumn'
import { CollectionsColumn, SeriesColumn, ArtistColumn } from '@/components/dashboard/CompletenessColumns'
import { EmptyDashboard } from '@/components/dashboard/EmptyDashboard'
import { DashboardSkeleton } from '@/components/dashboard/DashboardSkeleton'
import type { DashboardProps, UpgradeTab, MissingMovie, MissingEpisode, MissingAlbumItem, MusicAlbumUpgrade } from '@/components/dashboard/types'

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

  // Handlers
  const toggleCollectionExpand = useCallback((index: number) => {
    setExpandedCollections(prev => {
      const next = new Set(prev)
      next.has(index) ? next.delete(index) : next.add(index)
      return next
    })
  }, [])

  const toggleSeriesExpand = useCallback((index: number) => {
    setExpandedSeries(prev => {
      const next = new Set(prev)
      next.has(index) ? next.delete(index) : next.add(index)
      return next
    })
  }, [])

  const toggleArtistExpand = useCallback((index: number) => {
    setExpandedArtists(prev => {
      const next = new Set(prev)
      next.has(index) ? next.delete(index) : next.add(index)
      return next
    })
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
        className="fixed top-[88px] bottom-4 flex flex-col items-center justify-center transition-[left,right] duration-300 ease-out"
        style={{ left: sidebarCollapsed ? '96px' : '288px', right: '16px' }}
      >
        <div className="text-destructive mb-4">{error}</div>
        <button onClick={loadDashboardData} className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors">Try Again</button>
      </div>
    )
  }

  return (
    <div className="flex-1 h-full flex flex-col overflow-hidden">
      {isLoading ? (
        <DashboardSkeleton hasMovies={hasMovies} hasTV={hasTV} hasMusic={hasMusic} />
      ) : hasNothing ? (
        <EmptyDashboard sourcesLength={sources.length} onAddSource={onAddSource} />
      ) : (
        <div className="flex-1 flex gap-4 px-4 pb-4 overflow-x-auto overflow-y-hidden">
          <UpgradesColumn
            upgradeTab={upgradeTab} setUpgradeTab={setUpgradeTab}
            movieUpgrades={movieUpgrades} tvUpgrades={tvUpgrades} musicUpgrades={musicUpgrades as MusicAlbumUpgrade[]}
            upgradeSortBy={upgradeSortBy} setUpgradeSortBy={setUpgradeSortBy}
            hasMovies={hasMovies} hasTV={hasTV} hasMusic={hasMusic}
            onSelect={setSelectedMediaId}
            onDismissMovie={dismissMovieUpgrade} onDismissTv={dismissTvUpgrade} onDismissMusic={dismissMusicUpgrade}
            expandedRecommendations={expandedRecommendations} toggleRecommendation={toggleRecommendation}
          />

          {hasMovies && (
            <CollectionsColumn
              collections={collections} sortBy={collectionSortBy} setSortBy={setCollectionSortBy}
              expandedCollections={expandedCollections} toggleExpand={toggleCollectionExpand} onDismiss={handleDismissCollectionMovie}
            />
          )}

          {hasTV && (
            <SeriesColumn
              series={series} sortBy={seriesSortBy} setSortBy={setSeriesSortBy}
              expandedSeries={expandedSeries} toggleExpand={toggleSeriesExpand} onDismiss={dismissSeriesEpisode}
            />
          )}

          {hasMusic && (
            <ArtistColumn
              artists={artists} sortBy={artistSortBy} setSortBy={setArtistSortBy}
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
