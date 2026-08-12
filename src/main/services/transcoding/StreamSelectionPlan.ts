import type { FileAnalysisResult } from '../MediaFileAnalyzer'
import type { TranscodeOptions } from '../TranscodingService'

export type DefaultSubtitleSelection = 'preserve' | 'none' | number

export interface StreamSelectionPlan {
  audioStreamIndexes: number[]
  subtitleStreamIndexes: number[]
  defaultSubtitle: DefaultSubtitleSelection
}

export interface SubtitleSelectionPolicy {
  language?: string
  forced?: boolean
  hearingImpaired?: boolean
  title?: string
}

export type StreamSelectionPolicy =
  | { audio: 'all'; subtitle: 'all'; defaultSubtitle?: 'preserve' | 'none' | SubtitleSelectionPolicy }
  | { audio: 'original-and-protected'; originalLanguage: string; subtitle: 'all'; defaultSubtitle?: 'preserve' | 'none' | SubtitleSelectionPolicy }

function normalizeLanguage(language?: string | null): string | null {
  if (!language) return null
  const value = language.trim().toLowerCase().split(/[-_]/)[0]
  const aliases: Record<string, string> = { eng: 'en', heb: 'he', deu: 'de', ger: 'de', fra: 'fr', fre: 'fr', spa: 'es', ita: 'it', jpn: 'ja', kor: 'ko', zho: 'zh', chi: 'zh', rus: 'ru' }
  return aliases[value] || value || null
}

function resolvePolicyIndexes(analysis: FileAnalysisResult, policy: StreamSelectionPolicy): number[] {
  if (policy.audio === 'all') return analysis.audioTracks.map(track => track.index)
  const original = normalizeLanguage(policy.originalLanguage)
  if (!original) throw new Error('Original language is required for original-and-protected audio policy')
  const protectedTitle = /commentary|comment|audio description|descriptive|accessib|narration/i
  const result = analysis.audioTracks.filter(track => {
    const protectedTrack = track.hasObjectAudio || track.isCommentary || track.isAudioDescription || track.isAccessibility || protectedTitle.test(track.title || '')
    const language = normalizeLanguage(track.language)
    if (!language && !protectedTrack) throw new Error(`Audio stream ${track.index} has no reliable language tag`)
    return protectedTrack || language === original
  }).map(track => track.index)
  if (result.length === 0) throw new Error(`No audio stream matches original language ${policy.originalLanguage}`)
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

export function buildStreamSelectionPlan(analysis: FileAnalysisResult, options: TranscodeOptions): StreamSelectionPlan {
  const policyAudio = options.streamSelection ? resolvePolicyIndexes(analysis, options.streamSelection) : undefined
  const audioStreamIndexes = selectIndexes(analysis.audioTracks, policyAudio, 'Audio')
  const subtitleStreamIndexes = selectIndexes(analysis.subtitleTracks, undefined, 'Subtitle')
  const requestedDefault: number | null | 'preserve' | 'none' | undefined = options.streamSelection ? resolvePolicySubtitle(options.streamSelection, analysis, subtitleStreamIndexes) : undefined
  if (typeof requestedDefault === 'number' && !subtitleStreamIndexes.includes(requestedDefault)) {
    throw new Error(`Subtitle stream ${requestedDefault} is not selected`)
  }

  return {
    audioStreamIndexes,
    subtitleStreamIndexes,
    defaultSubtitle: requestedDefault === undefined ? 'preserve' : requestedDefault === null ? 'none' : requestedDefault
  }
}

export function appendStreamMappingArgs(args: string[], analysis: FileAnalysisResult, options: TranscodeOptions): void {
  if (!analysis.video) throw new Error('Transcoding requires an analyzed video stream')
  const plan = buildStreamSelectionPlan(analysis, options)
  args.push('-map', `0:${analysis.video.index}`)
  for (const index of plan.audioStreamIndexes) args.push('-map', `0:${index}`)
  for (const index of plan.subtitleStreamIndexes) args.push('-map', `0:${index}`)
  if (plan.audioStreamIndexes.length > 0) args.push('-c:a', 'copy')
  if (plan.subtitleStreamIndexes.length > 0) args.push('-c:s', 'copy')
  args.push('-map', '0:t?', '-map_chapters', '0', '-map_metadata', '0')

  if (plan.defaultSubtitle !== 'preserve') {
    for (let outputIndex = 0; outputIndex < plan.subtitleStreamIndexes.length; outputIndex++) {
      args.push(`-disposition:s:${outputIndex}`, '0')
    }
    if (typeof plan.defaultSubtitle === 'number') {
      args.push(`-disposition:s:${plan.subtitleStreamIndexes.indexOf(plan.defaultSubtitle)}`, 'default')
    }
  }
}
