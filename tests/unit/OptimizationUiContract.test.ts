import { describe, expect, it } from 'vitest'
import { OUTPUT_HANDLING_CHOICES } from '../../src/renderer/src/components/library/transcoding/OutputHandlingSelection'
import { OPTIMIZATION_METHODS } from '../../src/renderer/src/components/library/transcoding/OptimizationMethodSelection'
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'
import { OutputHandlingSelection } from '../../src/renderer/src/components/library/transcoding/OutputHandlingSelection'
import { OptimizationPlaybackTargetSelection } from '../../src/renderer/src/components/library/transcoding/OptimizationPlaybackTargetSelection'
import { OptimizationEncodingProgress } from '../../src/renderer/src/components/library/transcoding/OptimizationEncodingProgress'
import { optimizationCoverageLabel, optimizationDecisionLabel } from '../../src/renderer/src/components/library/transcoding/optimizationStatus'
import { OptimizationReviewItem } from '../../src/renderer/src/components/library/transcoding/OptimizationReviewItem'
import { OptimizationTaskResults } from '../../src/renderer/src/components/library/transcoding/OptimizationTaskResults'
import { OptimizationTerminalState } from '../../src/renderer/src/components/library/transcoding/OptimizationTerminalState'
import { OptimizationSettingsLayout } from '../../src/renderer/src/components/library/transcoding/OptimizationSettingsLayout'
import { OptimizationQualityFormatSelection } from '../../src/renderer/src/components/library/transcoding/OptimizationQualityFormatSelection'
import { SubtitleLanguageSelection } from '../../src/renderer/src/components/library/transcoding/SubtitleLanguageSelection'
import { AudioTrackPolicySelection } from '../../src/renderer/src/components/library/transcoding/AudioTrackPolicySelection'
import { OptimizationDialogFooter } from '../../src/renderer/src/components/library/transcoding/OptimizationDialogFooter'
import { OptimizationContainerSelection } from '../../src/renderer/src/components/library/transcoding/OptimizationContainerSelection'
import { OptimizationAudioCodecSelection } from '../../src/renderer/src/components/library/transcoding/OptimizationAudioCodecSelection'
import { OptimizationAudioConversionSelection } from '../../src/renderer/src/components/library/transcoding/OptimizationAudioConversionSelection'
import { availableOptimizationDialogStages, optimizationDialogStage } from '../../src/renderer/src/components/library/transcoding/OptimizationStages'
import { OPTIMIZATION_VIDEO_FORMATS, optimizationAudioCodecOptions, optimizationContainerOptions } from '../../src/renderer/src/components/library/transcoding/optimizationOptions'
import { createInitialOptimizationConfiguration, optimizationTrackSummary } from '../../src/renderer/src/components/library/transcoding/optimizationConfiguration'
import { OPTIMIZATION_CHOICE_ACCENTS } from '../../src/renderer/src/components/library/transcoding/optimizationChoiceAccents'

describe('optimization UI contract', () => {
  it('uses the same stage order and hides stale reviews', () => {
    expect(availableOptimizationDialogStages(false, false)).toEqual(['Settings'])
    expect(availableOptimizationDialogStages(true, false)).toEqual(['Settings', 'Review'])
    expect(availableOptimizationDialogStages(false, true)).toEqual(['Settings', 'Results'])
    expect(optimizationDialogStage(false, false)).toBe('Settings')
    expect(optimizationDialogStage(true, false)).toBe('Review')
    expect(optimizationDialogStage(false, true)).toBe('Results')
  })

  it('uses concise, distinct output handling labels', () => {
    expect(OUTPUT_HANDLING_CHOICES.map(choice => choice.title)).toEqual([
      'Replace original',
      'Replace and keep backup',
      'Save a copy',
    ])
    expect(OUTPUT_HANDLING_CHOICES.map(choice => choice.value)).toEqual(['replace', 'quarantine-replace', 'copy'])
    expect(new Set(OUTPUT_HANDLING_CHOICES.map(choice => choice.value)).size).toBe(OUTPUT_HANDLING_CHOICES.length)
  })

  it('uses the same optimization methods across scopes', () => {
    expect(OPTIMIZATION_METHODS.map(method => method.label)).toEqual(['Smart', 'Keep video', 'Re-encode video'])
    expect(OPTIMIZATION_CHOICE_ACCENTS).toEqual({
      recommended: 'text-green-700 dark:text-green-400',
      preserve: 'text-purple-700 dark:text-purple-400',
      compress: 'text-amber-700 dark:text-amber-400',
    })
  })

  it('renders output handling as native keyboard-selectable radio inputs', () => {
    const markup = renderToStaticMarkup(React.createElement(OutputHandlingSelection, { value: 'copy', onChange: () => undefined }))
    expect(markup).toContain('Save output')
    expect(markup.match(/type="radio"/g)).toHaveLength(3)
    expect(markup).toContain('checked=""')
    expect(markup).toContain('bg-card')
    expect(markup).toContain('text-muted-foreground')
    expect(markup).toContain('text-amber-700 dark:text-amber-400')
    const disabledMarkup = renderToStaticMarkup(React.createElement(OutputHandlingSelection, { value: 'copy', onChange: () => undefined, disabled: true }))
    expect(disabledMarkup.match(/disabled=""/g)).toHaveLength(3)
  })

  it('uses one labeled container control with explicit empty and disabled states', () => {
    const markup = renderToStaticMarkup(React.createElement(OptimizationContainerSelection, {
      value: '', placeholder: 'Choose a supported container', disabled: true,
      options: [{ value: 'mkv', label: 'MKV' }, { value: 'mp4', label: 'MP4' }],
      onChange: () => undefined,
    }))
    expect(markup).toContain('aria-label="Container"')
    expect(markup).toContain('Choose a supported container')
    expect(markup).toContain('<option value="mkv">MKV</option>')
    expect(markup).toContain('disabled=""')
  })

  it('renders the shared audio conversion switch and gates its codec selector', () => {
    const markup = renderToStaticMarkup(React.createElement(OptimizationAudioConversionSelection, {
      enabled: false, codec: '', sourceCodec: 'EAC3', options: [{ value: 'aac', label: 'AAC' }],
      onEnabledChange: () => undefined, onCodecChange: () => undefined,
    }))
    expect(markup).toContain('Convert audio')
    expect(markup).toContain('Protected tracks keep their source codec.')
    expect(markup).not.toContain('Convert retained tracks.')
    expect(markup).not.toContain('Preserve source (EAC3)')
    expect(markup).toContain('type="checkbox"')
    expect(markup.match(/disabled=""/g)?.length ?? 0).toBe(0)
    expect(markup).not.toContain('Transcode audio')
  })

  it('uses one audio codec label while retaining scope-provided choices', () => {
    const markup = renderToStaticMarkup(React.createElement(OptimizationAudioCodecSelection, {
      value: 'eac3', placeholder: 'Preserve source (AC3)', disabled: true,
      options: [{ value: 'eac3', label: 'EAC3 (recommended)' }], onChange: () => undefined,
    }))
    expect(markup).toContain('Audio')
    expect(markup).toContain('aria-label="Audio"')
    expect(markup).toContain('Preserve source (AC3)')
    expect(markup).toContain('EAC3 (recommended)')
    expect(markup).toContain('disabled=""')
  })

  it('renders all optimization stages with one shared footer layout', () => {
    const markup = renderToStaticMarkup(React.createElement(OptimizationDialogFooter, {
      leadingAction: { label: 'Cancel', onClick: () => undefined },
      secondaryAction: { label: 'Analyze item', onClick: () => undefined, variant: 'outline' },
      primaryAction: { label: 'Prepare review', onClick: () => undefined },
    }))
    expect(markup).toContain('Cancel')
    expect(markup).toContain('Analyze item')
    expect(markup).toContain('Prepare review')
    expect(markup.match(/type="button"/g)).toHaveLength(3)
    expect(markup).toContain('focus-visible:outline-primary')
  })

  it('keeps shared settings in target, method, output settings, save output order', () => {
    const markup = renderToStaticMarkup(React.createElement(OptimizationSettingsLayout, {
      profiles: [], targetProfileId: '', onTargetProfileChange: () => undefined,
      disabled: true,
      optimizationMode: 'smart', onOptimizationModeChange: () => undefined,
      playbackPolicy: 'allow-transcoding', onPlaybackPolicyChange: () => undefined,
      outputMode: 'copy', onOutputModeChange: () => undefined,
      qualityProfile: 'balanced', targetCodec: 'hevc', supportedTargetCodecs: ['hevc'], videoRequired: true,
      trackSummary: 'Audio: English + protected tracks · Subtitles: English',
      encodingSummary: 'Intel GPU · H.265 · MKV',
      onQualityProfileChange: () => undefined, onTargetCodecChange: () => undefined,
      playbackOptions: React.createElement('label', null, 'Playback behavior'),
      outputOptions: React.createElement('h3', null, 'Container'),
    }))
    const order = [
      markup.indexOf('Playback target'),
      markup.indexOf('Optimization method'),
      markup.indexOf('Output settings'),
      markup.indexOf('aria-label="Quality"'),
      markup.indexOf('aria-label="Video format"'),
      markup.indexOf('Save output'),
      markup.indexOf('Advanced settings'),
    ]
    expect(order.every((position, index) => position >= 0 && (index === 0 || position > order[index - 1]))).toBe(true)
    expect(markup).toContain('Playback behavior')
    expect(markup).not.toContain('Remove unselected streams')
    expect(markup.match(/<select[^>]*disabled=""/g)?.length).toBe(2)
    expect(markup.match(/type="radio"[^>]*disabled=""/g)).toHaveLength(11)
  })

  it('uses shared quality and video format choices with unsupported formats disabled', () => {
    expect(OPTIMIZATION_VIDEO_FORMATS).toEqual([
      { value: 'hevc', label: 'HEVC (H.265)' },
      { value: 'av1', label: 'AV1' },
    ])
    const markup = renderToStaticMarkup(React.createElement(OptimizationQualityFormatSelection, {
      qualityProfile: 'balanced', targetCodec: 'hevc', supportedTargetCodecs: ['hevc'], videoRequired: true,
      onQualityProfileChange: () => undefined, onTargetCodecChange: () => undefined,
    }))
    expect(markup).toContain('aria-label="Quality"')
    expect(markup).toContain('Balanced')
    expect(markup).toContain('HEVC (H.265)')
    expect(markup).toContain('AV1 (unavailable)')
    expect(markup).toContain('disabled=""')
    expect(markup).toContain('bg-card')
    expect(markup).not.toContain('bg-purple-800')
  })

  it('starts with a useful plan and concise track summary', () => {
    const configuration = createInitialOptimizationConfiguration()
    expect(configuration).toMatchObject({
      optimizationMode: 'smart', qualityProfile: 'balanced', targetCodec: 'hevc',
      encoderPolicy: 'automatic', outputMode: 'quarantine-replace',
      audioTrackPolicy: 'original-and-protected', removeUnnecessaryStreams: true,
    })
    expect(optimizationTrackSummary({ ...configuration, originalAudioLanguage: 'eng', subtitleLanguages: 'eng, heb' }))
      .toBe('Audio: English + protected tracks · Subtitles: English, Hebrew')
    expect(optimizationTrackSummary({ ...configuration, originalAudioLanguage: 'und' }))
      .toContain('Unknown language · review before pruning')
  })

  it('uses one supported audio codec list across optimization scopes', () => {
    expect(optimizationAudioCodecOptions()).toEqual([
      { value: 'aac', label: 'AAC' },
      { value: 'ac3', label: 'AC3' },
      { value: 'eac3', label: 'EAC3' },
    ])
    expect(optimizationAudioCodecOptions(['EAC3', 'AAC'])).toEqual([
      { value: 'aac', label: 'AAC' },
      { value: 'eac3', label: 'EAC3' },
    ])
    expect(optimizationAudioCodecOptions(['opus'])).toEqual([])
  })

  it('uses the same container names across optimization scopes', () => {
    expect(optimizationContainerOptions(['matroska', 'mp4'])).toEqual([
      { value: 'mkv', label: 'MKV' },
      { value: 'mp4', label: 'MP4' },
    ])
    expect(optimizationContainerOptions(['MP4'])).toEqual([{ value: 'mp4', label: 'MP4' }])
    expect(optimizationContainerOptions()).toEqual([])
  })

  it('shares subtitle language selection and common language shortcuts', () => {
    const markup = renderToStaticMarkup(React.createElement(SubtitleLanguageSelection, { value: 'eng, heb', onChange: () => undefined }))
    expect(markup).toContain('<legend')
    expect(markup).toContain('Subtitles')
    expect(markup).toContain('English (eng)')
    expect(markup).toContain('Hebrew (heb)')
    expect(markup).toContain('aria-pressed="true"')
    expect(markup).toContain('role="group"')
    expect(markup).toContain('aria-label="Common subtitle languages"')
    expect(markup.match(/min-h-6/g)?.length).toBeGreaterThanOrEqual(12)
    const emptyMarkup = renderToStaticMarkup(React.createElement(SubtitleLanguageSelection, { value: '', onChange: () => undefined }))
    expect(emptyMarkup).toContain('All subtitles')
  })

  it('uses the shared audio policy labels and scoped language selector', () => {
    const markup = renderToStaticMarkup(React.createElement(AudioTrackPolicySelection, {
      policy: 'preferred', language: 'eng', languages: [{ value: 'eng', label: 'English (eng)', group: 'In file' }],
      onPolicyChange: () => undefined, onLanguageChange: () => undefined,
    }))
    expect(markup).toContain('Audio tracks')
    expect(markup).toContain('Preferred language and protected tracks')
    expect(markup).toContain('All audio tracks')
    expect(markup).toContain('Original audio language')
    expect(markup).toContain('English (eng)')
  })

  it('renders one labeled playback target control with an associated error', () => {
    const markup = renderToStaticMarkup(React.createElement(OptimizationPlaybackTargetSelection, {
      profiles: [], value: '', onChange: () => undefined, error: 'Choose a supported target.',
    }))
    expect(markup).toContain('aria-label="Playback target"')
    expect(markup).toContain('aria-invalid="true"')
    expect(markup).toContain('role="alert"')
    expect(markup).toContain('Choose a supported target.')
  })

  it('shares accessible progress UI and keeps unknown progress indeterminate', () => {
    const markup = renderToStaticMarkup(React.createElement(OptimizationEncodingProgress, {
      status: 'Running', percent: null, phase: 'Encoding',
    }))
    expect(markup).toContain('aria-label="Optimization progress"')
    expect(markup).toContain('aria-label="Optimization progress" max="100"')
    expect(markup).not.toContain('value="0"')
    expect(markup).toContain('Not available')
  })

  it('maps backend decision states to concise user labels', () => {
    expect(optimizationDecisionLabel('already_optimized')).toBe('Up to date')
    expect(optimizationDecisionLabel('sample_required')).toBe('Review sample')
    expect(optimizationDecisionLabel('quality_threshold_unmet')).toBe('Quality threshold not met')
    expect(optimizationDecisionLabel('unexpected_backend_state')).toBe('Needs review')
    expect(optimizationCoverageLabel('complete')).toBe('Complete')
    expect(optimizationCoverageLabel('partial')).toBe('Partial')
    expect(optimizationCoverageLabel('insufficient')).toBe('Limited')
    expect(optimizationCoverageLabel('unexpected_coverage')).toBe('Unavailable')
  })

  it('renders a shared review row with a friendly status and unknown savings', () => {
    const markup = renderToStaticMarkup(React.createElement(OptimizationReviewItem, {
      item: { mediaItemId: 12, label: 'Example · S01E02', compatible: true, decisionStatus: 'sample_required', hdrFormat: 'SDR', sourceSize: 1000, sourceMtimeMs: 0, operations: [], estimatedSavingsBytes: null },
      targetSelected: true,
    }))
    expect(markup).toContain('Example · S01E02')
    expect(markup).toContain('Review sample')
    expect(markup).toContain('Estimated savings:')
    expect(markup).toContain('Not measured')
    expect(markup).not.toContain('sample_required')
  })

  it('shows the actual planned audio stream choices even for a blocked video measurement', () => {
    const markup = renderToStaticMarkup(React.createElement(OptimizationReviewItem, {
      item: {
        label: 'BLUE LOCK S01E01', compatible: false,
        reason: 'Encoded sample frame count differs from its source',
        sourceAnalysis: { audioTracks: [
          { index: 1, language: '日本語', codec: 'flac', channels: 2, isDefault: true, hasObjectAudio: false },
          { index: 2, language: 'English', codec: 'aac', channels: 2, isDefault: false, hasObjectAudio: false },
        ] },
        audioPlan: [{ index: 1, action: 'keep' }, { index: 2, action: 'remove' }],
      },
      targetSelected: false,
    }))
    expect(markup).toContain('Audio track decisions')
    expect(markup).toMatch(/Japanese.*?Keep/)
    expect(markup).toMatch(/English.*?Remove/)
    expect(markup).toContain('Proposed selections only; optimization is blocked.')
  })

  it('uses measured savings and space-freed labels for task results', () => {
    const markup = renderToStaticMarkup(React.createElement(OptimizationTaskResults, { tasks: [
      { id: 'task-1', type: 'transcode', label: 'Example.mkv', status: 'completed', createdAt: '2026-10-30T00:00:00Z', result: { encodedReductionBytes: 123, physicallyReclaimedBytes: 50 } },
      { id: 'task-2', type: 'transcode', label: 'Example-2.mkv', status: 'completed', createdAt: '2026-10-30T00:00:00Z', result: { encodedReductionBytes: 10, physicallyReclaimedBytes: 20 } },
    ] }))
    expect(markup).toContain('Measured savings')
    expect(markup).toContain('133 B')
    expect(markup).toContain('Space freed')
    expect(markup).toContain('70 B')
    expect(markup).not.toContain('Verified saving')
  })

  it('keeps aggregate savings unknown when a completed result lacks a measurement', () => {
    const markup = renderToStaticMarkup(React.createElement(OptimizationTaskResults, { tasks: [
      { id: 'task-1', type: 'transcode', label: 'Measured.mkv', status: 'completed', createdAt: '2026-10-30T00:00:00Z', result: { encodedReductionBytes: 100, physicallyReclaimedBytes: 25 } },
      { id: 'task-2', type: 'transcode', label: 'Unknown.mkv', status: 'completed', createdAt: '2026-10-30T00:00:00Z', result: { physicallyReclaimedBytes: 10 } },
    ] }))
    expect(markup).toContain('Measured savings</dt><dd>Not measured')
    expect(markup).toContain('Space freed</dt><dd>35 B')
  })

  it('keeps batch totals unknown when a completed task has no result object', () => {
    const markup = renderToStaticMarkup(React.createElement(OptimizationTaskResults, { tasks: [
      { id: 'task-1', type: 'transcode', label: 'Measured.mkv', status: 'completed', createdAt: '2026-10-30T00:00:00Z', result: { encodedReductionBytes: 100, physicallyReclaimedBytes: 25 } },
      { id: 'task-2', type: 'transcode', label: 'Missing result.mkv', status: 'completed', createdAt: '2026-10-30T00:00:00Z' },
    ] }))
    expect(markup).toContain('Measured savings</dt><dd>Not measured')
    expect(markup).toContain('Space freed</dt><dd>Not measured')
    expect(markup).toContain('Missing result.mkv')
  })

  it('shares concise completion and failure states', () => {
    const completed = renderToStaticMarkup(React.createElement(OptimizationTerminalState, {
      state: 'complete', itemLabel: 'Example.mkv', onClose: () => undefined,
    }))
    const failed = renderToStaticMarkup(React.createElement(OptimizationTerminalState, {
      state: 'failed', itemLabel: 'Example.mkv', error: 'Raw encoder diagnostic', onClose: () => undefined, onRetry: () => undefined,
    }))
    expect(completed).toContain('Optimization complete')
    expect(failed).toContain('Optimization failed')
    expect(failed).toContain('Retry optimization')
    expect(failed).toContain('<details')
    expect(failed).toContain('Error details')
  })
})
