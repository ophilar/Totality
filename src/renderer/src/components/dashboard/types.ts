import type { MusicAlbum } from '../library/types'

export interface MusicAlbumUpgrade extends MusicAlbum {
  quality_tier: string
  tier_quality: string
  tier_score: number
  storage_debt_bytes?: number
}

export interface MissingMovie {
  tmdb_id: string
  title: string
  year?: number
  poster_url?: string
}

export interface MissingEpisode {
  season_number: number
  episode_number: number
  episode_title?: string
}

export interface MissingAlbumItem {
  musicbrainz_id: string
  title: string
  year?: number
  album_type: 'album' | 'ep' | 'single'
}

export interface SeasonGroup {
  seasonNumber: number
  isWholeSeason: boolean
  totalEpisodes: number
  missingEpisodes: MissingEpisode[]
}

export type UpgradeTab = 'movies' | 'tv' | 'music'

export interface DashboardProps {
  onNavigateToLibrary: (view: 'movies' | 'tv' | 'music') => void
  onAddSource?: () => void
  sidebarCollapsed?: boolean
  hasMovies?: boolean
  hasTV?: boolean
  hasMusic?: boolean
}

export type UpgradeSortBy = 'quality' | 'efficiency' | 'recent' | 'title'
export type CollectionSortBy = 'completeness' | 'name' | 'recent'
export type SeriesSortBy = 'completeness' | 'name' | 'recent'
export type ArtistSortBy = 'completeness' | 'name'
