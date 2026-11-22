import type { AudioTrack } from '@main/types/database'
import type { AnalyzedAudioStream } from '@main/services/MediaFileAnalyzer'
import type { OptimizationDecisionAudioTrack } from '@main/services/OptimizationDecisionService'
import { isSameLanguage, normalizeLanguage } from '@main/constants/languages'
import { normalizeAudioCodec } from '@main/services/MediaNormalizer'

export const COMMENTARY_TITLE_REGEX = /commentary|comment/i
export const AUDIO_DESCRIPTION_TITLE_REGEX = /audio description|descriptive/i
export const ACCESSIBILITY_TITLE_REGEX = /accessib|hearing impaired|narration/i
export const PROTECTED_TITLE_REGEX = /commentary|comment|audio description|descriptive|accessib|hearing impaired|narration/i

export interface ProtectedAudioTrackInput {
  title?: string | null
  isCommentary?: boolean
  isAudioDescription?: boolean
  isAccessibility?: boolean
  hasObjectAudio?: boolean
  disposition?: {
    comment?: number
    visual_impaired?: number
    hearing_impaired?: number
    [key: string]: unknown
  } | null
  tags?: {
    title?: string
    [key: string]: unknown
  } | null
}

export function isCommentaryTrack(track: ProtectedAudioTrackInput): boolean {
  if (track.isCommentary === true || track.disposition?.comment === 1) {
    return true
  }
  const title = track.title ?? track.tags?.title ?? ''
  return COMMENTARY_TITLE_REGEX.test(title)
}

export function isAudioDescriptionTrack(track: ProtectedAudioTrackInput): boolean {
  if (track.isAudioDescription === true || track.disposition?.visual_impaired === 1) {
    return true
  }
  const title = track.title ?? track.tags?.title ?? ''
  return AUDIO_DESCRIPTION_TITLE_REGEX.test(title)
}

export function isAccessibilityTrack(track: ProtectedAudioTrackInput): boolean {
  if (track.isAccessibility === true || track.disposition?.hearing_impaired === 1) {
    return true
  }
  const title = track.title ?? track.tags?.title ?? ''
  return ACCESSIBILITY_TITLE_REGEX.test(title)
}

export function isProtectedAudioTrack(track: ProtectedAudioTrackInput): boolean {
  if (
    track.hasObjectAudio ||
    isCommentaryTrack(track) ||
    isAudioDescriptionTrack(track) ||
    isAccessibilityTrack(track)
  ) {
    return true
  }
  const title = track.title ?? track.tags?.title ?? ''
  return PROTECTED_TITLE_REGEX.test(title)
}

/**
 * Match provider tracks to probed streams without assuming they share an order.
 * Native stream indices identify streams directly; otherwise use unique
 * metadata matches. Indistinguishable streams remain unmatched.
 */
export function reconcileAnalyzedAudioTracks(
  provider: readonly AudioTrack[],
  probed: readonly AnalyzedAudioStream[],
): { aligned: boolean; matchedCount: number; tracks: AnalyzedAudioStream[] } {
  const matches = new Map<number, number>()
  const available = new Set(probed.map((_, index) => index))
  const remaining = new Set(provider.map((_, index) => index))
  const declared = (value?: string | null) => {
    const code = normalizeLanguage(value)
    return code === 'und' ? null : code
  }
  const candidates = (source: AudioTrack): number[] => {
    const matching = [...available].filter(index => {
      const target = probed[index]
      if (normalizeAudioCodec(source.codec, source.profile) !== normalizeAudioCodec(target.codec, target.profile)
        || source.channels !== target.channels
        || (source.streamIndex !== undefined && source.streamIndex !== target.index)
        || (source.sampleRate !== undefined && target.sampleRate !== undefined && source.sampleRate !== target.sampleRate)) {
        return false
      }
      const fromProvider = declared(source.language)
      const fromProbe = declared(target.language)
      return source.streamIndex !== undefined || !fromProvider || !fromProbe || isSameLanguage(fromProvider, fromProbe)
    })

    // Exact titles distinguish otherwise equivalent audio streams, but a
    // provider's formatted display title is not a required identity field.
    if (matching.length > 1 && source.title) {
      const titled = matching.filter(index =>
        probed[index].title?.trim().toLowerCase() === source.title?.trim().toLowerCase())
      if (titled.length) return titled
    }
    return matching
  }

  // Resolve unique candidates first, then repeat with remaining streams.
  // Ambiguous streams are intentionally not assigned provider metadata.
  let progressed = true
  while (progressed) {
    progressed = false
    const unique = [...remaining].map(index => ({ index, options: candidates(provider[index]) }))
      .filter(entry => entry.options.length === 1)
    for (const { index, options } of unique) {
      const candidate = options[0]
      if (unique.some(other => other.index !== index && other.options[0] === candidate)) continue
      matches.set(index, candidate)
      remaining.delete(index)
      available.delete(candidate)
      progressed = true
      break
    }
  }

  const tracks = probed.map(stream => ({ ...stream }))
  for (const [sourceIndex, targetIndex] of matches) {
    const source = provider[sourceIndex]
    const target = tracks[targetIndex]
    const fromProvider = declared(source.language)
    const fromProbe = declared(target.language)
    target.language = fromProvider && fromProbe && !isSameLanguage(fromProvider, fromProbe)
      ? undefined
      : fromProbe ?? fromProvider ?? undefined
    target.title ??= source.title
  }
  return { aligned: matches.size === provider.length && matches.size === probed.length, matchedCount: matches.size, tracks }
}

/** Preserve provider language evidence; use FFprobe stream indexes for executable plans. */
export function mapAudioTracksForOptimization(
  provider: readonly AudioTrack[],
  probed?: readonly AnalyzedAudioStream[],
): OptimizationDecisionAudioTrack[] {
  const tracks: readonly (AudioTrack | AnalyzedAudioStream)[] =
    probed ? reconcileAnalyzedAudioTracks(provider, probed).tracks : provider
  return tracks.map(track => {
    const normalized = normalizeLanguage(track.language)
    const language = normalized === 'und' ? undefined : normalized ?? undefined
    return {
      index: track.index,
      codec: normalizeAudioCodec(track.codec, track.profile),
      profile: track.profile,
      channels: track.channels,
      language,
      title: track.title,
      bitrateKbps: 'bitrate' in track ? track.bitrate : track.bitrateKbps,
      channelLayout: 'channelLayout' in track ? track.channelLayout : undefined,
      isDefault: track.isDefault ?? false,
      hasObjectAudio: track.hasObjectAudio ?? false,
      reliableTag: probed !== undefined && language !== undefined,
      isCommentary: 'isCommentary' in track ? track.isCommentary : undefined,
      isAudioDescription: 'isAudioDescription' in track ? track.isAudioDescription : undefined,
      isAccessibility: 'isAccessibility' in track ? track.isAccessibility : undefined,
    }
  })
}
