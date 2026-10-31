import { useState, useEffect, useCallback, useRef, useMemo, type SetStateAction } from 'react'
import { createPortal } from 'react-dom'
import {
  Zap,
  Play,
  RefreshCw,
  AlertTriangle,
} from 'lucide-react'
import { useToast } from '@/contexts/ToastContext'
import { TaskType, type MediaItem } from '@main/types/database'
import type { PlaybackTargetProfile } from '@main/types/playbackTarget'
import type { OptimizationDecision } from '@main/services/OptimizationDecisionService'

import type { TranscodeOptions, TranscodingParams, Availability, TranscodeProgress, SavedShowPreflight } from './transcoding'
import { AdvancedTab, LiveEncodingTab, EncoderPolicySelector, OptimizationDialogShell, buildEffectiveOptimizationOptions } from './transcoding'
import type { TranscodingCapabilities } from '@main/services/TranscodingCapabilities'
import type { ShowOptimizationDiscovery } from './transcoding/types'
import { getHardwareEncoder } from '@main/services/TranscodingCapabilities'
import { formatLanguage, getOptimizationContainer, isSameLanguage, LANGUAGE_OPTIONS, parseLanguageWhitelist, toIso639_2 } from './mediaUtils'
import { SETTING_KEYS } from '@shared/settingKeys'
import { normalizeVideoCodec } from '@main/services/MediaNormalizer'
import { describeMissingOptimizationSettings, getMissingOptimizationSettings } from './transcoding/readiness'
import { SeriesOptimizationFlow, type SeriesOptimizationFlowProps } from './SeriesOptimizationFlow'
import { OptimizationReviewSummary } from './transcoding/OptimizationReviewSummary'
import { OptimizationResultsStage } from './transcoding/OptimizationResultsStage'
import { describeOptimizationScope, optimizationScopeForSeries } from './transcoding/OptimizationScope'
import { useOptimizationWorkflow } from './transcoding/useOptimizationWorkflow'
import { createInitialOptimizationConfiguration, optimizationAudioLanguageIsKnown, optimizationConfigurationToOptions, optimizationStreamSelection, optimizationTrackSummary, useOptimizationConfiguration } from './transcoding/optimizationConfiguration'
import { OptimizationSettingsLayout } from './transcoding/OptimizationSettingsLayout'
import { OptimizationReviewItem } from './transcoding/OptimizationReviewItem'
import { SubtitleLanguageSelection } from './transcoding/SubtitleLanguageSelection'
import { AudioTrackPolicySelection, type AudioLanguageOption, type AudioTrackPolicy } from './transcoding/AudioTrackPolicySelection'
import { OptimizationDialogFooter } from './transcoding/OptimizationDialogFooter'
import { loadOptimizationPreferences } from './transcoding/optimizationPreferences'
import { OptimizationContainerSelection } from './transcoding/OptimizationContainerSelection'
import { availableOptimizationDialogStages, optimizationDialogStage } from './transcoding/OptimizationStages'
import { optimizationAudioCodecOptions, optimizationContainerOptions } from './transcoding/optimizationOptions'
import { optimizationCandidateReasonLabel } from './transcoding/optimizationCandidateLabels'
import { formatOptimizationBytes } from './transcoding/optimizationResults'

interface MediaOptimizationFlowProps {
  scope: Extract<import('./transcoding/OptimizationScope').OptimizationScope, { kind: 'movie' | 'episode' }>
  initialPreflightId?: string
  onClose: () => void
  onOptimizationCompleted?: () => void
  initialOptimizationMode?: 'smart' | 'remux_only' | 'transcode'
  initialStreamPruning?: boolean
}

type SingleItemOptimizationRequest = {
  controller: 'media'
  scope: Extract<import('./transcoding/OptimizationScope').OptimizationScope, { kind: 'movie' | 'episode' }>
  onClose: () => void
  initialPreflightId?: string
  onOptimizationCompleted?: () => void
  initialOptimizationMode?: 'smart' | 'remux_only' | 'transcode'
  initialStreamPruning?: boolean
  series?: never
}

type SeriesOptimizationRequest = {
  controller: 'series'
  onClose: () => void
  series: Omit<SeriesOptimizationFlowProps, 'onClose' | 'scope'>
  initialPreflightId?: never
  onOptimizationCompleted?: never
  initialOptimizationMode?: never
  initialStreamPruning?: never
}

export type OptimizationDialogRequest = SingleItemOptimizationRequest | SeriesOptimizationRequest

export type SharedOptimizationDialogProps = { request: OptimizationDialogRequest }

export function SharedOptimizationDialog({ request }: SharedOptimizationDialogProps) {
  if (request.controller === 'series') return <SeriesOptimizationFlow {...request.series} scope={optimizationScopeForSeries(request.series.show, request.series.episode, request.series.seasonNumber)} onClose={request.onClose} />
  return <MediaOptimizationFlow scope={request.scope} onClose={request.onClose} initialPreflightId={request.initialPreflightId} onOptimizationCompleted={request.onOptimizationCompleted} initialOptimizationMode={request.initialOptimizationMode} initialStreamPruning={request.initialStreamPruning} />
}

function MediaOptimizationFlow({ scope, initialPreflightId, onClose, onOptimizationCompleted, initialOptimizationMode = 'smart', initialStreamPruning }: MediaOptimizationFlowProps) {
  const mediaId = scope.mediaId
  const scopeKey = describeOptimizationScope(scope)
  const { addToast } = useToast()
  const [media, setMedia] = useState<MediaItem | null>(null)
  const [optimizationDecision, setOptimizationDecision] = useState<OptimizationDecision | null>(null)
  const [optimizationDecisionError, setOptimizationDecisionError] = useState<string | null>(null)
  const [candidateDiscovery, setCandidateDiscovery] = useState<ShowOptimizationDiscovery | null>(null)
  const [candidateDiscoveryBusy, setCandidateDiscoveryBusy] = useState(false)
  const [candidateDiscoveryError, setCandidateDiscoveryError] = useState<string | null>(null)
  const [targetProfiles, setTargetProfiles] = useState<PlaybackTargetProfile[]>([])
  const { configuration, updateConfiguration, restoreConfiguration } = useOptimizationConfiguration(createInitialOptimizationConfiguration(initialOptimizationMode, {
    audioTrackPolicy: initialStreamPruning === false ? 'all' : 'original-and-protected',
    removeUnnecessaryStreams: initialStreamPruning !== false,
  }))
  const { targetProfileId, optimizationMode, outputMode, targetContainer, targetCodec, targetAudioCodec, originalAudioLanguage, audioTrackPolicy, subtitleLanguages, audioTranscodeEnabled, playbackPolicy } = configuration
  const [targetProfileError, setTargetProfileError] = useState<string | null>(null)
  const [availability, setAvailability] = useState<Availability | null>(null)
  const [capabilities, setCapabilities] = useState<TranscodingCapabilities | null>(null)
  const [loading, setLoading] = useState(true)
  const [params, setParams] = useState<TranscodingParams | null>(null)
  const [advancedSettingsOpen, setAdvancedSettingsOpen] = useState(false)
  const [trackSettingsOpen, setTrackSettingsOpen] = useState(false)
  const [analysisRequired, setAnalysisRequired] = useState(false)
  const [analyzingItem, setAnalyzingItem] = useState(false)
  const [outputModeSettingError, setOutputModeSettingError] = useState<string | null>(null)
  const completionReportedRef = useRef(false)
  const candidateDiscoveryStartedFor = useRef<number | null>(null)
  const handleQueueError = useCallback((error: unknown) => addToast({ title: 'Could not read optimization queue', message: error instanceof Error ? error.message : String(error), type: 'error' }), [addToast])
  const workflow = useOptimizationWorkflow(handleQueueError)
  const { queueState, stage, setStage, review: preflight, reviewedSampleGroups, batchId: submittedBatchId, submittedTaskIds, submittedMediaItemIds, queueControlState, batchSummary, reviewMatches, replaceReview, clearReview, submitBatch, toggleQueuePause: toggleWorkflowQueuePause, retryFailedTasks: retryWorkflowFailedTasks, setReviewedSampleGroups } = workflow
  const completedOptimizationTasks = queueState.completedTasks.filter(task => task.type === TaskType.Transcode && (task.batchId === submittedBatchId && Boolean(submittedBatchId) || submittedTaskIds.includes(task.id)))
  const activeTab = stage === 'review' ? 'review' : stage === 'results' ? 'monitor' : 'presets'
  const setActiveTab = useCallback((tab: 'presets' | 'advanced' | 'monitor' | 'review') => {
    if (tab === 'advanced') {
      setAdvancedSettingsOpen(true)
      setStage('options')
    } else if (tab === 'presets') {
      setAdvancedSettingsOpen(false)
      setStage('options')
    } else setStage(tab === 'review' ? 'review' : 'results')
  }, [setStage])
  const samplesReviewed = reviewedSampleGroups.includes('item-sample')
  const setSamplesReviewed = useCallback((reviewed: boolean) => setReviewedSampleGroups(reviewed ? ['item-sample'] : []), [setReviewedSampleGroups])

  const [options, setOptions] = useState<TranscodeOptions>(() => ({
    useGpu: false,
    gpuId: '',
    encoder: '',
    crf: undefined,
    preset: '',
    customArgs: '',
    transcodingEngine: 'ffmpeg',
    targetSize: '',
  }))

  const optionsForControls = useMemo(() => ({ ...options, ...optimizationConfigurationToOptions(configuration) }), [options, configuration])
  const updateTranscodeOptions = useCallback((update: SetStateAction<TranscodeOptions>) => {
    const next = typeof update === 'function' ? update(optionsForControls) : update
    const {
      optimizationMode: nextMode,
      targetProfileId: nextTargetProfileId,
      targetContainer: nextTargetContainer,
      targetContainerSelection: nextContainerSelection,
      outputMode: nextOutputMode,
      qualityProfile: nextQualityProfile,
      encoderPolicy: nextEncoderPolicy,
      targetCodec: nextTargetCodec,
      targetAudioCodec: nextTargetAudioCodec,
      targetHdrFormat: nextTargetHdrFormat,
      ...otherOptions
    } = next
    setOptions(otherOptions as TranscodeOptions)
    updateConfiguration({
      optimizationMode: nextMode ?? configuration.optimizationMode,
      targetProfileId: nextTargetProfileId ?? configuration.targetProfileId,
      targetContainer: nextTargetContainer ?? '',
      targetContainerSelection: nextContainerSelection ?? '',
      outputMode: nextOutputMode ?? '',
      qualityProfile: nextQualityProfile ?? '',
      encoderPolicy: nextEncoderPolicy ?? '',
      targetCodec: nextTargetCodec ?? '',
      targetAudioCodec: nextTargetAudioCodec ?? '',
      targetHdrFormat: nextTargetHdrFormat ?? '',
      audioTranscodeEnabled: nextTargetAudioCodec !== undefined ? Boolean(nextTargetAudioCodec) : configuration.audioTranscodeEnabled,
    })
  }, [optionsForControls, configuration, updateConfiguration])

  const [status, setStatus] = useState<'idle' | 'generating' | 'queued' | 'encoding' | 'complete' | 'failed'>('idle')
  const settingsDisabled = status === 'generating' || status === 'encoding' || status === 'queued'
  const [progress, setProgress] = useState<TranscodeProgress | null>(null)

  const failureReportedRef = useRef(false)
  const selectedGpu = capabilities?.gpus.find(gpu => gpu.id === options.gpuId)
  const hardwareEncoder = selectedGpu && targetCodec ? getHardwareEncoder(selectedGpu.vendor, targetCodec) : undefined
  const hardwareAvailable = Boolean(hardwareEncoder && selectedGpu && capabilities?.deviceEncoders[selectedGpu.id]?.includes(hardwareEncoder))
  const softwareEncoder = targetCodec === 'av1' ? 'svt_av1' : targetCodec === 'hevc' ? 'x265' : undefined
  const softwareAvailable = Boolean(softwareEncoder && capabilities?.deviceEncoders.software.includes(softwareEncoder))
  const targetProfile = targetProfiles.find(profile => profile.id === targetProfileId)
  const supportedTargetCodecs = (['hevc', 'av1'] as const).filter(codec => {
    const profileSupports = playbackPolicy === 'allow-transcoding' || !targetProfile || targetProfile.definition.video.codecs.some(value => normalizeVideoCodec(value) === normalizeVideoCodec(codec))
    const codecCapabilities = capabilities?.encodingMatrix.codecs.find(value => value.codec === codec)?.capabilities ?? []
    const deviceIndex = selectedGpu ? capabilities?.encodingMatrix.devices.findIndex(device => device.id === selectedGpu.id) : undefined
    const encoderSupports = configuration.encoderPolicy === 'software'
      ? Boolean(codecCapabilities[0])
      : configuration.encoderPolicy === 'hardware'
        ? deviceIndex !== undefined && deviceIndex >= 0 && Boolean(codecCapabilities[deviceIndex])
        : codecCapabilities.some(Boolean)
    return profileSupports && encoderSupports
  })
  const unsupportedTargetCodecReasons = Object.fromEntries((['hevc', 'av1'] as const)
    .filter(codec => !supportedTargetCodecs.includes(codec))
    .map(codec => {
      const label = codec === 'hevc' ? 'H.265' : 'AV1'
      if (targetProfile && !targetProfile.definition.video.codecs.some(value => normalizeVideoCodec(value) === normalizeVideoCodec(codec))) {
        return [codec, `Not supported by ${targetProfile.name}.`]
      }
      if (!capabilities) return [codec, 'Checking encoder support.']
      if (configuration.encoderPolicy === 'software') return [codec, `Software encoding for ${label} is unavailable.`]
      if (configuration.encoderPolicy === 'hardware') return [codec, selectedGpu ? `${selectedGpu.name} cannot encode ${label}.` : `Choose a GPU that supports ${label}.`]
      return [codec, `No compatible ${label} encoder is available.`]
    })) as Partial<Record<'hevc' | 'av1', string>>
  const originalAudioLanguageOptions = useMemo<AudioLanguageOption[]>(() => {
    const detected = (optimizationDecision?.trackRemoval.tracks ?? [])
      .map(track => track.language)
      .filter((language): language is string => Boolean(language))
      .map(language => ({ language, value: toIso639_2(language) || language }))
      .filter((item, index, items) => items.findIndex(candidate => candidate.value === item.value) === index)
    const selectedFromMetadata = originalAudioLanguage && !detected.some(item => item.value === originalAudioLanguage)
      ? [{ value: originalAudioLanguage, label: `${formatLanguage(originalAudioLanguage)} (${originalAudioLanguage}) · metadata`, group: 'Metadata' }]
      : []
    const inFile = detected.map(({ language, value }) => ({ value, label: `${formatLanguage(language)} (${value})`, group: 'In file' }))
    const otherLanguages = LANGUAGE_OPTIONS
      .filter(option => !detected.some(item => isSameLanguage(item.language, option.code)))
      .map(option => ({ value: option.code3, label: option.label.replace(`(${option.code})`, `(${option.code3})`), group: 'Other languages' }))
    return [...inFile, ...selectedFromMetadata, ...otherLanguages]
  }, [optimizationDecision, originalAudioLanguage])

  const selectEncoderPolicy = (encoderPolicy: TranscodeOptions['encoderPolicy']) => {
    updateConfiguration({ encoderPolicy: encoderPolicy ?? '' })
    const supportsSelectedCodec = (gpu: NonNullable<typeof capabilities>['gpus'][number]) => {
      const encoder = targetCodec ? getHardwareEncoder(gpu.vendor, targetCodec) : undefined
      return Boolean(encoder && capabilities?.deviceEncoders[gpu.id]?.includes(encoder))
    }
    const selectedHardware = capabilities?.gpus.find(gpu => gpu.vendor === 'Intel' && supportsSelectedCodec(gpu))
      ?? capabilities?.gpus.find(supportsSelectedCodec)
    setOptions(prev => ({
      ...prev,
      useGpu: encoderPolicy !== 'software',
      gpuId: encoderPolicy === 'software' ? '' : selectedHardware?.id ?? capabilities?.selectedGpuId ?? ''
    }))
  }

  const loadInitialData = useCallback(async () => {
    try {
      setLoading(true)
      const [item, capabilities, preferences] = await Promise.all([
        window.electronAPI.getMediaItem(mediaId),
        window.electronAPI.getCapabilities(),
        loadOptimizationPreferences(),
      ])
      const { targetProfiles, targetProfileId: configuredTargetProfileId } = preferences
      if (!initialPreflightId && preferences.outputModeError) setOutputModeSettingError(preferences.outputModeError)

      setTargetProfiles(targetProfiles)
      if (!initialPreflightId) updateConfiguration({ subtitleLanguages: preferences.subtitleWhitelist })
      if (!initialPreflightId) updateConfiguration({ targetProfileId: configuredTargetProfileId, ...(preferences.outputMode ? { outputMode: preferences.outputMode } : {}) })
      setTargetProfileError(!initialPreflightId ? preferences.targetProfileError : null)

      if (item) {
        const loadedMedia = item as MediaItem
        setMedia(loadedMedia)
        const loadedOriginalAudioLanguage = toIso639_2(loadedMedia.original_language) || loadedMedia.original_language || ''
        if (!initialPreflightId) updateConfiguration({ originalAudioLanguage: loadedOriginalAudioLanguage })
        const sourceContainer = getOptimizationContainer(loadedMedia.container)
        const configuredProfile = targetProfiles.find(profile => profile.id === configuredTargetProfileId)
        if (!initialPreflightId) updateConfiguration({ targetContainer: sourceContainer && (!configuredProfile || configuredProfile.definition.containers.includes(sourceContainer === 'mkv' ? 'matroska' : 'mp4')) ? sourceContainer : '' })
      }
      const avail = capabilities || { ffmpeg: false }
      setAvailability(avail)
      setCapabilities(capabilities)
      try {
        const decision = await window.electronAPI.optimizationGetDecision(mediaId) as OptimizationDecision
        const originalLanguage = decision.trackRemoval.originalLanguage
        if (originalLanguage) {
          updateConfiguration({ originalAudioLanguage: toIso639_2(originalLanguage) || originalLanguage })
          setMedia(current => current ? { ...current, original_language: originalLanguage } : current)
        }
        setOptimizationDecision(decision)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        setOptimizationDecisionError(message)
        console.error('Failed to load optimization savings:', error)
      }

      const defaultEngine = capabilities?.engines?.[0] || 'ffmpeg'
      const hardwareSupports = (gpu: NonNullable<typeof capabilities>['gpus'][number], codec: 'hevc' | 'av1') => {
        const encoder = getHardwareEncoder(gpu.vendor, codec)
        return Boolean(encoder && capabilities?.deviceEncoders[gpu.id]?.includes(encoder))
      }
      const codecIsSupported = (codec: NonNullable<typeof targetCodec>) => {
        const profile = targetProfiles.find(candidate => candidate.id === configuredTargetProfileId)
        const profileSupports = !profile || profile.definition.video.codecs.some(value => normalizeVideoCodec(value) === normalizeVideoCodec(codec))
        const matrix = capabilities?.encodingMatrix.codecs.find(value => value.codec === codec)?.capabilities ?? []
        return profileSupports && matrix.some(Boolean)
      }
      const preferredCodec = (['hevc', 'av1'] as const).find(codecIsSupported) ?? 'hevc'
      const selectedGpu = capabilities?.gpus?.find(gpu => gpu.vendor === 'Intel' && hardwareSupports(gpu, preferredCodec))
        ?? capabilities?.gpus?.find(gpu => gpu.id === capabilities.selectedGpuId && hardwareSupports(gpu, preferredCodec))
        ?? capabilities?.gpus?.find(gpu => hardwareSupports(gpu, preferredCodec))
      const selectedGpuId = selectedGpu?.id ?? ''
      if (!initialPreflightId) updateConfiguration({ targetCodec: preferredCodec })

      setOptions(prev => ({
        ...prev,
        transcodingEngine: defaultEngine,
        gpuId: selectedGpuId,
        useGpu: Boolean(selectedGpuId)
      }))
    } catch (err) {
      console.error('Failed to load transcode data:', err)
      addToast({ title: 'Failed to initialize transcoding subsystem', type: 'error' })
    } finally {
      setLoading(false)
    }
  }, [mediaId, addToast, initialPreflightId, updateConfiguration])

  useEffect(() => {
    queueMicrotask(() => { void loadInitialData() })
  }, [loadInitialData])

  useEffect(() => {
    if (!initialPreflightId) return
    let cancelled = false
    void window.electronAPI.getShowPreflight(initialPreflightId)
      .then((saved: SavedShowPreflight | undefined) => {
        if (cancelled) return
        if (!saved) throw new Error(`Saved optimization review ${initialPreflightId} was not found`)
        replaceReview(saved.result, saved.request.options)
        restoreConfiguration(saved.request.options)
        const savedOptions = { ...saved.request.options }
        delete savedOptions.streamSelection
        delete savedOptions.optimizationMode
        delete savedOptions.outputMode
        delete savedOptions.targetProfileId
        delete savedOptions.targetContainer
        delete savedOptions.targetContainerSelection
        delete savedOptions.qualityProfile
        delete savedOptions.encoderPolicy
        delete savedOptions.targetCodec
        delete savedOptions.targetAudioCodec
        delete savedOptions.targetHdrFormat
        setOptions(previous => ({ ...previous, ...savedOptions }))
        updateConfiguration({
          audioTrackPolicy: saved.request.options.streamSelection?.audio === 'original-and-protected' ? 'original-and-protected' : 'all',
          originalAudioLanguage: saved.request.options.streamSelection?.audio === 'original-and-protected' ? saved.request.options.streamSelection.originalLanguage : '',
          subtitleLanguages: saved.request.options.streamSelection?.subtitleLanguageWhitelist?.join(', ') ?? '',
        })
        submitBatch(saved.result.batchId, saved.result.queuedMediaItemIds ?? [], saved.result.queuedTaskIds ?? [])
        setStatus(saved.result.queuedAt ? 'queued' : 'idle')
        setActiveTab(saved.result.queuedAt ? 'monitor' : 'review')
      })
      .catch(error => {
        if (!cancelled) addToast({ title: 'Could not reopen optimization review', message: error instanceof Error ? error.message : String(error), type: 'error' })
      })
    return () => { cancelled = true }
  }, [initialPreflightId, addToast, replaceReview, submitBatch, setActiveTab, restoreConfiguration, updateConfiguration])

  useEffect(() => {
    const unsub = window.electronAPI.onProgress(p => {
      const activeTask = queueState.currentTask
      const belongsToSubmittedTask = Boolean(
        submittedBatchId && activeTask?.batchId === submittedBatchId && p.mediaItemId === mediaId &&
        (submittedTaskIds.length > 0 ? submittedTaskIds.includes(activeTask.id) : submittedMediaItemIds.includes(mediaId))
      )
      if (belongsToSubmittedTask) {
        setProgress(p)
        if (['encoding', 'muxing', 'verifying'].includes(p.status)) {
          setStatus('encoding')
          setActiveTab('monitor')
        }
        if (p.status === 'complete') {
          setActiveTab('monitor')
        }
        if (p.status === 'cancelled') {
          setProgress(null)
        }
        if (p.status === 'failed') {
          setStatus('failed')
          setActiveTab('monitor')
          if (!failureReportedRef.current) {
            failureReportedRef.current = true
            addToast({ title: `Transcode failed: ${p.error || 'Unknown error'}`, type: 'error' })
          }
        }
      }
    })
    return () => {
      if (typeof unsub === 'function') unsub()
    }
  }, [mediaId, addToast, queueState.currentTask, submittedBatchId, submittedTaskIds, submittedMediaItemIds, setActiveTab])

  const getEffectivePreflightOptions = useCallback(() => {
    return buildEffectiveOptimizationOptions({
      ...options,
      ...optimizationConfigurationToOptions(configuration),
      streamSelection: optimizationStreamSelection(configuration, configuration.removeUnnecessaryStreams),
    }, {
      targetProfileId,
      targetContainer: targetContainer || undefined,
      audioTranscodeEnabled,
      subtitleLanguageWhitelist: parseLanguageWhitelist(subtitleLanguages),
    })
  }, [options, configuration, targetProfileId, targetContainer, audioTranscodeEnabled, subtitleLanguages])
  const discoverCandidates = useCallback(async () => {
    if (!media?.source_id) {
      setCandidateDiscoveryError('This item has no source identity for candidate discovery.')
      return
    }
    setCandidateDiscoveryBusy(true)
    setCandidateDiscoveryError(null)
    try {
      const result = await window.electronAPI.discoverShowOptimization({
        requestId: crypto.randomUUID(),
        mediaItemId: media.id,
        sourceId: media.source_id,
        libraryId: media.library_id,
        options: getEffectivePreflightOptions(),
      })
      setCandidateDiscovery(result)
    } catch (error) {
      setCandidateDiscoveryError(error instanceof Error ? error.message : String(error))
    } finally {
      setCandidateDiscoveryBusy(false)
    }
  }, [media, getEffectivePreflightOptions])
  useEffect(() => {
    if (loading || initialPreflightId || !media?.id || candidateDiscoveryStartedFor.current === media.id) return
    candidateDiscoveryStartedFor.current = media.id
    void discoverCandidates()
  }, [loading, initialPreflightId, media?.id, discoverCandidates])
  const preflightMatchesCurrentSettings = reviewMatches(getEffectivePreflightOptions())

  useEffect(() => {
    if (!batchSummary) return
    if (batchSummary.outcome === 'completed') {
      setStatus('complete')
      setActiveTab('monitor')
      if (!completionReportedRef.current) {
        completionReportedRef.current = true
        onOptimizationCompleted?.()
      }
    } else if (['partly-completed', 'failed', 'cancelled'].includes(batchSummary.outcome)) {
      setStatus('failed')
      setActiveTab('monitor')
    }
  }, [batchSummary, onOptimizationCompleted, setActiveTab])
  const missingSettings = getMissingOptimizationSettings({
    outputModeSelected: Boolean(outputMode),
    videoTranscode: optimizationMode !== 'remux_only',
    videoCodecSelected: Boolean(targetCodec),
    videoCodecSupported: targetCodec ? supportedTargetCodecs.includes(targetCodec) : undefined,
    qualityProfileSelected: Boolean(configuration.qualityProfile),
    encoderPolicySelected: Boolean(configuration.encoderPolicy),
    audioTranscode: audioTranscodeEnabled,
    audioCodecSelected: Boolean(targetAudioCodec),
    streamPruning: audioTrackPolicy === 'original-and-protected',
    originalAudioLanguageSelected: optimizationAudioLanguageIsKnown(originalAudioLanguage),
  })

  useEffect(() => {
    if (preflight && !preflightMatchesCurrentSettings && samplesReviewed) setSamplesReviewed(false)
  }, [preflight, preflightMatchesCurrentSettings, samplesReviewed, setSamplesReviewed])

  const selectOutputMode = async (outputMode: NonNullable<TranscodeOptions['outputMode']>) => {
    try {
      await window.electronAPI.setSetting(SETTING_KEYS.transcoding_default_output_mode, outputMode)
      updateConfiguration({ outputMode })
      setOutputModeSettingError(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setOutputModeSettingError(`Could not save output choice: ${message}`)
    }
  }

  const loadEncodingSettings = async () => {
    if (!media?.file_path) return
    setStatus('generating')
    try {
      const nextParams = await window.electronAPI.getParameters(media.id!, { ...options, ...optimizationConfigurationToOptions(configuration) })
      setParams(nextParams)
      setOptions(previous => ({ ...previous, encoder: nextParams.encoder || previous.encoder, crf: nextParams.crf ?? previous.crf, preset: nextParams.preset || previous.preset }))
      setStatus('idle')
    } catch (error) {
      setStatus('idle')
      addToast({ title: 'Could not prepare encoding settings', message: error instanceof Error ? error.message : String(error), type: 'error' })
    }
  }

  const startTranscode = async () => {
    if (!media?.source_id || media.id === undefined) return
    failureReportedRef.current = false
    setStatus('generating')
    try {
      if (missingSettings.length) throw new Error(`Select ${missingSettings.join(', ')} to continue.`)
      if (!preflight || !preflightMatchesCurrentSettings) {
        const preflightOptions = getEffectivePreflightOptions()
        const result = await window.electronAPI.preflightShow({
          requestId: crypto.randomUUID(),
          mediaItemId: media.id,
          seriesIdentityKey: media.series_identity_key || undefined,
          sourceId: media.source_id,
          libraryId: media.library_id,
          options: preflightOptions
        }) as typeof preflight
        if (!result) throw new Error('Optimization review could not be created')
        replaceReview(result, preflightOptions)
        setSamplesReviewed(false)
        setStatus('idle')
        setActiveTab('review')
        return
      }
      const item = preflight.episodes.find(entry => entry.mediaItemId === media.id)
      if (!item?.compatible) throw new Error(item?.reason || 'This file has no safe optimization plan')
      if (item.decisionStatus === 'sample_required' && !samplesReviewed) throw new Error('Review the measured samples before queuing this transcode')
      if (item.decisionStatus === 'sample_required') await window.electronAPI.approveShow(preflight.preflightId)
      const queued = await window.electronAPI.queueShow(preflight.preflightId)
      submitBatch(queued.batchId, queued.queuedMediaItemIds, queued.queuedTaskIds)
      completionReportedRef.current = false
      setProgress(null)
      setStatus('queued')
      setActiveTab('monitor')
      addToast({ title: 'Optimization queued', type: 'success' })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      if (/persisted file analysis|analyze the item/i.test(message)) setAnalysisRequired(true)
      setStatus('idle')
      addToast({ title: `Optimization could not be queued: ${message}`, type: 'error' })
    }
  }

  const analyzeRequiredEvidence = async () => {
    if (!media?.file_path) return
    try {
      setAnalyzingItem(true)
      const analysis = await window.electronAPI.ffprobeAnalyzeFile(media.file_path)
      if (!analysis.success) throw new Error(analysis.error || 'File analysis failed')
      setAnalysisRequired(false)
      addToast({ title: 'Analysis complete. Refreshing optimization review…', type: 'success' })
      void startTranscode()
    } catch (error) {
      addToast({ title: `Analysis failed: ${error instanceof Error ? error.message : String(error)}`, type: 'error' })
    } finally {
      setAnalyzingItem(false)
    }
  }

  const cancelTranscode = async () => {
    try {
      await window.electronAPI.cancel(mediaId)
    } catch (err: unknown) {
      addToast({ title: `Cancellation failed: ${err instanceof Error ? err.message : String(err)}`, type: 'error' })
    }
  }

  const retryFailedTasks = async () => {
    await retryWorkflowFailedTasks(() => {
      completionReportedRef.current = false
      setStatus('queued')
      setProgress(null)
    }, error => addToast({ title: 'Could not retry optimization', message: error instanceof Error ? error.message : String(error), type: 'error' }))
  }

  const toggleQueuePause = async () => {
    await toggleWorkflowQueuePause((error, resuming) => {
      addToast({ title: `Could not ${resuming ? 'resume' : 'pause'} optimization`, message: error instanceof Error ? error.message : String(error), type: 'error' })
    })
  }

  if (loading) {
    return createPortal(
      <div className="fixed inset-0 z-250 flex items-center justify-center bg-black/60 backdrop-blur-sm">
        <RefreshCw className="w-8 h-8 animate-spin text-primary" />
      </div>,
      document.body
    )
  }

  if (!media) return null

  return <OptimizationDialogShell
    key={scopeKey}
    scope={scope}
    stage={optimizationDialogStage(activeTab === 'review', activeTab === 'monitor')}
    availableStages={availableOptimizationDialogStages(Boolean(preflight && preflightMatchesCurrentSettings), Boolean(batchSummary || progress || status !== 'idle'))}
    onStageChange={next => {
      if (next === 'Settings') setActiveTab('presets')
      else if (next === 'Review' && preflight && preflightMatchesCurrentSettings) setActiveTab('review')
      else if (next === 'Results' && (batchSummary || progress || status !== 'idle')) setActiveTab('monitor')
    }}
    title={media.type === 'movie' ? 'Optimize movie' : 'Optimize episode'}
    subtitle={media.type === 'episode' ? `${media.series_title ?? media.title} · S${String(media.season_number ?? '?').padStart(2, '0')}E${String(media.episode_number ?? '?').padStart(2, '0')}` : media.title}
    leading={<Zap className="h-5 w-5" />}
    onClose={onClose}
    wide
    footer={status !== 'encoding' && status !== 'queued' && status !== 'complete' ? <OptimizationDialogFooter
      leadingAction={{ label: 'Cancel', onClick: onClose }}
      secondaryAction={missingSettings.includes('original audio language')
        ? { label: 'Edit audio', onClick: () => setTrackSettingsOpen(true), variant: 'outline' }
        : analysisRequired ? { label: analyzingItem ? 'Analyzing…' : 'Analyze item', onClick: () => void analyzeRequiredEvidence(), disabled: analyzingItem, variant: 'outline' } : undefined}
      status={missingSettings.length > 0 ? describeMissingOptimizationSettings(missingSettings) : activeTab === 'review' && preflight?.episodes.some(item => !item.compatible) ? 'Review is blocked because one or more items have no compatible plan.' : undefined}
      primaryAction={{
        label: <><Play className="h-4 w-4 fill-current" />{status === 'generating' ? 'Preparing…' : preflightMatchesCurrentSettings ? 'Start optimization' : 'Prepare review'}</>,
        onClick: startTranscode,
        disabled: !availability?.ffmpeg || status === 'generating' || missingSettings.length > 0 || (activeTab === 'review' && preflight?.episodes.some(item => !item.compatible)),
      }}
    /> : undefined}
  >
        {/* Modal Body with Scroll */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 custom-scrollbar">
          {/* Availability Warnings */}
          {!availability?.ffmpeg && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 flex gap-4">
              <AlertTriangle className="w-5 h-5 text-red-400 shrink-0" />
              <div className="space-y-1">
                <p className="text-sm font-bold text-red-400">FFmpeg is unavailable</p>
                <p className="text-xs text-muted-foreground">Configure FFmpeg in Settings to optimize this file.</p>
              </div>
            </div>
          )}

          {optimizationDecisionError && (
            <div role="alert" className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
              <p>Could not estimate savings.</p>
              <details className="mt-1 text-xs"><summary className="cursor-pointer">Technical details</summary><p className="pt-1">{optimizationDecisionError}</p></details>
            </div>
          )}
          {activeTab === 'presets' && <section className="rounded-xl border border-border/50 p-3 space-y-2" aria-live="polite">
            <div className="flex items-center justify-between gap-3"><div><h3 className="text-sm font-semibold">Optimization candidates</h3><p className="text-xs text-muted-foreground">Metadata-only discovery uses the current track pruning policy. Savings are estimates.</p></div><button type="button" onClick={() => void discoverCandidates()} disabled={candidateDiscoveryBusy || settingsDisabled || !media?.id} className="rounded-lg border border-border px-3 py-1.5 text-xs disabled:opacity-50">{candidateDiscoveryBusy ? 'Scanning…' : candidateDiscovery ? 'Refresh' : 'Discover'}</button></div>
            {candidateDiscoveryError && <p role="alert" className="text-xs text-destructive">{candidateDiscoveryError}</p>}
            {candidateDiscovery && (candidateDiscovery.candidateCount === 0
              ? <p className="text-xs text-muted-foreground">No candidates found for this file and the current pruning policy.</p>
              : <ul className="list-disc space-y-1 pl-5 text-xs">{candidateDiscovery.groups.flatMap(group => group.mediaItemIds.map(id => <li key={`video:${id}`}>{group.mediaItemLabels[id]} · {(group.candidateReasonsByMediaItemId[id] ?? []).map(optimizationCandidateReasonLabel).join(' · ')} · {group.estimatedSavingsByMediaItemId[id] == null ? 'Not measured' : `${formatOptimizationBytes(group.estimatedSavingsByMediaItemId[id]!)} estimated savings`}</li>))}{candidateDiscovery.otherOperationCandidates.map(candidate => <li key={`other:${candidate.mediaItemId}`}>{candidate.label} · {candidate.candidateReasons.map(optimizationCandidateReasonLabel).join(' · ')} · {candidate.estimatedSavingsBytes == null ? 'Not measured' : `${formatOptimizationBytes(candidate.estimatedSavingsBytes)} estimated savings`}</li>)}</ul>)}
          </section>}
          {outputModeSettingError && <p role="alert" className="text-sm text-destructive">{outputModeSettingError}</p>}
          {activeTab !== 'review' && activeTab !== 'monitor' && <OptimizationSettingsLayout profiles={targetProfiles} targetProfileId={targetProfileId} targetError={targetProfileError} qualityProfile={configuration.qualityProfile} targetCodec={targetCodec} supportedTargetCodecs={supportedTargetCodecs} unsupportedTargetCodecReasons={unsupportedTargetCodecReasons} videoRequired={optimizationMode !== 'remux_only'} playbackPolicy={playbackPolicy} onPlaybackPolicyChange={value => updateConfiguration({ playbackPolicy: value })} trackSummary={optimizationTrackSummary(configuration)} trackSettingsOpen={trackSettingsOpen} onTrackSettingsOpenChange={setTrackSettingsOpen} encodingSummary={`${configuration.encoderPolicy === 'software' ? 'Software' : selectedGpu?.name ?? 'Automatic encoder'} · ${targetCodec === 'hevc' ? 'H.265' : targetCodec.toUpperCase()} · ${targetContainer?.toUpperCase() || 'Automatic container'}`} advancedSettingsOpen={advancedSettingsOpen} onAdvancedSettingsOpenChange={setAdvancedSettingsOpen} disabled={settingsDisabled} onQualityProfileChange={qualityProfile => updateConfiguration({ qualityProfile })} onTargetCodecChange={targetCodec => updateConfiguration({ targetCodec })} audioConversion={{ enabled: audioTranscodeEnabled, codec: targetAudioCodec, sourceCodec: media.audio_codec, options: optimizationAudioCodecOptions(targetProfile?.definition.audio.codecs), onEnabledChange: enabled => updateConfiguration({ audioTranscodeEnabled: enabled, ...(!enabled ? { targetAudioCodec: '' } : {}) }), onCodecChange: codec => updateConfiguration({ targetAudioCodec: codec }) }} onTargetProfileChange={profileId => {
                updateConfiguration({ targetProfileId: profileId })
                const profile = targetProfiles.find(candidate => candidate.id === profileId)
                const sourceContainer = getOptimizationContainer(media?.container)
                updateConfiguration({ targetContainer: sourceContainer && profile?.definition.containers.includes(sourceContainer === 'mkv' ? 'matroska' : 'mp4') ? sourceContainer : '' })
                updateConfiguration({ targetCodec: targetCodec && (playbackPolicy === 'allow-transcoding' || !profile || profile.definition.video.codecs.some(codec => normalizeVideoCodec(codec) === normalizeVideoCodec(targetCodec))) ? targetCodec : '' })
                setTargetProfileError(null)
              }} optimizationMode={optimizationMode} onOptimizationModeChange={nextMode => updateConfiguration({ optimizationMode: nextMode })} outputMode={outputMode || undefined} onOutputModeChange={mode => { void selectOutputMode(mode) }}
            playbackOptions={activeTab === 'presets' ? <div className="space-y-2">
              <SubtitleLanguageSelection value={subtitleLanguages} onChange={value => updateConfiguration({ subtitleLanguages: value })} disabled={settingsDisabled} />
              <AudioTrackPolicySelection
                policy={audioTrackPolicy === 'original-and-protected' ? 'preferred' : 'all'}
                language={originalAudioLanguage}
                languages={originalAudioLanguageOptions}
                disabled={settingsDisabled}
                onPolicyChange={(policy: AudioTrackPolicy) => updateConfiguration({ audioTrackPolicy: policy === 'preferred' ? 'original-and-protected' : 'all' })}
                onLanguageChange={language => updateConfiguration({ originalAudioLanguage: language })}
              />
            </div> : undefined}
            outputOptions={activeTab === 'presets' && targetProfileId ? <OptimizationContainerSelection
              value={targetContainer}
              placeholder={targetContainer ? undefined : 'Select a supported container'}
              options={optimizationContainerOptions(targetProfiles.find(profile => profile.id === targetProfileId)?.definition.containers)}
              disabled={settingsDisabled}
              onChange={value => updateConfiguration({ targetContainer: value as typeof targetContainer })}
            /> : undefined}
            advancedOptions={activeTab === 'presets' ? <div className="space-y-3">
              <EncoderPolicySelector value={configuration.encoderPolicy} hardwareAvailable={hardwareAvailable} softwareAvailable={softwareAvailable} onChange={selectEncoderPolicy} disabled={settingsDisabled} />
              <button type="button" onClick={() => void loadEncodingSettings()} disabled={status === 'generating'} className="rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-50">{status === 'generating' ? 'Preparing…' : 'Prepare encoding settings'}</button>
              <AdvancedTab options={optionsForControls} setOptions={updateTranscodeOptions} params={params} availability={availability} />
            </div> : undefined}
          />}

          {activeTab === 'monitor' && <OptimizationResultsStage summary={batchSummary} queuePaused={queueState.isPaused} waitingCount={queueState.queue.filter(task => task.batchId === submittedBatchId).length} queueControlState={queueControlState} tasks={completedOptimizationTasks} onTogglePause={() => void toggleQueuePause()} onRetry={() => void retryFailedTasks()} onOpenQueue={() => window.dispatchEvent(new Event('taskQueue:open'))}>
            {status !== 'queued' && (progress || status === 'complete' || status === 'failed') && !((status === 'complete' || status === 'failed') && completedOptimizationTasks.length > 0) && <LiveEncodingTab status={status} progress={progress} params={params} mediaTitle={media.title} onCancel={cancelTranscode} onStart={startTranscode} onClose={onClose} />}
          </OptimizationResultsStage>}

          {activeTab === 'review' && preflight && (
            <OptimizationReviewSummary estimatedSavingsBytes={preflight.estimatedSavingsBytes} coverage={preflight.savingsCoverage ?? 'insufficient'}>
              {preflight.episodes.map(item => <OptimizationReviewItem key={item.mediaItemId} item={item} targetSelected={Boolean(targetProfileId)} onOpenSample={index => { void window.electronAPI.openShowSample(preflight.preflightId, item.mediaItemId, index).catch(error => addToast({ title: 'Could not open measured sample', message: error instanceof Error ? error.message : String(error), type: 'error' })) }} />)}
              {optimizationDecision?.trackRemoval.tracks.length ? <details className="text-xs"><summary className="cursor-pointer font-medium">Audio track decisions</summary><ul className="space-y-1 pt-2">{optimizationDecision.trackRemoval.tracks.map(track => <li key={track.index} className="flex justify-between gap-3"><span>{track.language || 'Unknown'}{track.title ? ` · ${track.title}` : ''} · {track.codec} · {track.channelLayout || `${track.channels}ch`}</span><span>{optimizationDecision.trackRemoval.retainedTrackIndexes.includes(track.index) ? 'Keep' : optimizationDecision.trackRemoval.removableTrackIndexes.includes(track.index) ? 'Remove' : 'Review'}</span></li>)}</ul></details> : null}
              {audioTrackPolicy === 'original-and-protected' && <p className="text-muted-foreground">This plan keeps original-language and protected audio tracks, removing other audio tracks.</p>}
              {audioTranscodeEnabled && targetAudioCodec && <p className="text-muted-foreground">Eligible retained audio tracks will be converted to {targetAudioCodec.toUpperCase()}.</p>}
              {preflight.episodes.some(item => item.decisionStatus === 'sample_required') && <label className="flex gap-2 text-sm"><input type="checkbox" checked={samplesReviewed} onChange={event => setSamplesReviewed(event.target.checked)} /> I reviewed and approve the measured sample</label>}
            </OptimizationReviewSummary>
          )}
          {analysisRequired && <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 space-y-2 text-sm">
            <p className="font-semibold text-amber-200">Analyze this file before optimizing.</p>
            {analyzingItem ? <p>Analyzing…</p> : <button className="underline" onClick={() => { clearReview(); setAnalysisRequired(false); void startTranscode() }}>Analyze and refresh review</button>}
          </div>}
        </div>

  </OptimizationDialogShell>
}
