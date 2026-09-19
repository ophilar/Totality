
export interface MovieSearchResult {
  id: number
  title: string
  year?: number | null
  poster_url?: string | null
  needs_upgrade: boolean
  type: 'movie'
}

export interface TVSearchResult {
  id: string
  title: string
  poster_url?: string | null
  type: 'tv'
}

export interface EpisodeSearchResult {
  id: number
  title: string
  series_title?: string | null
  series_identity_key?: string | null
  source_id?: string | null
  library_id?: string | null
  season_number?: number | null
  episode_number?: number | null
  thumb_url?: string | null
  needs_upgrade: boolean
  type: 'episode'
}

export interface ArtistSearchResult {
  id: number
  title: string
  thumb_url?: string | null
  type: 'artist'
}

export interface AlbumSearchResult {
  id: number
  title: string
  subtitle: string
  year?: number | null
  thumb_url?: string | null
  needs_upgrade: boolean
  type: 'album'
}

export interface TrackSearchResult {
  id: number
  title: string
  album_id: number
  album_title?: string | null
  artist_name?: string | null
  thumb_url?: string | null
  needs_upgrade: boolean
  type: 'track'
}

export interface GlobalSearchResults {
  movies: MovieSearchResult[]
  tvShows: TVSearchResult[]
  episodes: EpisodeSearchResult[]
  artists: ArtistSearchResult[]
  albums: AlbumSearchResult[]
  tracks: TrackSearchResult[]
}

import type { Client } from '@libsql/client'

export class GlobalSearchRepository {
  constructor(private db: Client) {}
  
  async search(query: string): Promise<GlobalSearchResults> {
    const likeQuery = `%${query}%`

    // Movies
    const moviesRes = await this.db.execute({
      sql: `SELECT id, title, year, poster_url, (needs_upgrade = 1 OR tier_quality = 'LOW') as needs_upgrade
            FROM media_items
            WHERE type = 'movie' AND title LIKE ? COLLATE NOCASE
            ORDER BY title ASC
            LIMIT 5`,
      args: [likeQuery]
    })
    const movies = moviesRes.rows.map(r => ({
      id: r.id as number,
      title: r.title as string,
      year: r.year as number | null,
      poster_url: r.poster_url as string | null,
      needs_upgrade: !!r.needs_upgrade,
      type: 'movie' as const
    }))

    // TV Shows
    const tvRes = await this.db.execute({
      sql: `SELECT series_identity_key as id, series_title as title, poster_url
            FROM series
            WHERE series_title LIKE ? COLLATE NOCASE
            GROUP BY series_identity_key
            ORDER BY series_title ASC
            LIMIT 5`,
      args: [likeQuery]
    })
    const tvShows = tvRes.rows.map(r => ({
      id: r.id as string,
      title: r.title as string,
      poster_url: r.poster_url as string | null,
      type: 'tv' as const
    }))

    // Episodes
    const epsRes = await this.db.execute({
      sql: `SELECT id, title, series_title, series_identity_key, source_id, library_id, season_number, episode_number, COALESCE(episode_thumb_url, season_poster_url, poster_url) as thumb_url, (needs_upgrade = 1 OR tier_quality = 'LOW') as needs_upgrade
            FROM media_items
            WHERE type = 'episode' AND (title LIKE ? COLLATE NOCASE OR series_title LIKE ? COLLATE NOCASE)
            ORDER BY series_title ASC, season_number ASC, episode_number ASC
            LIMIT 5`,
      args: [likeQuery, likeQuery]
    })
    const episodes = epsRes.rows.map(r => ({
      id: r.id as number,
      title: r.title as string,
      series_title: r.series_title as string | null,
      series_identity_key: r.series_identity_key as string | null,
      source_id: r.source_id as string | null,
      library_id: r.library_id as string | null,
      season_number: r.season_number as number | null,
      episode_number: r.episode_number as number | null,
      thumb_url: r.thumb_url as string | null,
      needs_upgrade: !!r.needs_upgrade,
      type: 'episode' as const
    }))

    // Artists
    const artistsRes = await this.db.execute({
      sql: `SELECT id, name as title, thumb_url
            FROM music_artists
            WHERE name LIKE ? COLLATE NOCASE
            ORDER BY name ASC
            LIMIT 5`,
      args: [likeQuery]
    })
    const artists = artistsRes.rows.map(r => ({
      id: r.id as number,
      title: r.title as string,
      thumb_url: r.thumb_url as string | null,
      type: 'artist' as const
    }))

    // Albums
    const albumsRes = await this.db.execute({
      sql: `SELECT id, title, artist_name as subtitle, year, thumb_url, 0 as needs_upgrade
            FROM music_albums
            WHERE title LIKE ? COLLATE NOCASE OR artist_name LIKE ? COLLATE NOCASE
            ORDER BY title ASC
            LIMIT 5`,
      args: [likeQuery, likeQuery]
    })
    const albums = albumsRes.rows.map(r => ({
      id: r.id as number,
      title: r.title as string,
      subtitle: r.subtitle as string,
      year: r.year as number | null,
      thumb_url: r.thumb_url as string | null,
      needs_upgrade: !!r.needs_upgrade,
      type: 'album' as const
    }))

    // Tracks
    const tracksRes = await this.db.execute({
      sql: `SELECT t.id, t.title, t.album_id, a.title as album_title, a.artist_name, a.thumb_url, (t.is_lossless = 0 AND t.is_hi_res = 0) as needs_upgrade
            FROM music_tracks t
            LEFT JOIN music_albums a ON t.album_id = a.id
            WHERE t.album_id IS NOT NULL AND t.title LIKE ? COLLATE NOCASE
            ORDER BY t.title ASC
            LIMIT 5`,
      args: [likeQuery]
    })
    const tracks = tracksRes.rows.map(r => ({
      id: r.id as number,
      title: r.title as string,
      album_id: r.album_id as number,
      album_title: r.album_title as string | null,
      artist_name: r.artist_name as string | null,
      thumb_url: r.thumb_url as string | null,
      needs_upgrade: !!r.needs_upgrade,
      type: 'track' as const
    }))

    return {
      movies,
      tvShows,
      episodes,
      artists,
      albums,
      tracks
    }
  }
}
