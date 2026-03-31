import type { MovieCollectionData, SeriesCompletenessData, ArtistCompletenessData } from '../library/types'
import type { MissingMovie, MissingEpisode, MissingAlbumItem, SeasonGroup } from './types'

export const parseMissingMovies = (collection: MovieCollectionData): MissingMovie[] => {
  if (!collection.missing_movies) return []
  try {
    const parsed = JSON.parse(collection.missing_movies)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((m): m is MissingMovie =>
      m && typeof m === 'object' && typeof m.title === 'string'
    )
  } catch {
    return []
  }
}

export const parseMissingEpisodes = (s: SeriesCompletenessData): MissingEpisode[] => {
  if (!s.missing_episodes) return []
  try {
    const parsed = JSON.parse(s.missing_episodes)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((ep): ep is MissingEpisode =>
      ep && typeof ep === 'object' &&
      typeof ep.season_number === 'number' &&
      typeof ep.episode_number === 'number'
    )
  } catch {
    return []
  }
}

export const parseMissingAlbums = (artist: ArtistCompletenessData, includeEps: boolean, includeSingles: boolean): MissingAlbumItem[] => {
  const albums: MissingAlbumItem[] = []
  const isValidAlbum = (a: unknown): a is { title: string; musicbrainz_id?: string; year?: number } =>
    a !== null && typeof a === 'object' && typeof (a as { title?: string }).title === 'string'

  try {
    if (artist.missing_albums) {
      const parsed = JSON.parse(artist.missing_albums)
      if (Array.isArray(parsed)) {
        parsed.filter(isValidAlbum).forEach(a => albums.push({ ...a, musicbrainz_id: a.musicbrainz_id || '', album_type: 'album' }))
      }
    }
    if (includeEps && artist.missing_eps) {
      const parsed = JSON.parse(artist.missing_eps)
      if (Array.isArray(parsed)) {
        parsed.filter(isValidAlbum).forEach(a => albums.push({ ...a, musicbrainz_id: a.musicbrainz_id || '', album_type: 'ep' }))
      }
    }
    if (includeSingles && artist.missing_singles) {
      const parsed = JSON.parse(artist.missing_singles)
      if (Array.isArray(parsed)) {
        parsed.filter(isValidAlbum).forEach(a => albums.push({ ...a, musicbrainz_id: a.musicbrainz_id || '', album_type: 'single' }))
      }
    }
  } catch {
    // Ignore parse errors
  }
  return albums
}

export const groupEpisodesBySeason = (s: SeriesCompletenessData): SeasonGroup[] => {
  const episodes = parseMissingEpisodes(s)
  if (episodes.length === 0) return []

  let wholeMissingSeasons = new Set<number>()
  try {
    if (s.missing_seasons) {
      const parsed = JSON.parse(s.missing_seasons)
      wholeMissingSeasons = new Set(parsed)
    }
  } catch {
    // Ignore parse errors
  }

  const groups = new Map<number, MissingEpisode[]>()
  episodes.forEach(ep => {
    if (!groups.has(ep.season_number)) {
      groups.set(ep.season_number, [])
    }
    groups.get(ep.season_number)!.push(ep)
  })

  return Array.from(groups.entries())
    .map(([seasonNumber, eps]) => ({
      seasonNumber,
      isWholeSeason: wholeMissingSeasons.has(seasonNumber),
      totalEpisodes: eps.length,
      missingEpisodes: eps.sort((a, b) => a.episode_number - b.episode_number)
    }))
    .sort((a, b) => a.seasonNumber - b.seasonNumber)
}
