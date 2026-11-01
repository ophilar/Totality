
import type { FileAnalysisResult } from '../MediaFileAnalyzer'
import type { TranscodeOptions } from './types'
import { normalizeLanguage } from '../../constants/languages'
import { isProtectedAudioTrack, isCommentaryTrack, isAudioDescriptionTrack, isAccessibilityTrack } from '../utils/audioTrackUtils'

export type DefaultSubtitleSelection = 'preserve' | 'none' | number

export interface StreamSelectionPlan {
  audioStreamIndexes: number[]
  subtitleStreamIndexes: number[]
  defaultSubtitle: DefaultSubtitleSelection
}

/** Read-only review projection of the stream mappings used by FFmpeg. */
export interface PlannedAudioStream {
  index: number
  action: 'keep' | 'remove' | 'convert'
  targetCodec?: string
}

export function getPlannedAudioStreams(
  analysis: Pick<FileAnalysisResult, 'audioTracks'>,
  plan: Pick<StreamSelectionPlan, 'audioStreamIndexes'>,
  conversions: readonly { sourceIndex: number; codec: string }[] = [],
): PlannedAudioStream[] {
  const retained = new Set(plan.audioStreamIndexes)
  const converted = new Map(conversions.map(({ sourceIndex, codec }) => [sourceIndex, codec]))
  return analysis.audioTracks.map(({ index }) => {
    if (!retained.has(index)) return { index, action: 'remove' }
    const targetCodec = converted.get(index)
    return targetCodec ? { index, action: 'convert', targetCodec } : { index, action: 'keep' }
  })
}

export interface SubtitleSelectionPolicy {
  language?: string
  forced?: boolean
  hearingImpaired?: boolean
  title?: string
}

export type StreamSelectionPolicy =
  | {
      audio: 'all'
      subtitle: 'all'
      subtitleLanguageWhitelist?: string[]
      defaultSubtitle?: 'preserve' | 'none' | SubtitleSelectionPolicy
    }
  | {
      audio: 'original-and-protected'
      originalLanguage: string
      subtitle: 'all'
      subtitleLanguageWhitelist?: string[]
      defaultSubtitle?: 'preserve' | 'none' | SubtitleSelectionPolicy
    }
  | {
      audio: 'explicit'
      audioIndexes: number[]
      subtitle: 'all'
      subtitleLanguageWhitelist?: string[]
      defaultSubtitle?: 'preserve' | 'none' | SubtitleSelectionPolicy
    }

function resolvePolicyIndexes(analysis: FileAnalysisResult, policy: StreamSelectionPolicy): number[] {
  if (policy.audio === 'all') return analysis.audioTracks.map(track => track.index)
  if (policy.audio === 'explicit') return policy.audioIndexes
  const original = normalizeLanguage(policy.originalLanguage)
  if (!original || original === 'und') throw new Error('A known original language is required for original-and-protected audio policy')
  const result = analysis.audioTracks.filter(track => {
    const protectedTrack = isProtectedAudioTrack(track)
    const language = normalizeLanguage(track.language)
    if ((!language || language === 'und') && !protectedTrack) throw new Error(`Audio stream ${track.index} has no reliable language tag`)
    return protectedTrack || language === original
  }).map(track => track.index)
  const originalTracks = analysis.audioTracks.filter(track => normalizeLanguage(track.language) === original)
  if (originalTracks.length === 0) throw new Error(`No audio stream matches original language ${policy.originalLanguage}`)
  if (!originalTracks.some(track => !isCommentaryTrack(track) && !isAudioDescriptionTrack(track) && !isAccessibilityTrack(track))) {
    throw new Error(`No primary audio stream matches original language ${policy.originalLanguage}`)
  }
  return result
}

function resolvePolicySubtitle(policy: StreamSelectionPolicy, analysis: FileAnalysisResult, selected: number[]): number | 'preserve' | 'none' {
  const choice = policy.defaultSubtitle
  if (choice === undefined || choice === 'preserve') return 'preserve'
  if (choice === 'none') return 'none'
  const candidates = analysis.subtitleTracks.filter(track => selected.includes(track.index))
    .filter(track => choice.language === undefined || normalizeLanguage(track.language) === normalizeLanguage(choice.language))
    .filter(track => choice.forced === undefined || track.isForced === choice.forced)
    .filter(track => choice.title === undefined || track.title === choice.title)
  if (candidates.length !== 1) throw new Error(`Subtitle policy resolved to ${candidates.length} tracks; exactly one is required`)
  return candidates[0].index
}

function selectIndexes(
  available: ReadonlyArray<{ index: number }>,
  requested: number[] | undefined,
  label: 'Audio' | 'Subtitle'
): number[] {
  const availableIndexes = new Set(available.map(track => track.index))
  const selected = requested === undefined ? [...availableIndexes] : requested
  const unique = new Set<number>()

  for (const index of selected) {
    if (!Number.isInteger(index) || index < 0) throw new Error(`${label} stream index must be a non-negative integer`)
    if (!availableIndexes.has(index)) throw new Error(`${label} stream ${index} is not available`)
    if (unique.has(index)) throw new Error(`${label} stream ${index} was selected more than once`)
    unique.add(index)
  }

  return selected
}

export function selectSubtitleStreamIndexes(
  subtitleTracks: ReadonlyArray<{ index: number; language?: string; isForced?: boolean }>,
  languageWhitelist: readonly string[],
): number[] {
  const normalizedWhitelist = new Set(languageWhitelist.map(normalizeLanguage).filter((language): language is string => Boolean(language)))
  return subtitleTracks
    .filter(track => track.isForced || (track.language && normalizedWhitelist.has(normalizeLanguage(track.language) ?? '')))
    .map(track => track.index)
}

export function buildStreamSelectionPlan(analysis: FileAnalysisResult, options: TranscodeOptions): StreamSelectionPlan {
  const policy = options.streamSelection as StreamSelectionPolicy | undefined
  const policyAudio = policy ? resolvePolicyIndexes(analysis, policy) : undefined
  const audioStreamIndexes = selectIndexes(analysis.audioTracks, policyAudio, 'Audio')

  let subtitleCandidates: number[] | undefined = undefined
  if (
    policy?.subtitleLanguageWhitelist &&
    policy.subtitleLanguageWhitelist.length > 0
  ) {
    subtitleCandidates = selectSubtitleStreamIndexes(analysis.subtitleTracks, policy.subtitleLanguageWhitelist)
  }

  const subtitleStreamIndexes = selectIndexes(analysis.subtitleTracks, subtitleCandidates, 'Subtitle')
  const requestedDefault: number | null | 'preserve' | 'none' | undefined = policy ? resolvePolicySubtitle(policy, analysis, subtitleStreamIndexes) : undefined
  if (typeof requestedDefault === 'number' && !subtitleStreamIndexes.includes(requestedDefault)) {
    throw new Error(`Subtitle stream ${requestedDefault} is not selected`)
  }

  return {
    audioStreamIndexes,
    subtitleStreamIndexes,
    defaultSubtitle: requestedDefault === undefined ? 'preserve' : requestedDefault === null ? 'none' : requestedDefault
  }
}

export function appendStreamMappingArgs(args: string[], analysis: FileAnalysisResult, options: TranscodeOptions): StreamSelectionPlan {
  if (!analysis.video) throw new Error('Transcoding requires an analyzed video stream')
  const plan = buildStreamSelectionPlan(analysis, options)
  args.push('-map', `0:${analysis.video.index}`)
  for (const index of plan.audioStreamIndexes) args.push('-map', `0:${index}`)
  for (const index of plan.subtitleStreamIndexes) args.push('-map', `0:${index}`)
  if (plan.audioStreamIndexes.length > 0) args.push('-c:a', 'copy')
  if (plan.subtitleStreamIndexes.length > 0) args.push('-c:s', 'copy')
  for (const [outputIndex, sourceIndex] of plan.audioStreamIndexes.entries()) {
    const conversion = options.audioConversions?.find(item => item.sourceIndex === sourceIndex)
    if (conversion) args.push(`-c:a:${outputIndex}`, conversion.codec, `-b:a:${outputIndex}`, `${conversion.bitrateKbps}k`)
  }
  args.push('-map', '0:t?', '-map_chapters', '0', '-map_metadata', '0')

  if (plan.defaultSubtitle !== 'preserve') {
    for (let outputIndex = 0; outputIndex < plan.subtitleStreamIndexes.length; outputIndex++) {
      args.push(`-disposition:s:${outputIndex}`, '0')
    }
    if (typeof plan.defaultSubtitle === 'number') {
      args.push(`-disposition:s:${plan.subtitleStreamIndexes.indexOf(plan.defaultSubtitle)}`, 'default')
    }
  }
  return plan
}
