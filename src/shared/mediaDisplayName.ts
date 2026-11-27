export interface EpisodeDisplayMetadata {
  type?: string
  title?: string | null
  series_title?: string | null
  season_number?: number | null
  episode_number?: number | null
}

/** Returns the user-facing name for a media item without changing its stored identity. */
export function formatMediaDisplayName(media: EpisodeDisplayMetadata, seriesTitle = media.series_title): string {
  if (media.type === 'movie') return media.title?.trim() ?? ''

  const series = seriesTitle?.trim() ?? ''
  const coordinates = media.season_number == null || media.episode_number == null
    ? ''
    : `S${String(media.season_number).padStart(2, '0')}E${String(media.episode_number).padStart(2, '0')}`
  const title = media.title?.trim()
  const prefix = series && coordinates ? `${series}: ${coordinates}` : series || coordinates
  return `${prefix}${title ? `${prefix ? ' ' : ''}${title}` : ''}`
}
