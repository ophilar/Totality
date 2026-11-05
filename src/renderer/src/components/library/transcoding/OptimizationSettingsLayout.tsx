import type { ReactNode } from 'react'
import type { PlaybackTargetProfile } from '@main/types/playbackTarget'
import { OptimizationMethodSelection, type OptimizationMethod } from './OptimizationMethodSelection'
import { OptimizationPlaybackTargetSelection } from './OptimizationPlaybackTargetSelection'
import { OutputHandlingSelection } from './OutputHandlingSelection'
import type { TranscodeOptions } from './types'
import { OptimizationQualityFormatSelection } from './OptimizationQualityFormatSelection'
import { OptimizationAudioConversionSelection } from './OptimizationAudioConversionSelection'
import { OptimizationPlaybackBehaviorSelection } from './OptimizationPlaybackBehaviorSelection'

export function OptimizationSettingsLayout({
  profiles,
  targetProfileId,
  onTargetProfileChange,
  targetError,
  loadingTargets,
  disabled,
  optimizationMode,
  onOptimizationModeChange,
  outputMode,
  onOutputModeChange,
  qualityProfile,
  targetCodec,
  supportedTargetCodecs,
  unsupportedTargetCodecReasons,
  videoRequired,
  playbackPolicy,
  onPlaybackPolicyChange,
  trackSummary,
  trackSettingsOpen,
  onTrackSettingsOpenChange,
  encodingSummary,
  advancedSettingsOpen,
  onAdvancedSettingsOpenChange,
  onQualityProfileChange,
  onTargetCodecChange,
  audioConversion,
  playbackOptions,
  outputOptions,
  advancedOptions,
}: {
  profiles: PlaybackTargetProfile[]
  targetProfileId: string
  onTargetProfileChange: (value: string) => void
  targetError?: string | null
  loadingTargets?: boolean
  disabled?: boolean
  optimizationMode: OptimizationMethod
  onOptimizationModeChange: (value: OptimizationMethod) => void
  outputMode: NonNullable<TranscodeOptions['outputMode']> | '' | undefined
  onOutputModeChange: (value: NonNullable<TranscodeOptions['outputMode']>) => void
  qualityProfile: NonNullable<TranscodeOptions['qualityProfile']> | ''
  targetCodec: NonNullable<TranscodeOptions['targetCodec']> | ''
  supportedTargetCodecs: readonly NonNullable<TranscodeOptions['targetCodec']>[]
  unsupportedTargetCodecReasons?: Partial<Record<NonNullable<TranscodeOptions['targetCodec']>, string>>
  videoRequired: boolean
  playbackPolicy: NonNullable<TranscodeOptions['playbackPolicy']>
  onPlaybackPolicyChange: (value: NonNullable<TranscodeOptions['playbackPolicy']>) => void
  trackSummary: string
  trackSettingsOpen?: boolean
  onTrackSettingsOpenChange?: (open: boolean) => void
  encodingSummary: string
  advancedSettingsOpen?: boolean
  onAdvancedSettingsOpenChange?: (open: boolean) => void
  onQualityProfileChange: (value: NonNullable<TranscodeOptions['qualityProfile']> | '') => void
  onTargetCodecChange: (value: NonNullable<TranscodeOptions['targetCodec']> | '') => void
  audioConversion?: {
    enabled: boolean
    codec: 'aac' | 'ac3' | 'eac3' | ''
    sourceCodec?: string | null
    options: readonly { value: 'aac' | 'ac3' | 'eac3'; label: string }[]
    onEnabledChange: (enabled: boolean) => void
    onCodecChange: (codec: 'aac' | 'ac3' | 'eac3' | '') => void
  }
  playbackOptions?: ReactNode
  outputOptions?: ReactNode
  advancedOptions?: ReactNode
}) {
  return <section aria-label="Optimization settings" className="space-y-4 rounded-xl border border-border/40 bg-muted/10 p-4">
    <OptimizationPlaybackTargetSelection profiles={profiles} value={targetProfileId} error={targetError} loading={loadingTargets} disabled={disabled} onChange={onTargetProfileChange} />
    <OptimizationMethodSelection value={optimizationMode} disabled={disabled} onChange={onOptimizationModeChange} />
    <fieldset className="space-y-4">
      <legend className="mb-2 text-sm font-semibold">Output settings</legend>
      <OptimizationQualityFormatSelection qualityProfile={qualityProfile} targetCodec={targetCodec} supportedTargetCodecs={supportedTargetCodecs} unsupportedReasons={unsupportedTargetCodecReasons} videoRequired={videoRequired} disabled={disabled} onQualityProfileChange={onQualityProfileChange} onTargetCodecChange={onTargetCodecChange} />
    </fieldset>
    <details open={trackSettingsOpen} onToggle={event => onTrackSettingsOpenChange?.(event.currentTarget.open)} className="rounded-lg border border-border/40 p-3">
      <summary className="cursor-pointer text-sm font-medium">{trackSummary} · Edit</summary>
      <div className="mt-3 space-y-4">{playbackOptions}</div>
    </details>
    <OutputHandlingSelection value={outputMode || undefined} onChange={onOutputModeChange} disabled={disabled} />
    <details open={advancedSettingsOpen} onToggle={event => onAdvancedSettingsOpenChange?.(event.currentTarget.open)} className="rounded-lg border border-border/40 p-3">
      <summary className="cursor-pointer text-sm font-medium">Advanced settings · {encodingSummary}</summary>
      <div className="mt-3 space-y-4">
        <OptimizationPlaybackBehaviorSelection value={playbackPolicy} disabled={disabled} onChange={onPlaybackPolicyChange} />
        {audioConversion && <OptimizationAudioConversionSelection enabled={audioConversion.enabled} codec={audioConversion.codec} sourceCodec={audioConversion.sourceCodec} options={audioConversion.options} disabled={disabled} onEnabledChange={audioConversion.onEnabledChange} onCodecChange={audioConversion.onCodecChange} />}
        {outputOptions && <div className="space-y-4">{outputOptions}</div>}
        {advancedOptions}
      </div>
    </details>
  </section>
}
