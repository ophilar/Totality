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

const LANGUAGE_ALIASES: Record<string, string> = { eng: 'en', deu: 'de', ger: 'de', fra: 'fr', fre: 'fr', spa: 'es', ita: 'it', jpn: 'ja', kor: 'ko', zho: 'zh', chi: 'zh', rus: 'ru' }
const normalize = (language?: string | null) => {
  const value = language?.trim().toLowerCase().split(/[-_]/)[0] || null
  return value ? LANGUAGE_ALIASES[value] || value : null
}
const protectedTitle = /commentary|comment|audio description|descriptive|accessib|narration/i

export class LanguageDecisionService {
  decide(originalLanguage: string | null | undefined, tracks: AudioTrackForDecision[], metadataAgreesWithTags = true): LanguageDecision {
    const original = normalize(originalLanguage)
    const evidenceSources = original ? ['matched-original-language-metadata'] : []
    const retained: number[] = [], removable: number[] = [], review: number[] = []
    if (!original || !metadataAgreesWithTags) {
      return { originalLanguage: original, evidenceSources, confidence: 'none', status: 'review-required', retainedTrackIndexes: [], removableTrackIndexes: [], reviewRequiredTrackIndexes: tracks.map(t => t.index), reason: !original ? 'Original language metadata is unknown' : 'Original language metadata conflicts with embedded audio evidence' }
    }
    for (const track of tracks) {
      const language = normalize(track.language)
      const protectedTrack = track.isCommentary || track.isAudioDescription || track.isAccessibility || protectedTitle.test(track.title || '')
      if (track.reliableTag) evidenceSources.push(`embedded-audio-tag:${track.index}`)
      if (!track.reliableTag || !language) review.push(track.index)
      else if (language === original || protectedTrack) retained.push(track.index)
      else removable.push(track.index)
    }
    const status = review.length ? 'review-required' : 'approved'
    return { originalLanguage: original, evidenceSources: [...new Set(evidenceSources)], confidence: status === 'approved' ? 'high' : 'none', status, retainedTrackIndexes: retained, removableTrackIndexes: removable, reviewRequiredTrackIndexes: review, reason: status === 'approved' ? 'Metadata and reliable embedded audio tags agree' : 'One or more audio tracks have unknown or unreliable language evidence' }
  }
}
