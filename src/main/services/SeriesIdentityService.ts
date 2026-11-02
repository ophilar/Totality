import { getFileNameParser } from '@main/services/FileNameParser'

export type MediaMatchStatus = 'manual' | 'conflicting' | 'verified' | 'unresolved'

export interface SeriesIdentityInput {
  sourceId: string
  libraryId: string
  folderRelativePath: string
  tmdbId?: string | null
  tvdbId?: string | null
}

export function normalizeSeriesPathOrTitle(pathOrTitle: string): string {
  if (!pathOrTitle) return ''
  const parser = getFileNameParser()
  const extracted = parser.extractSeriesTitleFromPath(pathOrTitle)
  return parser.normalizeSeriesTitle(extracted || pathOrTitle)
}

export function deriveSeriesIdentityKey(input: SeriesIdentityInput): string {
  if (input.tmdbId && String(input.tmdbId).trim() !== '') return `tmdb:${String(input.tmdbId).trim()}`
  if (input.tvdbId && String(input.tvdbId).trim() !== '') return `tvdb:${String(input.tvdbId).trim()}`
  const normalized = normalizeSeriesPathOrTitle(input.folderRelativePath)
  const slug = normalized.trim().replace(/\s+/g, '-').replace(/[^a-z0-9-_]/g, '')
  return `unresolved:${input.sourceId}:${input.libraryId}:${slug || 'unknown'}`
}

export function getMediaMatchStatus(input: { locked: boolean; canonicalIds: string[]; conflictingEntityIds: number[] }): MediaMatchStatus {
  if (input.locked) return 'manual'
  if (input.conflictingEntityIds.length > 0) return 'conflicting'
  return input.canonicalIds.length > 0 ? 'verified' : 'unresolved'
}


