import { getLoggingService } from '@main/services/LoggingService'

export type LanguageDecisionStatus = 'approved' | 'review-required'
export type AudioTrackAction = 'retain' | 'remove' | 'review-required'

export interface AudioTrackForDecision {
  index: number
  language?: string | null
  title?: string | null
  isCommentary?: boolean
  isAudioDescription?: boolean
  isAccessibility?: boolean
  reliableTag?: boolean
  disposition?: {
    default?: number
    forced?: number
    comment?: number
    visual_impaired?: number
    hearing_impaired?: number
    [key: string]: unknown
  }
  tags?: {
    language?: string
    title?: string
    [key: string]: unknown
  } | null
}

export interface AudioDecisionConfig {
  retainCommentary?: boolean
  retainAudioDescription?: boolean
  retainAccessibility?: boolean
}

export interface AudioStreamDecision {
  action: AudioTrackAction
  decision: AudioTrackAction
  rationale: string
  reason: string
  originalLanguage: string | null
  streamLanguage: string | null
}

export interface LanguageDecision {
  originalLanguage: string | null
  evidenceSources: string[]
  confidence: 'high' | 'none'
  status: LanguageDecisionStatus
  retainedTrackIndexes: number[]
  removableTrackIndexes: number[]
  reviewRequiredTrackIndexes: number[]
  reason: string
}

import { normalizeLanguage } from '@main/constants/languages'
import {
  isAudioDescriptionTrack,
  isAccessibilityTrack,
  isCommentaryTrack,
  isProtectedAudioTrack
} from '@main/services/utils/audioTrackUtils'

const normalize = normalizeLanguage

export class LanguageDecisionService {
  /**
   * Decide retention vs removal for a single audio stream:
   * - Retain: matches original language, or is commentary, audio description, or accessibility.
   * - Remove: unwanted dubbed audio in a different language than original.
   * - Review-required: missing/unknown language or original language metadata.
   */
  decideAudioStream(
    stream: {
      index?: number
      language?: string | null
      title?: string | null
      isCommentary?: boolean
      isAudioDescription?: boolean
      isAccessibility?: boolean
      reliableTag?: boolean
      disposition?: {
        comment?: number
        visual_impaired?: number
        hearing_impaired?: number
        [key: string]: unknown
      }
      tags?: {
        language?: string
        title?: string
        [key: string]: unknown
      } | null
    },
    originalLanguage?: string | null,
    config?: AudioDecisionConfig
  ): AudioStreamDecision {
    const rawLanguage = stream.language ?? stream.tags?.language ?? null
    const normLang = normalize(rawLanguage)
    const normOrig = normalize(originalLanguage)

    const isCommentary = isCommentaryTrack(stream)
    const isAudioDescription = isAudioDescriptionTrack(stream)
    const isAccessibility = isAccessibilityTrack(stream)

    const retainCommentary = config?.retainCommentary ?? true
    const retainAudioDesc = config?.retainAudioDescription ?? true
    const retainAccess = config?.retainAccessibility ?? true

    if (isCommentary && retainCommentary) {
      const rationale = 'Commentary track retained for extras/accessibility'
      return { action: 'retain', decision: 'retain', rationale, reason: rationale, originalLanguage: normOrig, streamLanguage: normLang }
    }

    if (isAudioDescription && retainAudioDesc) {
      const rationale = 'Audio description track retained for accessibility'
      return { action: 'retain', decision: 'retain', rationale, reason: rationale, originalLanguage: normOrig, streamLanguage: normLang }
    }

    if (isAccessibility && retainAccess) {
      const rationale = 'Accessibility track retained'
      return { action: 'retain', decision: 'retain', rationale, reason: rationale, originalLanguage: normOrig, streamLanguage: normLang }
    }

    if (!normOrig) {
      const rationale = 'Original language metadata is unknown'
      getLoggingService().debug('[LanguageDecision]', `Track ${stream.index ?? '?'}: original language metadata is unknown`)
      return { action: 'review-required', decision: 'review-required', rationale, reason: rationale, originalLanguage: normOrig, streamLanguage: normLang }
    }

    if (!normLang) {
      const rationale = 'Missing or unreliable language tag requires review'
      getLoggingService().debug('[LanguageDecision]', `Track ${stream.index ?? '?'}: missing or unreliable language tag "${rawLanguage ?? ''}"`)
      return { action: 'review-required', decision: 'review-required', rationale, reason: rationale, originalLanguage: normOrig, streamLanguage: normLang }
    }

    if (normLang === normOrig) {
      const rationale = `Matches original language (${originalLanguage || normOrig})`
      return { action: 'retain', decision: 'retain', rationale, reason: rationale, originalLanguage: normOrig, streamLanguage: normLang }
    }

    const rationale = `Unwanted dubbed audio track (${rawLanguage || normLang}) different from original language (${originalLanguage || normOrig})`
    return { action: 'remove', decision: 'remove', rationale, reason: rationale, originalLanguage: normOrig, streamLanguage: normLang }
  }

  decide(originalLanguage: string | null | undefined, tracks: AudioTrackForDecision[], metadataAgreesWithTags = true): LanguageDecision {
    const original = normalize(originalLanguage)
    const evidenceSources = original ? ['matched-original-language-metadata'] : []
    const retained: number[] = [], removable: number[] = [], review: number[] = []
    if (!original) {
      getLoggingService().debug('[LanguageDecision]', 'Original language metadata is unknown for audio decision')
      return { originalLanguage: original, evidenceSources, confidence: 'none', status: 'review-required', retainedTrackIndexes: [], removableTrackIndexes: [], reviewRequiredTrackIndexes: tracks.map(t => t.index), reason: 'Original language metadata is unknown' }
    }
    if (!metadataAgreesWithTags) {
      getLoggingService().warn('[LanguageDecision]', `Original language metadata (${original}) conflicts with embedded audio evidence`)
      return { originalLanguage: original, evidenceSources, confidence: 'none', status: 'review-required', retainedTrackIndexes: [], removableTrackIndexes: [], reviewRequiredTrackIndexes: tracks.map(t => t.index), reason: 'Original language metadata conflicts with embedded audio evidence' }
    }
    for (const track of tracks) {
      const language = normalize(track.language)
      const protectedTrack = isProtectedAudioTrack(track)
      if (track.reliableTag) evidenceSources.push(`embedded-audio-tag:${track.index}`)
      if (!track.reliableTag || !language) {
        getLoggingService().warn('[LanguageDecision]', `Audio track ${track.index} has unknown or missing language tag`)
        review.push(track.index)
      } else if (language === original || protectedTrack) {
        retained.push(track.index)
      } else {
        removable.push(track.index)
      }
    }
    const status = review.length ? 'review-required' : 'approved'
    return { originalLanguage: original, evidenceSources: [...new Set(evidenceSources)], confidence: status === 'approved' ? 'high' : 'none', status, retainedTrackIndexes: retained, removableTrackIndexes: removable, reviewRequiredTrackIndexes: review, reason: status === 'approved' ? 'Metadata and reliable embedded audio tags agree' : 'One or more audio tracks have unknown or unreliable language evidence' }
  }
}

