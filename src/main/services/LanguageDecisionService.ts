

export type LanguageDecisionStatus = 'approved' | 'review-required'
export type AudioTrackAction = 'retain' | 'remove' | 'review-required'

export interface AudioTrackForDecision {
  index: number
  language?: string | null
  title?: string | null
  isCommentary?: boolean
  isAudioDescription?: boolean
  isAccessibility?: boolean
  hasObjectAudio?: boolean
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

import { formatLanguage, isSameLanguage, normalizeLanguage } from '@main/constants/languages'
import {
  isAudioDescriptionTrack,
  isAccessibilityTrack,
  isCommentaryTrack,
  isProtectedAudioTrack
} from '@main/services/utils/audioTrackUtils'

// ISO 639 und is a missing value, not positive evidence of a language.
const normalize = (value?: string | null): string | null => {
  const code = normalizeLanguage(value)
  return code === 'und' ? null : code
}

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
      return { action: 'review-required', decision: 'review-required', rationale, reason: rationale, originalLanguage: normOrig, streamLanguage: normLang }
    }

    if (!normLang) {
      const rationale = 'Missing or unreliable language tag requires review'
      return { action: 'review-required', decision: 'review-required', rationale, reason: rationale, originalLanguage: normOrig, streamLanguage: normLang }
    }

    if (isSameLanguage(normLang, normOrig)) {
      const rationale = `Matches original language (${originalLanguage || normOrig})`
      return { action: 'retain', decision: 'retain', rationale, reason: rationale, originalLanguage: normOrig, streamLanguage: normLang }
    }

    const rationale = `Unwanted dubbed audio track (${rawLanguage || normLang}) different from original language (${originalLanguage || normOrig})`
    return { action: 'remove', decision: 'remove', rationale, reason: rationale, originalLanguage: normOrig, streamLanguage: normLang }
  }

  decide(originalLanguage: string | null | undefined, tracks: AudioTrackForDecision[], metadataAgreesWithTags = true): LanguageDecision {
    const original = normalize(originalLanguage)
    const taggedTracks = tracks.map(track => ({
      track,
      language: normalize(track.language ?? track.tags?.language),
    }))
    const evidenceSources = [
      ...(original ? ['original-language-metadata'] : []),
      ...taggedTracks.filter(({ language }) => Boolean(language))
        .map(({ track }) => `${track.reliableTag ? 'embedded-audio-tag' : 'unverified-audio-tag'}:${track.index}`),
    ]
    const reviewAll = (reason: string): LanguageDecision => ({
      originalLanguage: original,
      evidenceSources,
      confidence: 'none',
      status: 'review-required',
      retainedTrackIndexes: tracks.filter(isProtectedAudioTrack).map(track => track.index),
      removableTrackIndexes: [],
      reviewRequiredTrackIndexes: tracks.filter(track => !isProtectedAudioTrack(track)).map(track => track.index),
      reason,
    })
    if (!original) {
      const known = taggedTracks
        .filter(({ language }) => Boolean(language))
        .map(({ track, language }) => `${formatLanguage(language)} (stream ${track.index}${track.reliableTag ? '' : ', not yet matched to a probed stream'})`)
      return reviewAll(known.length
        ? `Audio track languages are identified: ${known.join(', ')}. Original-language metadata is unknown; cannot identify dubs safely`
        : 'Original-language metadata and audio track languages are unknown')
    }
    if (!metadataAgreesWithTags) {
      return reviewAll('Original-language metadata conflicts with embedded audio evidence')
    }
    // Do not remove a dub based only on a title-level original-language guess.
    // Object-audio tracks may be the primary soundtrack and must remain valid.
    const primaryMatch = taggedTracks.some(({ track, language }) =>
      track.reliableTag && isSameLanguage(language, original) &&
      !isCommentaryTrack(track) && !isAudioDescriptionTrack(track) && !isAccessibilityTrack(track))
    if (tracks.length > 0 && !primaryMatch) {
      return reviewAll('No reliable primary audio stream matches the original language; removing other tracks could eliminate the soundtrack')
    }
    const retained: number[] = []
    const removable: number[] = []
    const review: number[] = []
    for (const { track, language } of taggedTracks) {
      if (isProtectedAudioTrack(track)) {
        retained.push(track.index)
      } else if (!track.reliableTag || !language) {
        review.push(track.index)
      } else if (isSameLanguage(language, original)) {
        retained.push(track.index)
      } else {
        removable.push(track.index)
      }
    }
    const status = review.length ? 'review-required' : 'approved'
    return {
      originalLanguage: original,
      evidenceSources,
      confidence: status === 'approved' ? 'high' : 'none',
      status,
      retainedTrackIndexes: retained,
      removableTrackIndexes: removable,
      reviewRequiredTrackIndexes: review,
      reason: status === 'approved'
        ? 'Original-language track confirmed and embedded audio languages identified'
        : 'One or more audio tracks have unknown or unreliable language metadata',
    }
  }
}

