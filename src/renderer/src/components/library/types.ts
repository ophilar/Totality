/**
 * Media Browser Type Definitions
 *
 * Shared types used across media browser components.
 * Consolidates types with @main/types/database for Single Source of Truth.
 */

import type { 
  ProviderType, 
  MediaItem as BaseMediaItem,
  MediaItemVersion as BaseMediaItemVersion,
  MusicArtist as BaseMusicArtist,
  MusicAlbum as BaseMusicAlbum,
  MusicTrack as BaseMusicTrack,
  TVShowSummary as BaseTVShowSummary,
  MissingEpisode as BaseMissingEpisode,
  LibraryStats as BaseLibraryStats,
  SeriesStats as BaseSeriesStats,
  CollectionStats as BaseCollectionStats,
  MusicStats as BaseMusicStats,
  MusicCompletenessStats as BaseMusicCompletenessStats,
  SeriesCompleteness as BaseSeriesCompleteness,
  MovieCollection as BaseMovieCollection,
  ArtistCompleteness as BaseArtistCompleteness,
  AlbumCompleteness as BaseAlbumCompleteness,
  MissingAlbum as BaseMissingAlbum,
  MissingTrack as BaseMissingTrack,
} from '@main/types/database'
import type { MediaSourceResponse } from '@preload/api/types'

// Re-export for convenience
export type { ProviderType }

// Alias for MediaSourceResponse used in hooks
export type MediaSource = MediaSourceResponse

// ============================================================================
// Consolidated Base Types (Aliases for UI)
// ============================================================================

export type MediaItem = BaseMediaItem
export type MediaItemVersion = BaseMediaItemVersion
export type MusicArtist = BaseMusicArtist
export type MusicAlbum = BaseMusicAlbum
export type MusicTrack = BaseMusicTrack
export type TVShowSummary = BaseTVShowSummary
export type MissingEpisode = BaseMissingEpisode
export type LibraryStats = BaseLibraryStats
export type SeriesStats = BaseSeriesStats
export type CollectionStats = BaseCollectionStats
export type MusicStats = BaseMusicStats
export type MusicCompletenessStats = BaseMusicCompletenessStats
export type SeriesCompletenessData = BaseSeriesCompleteness
export type MovieCollectionData = BaseMovieCollection
export type ArtistCompletenessData = BaseArtistCompleteness
export type AlbumCompletenessData = BaseAlbumCompleteness
export type MissingAlbum = BaseMissingAlbum
export type MissingTrack = BaseMissingTrack

// ============================================================================
// TV Show UI Specific Types
// ============================================================================

export interface TVShow {
  title: string
  poster_url?: string
  seasons: Map<number, TVSeason>
}

export interface SeasonInfo {
  seasonNumber: number
  episodes: MediaItem[]
  posterUrl?: string
}

export interface TVSeason {
  seasonNumber: number
  episodes: MediaItem[]
  posterUrl?: string
}

// ============================================================================
// Analysis Types
// ============================================================================

export interface AnalysisProgress {
  current: number
  total: number
  currentItem: string
  phase: string
}

// ============================================================================
// Component Props Types
// ============================================================================

export interface MediaBrowserProps {
  onAddSource?: () => void
  onOpenSettings?: (initialTab?: string) => void
  sidebarCollapsed?: boolean
  onNavigateHome?: () => void
  initialTab?: MediaViewType
  // When true, don't render the header (it's rendered at app level)
  hideHeader?: boolean
  // External panel state control
  showCompletenessPanel?: boolean
  showWishlistPanel?: boolean
  showChatPanel?: boolean
  onToggleCompleteness?: () => void
  onToggleWishlist?: () => void
  onToggleChat?: () => void
  // External view tab control
  libraryTab?: MediaViewType
  onLibraryTabChange?: (tab: MediaViewType) => void
  // Notify parent of auto-refresh state
  onAutoRefreshChange?: (isRefreshing: boolean) => void
}

export interface MissingItemPopupData {
  type: 'episode' | 'season' | 'movie'
  title: string
  year?: number
  airDate?: string
  seasonNumber?: number
  episodeNumber?: number
  posterUrl?: string
  tmdbId?: string
  imdbId?: string
  seriesTitle?: string
}

export interface MatchFixModalData {
  isOpen: boolean
  type: 'series' | 'movie' | 'artist' | 'album'
  title: string
  year?: number
  filePath?: string
  artistName?: string
  sourceId?: string
  mediaItemId?: number
  artistId?: number
  albumId?: number
}

// ============================================================================
// Filter Types
// ============================================================================

export type TierFilter = 'all' | 'SD' | '720p' | '1080p' | '4K'
export type QualityFilter = 'all' | 'low' | 'medium' | 'high'
export type ViewType = 'grid' | 'list'
export type MediaViewType = 'movies' | 'tv' | 'music' | 'wishlist' | 'duplicates'
export type MusicViewMode = 'artists' | 'albums' | 'tracks'
