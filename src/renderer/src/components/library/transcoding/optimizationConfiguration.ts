import { useCallback, useState } from 'react'
import type { TranscodeOptions } from '@main/services/TranscodingService'
import { formatLanguage, parseLanguageWhitelist } from '../mediaUtils'

export type OptimizationConfiguration = {
  optimizationMode: NonNullable<TranscodeOptions['optimizationMode']>
  targetProfileId: string
  targetContainer: NonNullable<TranscodeOptions['targetContainer']> | ''
  targetContainerSelection: NonNullable<TranscodeOptions['targetContainerSelection']> | ''
  outputMode: NonNullable<TranscodeOptions['outputMode']> | ''
  qualityProfile: NonNullable<TranscodeOptions['qualityProfile']> | ''
  encoderPolicy: NonNullable<TranscodeOptions['encoderPolicy']> | ''
  targetCodec: NonNullable<TranscodeOptions['targetCodec']> | ''
  targetAudioCodec: NonNullable<TranscodeOptions['targetAudioCodec']> | ''
  targetHdrFormat: NonNullable<TranscodeOptions['targetHdrFormat']> | ''
  audioTranscodeEnabled: boolean
  removeUnnecessaryStreams: boolean
  playbackPolicy: NonNullable<TranscodeOptions['playbackPolicy']>
  audioTrackPolicy: 'all' | 'original-and-protected'
  originalAudioLanguage: string
  subtitleLanguages: string
}

export type OptimizationConfigurationSeed = Pick<OptimizationConfiguration, 'optimizationMode'> & Partial<Omit<OptimizationConfiguration, 'optimizationMode'>>

export function createInitialOptimizationConfiguration(optimizationMode: OptimizationConfiguration['optimizationMode'] = 'smart', seed: Partial<OptimizationConfiguration> = {}): OptimizationConfiguration {
  return createOptimizationConfiguration({ ...seed, optimizationMode, targetContainerSelection: 'automatic' })
}

export function createOptimizationConfiguration(seed: OptimizationConfigurationSeed): OptimizationConfiguration {
  return {
    optimizationMode: seed.optimizationMode,
    targetProfileId: seed.targetProfileId ?? '',
    targetContainer: seed.targetContainer ?? '',
    targetContainerSelection: seed.targetContainerSelection ?? '',
    outputMode: seed.outputMode ?? 'quarantine-replace',
    qualityProfile: seed.qualityProfile ?? 'balanced',
    encoderPolicy: seed.encoderPolicy ?? 'automatic',
    targetCodec: seed.targetCodec ?? 'hevc',
    targetAudioCodec: seed.targetAudioCodec ?? '',
    targetHdrFormat: seed.targetHdrFormat ?? '',
    audioTranscodeEnabled: seed.audioTranscodeEnabled ?? false,
    removeUnnecessaryStreams: seed.removeUnnecessaryStreams ?? true,
    playbackPolicy: seed.playbackPolicy ?? 'allow-transcoding',
    audioTrackPolicy: seed.audioTrackPolicy ?? 'original-and-protected',
    originalAudioLanguage: seed.originalAudioLanguage ?? '',
    subtitleLanguages: seed.subtitleLanguages ?? '',
  }
}

export function optimizationConfigurationFromOptions(options: TranscodeOptions): Partial<OptimizationConfiguration> {
  return {
    optimizationMode: options.optimizationMode,
    targetProfileId: options.targetProfileId ?? '',
    targetContainer: options.targetContainer ?? '',
    ...(options.targetContainerSelection === undefined ? {} : { targetContainerSelection: options.targetContainerSelection }),
    outputMode: options.outputMode ?? '',
    qualityProfile: options.qualityProfile ?? '',
    encoderPolicy: options.encoderPolicy ?? '',
    targetCodec: options.targetCodec ?? '',
    targetAudioCodec: options.targetAudioCodec ?? '',
    targetHdrFormat: options.targetHdrFormat ?? '',
    audioTranscodeEnabled: Boolean(options.targetAudioCodec),
    removeUnnecessaryStreams: options.streamSelection?.audio !== 'all',
    playbackPolicy: options.playbackPolicy ?? 'allow-transcoding',
    audioTrackPolicy: options.streamSelection?.audio === 'original-and-protected' ? 'original-and-protected' : 'all',
    originalAudioLanguage: options.streamSelection?.audio === 'original-and-protected' ? options.streamSelection.originalLanguage : '',
    subtitleLanguages: options.streamSelection?.subtitleLanguageWhitelist?.join(', ') ?? '',
  }
}

export function mergeSavedOptimizationConfiguration(current: OptimizationConfiguration, options: TranscodeOptions): OptimizationConfiguration {
  const restored = optimizationConfigurationFromOptions(options)
  return { ...current, ...restored, optimizationMode: options.optimizationMode ?? current.optimizationMode }
}

export function optimizationConfigurationToOptions(configuration: OptimizationConfiguration): Pick<TranscodeOptions, 'optimizationMode' | 'targetProfileId' | 'targetContainer' | 'targetContainerSelection' | 'outputMode' | 'qualityProfile' | 'encoderPolicy' | 'targetCodec' | 'targetAudioCodec' | 'targetHdrFormat' | 'playbackPolicy' | 'streamSelection'> {
  return {
    optimizationMode: configuration.optimizationMode,
    targetProfileId: configuration.targetProfileId || null,
    targetContainer: configuration.targetContainer || undefined,
    targetContainerSelection: configuration.targetContainerSelection || undefined,
    outputMode: configuration.outputMode || undefined,
    qualityProfile: configuration.qualityProfile || undefined,
    encoderPolicy: configuration.encoderPolicy || undefined,
    targetCodec: configuration.targetCodec || undefined,
    targetAudioCodec: configuration.targetAudioCodec || undefined,
    targetHdrFormat: configuration.targetHdrFormat || undefined,
    playbackPolicy: configuration.playbackPolicy,
    streamSelection: optimizationStreamSelection(configuration, configuration.removeUnnecessaryStreams),
  }
}

export function optimizationStreamSelection(configuration: Pick<OptimizationConfiguration, 'audioTrackPolicy' | 'originalAudioLanguage' | 'subtitleLanguages'>, removeUnnecessaryStreams = true): NonNullable<TranscodeOptions['streamSelection']> {
  const subtitleLanguageWhitelist = removeUnnecessaryStreams ? parseLanguageWhitelist(configuration.subtitleLanguages) : undefined
  return configuration.audioTrackPolicy === 'original-and-protected' && removeUnnecessaryStreams
    ? {
        audio: 'original-and-protected',
        originalLanguage: configuration.originalAudioLanguage.trim().toLowerCase(),
        subtitle: 'all',
        subtitleLanguageWhitelist,
        defaultSubtitle: 'preserve',
      }
    : { audio: 'all', subtitle: 'all', subtitleLanguageWhitelist, defaultSubtitle: 'preserve' }
}

export function optimizationTrackSummary(configuration: Pick<OptimizationConfiguration, 'audioTrackPolicy' | 'originalAudioLanguage' | 'subtitleLanguages'>): string {
  const audio = configuration.audioTrackPolicy === 'original-and-protected'
    ? !optimizationAudioLanguageIsKnown(configuration.originalAudioLanguage)
      ? `${configuration.originalAudioLanguage.trim() ? 'Unknown language' : 'Original language not set'} · review before pruning`
      : `${formatLanguage(configuration.originalAudioLanguage)} + protected tracks`
    : 'All audio tracks'
  const subtitles = parseLanguageWhitelist(configuration.subtitleLanguages)
  return `Audio: ${audio} · Subtitles: ${subtitles.length ? subtitles.map(formatLanguage).join(', ') : 'All languages'}`
}

export function optimizationAudioLanguageIsKnown(language: string): boolean {
  return Boolean(language.trim()) && !['und', 'unknown'].includes(language.trim().toLowerCase())
}

export function useOptimizationConfiguration(initial: OptimizationConfigurationSeed) {
  const [configuration, setConfiguration] = useState<OptimizationConfiguration>(() => createOptimizationConfiguration(initial))
  const updateConfiguration = useCallback((next: Partial<OptimizationConfiguration>) => {
    setConfiguration(current => ({ ...current, ...next }))
  }, [])
  const restoreConfiguration = useCallback((options: TranscodeOptions) => {
    setConfiguration(current => mergeSavedOptimizationConfiguration(current, options))
  }, [])
  return { configuration, updateConfiguration, restoreConfiguration }
}

export function optimizationReviewMatches(reviewedOptions: string | null, currentOptions: unknown): boolean {
  return reviewedOptions !== null && reviewedOptions === JSON.stringify(currentOptions)
}

export function unavailablePlaybackTargetMessage(targetProfileId: string | null | undefined, availableTargetProfileIds: readonly string[]): string | null {
  return targetProfileId && !availableTargetProfileIds.includes(targetProfileId)
    ? 'Saved playback target is unavailable. Choose another target or no target.'
    : null
}
