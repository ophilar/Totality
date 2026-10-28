import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  Zap,
  Sliders,
  Activity,
  Play,
  RefreshCw,
  AlertTriangle,
  Sparkles
} from 'lucide-react'
import { useToast } from '@/contexts/ToastContext'
import type { MediaItem } from '@main/types/database'
import type { PlaybackTargetProfile } from '@main/types/playbackTarget'
import { PlaybackCompatibilityFindings } from './PlaybackCompatibilityPanel'
import type { OptimizationDecision } from '@main/services/OptimizationDecisionService'

import type { TranscodeOptions, TranscodingParams, Availability, TranscodeProgress, SavedShowPreflight } from './transcoding'
import { QuickPresetsTab, AdvancedTab, LiveEncodingTab, EncoderPolicySelector, OutputHandlingSelection, OptimizationDialogShell, buildEffectiveOptimizationOptions } from './transcoding'
import { EstimatedSavingsDisplay } from './EstimatedSavingsDisplay'
import type { TranscodingCapabilities } from '@main/services/TranscodingCapabilities'
import { getHardwareEncoder } from '@main/services/TranscodingCapabilities'
import { formatLanguage, getOptimizationContainer, isSameLanguage, LANGUAGE_OPTIONS, parseLanguageWhitelist, toIso639_2 } from './mediaUtils'
import { SETTING_KEYS } from '@shared/settingKeys'
import { normalizeAudioCodec, normalizeVideoCodec } from '@main/services/MediaNormalizer'
import { getMissingOptimizationSettings } from './transcoding/readiness'
import { SeriesOptimizationFlow, type SeriesOptimizationFlowProps } from './SeriesOptimizationFlow'
import { useOptimizationWorkflow } from './transcoding/useOptimizationWorkflow'

interface MediaOptimizationFlowProps {
  mediaId: number
  show?: never
  episode?: never
  seasonNumber?: never
  initialPreflight?: never
  resumeRequestId?: never
  initialPreflightId?: string
  onClose: () => void
  onOptimizationCompleted?: () => void
  initialOptimizationMode?: 'remux_only' | 'transcode'
  initialStreamPruning?: boolean
}

export type TranscodeModalProps = MediaOptimizationFlowProps | SeriesOptimizationFlowProps

export function TranscodeModal(props: TranscodeModalProps) {
  if (props.show !== undefined) return <SeriesOptimizationFlow {...props} />
  return <MediaOptimizationFlow {...props} />
}

function MediaOptimizationFlow({ mediaId, initialPreflightId, onClose, onOptimizationCompleted, initialOptimizationMode = 'transcode', initialStreamPruning = false }: MediaOptimizationFlowProps) {
  const { addToast } = useToast()
  const [media, setMedia] = useState<MediaItem | null>(null)
  const [optimizationDecision, setOptimizationDecision] = useState<OptimizationDecision | null>(null)
  const [optimizationDecisionError, setOptimizationDecisionError] = useState<string | null>(null)
  const [targetProfiles, setTargetProfiles] = useState<PlaybackTargetProfile[]>([])
  const [targetProfileId, setTargetProfileId] = useState('')
  const [targetProfileError, setTargetProfileError] = useState<string | null>(null)
  const [targetContainer, setTargetContainer] = useState<'mkv' | 'mp4' | ''>('')
  const [originalAudioLanguage, setOriginalAudioLanguage] = useState('')
  const [availability, setAvailability] = useState<Availability | null>(null)
  const [capabilities, setCapabilities] = useState<TranscodingCapabilities | null>(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [params, setParams] = useState<TranscodingParams | null>(null)
  const [optionsTab, setOptionsTab] = useState<'presets' | 'advanced'>('presets')
  const [audioTranscodeEnabled, setAudioTranscodeEnabled] = useState(false)
  const [subtitleWhitelist, setSubtitleWhitelist] = useState('')
  const [analysisRequired, setAnalysisRequired] = useState(false)
  const [analyzingItem, setAnalyzingItem] = useState(false)
  const [outputModeSettingError, setOutputModeSettingError] = useState<string | null>(null)
  const completionReportedRef = useRef(false)
  const handleQueueError = useCallback((error: unknown) => addToast({ title: 'Could not read optimization queue', message: error instanceof Error ? error.message : String(error), type: 'error' }), [addToast])
  const workflow = useOptimizationWorkflow(handleQueueError)
  const { queueState, stage, setStage, review: preflight, reviewedSampleGroups, batchId: submittedBatchId, submittedTaskIds, submittedMediaItemIds, queueControlState, batchSummary, reviewMatches, replaceReview, clearReview, submitBatch, toggleQueuePause: toggleWorkflowQueuePause, retryFailedTasks: retryWorkflowFailedTasks, setReviewedSampleGroups } = workflow
  const activeTab = stage === 'review' ? 'review' : stage === 'results' ? 'monitor' : optionsTab
  const setActiveTab = useCallback((tab: 'presets' | 'advanced' | 'monitor' | 'review') => {
    if (tab === 'presets' || tab === 'advanced') {
      setOptionsTab(tab)
      setStage('options')
    } else setStage(tab === 'review' ? 'review' : 'results')
  }, [setOptionsTab, setStage])
  const samplesReviewed = reviewedSampleGroups.includes('item-sample')
  const setSamplesReviewed = useCallback((reviewed: boolean) => setReviewedSampleGroups(reviewed ? ['item-sample'] : []), [setReviewedSampleGroups])

  const [options, setOptions] = useState<TranscodeOptions>(() => ({
    targetCodec: undefined,
    useGpu: false,
    gpuId: '',
    encoder: '',
    crf: undefined,
    preset: '',
    customArgs: '',
    transcodingEngine: 'ffmpeg',
    targetSize: '',
    qualityProfile: undefined,
    encoderPolicy: undefined,
    optimizationMode: initialOptimizationMode
  }))

  const [status, setStatus] = useState<'idle' | 'generating' | 'queued' | 'encoding' | 'complete' | 'failed'>('idle')
  const [progress, setProgress] = useState<TranscodeProgress | null>(null)

  const failureReportedRef = useRef(false)
  const selectedGpu = capabilities?.gpus.find(gpu => gpu.id === options.gpuId)
  const hardwareEncoder = selectedGpu && options.targetCodec ? getHardwareEncoder(selectedGpu.vendor, options.targetCodec) : undefined
  const hardwareAvailable = Boolean(hardwareEncoder && selectedGpu && capabilities?.deviceEncoders[selectedGpu.id]?.includes(hardwareEncoder))
  const softwareEncoder = options.targetCodec === 'av1' ? 'svt_av1' : options.targetCodec === 'hevc' ? 'x265' : undefined
  const softwareAvailable = Boolean(softwareEncoder && capabilities?.deviceEncoders.software.includes(softwareEncoder))
  const targetProfile = targetProfiles.find(profile => profile.id === targetProfileId)
  const supportedTargetCodecs = (['hevc', 'av1'] as const).filter(codec => {
    const profileSupports = !targetProfile || targetProfile.definition.video.codecs.some(value => normalizeVideoCodec(value) === normalizeVideoCodec(codec))
    const codecCapabilities = capabilities?.encodingMatrix.codecs.find(value => value.codec === codec)?.capabilities ?? []
    const deviceIndex = selectedGpu ? capabilities?.encodingMatrix.devices.findIndex(device => device.id === selectedGpu.id) : undefined
    const encoderSupports = options.encoderPolicy === 'software'
      ? Boolean(codecCapabilities[0])
      : options.encoderPolicy === 'hardware'
        ? deviceIndex !== undefined && deviceIndex >= 0 && Boolean(codecCapabilities[deviceIndex])
        : codecCapabilities.some(Boolean)
    return profileSupports && encoderSupports
  })
  const recommendedAudioCodec = targetProfile && media?.audio_codec
    && media.audio_channels <= targetProfile.definition.audio.maxChannels
    && (!media.has_object_audio || targetProfile.definition.audio.objectAudio)
    && !targetProfile.definition.audio.codecs.some(codec => normalizeAudioCodec(codec) === normalizeAudioCodec(media.audio_codec))
    ? (['eac3', 'ac3', 'aac'] as const).find(codec =>
      (media.audio_channels >= 6 ? codec !== 'aac' : codec === 'aac')
      && targetProfile.definition.audio.codecs.some(supportedCodec => normalizeAudioCodec(supportedCodec) === normalizeAudioCodec(codec))
    )
    : undefined

  const selectEncoderPolicy = (encoderPolicy: TranscodeOptions['encoderPolicy']) => {
    setOptions(prev => ({
      ...prev,
      encoderPolicy,
      useGpu: encoderPolicy === 'hardware' || encoderPolicy === 'compare',
      gpuId: encoderPolicy === 'hardware' || encoderPolicy === 'compare' ? capabilities?.selectedGpuId ?? '' : ''
    }))
  }

  const loadInitialData = useCallback(async () => {
    try {
      setLoading(true)
      const [item, capabilities, targetProfiles, configuredTargetProfileId, configuredSubtitleLanguages, configuredOutputMode] = await Promise.all([
        window.electronAPI.getMediaItem(mediaId),
        window.electronAPI.getCapabilities(),
        window.electronAPI.listPlaybackTargetProfiles(),
        window.electronAPI.getSetting('optimization_default_target_profile_id'),
        window.electronAPI.getSetting(SETTING_KEYS.subtitle_preferred_languages),
        window.electronAPI.getSetting(SETTING_KEYS.transcoding_default_output_mode),
      ])
      const outputMode = ['copy', 'quarantine-replace', 'replace'].includes(configuredOutputMode ?? '')
        ? configuredOutputMode as NonNullable<TranscodeOptions['outputMode']>
        : undefined
      if (configuredOutputMode && !outputMode) setOutputModeSettingError('Saved output handling is unsupported. Choose a valid option before preparing a review.')

      setTargetProfiles(targetProfiles)
      setSubtitleWhitelist(configuredSubtitleLanguages || '')
      setTargetProfileId(configuredTargetProfileId || '')
      setTargetProfileError(configuredTargetProfileId && !targetProfiles.some(profile => profile.id === configuredTargetProfileId)
        ? `Configured playback target ${configuredTargetProfileId} was not found. Choose another target or select no playback target.`
        : null)

      if (item) {
        const loadedMedia = item as MediaItem
        setMedia(loadedMedia)
        const loadedOriginalAudioLanguage = toIso639_2(loadedMedia.original_language) || loadedMedia.original_language || ''
        setOriginalAudioLanguage(loadedOriginalAudioLanguage)
        const sourceContainer = getOptimizationContainer(loadedMedia.container)
        const configuredProfile = targetProfiles.find(profile => profile.id === configuredTargetProfileId)
        setTargetContainer(sourceContainer && (!configuredProfile || configuredProfile.definition.containers.includes(sourceContainer === 'mkv' ? 'matroska' : 'mp4')) ? sourceContainer : '')
        if (initialStreamPruning && loadedMedia.original_language) {
          setOptions(prev => ({
            ...prev,
            streamSelection: {
              audio: 'original-and-protected',
              originalLanguage: loadedOriginalAudioLanguage,
              subtitle: 'all'
            }
          }))
        }
      }
      const avail = capabilities || { ffmpeg: false }
      setAvailability(avail)
      setCapabilities(capabilities)
      try {
        const decision = await window.electronAPI.optimizationGetDecision(mediaId) as OptimizationDecision
        const originalLanguage = decision.trackRemoval.originalLanguage
        if (originalLanguage) {
          setOriginalAudioLanguage(toIso639_2(originalLanguage) || originalLanguage)
          setMedia(current => current ? { ...current, original_language: originalLanguage } : current)
          if (initialStreamPruning) {
            setOptions(current => ({
              ...current,
              streamSelection: {
                audio: 'original-and-protected',
                originalLanguage,
                subtitle: 'all'
              }
            }))
          }
        }
        setOptimizationDecision(decision)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        setOptimizationDecisionError(message)
        console.error('Failed to load optimization savings:', error)
      }

      const defaultEngine = capabilities?.engines?.[0] || 'ffmpeg'
      const selectedGpuId = capabilities?.gpus?.some(gpu => gpu.id === capabilities.selectedGpuId)
        ? capabilities.selectedGpuId
        : ''

      setOptions(prev => ({
        ...prev,
        outputMode,
        transcodingEngine: defaultEngine,
        gpuId: selectedGpuId || '',
        useGpu: false
      }))
    } catch (err) {
      console.error('Failed to load transcode data:', err)
      addToast({ title: 'Failed to initialize transcoding subsystem', type: 'error' })
    } finally {
      setLoading(false)
    }
  }, [mediaId, addToast, initialStreamPruning])

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
        setOptions(previous => ({ ...previous, ...saved.request.options }))
        setTargetProfileId(saved.request.options.targetProfileId ?? '')
        setTargetContainer(saved.request.options.targetContainer ?? '')
        setAudioTranscodeEnabled(Boolean(saved.request.options.targetAudioCodec))
        setSubtitleWhitelist(saved.request.options.streamSelection?.subtitleLanguageWhitelist?.join(', ') ?? '')
        if (saved.request.options.streamSelection?.audio === 'original-and-protected') setOriginalAudioLanguage(saved.request.options.streamSelection.originalLanguage)
        submitBatch(saved.result.batchId, saved.result.queuedMediaItemIds ?? [], saved.result.queuedTaskIds ?? [])
        setStatus(saved.result.queuedAt ? 'queued' : 'idle')
        setActiveTab(saved.result.queuedAt ? 'monitor' : 'review')
      })
      .catch(error => {
        if (!cancelled) addToast({ title: 'Could not reopen optimization review', message: error instanceof Error ? error.message : String(error), type: 'error' })
      })
    return () => { cancelled = true }
  }, [initialPreflightId, addToast, replaceReview, submitBatch, setActiveTab])

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

  const getEffectivePreflightOptions = () => {
    return buildEffectiveOptimizationOptions(options, {
      targetProfileId,
      targetContainer: targetContainer || undefined,
      audioTranscodeEnabled,
      subtitleLanguageWhitelist: parseLanguageWhitelist(subtitleWhitelist),
    })
  }
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
    outputModeSelected: Boolean(options.outputMode),
    videoTranscode: options.optimizationMode !== 'remux_only',
    videoCodecSelected: Boolean(options.targetCodec),
    videoCodecSupported: options.targetCodec ? supportedTargetCodecs.includes(options.targetCodec) : undefined,
    qualityProfileSelected: Boolean(options.qualityProfile),
    encoderPolicySelected: Boolean(options.encoderPolicy),
    audioTranscode: audioTranscodeEnabled,
    audioCodecSelected: Boolean(options.targetAudioCodec),
    streamPruning: options.streamSelection?.audio === 'original-and-protected',
    originalAudioLanguageSelected: Boolean(originalAudioLanguage.trim()),
  })

  useEffect(() => {
    if (preflight && !preflightMatchesCurrentSettings && samplesReviewed) setSamplesReviewed(false)
  }, [preflight, preflightMatchesCurrentSettings, samplesReviewed, setSamplesReviewed])

  const generateParams = async () => {
    if (!media || !media.file_path) return
    setGenerating(true)
    setStatus('generating')
    try {
        const p = await window.electronAPI.getParameters(media.id!, options)
      setParams(p)

      setOptions(prev => ({
        ...prev,
        encoder: p.encoder || prev.encoder,
        crf: p.crf !== undefined ? p.crf : prev.crf,
        preset: p.preset || prev.preset
      }))

      setStatus('idle')
      addToast({ title: 'AI Transcoding parameters updated', type: 'info' })
    } catch (err: unknown) {
      addToast({ title: `AI parameter generation failed: ${err instanceof Error ? err.message : String(err)}`, type: 'error' })
      setStatus('idle')
    } finally {
      setGenerating(false)
    }
  }

  const selectOutputMode = async (outputMode: NonNullable<TranscodeOptions['outputMode']>) => {
    try {
      await window.electronAPI.setSetting(SETTING_KEYS.transcoding_default_output_mode, outputMode)
      setOptions(prev => ({ ...prev, outputMode }))
      setOutputModeSettingError(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setOutputModeSettingError(`Could not save output handling: ${message}`)
    }
  }

  const startTranscode = async () => {
    if (!media?.source_id || media.id === undefined) return
    failureReportedRef.current = false
    setStatus('generating')
    try {
      if (missingSettings.length) throw new Error(`Choose ${missingSettings.join(', ')} before preparing this optimization.`)
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
    title={media.type === 'movie' ? 'Optimize movie' : 'Optimize episode'}
    subtitle={media.type === 'episode' ? `${media.series_title ?? media.title} · Season ${media.season_number ?? '?'} · Episode ${media.episode_number ?? '?'} · 1 item` : `${media.title} · 1 item`}
    leading={<Zap className="h-5 w-5" />}
    onClose={onClose}
    wide
    footer={status !== 'encoding' && status !== 'queued' && status !== 'complete' ? (
          <div className="flex flex-col items-stretch justify-between gap-3 sm:flex-row sm:items-center">
            <button onClick={onClose} className="rounded-xl bg-muted px-6 py-2.5 text-xs font-bold transition-all hover:bg-muted/80">Cancel</button>
            <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:gap-3">
              {analysisRequired && <button onClick={() => void analyzeRequiredEvidence()} disabled={analyzingItem} className="rounded-xl border border-border px-5 py-2.5 text-xs font-bold disabled:opacity-50">{analyzingItem ? 'Analyzing…' : 'Analyze item'}</button>}
              <button onClick={generateParams} disabled={generating || !availability?.ffmpeg || (options.optimizationMode !== 'remux_only' && (!options.targetCodec || !options.qualityProfile || !options.encoderPolicy))} className="flex items-center gap-2 rounded-xl bg-muted/60 px-5 py-2.5 text-xs font-bold transition-all hover:bg-muted disabled:opacity-50">
                {generating ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4 text-primary" />}
                Generate encoding settings
              </button>
              <button onClick={startTranscode} disabled={!availability?.ffmpeg || status === 'generating' || missingSettings.length > 0 || (activeTab === 'review' && preflight?.episodes.some(item => !item.compatible))} className="flex items-center gap-2 rounded-xl bg-primary px-7 py-2.5 text-xs font-black text-primary-foreground shadow-lg shadow-primary/20 transition-all hover:opacity-90 disabled:opacity-50">
                <Play className="h-4 w-4 fill-current" />
                {status === 'generating' ? 'Preparing…' : preflightMatchesCurrentSettings ? 'Queue optimization' : 'Prepare review'}
              </button>
            </div>
          </div>
    ) : undefined}
  >
        {/* 3-Tab Wizard Header */}
        <div className="flex border-b border-border/20 bg-muted/30 px-3 sm:px-6 pt-2 sm:pt-3 gap-1 sm:gap-2 overflow-x-auto">
          <button
            onClick={() => setActiveTab('presets')}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-t-xl transition-all border-b-2 ${
              activeTab === 'presets'
                ? 'bg-card text-primary border-primary shadow-xs'
                : 'text-muted-foreground hover:text-foreground border-transparent'
            }`}
          >
            <Zap className="w-4 h-4" />
            Quick Presets
          </button>

          <button
            onClick={() => setActiveTab('advanced')}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-t-xl transition-all border-b-2 ${
              activeTab === 'advanced'
                ? 'bg-card text-primary border-primary shadow-xs'
                : 'text-muted-foreground hover:text-foreground border-transparent'
            }`}
          >
            <Sliders className="w-4 h-4" />
            Advanced Settings
          </button>

          <button
            onClick={() => setActiveTab('monitor')}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-t-xl transition-all border-b-2 relative ${
              activeTab === 'monitor'
                ? 'bg-card text-primary border-primary shadow-xs'
                : 'text-muted-foreground hover:text-foreground border-transparent'
            }`}
          >
            <Activity className="w-4 h-4" />
            Encoding Monitor
            {status === 'encoding' && (
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping absolute top-2 right-2" />
            )}
          </button>
        </div>

        {/* Modal Body with Scroll */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 custom-scrollbar">
          {/* Availability Warnings */}
          {!availability?.ffmpeg && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 flex gap-4">
              <AlertTriangle className="w-5 h-5 text-red-400 shrink-0" />
              <div className="space-y-1">
                <p className="text-sm font-bold text-red-400">No Transcoding Engines Available</p>
                <p className="text-xs text-muted-foreground">
                  FFmpeg was not detected on your system. Please install or configure it in Settings.
                </p>
              </div>
            </div>
          )}

          {optimizationDecision && (
            <section className="space-y-2 rounded-xl border border-border/40 bg-muted/20 p-4" aria-label="Estimated optimization savings">
              <h4 className="text-sm font-semibold">Estimated before sampling</h4>
              {([
                ['Remove audio tracks', optimizationDecision.trackRemoval],
                ['Transcode video', optimizationDecision.videoTranscode]
              ] as const).map(([label, mechanism]) => (
                <div key={label} className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 border-t border-border/30 pt-2 text-sm first:border-t-0 first:pt-0">
                  <span className="text-muted-foreground">{label}{label === 'Transcode video' && optimizationDecision.videoTranscode.assumedTargetCodec ? ` to ${optimizationDecision.videoTranscode.assumedTargetCodec.toUpperCase()}` : ''}</span>
                  <EstimatedSavingsDisplay bytes={mechanism.estimatedSavingsBytes} />
                  {(mechanism.estimatedSavingsBytes == null || label === 'Transcode video') && <span className="col-span-2 text-xs text-muted-foreground">{mechanism.reason}{mechanism.confidence === 'low' ? ' · Low confidence; measured samples determine whether the estimate is achievable.' : ''}</span>}
                </div>
              ))}
            </section>
          )}
          {normalizeVideoCodec(media.video_codec) === 'H.264' && (
            <p className="rounded-xl border border-sky-500/30 bg-sky-500/10 p-3 text-sm text-sky-100">
              This H.264 file can be evaluated for HEVC or AV1 compression. Savings depend on measured quality and playback compatibility.
            </p>
          )}
          {optimizationDecisionError && (
            <p role="alert" className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
              Estimated savings could not be calculated: {optimizationDecisionError}
            </p>
          )}
          {outputModeSettingError && <p role="alert" className="text-sm text-destructive">{outputModeSettingError}</p>}
          {missingSettings.length > 0 && <p role="status" className="text-sm text-amber-200">Before preparing a review, choose {missingSettings.join(', ')}.</p>}
          {activeTab === 'presets' && <OutputHandlingSelection value={options.outputMode} onChange={mode => { void selectOutputMode(mode) }} />}

          {/* Active Tab Content */}
          {(activeTab === 'presets' || activeTab === 'advanced') && <div className="space-y-2">
            <label className="flex items-start gap-3 rounded-xl border border-border/40 bg-muted/20 p-4 text-sm">
              <input
                type="checkbox"
                checked={options.optimizationMode === 'transcode'}
                onChange={event => setOptions(prev => ({ ...prev, optimizationMode: event.target.checked ? 'transcode' : 'remux_only' }))}
                className="mt-0.5"
              />
              <span>
                <span className="block font-medium">Transcode video</span>
                <span className="block text-xs text-muted-foreground">Apply the selected codec and quality settings to the video stream.</span>
              </span>
            </label>
            <label className="block rounded-xl border border-border/40 bg-muted/20 p-4 text-sm">
              <span className="block font-medium">Keep subtitle languages</span>
              <span className="mb-2 block text-xs text-muted-foreground">Blank keeps all subtitles. Other subtitle languages are removed.</span>
              <input
                type="text"
                aria-label="Subtitle language whitelist"
                value={subtitleWhitelist}
                onChange={event => setSubtitleWhitelist(event.target.value)}
                placeholder="eng, heb, spa"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
              />
            </label>
            <label className="flex items-start gap-3 rounded-xl border border-border/40 bg-muted/20 p-4 text-sm">
              <input
                type="checkbox"
                checked={options.streamSelection?.audio === 'original-and-protected'}
                disabled={!originalAudioLanguage}
                onChange={event => setOptions(prev => ({
                  ...prev,
                  streamSelection: event.target.checked && originalAudioLanguage
                    ? { audio: 'original-and-protected', originalLanguage: originalAudioLanguage, subtitle: 'all' }
                    : undefined
                }))}
                className="mt-0.5"
              />
              <span>
                <span className="block font-medium">Prune non-original audio tracks</span>
                <span className="block text-xs text-muted-foreground">
                  {originalAudioLanguage
                    ? `Keep ${formatLanguage(originalAudioLanguage)} (${originalAudioLanguage}) audio and protected tracks; remove other audio in the same operation.`
                    : 'Unavailable because the original audio language is unknown.'}
                </span>
              </span>
            </label>
            <label className="block rounded-xl border border-border/40 bg-muted/20 p-4 text-sm">
              <span className="mb-2 block font-medium">Original audio language</span>
              <select
                aria-label="Original audio language"
                value={originalAudioLanguage}
                onChange={event => {
                  const language = event.target.value
                  setOriginalAudioLanguage(language)
                  if (options.streamSelection?.audio === 'original-and-protected') {
                    setOptions(prev => ({
                      ...prev,
                      streamSelection: prev.streamSelection?.audio === 'original-and-protected'
                        ? { ...prev.streamSelection, originalLanguage: language }
                        : prev.streamSelection
                    }))
                  }
                }}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
              >
                {!originalAudioLanguage && <option value="">Select the original language</option>}
                {optimizationDecision?.trackRemoval.tracks
                  .map(track => track.language)
                  .filter((language): language is string => Boolean(language))
                  .map(language => ({ language, code: toIso639_2(language) || language }))
                  .filter(({ code }, index, languages) => languages.findIndex(candidate => candidate.code === code) === index)
                  .map(({ language, code }) => <option key={code} value={code}>{formatLanguage(language)} ({code}) · in file</option>)}
                {originalAudioLanguage && !optimizationDecision?.trackRemoval.tracks.some(track => track.language && (toIso639_2(track.language) || track.language) === originalAudioLanguage) && (
                  <option value={originalAudioLanguage}>{formatLanguage(originalAudioLanguage)} ({originalAudioLanguage}) · metadata</option>
                )}
                <optgroup label="Other languages">
                  {LANGUAGE_OPTIONS.filter(option => !optimizationDecision?.trackRemoval.tracks.some(track => track.language && isSameLanguage(track.language, option.code)))
                    .map(option => <option key={option.code} value={option.code3}>{option.label.replace(`(${option.code})`, `(${option.code3})`)}</option>)}
                </optgroup>
              </select>
              <span className="mt-2 block text-xs text-muted-foreground">
                {optimizationDecision?.trackRemoval.evidenceSources.length
                  ? `Detected from media metadata and ${optimizationDecision.trackRemoval.evidenceSources.filter(source => source.startsWith('embedded-audio-tag:')).length} embedded audio tags. Change this for this optimization only.`
                  : 'No original-language evidence is available. Choose the source language before pruning other audio tracks.'}
              </span>
            </label>
            <label className="flex items-start gap-3 rounded-xl border border-border/40 bg-muted/20 p-4 text-sm">
              <input
                type="checkbox"
                checked={audioTranscodeEnabled}
                onChange={event => {
                  setAudioTranscodeEnabled(event.target.checked)
                  if (!event.target.checked) setOptions(prev => ({ ...prev, targetAudioCodec: undefined }))
                }}
                className="mt-0.5"
              />
              <span className="min-w-0 flex-1">
                <span className="block font-medium">Transcode audio</span>
                <span className="block text-xs text-muted-foreground">
                  {media.audio_codec ? `Source: ${media.audio_codec}. ` : ''}{media.audio_codec && /dts.?hd|truehd|flac|pcm/i.test(media.audio_codec) ? 'Lossless audio is preserved unless conversion is needed for playback compatibility; conversion to AAC, AC-3, or E-AC-3 is lossy. ' : ''}Convert eligible retained tracks; protected tracks keep their original codec.
                </span>
                {audioTranscodeEnabled && optimizationDecision && <span className="block text-xs text-muted-foreground">Estimated audio conversion savings: <EstimatedSavingsDisplay bytes={optimizationDecision.audioTranscode.estimatedSavingsBytes} /></span>}
              </span>
              <select
                aria-label="Target audio codec"
                value={options.targetAudioCodec || ''}
                disabled={!audioTranscodeEnabled}
                onChange={event => setOptions(prev => ({ ...prev, targetAudioCodec: event.target.value ? event.target.value as NonNullable<TranscodeOptions['targetAudioCodec']> : undefined }))}
                className="rounded-lg border border-border bg-background px-2 py-1 text-xs text-foreground disabled:opacity-50"
              >
                <option value="">Preserve source{media.audio_codec ? ` (${media.audio_codec})` : ''}</option>
                {(['aac', 'ac3', 'eac3'] as const).filter(codec => !targetProfile || targetProfile.definition.audio.codecs.some(supportedCodec => normalizeAudioCodec(supportedCodec) === normalizeAudioCodec(codec))).map(codec => <option key={codec} value={codec}>{codec.toUpperCase()}{codec === recommendedAudioCodec ? ' (recommended for target compatibility)' : ''}</option>)}
              </select>
            </label>
          </div>}

          {(activeTab === 'presets' || activeTab === 'advanced') && (
            <EncoderPolicySelector value={options.encoderPolicy ?? ''} hardwareAvailable={hardwareAvailable} softwareAvailable={softwareAvailable} onChange={selectEncoderPolicy} />
          )}

          {activeTab === 'presets' && (
            <QuickPresetsTab
              options={options}
              setOptions={setOptions}
              params={params}
              supportedTargetCodecs={supportedTargetCodecs}
            />
          )}

          {activeTab === 'advanced' && (
            <>
              <section className="mb-6 space-y-3 rounded-xl border border-border/40 bg-muted/20 p-4">
                <h4 className="text-sm font-semibold">Playback target</h4>
                {targetProfileError && <p role="alert" className="text-xs text-destructive">{targetProfileError}</p>}
                <label className="block space-y-1.5 text-xs font-semibold text-muted-foreground">
                  Target device
                  <select
                    aria-label="Playback target"
                    value={targetProfileId}
                    onChange={event => {
                      setTargetProfileId(event.target.value)
                      const profile = targetProfiles.find(candidate => candidate.id === event.target.value)
                      const sourceContainer = getOptimizationContainer(media?.container)
                      setTargetContainer(sourceContainer && profile?.definition.containers.includes(sourceContainer === 'mkv' ? 'matroska' : 'mp4') ? sourceContainer : '')
                      setOptions(prev => ({ ...prev, targetCodec: prev.targetCodec && (!profile || profile.definition.video.codecs.some(codec => normalizeVideoCodec(codec) === normalizeVideoCodec(prev.targetCodec))) ? prev.targetCodec : undefined }))
                      setTargetProfileError(null)
                    }}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-normal text-foreground"
                  >
                    <option value="">No playback target</option>
                    {targetProfiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
                  </select>
                </label>
                {targetProfileId ? (
                  <label className="block space-y-1.5 text-xs font-semibold text-muted-foreground">
                    Output container
                    <select
                      aria-label="Output container"
                      value={targetContainer}
                      onChange={event => setTargetContainer(event.target.value as typeof targetContainer)}
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-normal text-foreground"
                    >
                      {!targetContainer && <option value="">Select a supported container</option>}
                      {targetProfiles.find(profile => profile.id === targetProfileId)?.definition.containers
                        .filter(container => container === 'matroska' || container === 'mp4')
                        .map(container => <option key={container} value={container === 'matroska' ? 'mkv' : 'mp4'}>{container === 'matroska' ? 'MKV (Matroska)' : 'MP4'}</option>)}
                    </select>
                  </label>
                ) : <p className="text-xs text-muted-foreground">Playback compatibility will not be evaluated. Measured quality and output-size checks still apply.</p>}
              </section>
              <AdvancedTab
                options={options}
                setOptions={setOptions}
                params={params}
                availability={availability}
              />
            </>
          )}

          {activeTab === 'monitor' && batchSummary && (
            <section role="status" aria-live="polite" className={`space-y-3 rounded-xl border p-4 text-sm ${batchSummary.outcome === 'completed' ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-primary/30 bg-primary/10'}`}>
              <h3 className="font-semibold">{batchSummary.outcome === 'completed' ? 'Completed' : batchSummary.outcome === 'partly-completed' ? 'Partly completed' : batchSummary.outcome === 'failed' ? 'Failed' : batchSummary.outcome === 'cancelled' ? 'Cancelled' : batchSummary.outcome === 'paused' ? 'Paused' : batchSummary.outcome === 'cancelling' ? 'Cancelling' : batchSummary.outcome === 'waiting' ? 'Waiting' : batchSummary.outcome === 'running' ? 'Running' : 'Queued'}</h3>
              <p className="text-xs text-muted-foreground">Completed {batchSummary.successfulCount} · Partial {batchSummary.partialCount} · Failed {batchSummary.failedMediaItemIds.length} · Cancelled {batchSummary.cancelledMediaItemIds.length}</p>
              <div className="flex flex-wrap gap-3 text-xs">
                {batchSummary.activeCount > 0 && <button type="button" disabled={queueControlState !== null} onClick={() => void toggleQueuePause()} className="text-primary underline disabled:opacity-50">{queueControlState === 'pausing' ? 'Pausing…' : queueControlState === 'resuming' ? 'Resuming…' : queueState.isPaused ? 'Resume queue' : 'Pause queue'}</button>}
                {batchSummary.failedMediaItemIds.length + batchSummary.cancelledMediaItemIds.length > 0 && batchSummary.activeCount === 0 && <button type="button" onClick={() => void retryFailedTasks()} className="text-primary underline">Retry failed or cancelled</button>}
                <button type="button" onClick={() => window.dispatchEvent(new Event('taskQueue:open'))} className="text-primary underline">Open Task Queue</button>
              </div>
            </section>
          )}
          {activeTab === 'monitor' && status !== 'queued' && (progress || status === 'complete' || status === 'failed') && (
            <LiveEncodingTab
              status={status}
              progress={progress}
              params={params}
              mediaTitle={media.title}
              onCancel={cancelTranscode}
              onStart={startTranscode}
              onClose={onClose}
            />
          )}

          {activeTab === 'review' && preflight && (
            <section className="space-y-4 rounded-xl border border-border p-4">
              <h4 className="font-bold">Review optimization plan</h4>
              <p className="text-sm">Selected plan total: <EstimatedSavingsDisplay bytes={preflight.estimatedSavingsBytes} /> · {preflight.savingsCoverage ?? 'insufficient'} evidence{preflight.savingsBasis === 'sample_based_projection' ? ' · Sample-based projection' : ''}</p>
              <button className="text-sm underline" onClick={() => { clearReview(); setActiveTab('advanced') }}>Change optimization settings</button>
              {preflight.episodes.map(item => <div key={item.mediaItemId} className="space-y-2 text-sm">
                <p className="font-semibold">{item.label}: {item.compatible ? item.decisionStatus?.replace(/_/g, ' ') : item.reason}</p>
                {!targetProfileId && !item.targetCompatibility && <p className="text-muted-foreground">Playback compatibility was not evaluated because no target profile is selected.</p>}
                {item.params?.summary && <p className="text-muted-foreground">{item.params.summary}</p>}
                {item.changes?.map(change => <p key={change} className="text-muted-foreground">{change}</p>)}
                {item.targetCompatibility && <PlaybackCompatibilityFindings evaluation={item.targetCompatibility} targetName={item.targetProfile?.name} />}
                {item.samplePaths?.map((sample, index) => <button key={sample} className="mr-3 underline" onClick={() => void window.electronAPI.openShowSample(preflight.preflightId, item.mediaItemId, index).catch(error => addToast({ title: 'Could not open measured sample', message: error instanceof Error ? error.message : String(error), type: 'error' }))}>Open measured sample {index + 1}</button>)}
              </div>)}
              {options.streamSelection?.audio === 'original-and-protected' && <p className="text-muted-foreground">This plan keeps original-language and protected audio tracks, removing other audio tracks.</p>}
              {audioTranscodeEnabled && options.targetAudioCodec && <p className="text-muted-foreground">Eligible retained audio tracks will be converted to {options.targetAudioCodec.toUpperCase()}.</p>}
              {preflight.episodes.some(item => item.decisionStatus === 'sample_required') && <label className="flex gap-2 text-sm"><input type="checkbox" checked={samplesReviewed} onChange={event => setSamplesReviewed(event.target.checked)} /> I reviewed and approve the measured sample</label>}
            </section>
          )}
          {analysisRequired && <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 space-y-2 text-sm">
            <p className="font-semibold text-amber-200">Current persisted file analysis is required before optimization.</p>
            <p className="text-muted-foreground">Run file analysis for this item, then refresh this review. Analysis does not approve or queue optimization.</p>
            {analyzingItem ? <p>Analyzing media file…</p> : <button className="underline" onClick={() => { clearReview(); setAnalysisRequired(false); void startTranscode() }}>Refresh optimization review</button>}
          </div>}
        </div>

  </OptimizationDialogShell>
}
