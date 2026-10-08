export type IdentityLike = {
  series_identity_key?: string
  series_title?: string
  source_id?: string
  library_id?: string
}

export interface TVShowIdentity {
  seriesIdentityKey: string
  sourceId: string
  libraryId: string
  key: string
}

export function getTVShowIdentity(show: IdentityLike): TVShowIdentity {
  const seriesIdentityKey = show.series_identity_key?.trim()
  const sourceId = show.source_id?.trim() || 'default'
  const libraryId = show.library_id?.trim() || 'default'

  if (!seriesIdentityKey) throw new Error('TV series identity key is missing')

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
