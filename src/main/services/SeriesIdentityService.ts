export type MediaMatchStatus = 'manual' | 'conflicting' | 'verified' | 'unresolved'

export interface SeriesIdentityInput {
  sourceId: string
  libraryId: string
  folderRelativePath: string
  tmdbId?: string | null
  tvdbId?: string | null
}

export function deriveSeriesIdentityKey(input: SeriesIdentityInput): string {
  if (input.tmdbId) return `tmdb:${input.tmdbId}`
  if (input.tvdbId) return `tvdb:${input.tvdbId}`
  return `unresolved:${input.sourceId}:${input.libraryId}:${input.folderRelativePath.replace(/\\/g, '/')}`
}

export function getMediaMatchStatus(input: { locked: boolean; canonicalIds: string[]; conflictingEntityIds: number[] }): MediaMatchStatus {
  if (input.locked) return 'manual'
  if (input.conflictingEntityIds.length > 0 || input.canonicalIds.length > 1) return 'conflicting'
  return input.canonicalIds.length === 1 ? 'verified' : 'unresolved'
}
