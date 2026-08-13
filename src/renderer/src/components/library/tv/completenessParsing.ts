import type { MissingEpisode } from '@/components/library/types'

export interface CompletenessParseDiagnostic {
  field: 'missing_seasons' | 'missing_episodes'
  message: string
}

export interface CompletenessParseResult<T> {
  value: T
  diagnostic?: CompletenessParseDiagnostic
}

function invalid(field: CompletenessParseDiagnostic['field'], detail: string): CompletenessParseResult<never> {
  return {
    value: undefined as never,
    diagnostic: { field, message: `Invalid ${field} metadata: ${detail}` },
  }
}

export function parseMissingSeasons(raw: string | undefined): CompletenessParseResult<number[]> {
  if (!raw) return { value: [] }

  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed) || parsed.some((season): season is unknown => typeof season !== 'number' || !Number.isInteger(season) || season < 0)) {
      return invalid('missing_seasons', 'expected an array of non-negative integers')
    }
    return { value: parsed }
  } catch (error: unknown) {
    return invalid('missing_seasons', error instanceof Error ? error.message : 'invalid JSON')
  }
}

function isMissingEpisode(value: unknown): value is MissingEpisode {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.season_number === 'number'
    && Number.isInteger(candidate.season_number)
    && candidate.season_number >= 0
    && typeof candidate.episode_number === 'number'
    && Number.isInteger(candidate.episode_number)
    && candidate.episode_number >= 0
    && (candidate.title === undefined || typeof candidate.title === 'string')
    && (candidate.air_date === undefined || typeof candidate.air_date === 'string')
}

export function parseMissingEpisodes(raw: string | undefined): CompletenessParseResult<MissingEpisode[]> {
  if (!raw) return { value: [] }

  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed) || parsed.some(episode => !isMissingEpisode(episode))) {
      return invalid('missing_episodes', 'expected an array of episode records')
    }
    return { value: parsed }
  } catch (error: unknown) {
    return invalid('missing_episodes', error instanceof Error ? error.message : 'invalid JSON')
  }
}
