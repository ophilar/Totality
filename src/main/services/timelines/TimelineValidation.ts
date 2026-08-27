import type { TimelineDefinition, TimelineRecipeSummary } from './ITimelineRecipeProvider'

export const CURRENT_TIMELINE_RECIPE_VERSION = 2
export const SUPPORTED_TIMELINE_RECIPE_VERSIONS = [1, CURRENT_TIMELINE_RECIPE_VERSION] as const

export type TimelineValidationResult<T> =
  | { valid: true; value: T }
  | { valid: false; reason: string }

type TimelineItemValidationResult = { valid: true } | { valid: false; reason: string }

export function validateTimelineDefinition(value: unknown): TimelineValidationResult<TimelineDefinition> {
  if (!isRecord(value)) return invalid('payload must be an object')
  if (!isNonEmptyString(value.id) || !isNonEmptyString(value.franchise) || !isNonEmptyString(value.name) ||
      typeof value.description !== 'string' || !Array.isArray(value.items)) {
    return invalid('payload is missing id, franchise, name, description, or items')
  }
  if (value.sourceUrl !== undefined && !isNonEmptyString(value.sourceUrl)) {
    return invalid('sourceUrl must be a non-empty string when present')
  }
  if (!SUPPORTED_TIMELINE_RECIPE_VERSIONS.includes(value.version as 1 | 2)) {
    return invalid(`unsupported version ${String(value.version)}`)
  }

  for (let index = 0; index < value.items.length; index++) {
    const itemValidation = validateTimelineItem(value.items[index], value.version, index)
    if (!itemValidation.valid) return itemValidation
  }

  return { valid: true, value: value as unknown as TimelineDefinition }
}

export function isTimelineRecipeSummary(value: unknown): value is TimelineRecipeSummary {
  if (!isRecord(value)) return false
  return isNonEmptyString(value.id) && isNonEmptyString(value.name) && isNonEmptyString(value.franchise) &&
    typeof value.description === 'string' && Number.isInteger(value.totalItems) && (value.totalItems as number) >= 0 &&
    (value.sourceType === 'preset' || value.sourceType === 'remote' || value.sourceType === 'trakt' ||
      value.sourceType === 'web' || value.sourceType === 'ai')
}

function validateTimelineItem(value: unknown, version: unknown, index: number): TimelineItemValidationResult {
  if (!isRecord(value)) return invalid(`item ${index + 1} must be an object`)
  if (!Number.isInteger(value.order) || (value.order as number) <= 0 || !isNonEmptyString(value.title) || !isRecord(value.identifiers)) {
    return invalid(`item ${index + 1} is missing a positive order, title, or identifiers`)
  }
  if (version === CURRENT_TIMELINE_RECIPE_VERSION && value.order !== index + 1) {
    return invalid(`version 2 item order must be contiguous and match array order at item ${index + 1}`)
  }
  if (value.type !== 'movie' && value.type !== 'episode' && value.type !== 'show') {
    return invalid(`item ${index + 1} has unsupported type ${String(value.type)}`)
  }
  if (!validateIdentifiers(value.identifiers)) return invalid(`item ${index + 1} has malformed identifiers`)
  if (!validateOptionalString(value.seriesTitle) || !validateOptionalString(value.airDate) || !validateOptionalString(value.timelineEra)) {
    return invalid(`item ${index + 1} has malformed optional text fields`)
  }
  if (!validateOptionalNonNegativeInteger(value.seasonNumber) || !validateOptionalPositiveInteger(value.episodeNumber)) {
    return invalid(`item ${index + 1} has malformed episode coordinates`)
  }

  if (version === CURRENT_TIMELINE_RECIPE_VERSION) {
    if (value.type === 'show') {
      return invalid(`version 2 must be episode-interleaved and cannot contain show-level item ${index + 1}`)
    }
    if (value.type === 'episode' &&
        (!isNonEmptyString(value.seriesTitle) || !isNonNegativeInteger(value.seasonNumber) || !isPositiveInteger(value.episodeNumber))) {
      return invalid(`version 2 episode ${index + 1} requires seriesTitle, seasonNumber, and episodeNumber`)
    }
  }

  return { valid: true }
}

function validateIdentifiers(value: Record<string, unknown>): boolean {
  return validateOptionalPositiveInteger(value.tmdbId) && validateOptionalPositiveInteger(value.tvdbId) &&
    (value.imdbId === undefined || isNonEmptyString(value.imdbId))
}

function validateOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string'
}

function validateOptionalPositiveInteger(value: unknown): boolean {
  return value === undefined || isPositiveInteger(value)
}

function validateOptionalNonNegativeInteger(value: unknown): boolean {
  return value === undefined || isNonNegativeInteger(value)
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function invalid(reason: string): { valid: false; reason: string } {
  return { valid: false, reason }
}
