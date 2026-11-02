import type { SeriesCompletenessData, TVShowSummary } from '@/components/library/types'

type TVShowIdentityLike = Pick<TVShowSummary, 'series_identity_key' | 'source_id' | 'library_id'>
type SeriesIdentityLike = Pick<SeriesCompletenessData, 'series_identity_key' | 'source_id' | 'library_id'>
type IdentityLike = TVShowIdentityLike | SeriesIdentityLike

export interface TVShowIdentity {
  seriesIdentityKey: string
  sourceId: string
  libraryId: string
  key: string
}

export function getTVShowIdentity(show: IdentityLike): TVShowIdentity {
  const seriesIdentityKey = show.series_identity_key?.trim()
  const sourceId = show.source_id?.trim()
  const libraryId = show.library_id?.trim()

  if (!seriesIdentityKey) throw new Error('TV series identity is missing')
  if (!sourceId) throw new Error('TV series source is missing')
  if (!libraryId) throw new Error('TV series library is missing')

  return {
    seriesIdentityKey,
    sourceId,
    libraryId,
    key: `${seriesIdentityKey}\u001f${sourceId}\u001f${libraryId}`,
  }
}

export function getTVShowIdentityKey(show: IdentityLike): string {
  return getTVShowIdentity(show).key
}
