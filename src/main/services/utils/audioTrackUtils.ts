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
