import { useState, useEffect, useCallback, useMemo, useRef, type ReactNode } from 'react'
import {
  Zap,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Layers,
  Sparkles,
  Volume2,
  Activity,
  Scissors,
  ArrowLeft
} from 'lucide-react'
import { useToast } from '@/contexts/ToastContext'
import type { TVShowSummary, MediaItem } from './types'
import type { GpuInfo, PlannedOptimizationOperation, SavedShowPreflight, ShowTranscodePreflight, ShowOptimizationDiscovery } from './transcoding/types'
import { EncoderPolicySelector } from './transcoding/EncoderPolicySelector'
import { formatLanguage, getOptimizationContainer, isSameLanguage, LANGUAGE_OPTIONS, parseLanguageWhitelist } from './mediaUtils'
import { describeDiagnosticError, logOptimizationDiagnostic } from './optimizationDiagnostics'
import { EstimatedSavingsDisplay } from './EstimatedSavingsDisplay'
import { getTVShowIdentity } from './tv/showIdentity'
import type { QueuedTask } from '@main/types/taskQueue'
import { getPlaybackTargetContainers, recommendPlaybackTargetContainer, type PlaybackTargetProfile } from '@main/types/playbackTarget'
import type { OptimizationQualityProfile } from '@main/services/MeasuredOptimizationPolicy'
import { getHardwareEncoder } from '@main/services/TranscodingCapabilities'
import { TaskType } from '@main/types/database'
import { SETTING_KEYS } from '@shared/settingKeys'
import { normalizeVideoCodec } from '@main/services/MediaNormalizer'
import { OPTIMIZATION_VIDEO_CODECS, getOptimizationVideoCodec, chooseOptimizationVideoCodec, playbackProfileSupportsOptimizationCodec } from '@main/services/transcoding/OptimizationCodecPolicy'
import { OptimizationDialogShell } from './transcoding/OptimizationDialogShell'
import { optimizationAudioCodecOptions, optimizationContainerOptions } from './transcoding/optimizationOptions'
import { optimizationCandidateReasonLabel } from './transcoding/optimizationCandidateLabels'
import { buildSampleApprovalGroups } from './tv/sampleApprovalGroups'
import { useOptimizationWorkflow } from './transcoding/useOptimizationWorkflow'
import { describeMissingOptimizationSettings, getMissingOptimizationSettings } from './transcoding/readiness'
import { buildEffectiveOptimizationOptions } from './transcoding/buildEffectiveOptimizationOptions'
import { OptimizationReviewSummary } from './transcoding/OptimizationReviewSummary'
import { OptimizationResultsStage } from './transcoding/OptimizationResultsStage'
import { createInitialOptimizationConfiguration, optimizationAudioLanguageIsKnown, optimizationStreamSelection, optimizationTrackSummary, unavailablePlaybackTargetMessage, useOptimizationConfiguration } from './transcoding/optimizationConfiguration'
import { OptimizationSettingsLayout } from './transcoding/OptimizationSettingsLayout'
import type { OptimizationScope } from './transcoding/OptimizationScope'
import { OptimizationEncodingProgress } from './transcoding/OptimizationEncodingProgress'
import { optimizationDecisionLabel } from './transcoding/optimizationStatus'
import { OptimizationReviewItem } from './transcoding/OptimizationReviewItem'
import { SubtitleLanguageSelection } from './transcoding/SubtitleLanguageSelection'
import { AudioTrackPolicySelection, type AudioLanguageOption } from './transcoding/AudioTrackPolicySelection'
import { OptimizationDialogFooter } from './transcoding/OptimizationDialogFooter'
import { loadOptimizationPreferences } from './transcoding/optimizationPreferences'
import { OptimizationContainerSelection } from './transcoding/OptimizationContainerSelection'
import { availableOptimizationDialogStages, optimizationDialogStage } from './transcoding/OptimizationStages'
import { formatOptimizationBytes } from './transcoding/optimizationResults'

function getSourceTierBadge(tier?: string) {
  switch (tier) {
    case 'Remux':
      return (
        <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-purple-500/20 text-purple-300 border border-purple-500/30">
          Remux
        </span>
      )
    case 'WEB-DL':
      return (
        <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-sky-500/20 text-sky-300 border border-sky-500/30">
          WEB-DL
        </span>
      )
    case 'WEBRip':
      return (
        <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
          WEBRip
        </span>
      )
    case 'BluRay':
      return (
        <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
          BluRay
        </span>
      )
    case 'HDTV':
      return (
        <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-amber-500/20 text-amber-300 border border-amber-500/30">
          HDTV
        </span>
      )
    case 'SDTV':
      return (
        <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-orange-500/20 text-orange-300 border border-orange-500/30">
          SDTV
        </span>
      )
    default:
      return tier ? (
        <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-zinc-500/20 text-zinc-300 border border-zinc-500/30">
          {tier}
        </span>
      ) : null
  }
}

function getAdvisoryBadges(operations: PlannedOptimizationOperation[], compatible: boolean = true, decisionStatus?: string) {
  const badges: ReactNode[] = []
  const outcome = decisionStatus && decisionStatus !== 'actionable' ? optimizationDecisionLabel(decisionStatus) : !compatible ? 'Not compatible' : undefined
  if (outcome) {
    const isCurrent = decisionStatus === 'already_optimized'
    badges.push(<span key={decisionStatus ?? 'incompatible'} className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border flex items-center gap-1 ${isCurrent ? 'bg-muted text-muted-foreground border-border/40' : !compatible ? 'bg-destructive/20 text-destructive border-destructive/30' : 'bg-amber-500/20 text-amber-300 border-amber-500/30'}`}>{isCurrent ? <CheckCircle2 className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}{outcome}</span>)
  } else if (!compatible) {
    badges.push(
      <span key="incompatible" className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-destructive/20 text-destructive border border-destructive/30 flex items-center gap-1">
        <AlertCircle className="w-3 h-3" /> Not compatible
      </span>
    )
  }
  if (compatible) {
    for (const operation of operations) {
      if (operation === 'video_transcode') {
        badges.push(
        <span key={operation} className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-blue-500/20 text-blue-400 border border-blue-500/30 flex items-center gap-1">
          <Zap className="w-3 h-3" /> Re-encode video
        </span>
        )
      } else if (operation === 'stream_pruning') {
        badges.push(
          <span key={operation} className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
            <Scissors className="w-3 h-3" /> Remove streams
          </span>
        )
      } else if (operation === 'subtitle_pruning') {
        badges.push(
          <span key={operation} className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
            <Scissors className="w-3 h-3" /> Remove subtitles
          </span>
        )
      } else if (operation === 'audio_transcode') {
        badges.push(
          <span key={operation} className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 flex items-center gap-1">
            <Volume2 className="w-3 h-3" /> Audio conversion
          </span>
        )
      } else if (operation === 'container_change') {
        badges.push(
          <span key={operation} className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-purple-500/20 text-purple-300 border border-purple-500/30 flex items-center gap-1">
            <Layers className="w-3 h-3" /> Change container
          </span>
        )
      }
    }
  }
  return <div className="flex flex-wrap justify-end gap-1">{badges}</div>
}

function formatBytes(bytes?: number): string {
  return bytes == null ? 'Not measured' : formatOptimizationBytes(bytes)
}

export interface SeriesOptimizationFlowProps {
  scope: Exclude<OptimizationScope, { kind: 'movie' }>
  show: TVShowSummary
  episode?: MediaItem
  seasonNumber?: number
  onClose: () => void
  initialPreflight?: import('./transcoding').SavedShowPreflight | null
  resumeRequestId?: string | null
}

export function SeriesOptimizationFlow({ scope, show, episode, seasonNumber, onClose, initialPreflight: initialReview, resumeRequestId }: SeriesOptimizationFlowProps) {
  const initialPreflight = initialReview?.result
  const { addToast } = useToast()
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])
  const { seriesIdentityKey, sourceId, libraryId } = getTVShowIdentity(show)
  const { configuration, updateConfiguration, restoreConfiguration } = useOptimizationConfiguration(createInitialOptimizationConfiguration('smart', { audioTrackPolicy: 'original-and-protected' }))
  const { optimizationMode, targetProfileId, targetContainer, targetContainerSelection, outputMode, audioTrackPolicy, originalAudioLanguage: language, subtitleLanguages: subtitleWhitelist, audioTranscodeEnabled, removeUnnecessaryStreams, playbackPolicy } = configuration
  const qualityProfile = configuration.qualityProfile as OptimizationQualityProfile | ''
  const encoderPolicy = configuration.encoderPolicy as 'automatic' | 'hardware' | 'software' | 'compare' | ''
  const codec = configuration.targetCodec as 'hevc' | 'av1' | ''
  const targetAudioCodec = configuration.targetAudioCodec as 'aac' | 'ac3' | 'eac3' | ''
  const targetHdrFormat = configuration.targetHdrFormat as 'SDR' | 'HDR10' | ''
  const setQualityProfile = useCallback((value: OptimizationQualityProfile | '') => updateConfiguration({ qualityProfile: value }), [updateConfiguration])
  const setEncoderPolicy = useCallback((value: typeof encoderPolicy) => updateConfiguration({ encoderPolicy: value }), [updateConfiguration])
  const setCodec = useCallback((value: typeof codec) => updateConfiguration({ targetCodec: value }), [updateConfiguration])
  const setTargetAudioCodec = useCallback((value: typeof targetAudioCodec) => updateConfiguration({ targetAudioCodec: value, audioTranscodeEnabled: Boolean(value) }), [updateConfiguration])
  const setTargetHdrFormat = useCallback((value: typeof targetHdrFormat) => updateConfiguration({ targetHdrFormat: value }), [updateConfiguration])
  const adjustToTarget = optimizationMode !== 'remux_only'
  const [targetProfiles, setTargetProfiles] = useState<PlaybackTargetProfile[]>([])
  const [targetProfilesLoading, setTargetProfilesLoading] = useState(true)
  const targetProfile = targetProfiles.find(profile => profile.id === targetProfileId)
  const targetProfileError = !targetProfilesLoading ? unavailablePlaybackTargetMessage(targetProfileId, targetProfiles.map(profile => profile.id)) : null
  const sourceContainer = getOptimizationContainer(episode?.container)
  const sourceVideoCodec = episode?.video_codec?.toLowerCase()
  const sourceTargetCodec = normalizeVideoCodec(sourceVideoCodec) === 'HEVC' ? 'hevc' : normalizeVideoCodec(sourceVideoCodec) === 'AV1' ? 'av1' : undefined
  const sourceHdrFormat = episode?.hdr_format?.toUpperCase()
  const qualityPreferenceScopes = useMemo(() => episode?.id
    ? [`item:${sourceId}:${episode.id}`, `show:${sourceId}:${libraryId}:${seriesIdentityKey}`]
    : seasonNumber !== undefined
      ? [`season:${sourceId}:${libraryId}:${seriesIdentityKey}:${seasonNumber}`, `show:${sourceId}:${libraryId}:${seriesIdentityKey}`]
      : [`show:${sourceId}:${libraryId}:${seriesIdentityKey}`], [episode, sourceId, libraryId, seriesIdentityKey, seasonNumber])
  const useHardwareEncoder = encoderPolicy !== 'software'
  const [detectedLanguages, setDetectedLanguages] = useState<string[]>([])
  const [providerLanguage, setProviderLanguage] = useState<string>('')
  const audioLanguageOptions = useMemo<AudioLanguageOption[]>(() => {
    const detected = detectedLanguages.map(code => {
      const defaultLabel = providerLanguage && isSameLanguage(code, providerLanguage)
        ? ` · preferred (${formatLanguage(providerLanguage)})`
        : ''
      return {
        value: code,
        label: code === 'und' ? 'Undetermined / untagged (und)' : `${formatLanguage(code)} (${code})${defaultLabel}`,
        group: 'In file',
      }
    })
    const selected = language && !detectedLanguages.includes(language) && !LANGUAGE_OPTIONS.some(option => option.code === language)
      ? [{ value: language, label: `${formatLanguage(language)} (${language})`, group: 'Other languages' }]
      : []
    const other = LANGUAGE_OPTIONS
      .filter(option => !detectedLanguages.some(code => isSameLanguage(code, option.code)))
      .map(option => ({ value: option.code, label: option.label, group: 'Other languages' }))
    return [...detected, ...selected, ...other]
  }, [detectedLanguages, language, providerLanguage])
  const [gpuId, setGpuId] = useState('')
  const [gpus, setGpus] = useState<GpuInfo[]>([])
  const [deviceEncoders, setDeviceEncoders] = useState<Record<string, string[]>>({})
  const [encoderCapabilitiesLoaded, setEncoderCapabilitiesLoaded] = useState(false)
  const [message, setMessage] = useState('')
  const [isSuccess, setIsSuccess] = useState(false)
  const [busy, setBusy] = useState(false)
  const [optimizationDiscovery, setOptimizationDiscovery] = useState<ShowOptimizationDiscovery | null>(null)
  const automaticCandidateDiscoveryStarted = useRef(false)
  const [selectedDiscoveryGroups, setSelectedDiscoveryGroups] = useState<string[]>([])
  const [representativeMediaItemIds, setRepresentativeMediaItemIds] = useState<Record<string, number>>({})
  const [includeOtherOperationItems, setIncludeOtherOperationItems] = useState(false)
  const [preparationStartedAt, setPreparationStartedAt] = useState<number>()
  const [preparationElapsedSeconds, setPreparationElapsedSeconds] = useState(0)
  const [quarantineFiles, setQuarantineFiles] = useState<Array<{ mediaItemId: number; label: string; path: string; size: number; modifiedAt: string; owned: boolean }>>([])
  const [loadingBackups, setLoadingBackups] = useState(false)
  const [trackSettingsOpen, setTrackSettingsOpen] = useState(false)

  const handleQueueError = useCallback((error: unknown) => addToast({ type: 'error', title: 'Show queue state', message: String(error) }), [addToast])
  const workflow = useOptimizationWorkflow(handleQueueError)
  const { queueState, stage, setStage, review: preflightData, reviewedSampleGroups, setReviewedSampleGroups, batchId: activeBatchId, submittedMediaItemIds, submittedTaskIds, queueControlState: batchQueueControlState, preparationTermination: preflightTermination, setPreparationTermination: setPreflightTermination, preparationProgress: preflightProgress, setPreparationProgress: setPreflightProgress, preparationState: preflightOperationState, setPreparationState: setPreflightOperationState, activePreparationRequestId: activePreflightRequestId, activePreparationTaskId: activePreflightTaskId, rejectPreparation: rejectPreflightWait, preparationMovedToBackground: backgroundPreflight, preparationStartedHere: startedPreflightHere, batchSummary, reviewMatches, replaceReview, clearReview, submitBatch, toggleQueuePause, retryFailedTasks, reconcilePreparationQueue } = workflow
  const mode = stage === 'options' ? optimizationDiscovery ? 'candidates' : 'config' : stage === 'review' ? 'preview' : 'monitoring'
  const setMode = useCallback((nextMode: 'config' | 'preview' | 'monitoring') => {
    if (nextMode === 'config') setOptimizationDiscovery(null)
    setStage(nextMode === 'config' ? 'options' : nextMode === 'preview' ? 'review' : 'results')
  }, [setStage])
  const sampleApprovalGroups = useMemo(() => buildSampleApprovalGroups(preflightData), [preflightData])

  useEffect(() => {
    if (!busy || preparationStartedAt === undefined) return
    const updateElapsed = () => setPreparationElapsedSeconds(Math.floor((Date.now() - preparationStartedAt) / 1000))
    updateElapsed()
    const interval = window.setInterval(updateElapsed, 1000)
    return () => window.clearInterval(interval)
  }, [busy, preparationStartedAt])

  const matchesPreparationScope = useCallback((task: QueuedTask) => {
    const request = (task.options as { request?: { seriesIdentityKey?: string; sourceId?: string; libraryId?: string; mediaItemId?: number; seasonNumber?: number } } | undefined)?.request
    return task.type === 'optimization-preflight' && request?.sourceId === sourceId && request.libraryId === libraryId &&
      request.seriesIdentityKey === seriesIdentityKey && request.mediaItemId === episode?.id && request.seasonNumber === seasonNumber
  }, [sourceId, libraryId, seriesIdentityKey, episode?.id, seasonNumber])
  const preparationObserver = useMemo(() => ({
    enabled: !initialPreflight,
    requestId: resumeRequestId,
    matchesScope: matchesPreparationScope,
    fallbackPhase: seasonNumber === undefined ? 'Preflighting series' : `Preflighting season ${seasonNumber}`,
    onReviewLoaded: (saved: SavedShowPreflight) => {
      replaceReview(saved.result, saved.request.options)
      setMode('preview')
    },
    onFailure: setMessage,
    onActivity: setBusy,
  }), [initialPreflight, resumeRequestId, matchesPreparationScope, seasonNumber, replaceReview, setMode])

  const restoreSavedReview = useCallback((saved: { request: import('@main/services/TranscodingService').ShowTranscodeRequest; result: ShowTranscodePreflight }) => {
    const { request, result } = saved
    const options = request.options
    restoreConfiguration(options)
    setGpuId(options.gpuId ?? '')
    replaceReview(result, options)
    submitBatch(result.batchId, result.queuedMediaItemIds ?? [], result.queuedTaskIds ?? [])
    setMode(result.queuedAt ? 'monitoring' : 'preview')
  }, [replaceReview, submitBatch, setMode, restoreConfiguration])

  useEffect(() => {
    if (!initialReview || !initialPreflight) return
    restoreSavedReview({ request: initialReview.request, result: initialPreflight })
    submitBatch(initialPreflight.batchId, initialPreflight.queuedMediaItemIds ?? [], initialPreflight.queuedTaskIds ?? [])
  }, [initialReview, initialPreflight, restoreSavedReview, submitBatch])

  useEffect(() => {
    if (initialPreflight || resumeRequestId || targetProfilesLoading) return
    let mounted = true
    void (async () => {
      const { operations } = await window.electronAPI.operationsGetActivity()
      const active = operations.some(operation => !operation.outcome && operation.kind === 'optimization-preflight' &&
        operation.entity?.sourceId === sourceId && operation.entity.libraryId === libraryId &&
        operation.entity.seriesIdentityKey === seriesIdentityKey && operation.entity.mediaItemId === episode?.id && operation.entity.seasonNumber === seasonNumber)
      if (active) return undefined
      return window.electronAPI.findShowPreflight(seriesIdentityKey, sourceId, libraryId, show.series_title, episode?.id, seasonNumber)
    })().then(saved => {
      if (!mounted || startedPreflightHere.current || !saved) return
      const result = saved.result as ShowTranscodePreflight
      restoreSavedReview({ request: saved.request as import('@main/services/TranscodingService').ShowTranscodeRequest, result })
      submitBatch(result.batchId, result.queuedMediaItemIds ?? [], result.queuedTaskIds ?? [])
      setMessage('')
      logOptimizationDiagnostic('TVOptimizationUI', 'info', 'preflight.reused', { preflightId: result.preflightId, batchId: result.batchId, seriesIdentityKey, seasonNumber, mediaItemId: episode?.id })
    }).catch(error => setMessage(error instanceof Error ? error.message : String(error)))
    return () => { mounted = false }
  }, [initialPreflight, resumeRequestId, targetProfilesLoading, seriesIdentityKey, sourceId, libraryId, show.series_title, episode?.id, seasonNumber, restoreSavedReview, submitBatch, startedPreflightHere])

  useEffect(() => {
    reconcilePreparationQueue(queueState, preparationObserver, () => mountedRef.current)
  }, [queueState, preparationObserver, reconcilePreparationQueue])

  useEffect(() => {
    let mounted = true
    void loadOptimizationPreferences().then(preferences => {
      if (mounted) {
        setTargetProfiles(preferences.targetProfiles)
        if (!initialReview && !initialPreflight) updateConfiguration({ subtitleLanguages: preferences.subtitleWhitelist })
        if (!initialReview && !initialPreflight) {
          if (preferences.outputModeError) setMessage(preferences.outputModeError)
          else if (preferences.outputMode) updateConfiguration({ outputMode: preferences.outputMode })
          if (preferences.targetProfileError) setMessage(preferences.targetProfileError)
          else if (preferences.targetProfileId) updateConfiguration({ targetProfileId: preferences.targetProfileId })
        }
      }
    }).catch(error => setMessage(error instanceof Error ? error.message : String(error)))
      .finally(() => { if (mounted) setTargetProfilesLoading(false) })
    return () => { mounted = false }
  }, [addToast, initialReview, initialPreflight, updateConfiguration])

  const selectOutputMode = async (next: 'copy' | 'quarantine-replace' | 'replace') => {
    try {
      await window.electronAPI.setSetting(SETTING_KEYS.transcoding_default_output_mode, next)
      updateConfiguration({ outputMode: next })
      setMessage(message => message.startsWith('Could not save output choice:') || message.startsWith('Saved output choice is unavailable.') ? '' : message)
    } catch (error) {
      setMessage(`Could not save output choice: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  useEffect(() => {
    if (initialPreflight?.episodes.some(item => item.options?.qualityProfile)) return
    let mounted = true
    void window.electronAPI.getSetting(SETTING_KEYS.optimization_quality_preferences).then(raw => {
      if (!mounted || !raw) return
      const preferences = JSON.parse(raw) as Record<string, OptimizationQualityProfile>
      const preference = qualityPreferenceScopes.map(scope => preferences[scope]).find(value => value !== undefined)
      if (preference) setQualityProfile(preference)
    }).catch(error => setMessage(error instanceof Error ? error.message : String(error)))
    return () => { mounted = false }
  }, [initialPreflight, qualityPreferenceScopes, episode, setQualityProfile])

  useEffect(() => {
    if (preflightData) return
    const sourceVideo = { codec: episode?.video_codec, profile: episode?.video_profile, hdrFormat: episode?.hdr_format }
    const supportedContainers = targetProfile ? getPlaybackTargetContainers(targetProfile, sourceVideo) : ['matroska', 'mp4']
    const preferredContainer: 'mkv' | 'mp4' | '' = !episode
      ? ''
      : targetProfile
      ? recommendPlaybackTargetContainer(targetProfile, sourceVideo, episode?.container)
      : sourceContainer || 'mkv'
    if (targetContainerSelection !== 'user-selected') {
      if (targetContainer !== preferredContainer || targetContainerSelection !== 'automatic') {
        updateConfiguration({ targetContainer: preferredContainer, targetContainerSelection: 'automatic' })
      }
    }
    const compatible = OPTIMIZATION_VIDEO_CODECS.map(item => item.value).filter(candidate => playbackProfileSupportsOptimizationCodec(candidate, targetProfile?.definition.video.codecs))
    const selectedCodec = chooseOptimizationVideoCodec(codec, compatible)
    if (selectedCodec !== codec) setCodec(selectedCodec)

    const targetHdrFormats = targetProfile?.definition.hdr.formats.map(format => format.toUpperCase()) ?? []
    const sourceIsSdr = !sourceHdrFormat || ['SDR', 'NONE'].includes(sourceHdrFormat)
    const sourceHdrSupported = sourceHdrFormat && ['HDR10', 'SDR'].includes(sourceHdrFormat) && (sourceHdrFormat === 'SDR' || targetHdrFormats.includes(sourceHdrFormat))
    const isDynamicHdrSource = ['DOLBY VISION', 'HDR10+'].includes(sourceHdrFormat ?? '')
    const recommendedHdr: 'SDR' | 'HDR10' | '' = isDynamicHdrSource
      ? ''
      : sourceIsSdr
      ? 'SDR'
      : sourceHdrSupported
        ? sourceHdrFormat as 'SDR' | 'HDR10'
        : targetHdrFormats.includes('HDR10') ? 'HDR10' : 'SDR'
    const supportedHdr = !targetProfile || !targetHdrFormat || targetHdrFormat === 'SDR' || targetHdrFormats.includes(targetHdrFormat)
    if (!supportedHdr || !targetHdrFormat) {
      const nextHdrFormat = targetProfile && episode ? recommendedHdr : ''
      if (nextHdrFormat !== targetHdrFormat) setTargetHdrFormat(nextHdrFormat)
    }
    logOptimizationDiagnostic('TVOptimizationUI', 'info', 'output.settings.recommended', {
      seriesIdentityKey,
      mediaItemId: episode?.id,
      targetProfileId: targetProfile?.id ?? null,
      targetCodec: selectedCodec || null,
      targetContainer: preferredContainer || null,
      qualityProfile: 'balanced',
      targetHdrFormat: targetProfile ? recommendedHdr : null,
      sourceCodec: sourceTargetCodec ?? null,
      sourceContainer: sourceContainer || null,
      sourceHdrFormat: sourceHdrFormat ?? null,
      containerSelection: 'automatic',
      allowedContainers: supportedContainers
    })
  }, [preflightData, episode, seriesIdentityKey, sourceTargetCodec, sourceHdrFormat, sourceContainer, targetProfile, targetContainer, targetContainerSelection, codec, targetHdrFormat, updateConfiguration, setCodec, setTargetHdrFormat])


  const handleClose = useCallback(() => {
    const requestId = activePreflightRequestId.current
    if (requestId) {
      logOptimizationDiagnostic('TVOptimizationUI', 'info', 'preflight.continue-in-queue', { requestId, seriesIdentityKey, mediaItemId: episode?.id })
      backgroundPreflight.current = true
      activePreflightRequestId.current = null
      onClose()
      return
    }
    logOptimizationDiagnostic('TVOptimizationUI', 'info', preflightData && mode !== 'monitoring' ? 'review.closed.saved' : 'optimizer.close.completed', { preflightId: preflightData?.preflightId, seriesIdentityKey, mediaItemId: episode?.id, mode })
    onClose()
  }, [preflightData, mode, onClose, seriesIdentityKey, episode?.id, activePreflightRequestId, backgroundPreflight])


  const loadQuarantine = async () => {
    setLoadingBackups(true)
    try {
      const files = await window.electronAPI.listShowQuarantine(show.series_title, sourceId, seriesIdentityKey, libraryId)
      setQuarantineFiles(files)
      if (files.length === 0) addToast({ type: 'info', title: 'No backups found', message: 'There are no original backups for this show.' })
    } catch (error) { addToast({ type: 'error', title: 'Could not load backups', message: String(error) }) }
    finally { setLoadingBackups(false) }
  }

  const purgeQuarantine = async () => {
    if (quarantineFiles.length === 0 || !window.confirm(`Permanently delete ${quarantineFiles.length} original backup${quarantineFiles.length === 1 ? '' : 's'} for this show?`)) return
    try {
      const result = await window.electronAPI.purgeShowQuarantine(show.series_title, sourceId, seriesIdentityKey, libraryId)
      setQuarantineFiles([])
      addToast({ type: 'success', title: 'Backups deleted', message: `Deleted ${result.purged} original backup${result.purged === 1 ? '' : 's'}.` })
    } catch (error) { addToast({ type: 'error', title: 'Could not delete backups', message: String(error) }) }
  }

  // Auto-detect available audio languages and provider original language from series metadata / episodes
  useEffect(() => {
    let isMounted = true
    async function loadLanguages() {
      if (!show.series_title) return
      let provLang = (show as TVShowSummary & { original_language?: string }).original_language || ''
      let fileLangs: string[] = []

      try {
        const res = await window.electronAPI.seriesGetAudioLanguagesByIdentity(show.series_title, sourceId, seriesIdentityKey, libraryId)
        if (Array.isArray(res)) {
          fileLangs = res
        }
      } catch (err) {
        console.error('Failed to get series audio languages:', err)
      }

      try {
        if (!provLang || fileLangs.length === 0) {
          const episodes = await window.electronAPI.seriesGetEpisodesByIdentity(show.series_title, sourceId, seriesIdentityKey, libraryId)
          if (Array.isArray(episodes) && episodes.length > 0) {
            const detected = (episodes as MediaItem[]).find(e => e.original_language)?.original_language
            if (detected && !provLang) provLang = detected
            if (fileLangs.length === 0) {
              const extracted = new Set<string>()
              for (const ep of episodes as MediaItem[]) {
                if (ep.audio_tracks) {
                  try {
                    const tracks = JSON.parse(ep.audio_tracks) as Array<{ language?: string; lang?: string }>
                    for (const t of tracks) {
                      const l = (t.language || t.lang || '').trim().toLowerCase()
                      if (l) extracted.add(l)
                    }
                  } catch (error) {
                    console.error('[SeriesOptimizationFlow] Failed to parse episode audio tracks for language detection', error)
                  }
                }
                if (ep.audio_language) {
                  const l = ep.audio_language.trim().toLowerCase()
                  if (l) extracted.add(l)
                }
              }
              fileLangs = Array.from(extracted)
            }
          }
        }
      } catch (err) {
        console.error('Failed to fetch episodes for original language detection:', err)
      }

      if (!isMounted) return

      setDetectedLanguages(fileLangs)
      setProviderLanguage(provLang)

      if (provLang && !initialReview && !initialPreflight) {
        const matchingFileCode = fileLangs.find(code => isSameLanguage(code, provLang))
        updateConfiguration({ originalAudioLanguage: matchingFileCode || provLang.toLowerCase() })
      }
    }

    loadLanguages()
    return () => { isMounted = false }
  }, [show, sourceId, seriesIdentityKey, libraryId, initialReview, initialPreflight, updateConfiguration])

  useEffect(() => {
    let isMounted = true
    window.electronAPI.transcodingGetCapabilities().then((capabilities) => {
      if (!isMounted || !capabilities) return
      const detectedGpus = capabilities.gpus || []
      setGpus(detectedGpus)
      setDeviceEncoders(capabilities.deviceEncoders)
      setEncoderCapabilitiesLoaded(true)
      setGpuId(capabilities.selectedGpuId || '')
    }).catch(err => {
      addToast({ type: 'error', title: 'Encoder capabilities', message: String(err) })
    })
    return () => { isMounted = false }
  }, [addToast])

  useEffect(() => {
    if (!encoderCapabilitiesLoaded || encoderPolicy === 'software' || !codec) return
    const supportsCodec = (gpu: GpuInfo) => {
      const encoder = getHardwareEncoder(gpu.vendor, codec)
      return Boolean(encoder && deviceEncoders[gpu.id]?.includes(encoder))
    }
    setGpuId(gpus.find(gpu => gpu.vendor === 'Intel' && supportsCodec(gpu))?.id ?? gpus.find(supportsCodec)?.id ?? '')
  }, [encoderCapabilitiesLoaded, encoderPolicy, codec, deviceEncoders, gpus])

  const subtitleList = parseLanguageWhitelist(subtitleWhitelist)

  const getCleanOptions = (overrides: { removeUnnecessaryStreams?: boolean; targetProfileId?: string; targetCodec?: 'hevc' | 'av1' } = {}) => {
    const shouldRemoveStreams = overrides.removeUnnecessaryStreams ?? removeUnnecessaryStreams
    const shouldAdjustToTarget = adjustToTarget
    const effectiveTargetProfileId = overrides.targetProfileId ?? targetProfileId
    const whitelist = shouldRemoveStreams && subtitleList.length > 0 ? subtitleList : undefined
    const effectiveOptimizationMode = shouldAdjustToTarget ? optimizationMode : 'remux_only' as const
    const options: import('@main/services/TranscodingService').TranscodeOptions = {
      targetCodec: (overrides.targetCodec ?? codec) || undefined,
      playbackPolicy,
      qualityProfile: qualityProfile || undefined,
      encoderPolicy: encoderPolicy || undefined,
      targetContainer: shouldAdjustToTarget ? targetContainer || undefined : undefined,
      targetContainerSelection: shouldAdjustToTarget ? targetContainerSelection || 'automatic' : 'automatic',
      targetAudioCodec: shouldAdjustToTarget ? targetAudioCodec || undefined : undefined,
      targetHdrFormat: shouldAdjustToTarget && effectiveTargetProfileId ? targetHdrFormat || undefined : undefined,
      transcodingEngine: 'ffmpeg' as const,
      outputMode: outputMode || undefined,
      gpuId: useHardwareEncoder && effectiveOptimizationMode !== 'remux_only' ? gpuId : undefined,
      optimizationMode: effectiveOptimizationMode,
      targetProfileId: (overrides.targetProfileId ?? targetProfileId) || null,
      streamSelection: optimizationStreamSelection(configuration, shouldRemoveStreams),
    }
    return buildEffectiveOptimizationOptions(options, {
      targetProfileId: effectiveTargetProfileId,
      targetContainer: shouldAdjustToTarget ? targetContainer || undefined : undefined,
      audioTranscodeEnabled: shouldAdjustToTarget && audioTranscodeEnabled,
      subtitleLanguageWhitelist: whitelist ?? [],
    })
  }

  const currentOptions = getCleanOptions()
  const currentOptionsFingerprint = JSON.stringify(currentOptions)
  const reviewMatchesCurrentSettings = reviewMatches(currentOptions)
  useEffect(() => {
    if (preflightData && !reviewMatchesCurrentSettings && reviewedSampleGroups.length > 0) {
      setReviewedSampleGroups([])
    }
  }, [preflightData, currentOptionsFingerprint, reviewMatchesCurrentSettings, reviewedSampleGroups.length, setReviewedSampleGroups])

  const getMissingSettings = (overrides: { removeUnnecessaryStreams?: boolean; targetProfileId?: string } = {}) => {
    const shouldRemoveStreams = overrides.removeUnnecessaryStreams ?? removeUnnecessaryStreams
    const shouldAdjustToTarget = adjustToTarget
    const effectiveTargetProfileId = overrides.targetProfileId ?? targetProfileId
    const videoTranscode = shouldAdjustToTarget
    const dynamicHdrSource = ['DOLBY VISION', 'HDR10+'].includes(sourceHdrFormat ?? '')
    return getMissingOptimizationSettings({
      outputModeSelected: Boolean(outputMode),
      videoTranscode,
      videoCodecSelected: Boolean(codec),
      videoCodecSupported: Boolean(codec && supportedTargetCodecs.includes(codec)),
      qualityProfileSelected: Boolean(qualityProfile),
      encoderPolicySelected: Boolean(encoderPolicy),
      streamPruning: shouldRemoveStreams && audioTrackPolicy === 'original-and-protected',
      originalAudioLanguageSelected: optimizationAudioLanguageIsKnown(language),
      playbackTargetRequired: playbackPolicy !== 'allow-transcoding',
      playbackTargetSelected: Boolean(effectiveTargetProfileId),
      additionalRequirements: [
        { label: 'output container', ready: !videoTranscode || targetContainerSelection !== 'user-selected' || Boolean(targetContainer) },
        { label: 'output color format for the selected playback target', ready: !videoTranscode || !effectiveTargetProfileId || Boolean(targetHdrFormat) || optimizationMode !== 'transcode' && (!episode || dynamicHdrSource) },
      ],
    })
  }

  const runPreflight = async (overrides: { removeUnnecessaryStreams?: boolean; targetProfileId?: string; targetCodec?: 'hevc' | 'av1'; representativeMediaItemId?: number; representativeMediaItemIds?: Record<string, number>; selectedMediaItemIds?: number[] } = {}) => {
    const { representativeMediaItemId, representativeMediaItemIds, selectedMediaItemIds, ...optionOverrides } = overrides
    const requestId = crypto.randomUUID()
    const requestedAt = Date.now()
    setPreparationStartedAt(requestedAt)
    const shouldRemoveStreams = overrides.removeUnnecessaryStreams ?? removeUnnecessaryStreams
    const shouldAdjustToTarget = adjustToTarget
    const effectiveTargetProfileId = overrides.targetProfileId ?? targetProfileId
    const missingSettings = getMissingSettings(overrides)
    const settings = {
      requestId, scope: episode ? 'episode' : seasonNumber === undefined ? 'series' : 'season', seriesIdentityKey, mediaItemId: episode?.id, sourceId, libraryId, optimizationMode, outputMode,
      seasonNumber,
      selectedMediaItemIds: selectedMediaItemIds ?? null,
      representativeMediaItemId: representativeMediaItemId ?? null,
      representativeMediaItemIds: representativeMediaItemIds ?? null,
      codec: codec || null, qualityProfile: qualityProfile || null, encoderPolicy: encoderPolicy || null,
      targetContainer: targetContainer || null, targetHdrFormat: targetHdrFormat || null,
      gpuId: gpuId || null, removeUnnecessaryStreams: shouldRemoveStreams,
      adjustToTarget: shouldAdjustToTarget, targetProfileId: effectiveTargetProfileId || null, playbackPolicy
    }
    logOptimizationDiagnostic('TVOptimizationUI', 'info', 'preflight.requested', { ...settings, stage: 'preparation.requested' })
    if (missingSettings.length > 0) {
      const error = `Complete these settings before measuring samples: ${missingSettings.join(', ')}.`
      logOptimizationDiagnostic('TVOptimizationUI', 'warn', 'preflight.validation.failed', { ...settings, missingSettings })
      throw new Error(error)
    }
    if (preflightData) {
      await window.electronAPI.discardShow(preflightData.preflightId)
      clearReview()
    }
    backgroundPreflight.current = false
    activePreflightRequestId.current = requestId
    setPreflightTermination(null)
    setPreflightProgress({ phase: 'Starting review preparation', currentItem: episode ? `Loading ${episode.title}` : seasonNumber === undefined ? 'Loading series episodes' : `Loading season ${seasonNumber} episodes` })
    setPreflightOperationState('running')
    startedPreflightHere.current = true
    let preflight: ShowTranscodePreflight | undefined
    let unsubscribeTaskComplete: (() => void) | undefined
    try {
      const started = await window.electronAPI.startPreflightShow({
        requestId,
        mediaItemId: episode?.id,
        seasonNumber,
        seriesTitle: show.series_title,
        seriesIdentityKey,
        sourceId,
        libraryId,
        representativeMediaItemId,
        representativeMediaItemIds,
        selectedMediaItemIds,
        options: getCleanOptions(optionOverrides)
      })
      if (started.requestId !== requestId) throw new Error('The background preflight returned a different request identity')
      activePreflightTaskId.current = started.taskId
      preflight = await new Promise<ShowTranscodePreflight>((resolve, reject) => {
        let settled = false
        rejectPreflightWait.current = reject
        const inspect = async (task: QueuedTask | null) => {
          if (settled || task?.id !== started.taskId || !['completed', 'failed', 'cancelled'].includes(task.status)) return
          settled = true
          unsubscribeTaskComplete?.()
          if (task.status !== 'completed') {
            reject(task.status === 'cancelled' ? new DOMException(task.error ?? 'Preflight cancelled', 'AbortError') : new Error(task.error ?? 'Optimization preflight failed'))
            return
          }
          try {
            const preflightId = task.result?.preflightId
            if (typeof preflightId !== 'string') throw new Error('The completed preflight did not return its saved review identifier')
            const saved = await window.electronAPI.getShowPreflight(preflightId) as { result: ShowTranscodePreflight } | undefined
            if (!saved) throw new Error('The saved optimization review could not be found')
            resolve(saved.result)
          } catch (error) {
            reject(error)
          }
        }
        unsubscribeTaskComplete = window.electronAPI.onTaskQueueTaskComplete(task => { void inspect(task) })
        void window.electronAPI.taskQueueGetState().then(state => {
          const task = [state.currentTask, ...state.queue, ...state.completedTasks].find(candidate => candidate?.id === started.taskId) ?? null
          void inspect(task)
        }).catch(reject)
      })
      logOptimizationDiagnostic('TVOptimizationUI', 'info', 'preflight.returned', { requestId, scope: episode ? 'episode' : seasonNumber === undefined ? 'series' : 'season', mediaItemId: episode?.id, stage: 'review.saved', durationMs: Date.now() - requestedAt, preflightId: preflight.preflightId, batchId: preflight.batchId, episodeCount: preflight.episodeCount, compatible: preflight.episodes.filter(item => item.compatible).length, savingsBytes: preflight.estimatedSavingsBytes, savingsCoverage: preflight.savingsCoverage })
      if (!backgroundPreflight.current) replaceReview(preflight, getCleanOptions(optionOverrides))
      return preflight
    } catch (error) {
      const cancelled = error instanceof DOMException && error.name === 'AbortError'
      logOptimizationDiagnostic('TVOptimizationUI', cancelled ? 'info' : 'error', cancelled ? 'preflight.cancelled' : 'preflight.failed', {
        requestId, scope: episode ? 'episode' : seasonNumber === undefined ? 'series' : 'season', stage: cancelled ? 'preparation.cancelled' : 'preparation.failed', durationMs: Date.now() - requestedAt,
        seriesIdentityKey, mediaItemId: episode?.id, sourceId, libraryId,
        ...(cancelled ? {} : { error: describeDiagnosticError(error) }),
      })
      throw error
    } finally {
      unsubscribeTaskComplete?.()
      if (!backgroundPreflight.current) {
        activePreflightRequestId.current = null
        activePreflightTaskId.current = null
        rejectPreflightWait.current = null
        setPreflightTermination(null)
        setPreflightProgress(null)
        setPreflightOperationState(null)
      }
    }
  }

  const handleDiscoverCandidates = async () => {
    setBusy(true)
    setMessage('')
    setPreflightProgress(null)
    setPreflightOperationState(null)
    try {
      const result = await window.electronAPI.discoverShowOptimization({
        requestId: crypto.randomUUID(),
        mediaItemId: episode?.id,
        seasonNumber,
        seriesTitle: show.series_title,
        seriesIdentityKey,
        sourceId,
        libraryId,
        options: getCleanOptions({}),
      })
      setOptimizationDiscovery(result)
      setSelectedDiscoveryGroups(result.groups.map(group => group.id))
      setIncludeOtherOperationItems(false)
      setRepresentativeMediaItemIds(Object.fromEntries(result.groups.map(group => [group.id, group.representativeMediaItemId])))
      logOptimizationDiagnostic('TVOptimizationUI', 'info', 'discovery.completed', {
        scope: episode ? 'media-item' : seasonNumber === undefined ? 'series' : 'season',
        seriesIdentityKey,
        mediaItemId: episode?.id,
        candidateCount: result.candidateCount,
        groups: result.groups.map(group => ({ id: group.id, mediaItemIds: group.mediaItemIds, representativeMediaItemId: group.representativeMediaItemId })),
        otherOperationMediaItemIds: result.otherOperationMediaItemIds,
      })
      setStage('options')
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error)
      logOptimizationDiagnostic('TVOptimizationUI', 'error', 'discovery.failed', { seriesIdentityKey, mediaItemId: episode?.id, error: describeDiagnosticError(error) })
      setMessage(errMsg)
      addToast({ type: 'error', title: 'Candidate discovery failed', message: errMsg })
    } finally {
      setBusy(false)
    }
  }
  const handleDiscoverCandidatesRef = useRef(handleDiscoverCandidates)
  handleDiscoverCandidatesRef.current = handleDiscoverCandidates

  useEffect(() => {
    if (targetProfilesLoading || initialPreflight || resumeRequestId || optimizationDiscovery || automaticCandidateDiscoveryStarted.current) return
    automaticCandidateDiscoveryStarted.current = true
    void handleDiscoverCandidatesRef.current()
  }, [targetProfilesLoading, initialPreflight, resumeRequestId, optimizationDiscovery])

  const handlePreviewPlan = async (selection?: { selectedMediaItemIds: number[]; representativeMediaItemIds: Record<string, number>; targetCodec?: 'hevc' | 'av1' }) => {
    setBusy(true)
    setMessage('')
    setIsSuccess(false)
    try {
      const preflight = await runPreflight(selection)
      if (backgroundPreflight.current) return
      setMode('preview')
      logOptimizationDiagnostic('TVOptimizationUI', 'info', 'review.opened', { preflightId: preflight.preflightId, batchId: preflight.batchId, episodeCount: preflight.episodes.length, sampleReviewCount: preflight.episodes.filter(item => item.compatible && item.samplePaths?.length).length })
      const hasIncompatibleEpisodes = preflight.episodes.some(item => item.decisionStatus === 'incompatible')
      const hasInsufficientEvidence = preflight.episodes.some(item => item.decisionStatus === 'insufficient_evidence')
      if (hasIncompatibleEpisodes && hasInsufficientEvidence) setMessage('Some episodes are incompatible and others need more evidence.')
      else if (hasIncompatibleEpisodes) setMessage('Some episodes are incompatible with this plan.')
      else if (hasInsufficientEvidence) setMessage('Some episodes need more evidence and will be skipped.')
    } catch (error) {
      if (backgroundPreflight.current) return
      if (error instanceof DOMException && error.name === 'AbortError') return
      const errMsg = error instanceof Error ? error.message : String(error)
      logOptimizationDiagnostic('TVOptimizationUI', 'error', 'review.preflight.failed', { seriesIdentityKey, mediaItemId: episode?.id, error: describeDiagnosticError(error) })
      setMessage(errMsg)
      addToast({
        type: 'error',
        title: 'Review preparation failed',
        message: errMsg
      })
    } finally {
      if (!backgroundPreflight.current) setBusy(false)
    }
  }

  const prepareAlternateRepresentative = async (item: ShowTranscodePreflight['episodes'][number]) => {
    if (!preflightData || !item.samplingGroupKey) throw new Error('The saved sample group identity is unavailable. Discover candidates and analyze the group again.')
    const saved = await window.electronAPI.getShowPreflight(preflightData.preflightId) as SavedShowPreflight | undefined
    if (!saved) throw new Error('The saved optimization review could not be found')
    const selectedMediaItemIds = saved.request.selectedMediaItemIds ?? saved.result.episodes.map(episode => episode.mediaItemId)
    const representativeMediaItemIds = {
      ...saved.request.representativeMediaItemIds,
      [item.samplingGroupKey]: item.mediaItemId,
    }
    await runPreflight({ selectedMediaItemIds, representativeMediaItemIds, representativeMediaItemId: saved.request.representativeMediaItemId })
  }

  const handleQueueFromPreview = async () => {
    if (!preflightData) return
    setBusy(true)
    setMessage('')
    try {
      if (!reviewMatchesCurrentSettings) throw new Error('Optimization settings changed. Prepare a new review before queueing.')
      const requiresApproval = preflightData.episodes.some(episode => episode.compatible && episode.decisionStatus === 'sample_required')
      logOptimizationDiagnostic('TVOptimizationUI', 'info', 'queue.requested', { preflightId: preflightData.preflightId, batchId: preflightData.batchId, requiresSampleApproval: requiresApproval, reviewedSampleGroupCount: reviewedSampleGroups.length })
      if (sampleApprovalGroups.some(group => !reviewedSampleGroups.includes(group.id))) throw new Error('Play and approve the measured sample for every representative group.')
      if (requiresApproval) await window.electronAPI.approveShow(preflightData.preflightId)
      if (qualityProfile) {
        const raw = await window.electronAPI.getSetting(SETTING_KEYS.optimization_quality_preferences)
        const preferences = raw ? JSON.parse(raw) as Record<string, OptimizationQualityProfile> : {}
        await window.electronAPI.setSetting(SETTING_KEYS.optimization_quality_preferences, JSON.stringify({ ...preferences, [qualityPreferenceScopes[0]]: qualityProfile }))
      }
      const queued = await window.electronAPI.queueShow(preflightData.preflightId)
      logOptimizationDiagnostic('TVOptimizationUI', 'info', 'queue.completed', { batchId: queued.batchId, queuedMediaItemIds: queued.queuedMediaItemIds })
      submitBatch(queued.batchId, queued.queuedMediaItemIds, queued.queuedTaskIds)
      setIsSuccess(false)
      setMode('monitoring')
      const count = queued.queuedMediaItemIds.length
      setMessage(`Successfully queued ${count} episode${count === 1 ? '' : 's'} in background task queue.`)
      addToast({
        type: 'success',
        title: 'Batch Transcoding Queued',
        message: `Queued ${count} episodes of "${show.series_title}" for background optimization.`
      })
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error)
      logOptimizationDiagnostic('TVOptimizationUI', 'error', 'queue.failed', { preflightId: preflightData.preflightId, batchId: preflightData.batchId, error: describeDiagnosticError(error) })
      setMessage(errMsg)
      addToast({
        type: 'error',
        title: 'Queueing Failed',
        message: errMsg
      })
    } finally {
      setBusy(false)
    }
  }

  const retryFailedBatchTasks = async () => {
    setBusy(true)
    await retryFailedTasks(count => {
      setMessage(`Queued ${count} failed or cancelled episode${count === 1 ? '' : 's'} for retry.`)
    }, error => {
      const message = error instanceof Error ? error.message : String(error)
      setMessage(message)
      addToast({ type: 'error', title: 'Could not retry optimization', message })
    })
    setBusy(false)
  }

  const toggleBatchPause = async () => {
    await toggleQueuePause((error, resuming) => {
      const message = error instanceof Error ? error.message : String(error)
      setMessage(message)
      addToast({ type: 'error', title: `Could not ${resuming ? 'resume' : 'pause'} optimization`, message })
    })
  }

  // Filter tasks belonging to transcoding
  const vendor = gpus.find(gpu => gpu.id === gpuId)?.vendor
  const hardwareEncoder = vendor && codec ? getHardwareEncoder(vendor, codec) : undefined
  const hardwareAvailable = hardwareEncoder !== undefined && (deviceEncoders[gpuId] ?? []).includes(hardwareEncoder)
  const softwareEncoder = codec === 'av1' ? 'svt_av1' : codec === 'hevc' ? 'x265' : undefined
  const softwareAvailable = softwareEncoder !== undefined && (deviceEncoders.software ?? []).includes(softwareEncoder)
  useEffect(() => {
    const recommendedPolicy = hardwareAvailable || softwareAvailable ? 'automatic' : ''
    logOptimizationDiagnostic('TVOptimizationUI', 'info', 'encoder.policy.recommended', {
      encoderPolicy: recommendedPolicy || null,
      codec: codec || null,
      gpuId: gpuId || null,
      encoder: hardwareAvailable ? hardwareEncoder : softwareAvailable ? softwareEncoder : null
    })
  }, [codec, gpuId, hardwareAvailable, hardwareEncoder, softwareAvailable, softwareEncoder])
  const profileSupportedContainers = targetProfile
    ? getPlaybackTargetContainers(targetProfile, { codec: episode?.video_codec, profile: episode?.video_profile, hdrFormat: episode?.hdr_format })
    : ['matroska', 'mp4']
  const supportedTargetCodecs = OPTIMIZATION_VIDEO_CODECS.map(item => item.value).filter(candidate => {
    const profileSupports = playbackPolicy === 'allow-transcoding' || playbackProfileSupportsOptimizationCodec(candidate, targetProfile?.definition.video.codecs)
    const softwareEncoder = getOptimizationVideoCodec(candidate).softwareEncoder
    const softwareSupports = (deviceEncoders.software ?? []).includes(softwareEncoder)
    const hardwareSupports = gpus.some(gpu => {
      const encoder = getHardwareEncoder(gpu.vendor, candidate)
      return Boolean(encoder && deviceEncoders[gpu.id]?.includes(encoder))
    })
    const selectedHardwareSupports = gpus.some(gpu => {
      const encoder = getHardwareEncoder(gpu.vendor, candidate)
      return gpu.id === gpuId && Boolean(encoder && deviceEncoders[gpu.id]?.includes(encoder))
    })
    const encoderSupports = encoderPolicy === 'software' ? softwareSupports
      : encoderPolicy === 'hardware' ? selectedHardwareSupports
        : softwareSupports || hardwareSupports
    return profileSupports && (!encoderCapabilitiesLoaded || encoderSupports)
  })
  const unsupportedTargetCodecReasons = Object.fromEntries(OPTIMIZATION_VIDEO_CODECS.map(item => item.value)
    .filter(candidate => !supportedTargetCodecs.includes(candidate))
    .map(candidate => {
      const label = getOptimizationVideoCodec(candidate).shortLabel
      if (!playbackProfileSupportsOptimizationCodec(candidate, targetProfile?.definition.video.codecs)) return [candidate, `Not supported by ${targetProfile?.name}.`]
      if (!encoderCapabilitiesLoaded) return [candidate, 'Checking encoder support.']
      if (encoderPolicy === 'software') return [candidate, `Software encoding for ${label} is unavailable.`]
      if (encoderPolicy === 'hardware') return [candidate, gpus.find(gpu => gpu.id === gpuId) ? `${gpus.find(gpu => gpu.id === gpuId)?.name} cannot encode ${label}.` : `Choose a GPU that supports ${label}.`]
      return [candidate, `No compatible ${label} encoder is available.`]
    })) as Partial<Record<'hevc' | 'av1', string>>
  const missingSettings = getMissingSettings()
  const queueableEpisodeCount = preflightData?.episodes.filter(episode =>
    episode.compatible && (episode.decisionStatus === 'actionable' || episode.decisionStatus === 'sample_required'),
  ).length ?? 0
  const unreviewedSampleGroup = sampleApprovalGroups.some(group => !reviewedSampleGroups.includes(group.id))
  const queueDisabledReason = !preflightData?.compatible
    ? 'No episodes are compatible with the selected optimization plan.'
    : queueableEpisodeCount === 0
      ? 'No episodes have an actionable optimization plan. Change settings and prepare a new review.'
      : unreviewedSampleGroup
        ? 'Review and approve each measured sample group before queueing.'
        : undefined
  const isSubmittedTask = (task: QueuedTask) => task.batchId === activeBatchId && (submittedTaskIds.length > 0 ? submittedTaskIds.includes(task.id) : submittedMediaItemIds.includes(task.mediaItemId ?? -1))
  const batchQueue = queueState.queue.filter(isSubmittedTask)
  const batchCompletedTasks = queueState.completedTasks.filter(isSubmittedTask)
  const currentTask = queueState.currentTask && isSubmittedTask(queueState.currentTask) ? queueState.currentTask : null
  const isCurrentTranscode = currentTask?.type === TaskType.Transcode
  const currentTaskStatusLabel = currentTask?.status === 'cancelling' ? 'Cancelling' : queueState.isPaused ? 'Paused' : 'Running'
  const currentTaskStartedAt = currentTask?.startedAt ? Date.parse(currentTask.startedAt) : undefined
  const [currentTaskElapsedSeconds, setCurrentTaskElapsedSeconds] = useState(0)

  useEffect(() => {
    if (currentTaskStartedAt === undefined) return
    const updateElapsed = () => setCurrentTaskElapsedSeconds(Math.floor((Date.now() - currentTaskStartedAt) / 1000))
    updateElapsed()
    const interval = window.setInterval(updateElapsed, 1000)
    return () => window.clearInterval(interval)
  }, [currentTaskStartedAt])

  const preflightProgressPanel = busy && preflightProgress ? (
    <div role="status" aria-live="polite" className="rounded-xl border border-primary/30 bg-primary/5 p-3 space-y-2">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="font-semibold">{preflightOperationState === 'paused' ? 'Review preparation paused' : preflightProgress.phase || (seasonNumber === undefined ? 'Preparing series review' : `Preparing Season ${seasonNumber} review`)}</span>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground tabular-nums">Elapsed {preparationElapsedSeconds}s</span>
          {typeof preflightProgress.percentage === 'number' && <span className="text-muted-foreground tabular-nums">{preflightProgress.percentage}%</span>}
          <button
            type="button"
            disabled={!activePreflightRequestId.current || preflightTermination !== null || preflightOperationState === 'pausing' || preflightOperationState === 'finishing'}
            onClick={() => {
              const requestId = activePreflightRequestId.current
              if (!requestId) return
              const shouldPause = preflightOperationState !== 'paused'
              setPreflightOperationState(shouldPause ? 'pausing' : 'running')
              void (shouldPause ? window.electronAPI.taskQueuePause() : window.electronAPI.taskQueueResume()).then(() => {
                logOptimizationDiagnostic('TVOptimizationUI', 'info', shouldPause ? 'preflight.pause.requested' : 'preflight.resume.requested', { requestId, taskId: activePreflightTaskId.current })
              }).catch(error => {
                logOptimizationDiagnostic('TVOptimizationUI', 'error', 'preflight.pause-control.failed', { requestId, error: describeDiagnosticError(error) })
                setMessage(error instanceof Error ? error.message : String(error))
              })
            }}
            className="rounded-md border border-border/60 px-2 py-1 font-semibold hover:bg-muted disabled:opacity-50"
          >
            {preflightOperationState === 'pausing' ? 'Pausing…' : preflightOperationState === 'paused' ? 'Resume' : 'Pause'}
          </button>
          <button
            type="button"
            disabled={!activePreflightRequestId.current || preflightTermination !== null || preflightOperationState === 'finishing'}
            onClick={() => {
              const requestId = activePreflightRequestId.current
              const taskId = activePreflightTaskId.current
              if (!requestId || !taskId) return
              setPreflightTermination('cancelling')
              const running = queueState.currentTask?.id === taskId
              void (running ? window.electronAPI.taskQueueCancelCurrent() : window.electronAPI.taskQueueRemoveTask(taskId)).then(() => {
                logOptimizationDiagnostic('TVOptimizationUI', 'info', 'preflight.cancel.requested', { requestId, taskId })
                if (!running) rejectPreflightWait.current?.(new DOMException('Preflight cancelled', 'AbortError'))
              }).catch(error => {
                logOptimizationDiagnostic('TVOptimizationUI', 'error', 'preflight.cancel.failed', { requestId, error: describeDiagnosticError(error) })
                setPreflightTermination(null)
                setMessage(error instanceof Error ? error.message : String(error))
              })
            }}
            className="rounded-md border border-destructive/40 px-2 py-1 font-semibold text-destructive hover:bg-destructive/10 disabled:opacity-50"
          >
            {preflightTermination === 'cancelling' ? 'Stopping…' : 'Stop'}
          </button>
        </div>
      </div>
      {typeof preflightProgress.percentage === 'number' ? <div
        role="progressbar"
        aria-label="Review preparation progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={preflightProgress.percentage}
        className="h-1.5 overflow-hidden rounded-full bg-muted"
      >
        <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${preflightProgress.percentage}%` }} />
      </div> : <Activity className="h-4 w-4 animate-pulse text-primary" aria-label="Preparation progress unavailable" />}
      <p className="text-xs text-muted-foreground break-words">{preflightProgress.currentItem || 'Preparing episode checks…'}</p>
      <p className="text-[11px] text-muted-foreground">Pause stops the active sample and keeps completed work. Close this window to leave the task in the queue.</p>
    </div>
  ) : null

  return <OptimizationDialogShell
    scope={scope}
    stage={optimizationDialogStage(mode === 'preview', mode === 'monitoring')}
    availableStages={availableOptimizationDialogStages(Boolean(preflightData && reviewMatchesCurrentSettings), Boolean(batchSummary || queueState.currentTask || mode === 'monitoring'))}
    onStageChange={next => {
      if (next === 'Settings') setMode('config')
      else if (next === 'Review' && preflightData && reviewMatchesCurrentSettings) setMode('preview')
      else if (next === 'Results' && (batchSummary || queueState.currentTask || mode === 'monitoring')) setMode('monitoring')
    }}
    title={episode ? 'Optimize episode' : seasonNumber === undefined ? 'Optimize show' : `Optimize season ${seasonNumber}`}
    subtitle={`${show.series_title}${episode ? ` · S${String(episode.season_number ?? '?').padStart(2, '0')}E${String(episode.episode_number ?? '?').padStart(2, '0')}` : `${seasonNumber === undefined ? '' : ` · Season ${seasonNumber}`}${preflightData ? ` · ${preflightData.episodeCount} items` : ''}`}`}
    leading={mode === 'monitoring' ? <Activity className="h-5 w-5 animate-pulse" /> : <Zap className="h-5 w-5 fill-current" />}
    onClose={() => void handleClose()}
    closeText={busy ? 'Continue in background' : undefined}
    wide
    footer={mode === 'config' ? <OptimizationDialogFooter
      leadingAction={{
        label: preflightTermination === 'cancelling' ? 'Stopping…' : preflightTermination === 'finishing' ? 'Finishing…' : activePreflightRequestId.current ? 'Stop preparation' : 'Cancel',
        onClick: () => void handleClose(),
        disabled: preflightTermination !== null,
        title: preflightTermination === 'cancelling' ? 'Cancelling optimization review' : preflightTermination === 'finishing' ? 'Finishing optimization review' : undefined,
      }}
      secondaryAction={missingSettings.includes('original audio language') ? { label: 'Edit audio', onClick: () => setTrackSettingsOpen(true), variant: 'outline' } : undefined}
      status={missingSettings.length ? describeMissingOptimizationSettings(missingSettings) : undefined}
      primaryAction={{
        label: busy ? <><RefreshCw className="h-4 w-4 animate-spin" />Finding candidates…</> : <><Sparkles className="h-4 w-4" />Find candidates</>,
        onClick: () => void handleDiscoverCandidates(),
        disabled: busy || targetProfilesLoading || missingSettings.length > 0,
      }}
    /> : mode === 'candidates' ? <OptimizationDialogFooter
      leadingAction={{ label: <><ArrowLeft className="h-3.5 w-3.5" />Change settings</>, onClick: () => setMode('config') }}
      primaryAction={{
        label: busy ? <><RefreshCw className="h-4 w-4 animate-spin" />Preparing review…</> : <><Sparkles className="h-4 w-4" />Prepare review</>,
        onClick: () => {
          const groups = optimizationDiscovery?.groups.filter(group => selectedDiscoveryGroups.includes(group.id)) ?? []
          const targetCodecs = new Set(groups.flatMap(group => group.targetCodec ? [group.targetCodec] : []))
          if (targetCodecs.size > 1) {
            setMessage('Prepare one target codec at a time. Select groups with the same target codec.')
            return
          }
          const selectedTargetCodec = [...targetCodecs][0]
          if (selectedTargetCodec && (playbackPolicy === 'allow-transcoding' || !targetProfile || targetProfile.definition.video.codecs.some(value => normalizeVideoCodec(value) === normalizeVideoCodec(selectedTargetCodec)))) {
            setCodec(selectedTargetCodec)
          }
          const selectedRepresentatives = Object.fromEntries(groups.map(group => [group.id, representativeMediaItemIds[group.id]]))
          const selectedIds = [...groups.flatMap(group => group.mediaItemIds), ...(includeOtherOperationItems ? optimizationDiscovery?.otherOperationMediaItemIds ?? [] : [])]
          void handlePreviewPlan({ selectedMediaItemIds: selectedIds, representativeMediaItemIds: selectedRepresentatives, targetCodec: selectedTargetCodec })
        },
        disabled: busy || selectedDiscoveryGroups.length === 0 && !includeOtherOperationItems,
        title: selectedDiscoveryGroups.length === 0 && !includeOtherOperationItems ? 'Select candidates to continue.' : undefined,
      }}
    /> : mode === 'preview' ? <OptimizationDialogFooter
      leadingAction={{ label: <><ArrowLeft className="h-3.5 w-3.5" />Change settings</>, onClick: () => setMode('config') }}
      status={queueDisabledReason}
      primaryAction={{
        label: busy ? <><RefreshCw className="h-4 w-4 animate-spin" />Starting optimization…</> : <><Sparkles className="h-4 w-4" />Start optimization</>,
        onClick: () => void handleQueueFromPreview(),
        disabled: busy || Boolean(queueDisabledReason),
      }}
    /> : <OptimizationDialogFooter
      secondaryAction={{ label: 'Open task queue', onClick: () => window.dispatchEvent(new Event('taskQueue:open')), variant: 'text' }}
      primaryAction={{ label: 'Run in background', onClick: () => void handleClose() }}
    />}
  >

        {preflightProgressPanel}

        {/* Content */}
        {mode === 'config' ? (
          <div className="p-5 sm:p-6 space-y-5">
            <div className="flex justify-end">
              <button type="button" onClick={() => void loadQuarantine()} disabled={loadingBackups} className="text-xs text-primary underline disabled:opacity-50">{loadingBackups ? 'Loading backups…' : 'View backups'}</button>
            </div>
            {quarantineFiles.length > 0 && <section className="space-y-3 rounded-xl border border-border/40 bg-muted/20 p-3" aria-label="Original backups">
              <div className="flex items-center justify-between gap-3"><div className="min-w-0"><div className="text-xs font-bold">Original backups</div><div className="text-[11px] text-muted-foreground">{quarantineFiles.length} file{quarantineFiles.length === 1 ? '' : 's'} · {formatBytes(quarantineFiles.reduce((total, file) => total + file.size, 0))}</div></div><button type="button" onClick={() => void purgeQuarantine()} disabled={quarantineFiles.some(file => !file.owned)} className="shrink-0 rounded-lg border border-red-500/40 px-2.5 py-1.5 text-xs text-red-300 disabled:opacity-40">Delete backups</button></div>
              <ul className="divide-y divide-border/40 text-xs">{quarantineFiles.map(file => <li key={`${file.mediaItemId}:${file.path}`} className="flex flex-wrap justify-between gap-x-4 gap-y-1 py-2 first:pt-0 last:pb-0"><span className="min-w-0 break-all">{file.label}</span><span className="shrink-0 text-muted-foreground">{formatBytes(file.size)} · {new Date(file.modifiedAt).toLocaleString()}</span></li>)}</ul>
            </section>}
            <OptimizationSettingsLayout profiles={targetProfiles} targetProfileId={targetProfileId} targetError={targetProfileError} qualityProfile={qualityProfile} targetCodec={codec} supportedTargetCodecs={supportedTargetCodecs} unsupportedTargetCodecReasons={unsupportedTargetCodecReasons} videoRequired={optimizationMode !== 'remux_only'} playbackPolicy={playbackPolicy} onPlaybackPolicyChange={value => { logOptimizationDiagnostic('TVOptimizationUI', 'info', 'playback.policy.selected', { playbackPolicy: value }); updateConfiguration({ playbackPolicy: value }) }} trackSummary={optimizationTrackSummary(configuration)} trackSettingsOpen={trackSettingsOpen} onTrackSettingsOpenChange={setTrackSettingsOpen} encodingSummary={`${encoderPolicy === 'software' ? 'Software' : gpus.find(gpu => gpu.id === gpuId)?.name ?? 'Automatic encoder'} · ${codec === 'hevc' ? 'H.265' : codec.toUpperCase()} · ${targetContainer?.toUpperCase() || 'Automatic container'}`} onQualityProfileChange={value => { logOptimizationDiagnostic('TVOptimizationUI', 'info', 'quality.preference.selected', { qualityProfile: value }); setQualityProfile(value) }} onTargetCodecChange={value => { if (value) logOptimizationDiagnostic('TVOptimizationUI', 'info', 'video.codec.selected', { targetCodec: value }); setCodec(value) }} audioConversion={{ enabled: audioTranscodeEnabled, codec: targetAudioCodec, sourceCodec: episode?.audio_codec, options: optimizationAudioCodecOptions(targetProfile?.definition.audio.codecs), onEnabledChange: enabled => { if (!enabled) setTargetAudioCodec(''); else updateConfiguration({ audioTranscodeEnabled: true }) }, onCodecChange: value => { const selectedCodec = value as typeof targetAudioCodec; logOptimizationDiagnostic('TVOptimizationUI', 'info', 'audio.conversion.selected', { targetAudioCodec: selectedCodec }); setTargetAudioCodec(selectedCodec) } }} loadingTargets={targetProfilesLoading} disabled={busy} onTargetProfileChange={profileId => {
                logOptimizationDiagnostic('TVOptimizationUI', 'info', 'playback.target.selected', { targetProfileId: profileId || null })
                updateConfiguration({ targetProfileId: profileId })
              const profile = targetProfiles.find(candidate => candidate.id === profileId)
              if (!profile) {
                setTargetHdrFormat('')
                return
              }
              if (codec && !profile.definition.video.codecs.some(value => normalizeVideoCodec(value) === normalizeVideoCodec(codec))) setCodec('')
              const normalizedContainer = targetContainer === 'mkv' ? 'matroska' : targetContainer
              if (normalizedContainer && !profile.definition.containers.includes(normalizedContainer as typeof profile.definition.containers[number])) {
                updateConfiguration({ targetContainer: '', targetContainerSelection: 'automatic' })
              }
              }} optimizationMode={optimizationMode} onOptimizationModeChange={mode => {
              logOptimizationDiagnostic('TVOptimizationUI', 'info', 'strategy.selected', { mode })
              updateConfiguration({ optimizationMode: mode })
            }} outputMode={outputMode} onOutputModeChange={value => void selectOutputMode(value)} playbackOptions={<>
            <AudioTrackPolicySelection
              policy={audioTrackPolicy === 'all' ? 'all' : 'preferred'}
              language={language}
              languages={audioLanguageOptions}
              disabled={busy}
              onPolicyChange={policy => updateConfiguration({ audioTrackPolicy: policy === 'all' ? 'all' : 'original-and-protected' })}
              onLanguageChange={value => updateConfiguration({ originalAudioLanguage: value })}
            />

            <SubtitleLanguageSelection value={subtitleWhitelist} onChange={value => updateConfiguration({ subtitleLanguages: value })} disabled={busy} />

            </>}
            outputOptions={<>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <OptimizationContainerSelection
                value={targetContainer}
                placeholder={!episode ? 'Automatic per episode' : !targetContainer ? 'No supported container available' : undefined}
                options={optimizationContainerOptions(profileSupportedContainers)}
                disabled={busy || !adjustToTarget}
                onChange={value => {
                  const container = value as typeof targetContainer
                  logOptimizationDiagnostic('TVOptimizationUI', 'info', 'output.container.selected', { targetContainer: container || null, selection: container ? 'user-selected' : 'automatic' })
                  updateConfiguration({ targetContainer: container, targetContainerSelection: container ? 'user-selected' : 'automatic' })
                }}
              />
              {targetProfile && episode && ['DOLBY VISION', 'HDR10+'].includes(sourceHdrFormat ?? '') && optimizationMode !== 'transcode'
                ? <p className="self-center text-xs text-muted-foreground">Dynamic HDR video is preserved.</p>
                : targetProfile ? <label className="space-y-1">Color<select aria-label="Color" value={targetHdrFormat} disabled={busy || !adjustToTarget} onChange={e => { const value = e.target.value as typeof targetHdrFormat; logOptimizationDiagnostic('TVOptimizationUI', 'info', 'output.color.selected', { targetHdrFormat: value }); setTargetHdrFormat(value) }}><option value="">{episode ? 'Choose conversion' : 'Automatic per episode'}</option><option value="SDR">SDR</option>{targetProfile.definition.hdr.formats.includes('HDR10') && <option value="HDR10">HDR10</option>}</select></label> : null}
            </div>

            </>}
            advancedOptions={<EncoderPolicySelector value={encoderPolicy} hardwareAvailable={hardwareAvailable} softwareAvailable={softwareAvailable} disabled={busy} onChange={policy => { logOptimizationDiagnostic('TVOptimizationUI', 'info', 'encoder.policy.selected', { encoderPolicy: policy ?? '' }); setEncoderPolicy(policy ?? '') }} />}
            />

            <details className="space-y-3 rounded-xl border border-border/40 bg-card/20 p-3">
              <summary className="cursor-pointer list-none text-xs font-bold uppercase tracking-wider text-muted-foreground">Execution and output</summary>
            {/* Status Message */}
            {message && (
              <div className={`p-3 rounded-xl text-xs flex items-center gap-2.5 ${
                isSuccess
                  ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
                  : 'bg-destructive/10 border border-destructive/20 text-destructive'
              }`}>
                {isSuccess ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
                <span>{message}</span>
              </div>
            )}
            </details>
          </div>
        ) : mode === 'candidates' && optimizationDiscovery ? (
          <div className="p-5 sm:p-6 space-y-4">
            {message && <div role="status" className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">{message}</div>}
            <div className="rounded-xl border border-border/40 bg-muted/20 p-4 space-y-2">
              <h3 className="text-sm font-bold">Optimization candidates</h3>
              <p className="text-xs text-muted-foreground">{optimizationDiscovery.candidateCount} files found. Savings are metadata estimates until review sampling confirms them.</p>
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer">How grouping works</summary>
                <p className="pt-1">Similar files are grouped. Choose one episode to measure each group.</p>
              </details>
            </div>
            {optimizationDiscovery.groups.length === 0 ? <p className="rounded-lg border border-border/40 p-3 text-xs text-muted-foreground">No video candidates found. You can still review stream, container, and playback changes below.</p> : null}
            <div className="space-y-2">
              {optimizationDiscovery.groups.map(group => {
                const selected = selectedDiscoveryGroups.includes(group.id)
                return <div key={group.id} className="rounded-xl border border-border/40 bg-card/20 p-3 flex flex-wrap items-center gap-3">
                  <input aria-label={`Analyze group ${group.technicalProfile}`} type="checkbox" checked={selected} onChange={event => setSelectedDiscoveryGroups(current => event.target.checked ? [...current, group.id] : current.filter(id => id !== group.id))} />
                  <div className="min-w-[180px] flex-1"><p className="text-xs font-semibold">{group.seasonNumber === undefined ? 'Film' : `Season ${group.seasonNumber}`} · {group.mediaItemIds.length} file{group.mediaItemIds.length === 1 ? '' : 's'}</p><p className="text-[11px] text-muted-foreground">{group.technicalProfile} · Target {group.targetCodec?.toUpperCase() ?? codec.toUpperCase()} · {formatBytes(group.estimatedSavingsBytes ?? undefined)} estimated</p><p className="mt-1 text-[11px] text-muted-foreground">{group.candidateReasons.map(optimizationCandidateReasonLabel).join(' · ')}</p><details className="mt-1 text-[11px] text-muted-foreground"><summary className="cursor-pointer">Per-file reasons and estimates</summary><ul className="ml-4 mt-1 list-disc space-y-1">{group.mediaItemIds.map(id => <li key={id}><span className="text-foreground">{group.mediaItemLabels[id]}</span> · {(group.candidateReasonsByMediaItemId[id] ?? []).map(optimizationCandidateReasonLabel).join(' · ')} · {formatBytes(group.estimatedSavingsByMediaItemId[id] ?? undefined)} estimated savings</li>)}</ul></details></div>
                  <label className="text-[11px] text-muted-foreground">Representative
                    <select aria-label={`Representative for ${group.technicalProfile}`} value={representativeMediaItemIds[group.id] ?? group.representativeMediaItemId} onChange={event => setRepresentativeMediaItemIds(current => ({ ...current, [group.id]: Number(event.target.value) }))} className="ml-2 max-w-64 rounded-md border border-border bg-background px-2 py-1 text-foreground">
                  {group.mediaItemIds.map(id => <option key={id} value={id}>{group.mediaItemLabels[id]}{id === group.representativeMediaItemId ? ' (median bitrate)' : ''}</option>)}
                    </select>
                  </label>
                </div>
              })}
            </div>
            {optimizationDiscovery.otherOperationCandidates.length > 0 && <section className="rounded-lg border border-border/40 p-3 text-xs"><label className="flex items-start gap-2"><input type="checkbox" checked={includeOtherOperationItems} onChange={event => setIncludeOtherOperationItems(event.target.checked)} /><span>Include {optimizationDiscovery.otherOperationCandidates.length} file{optimizationDiscovery.otherOperationCandidates.length === 1 ? '' : 's'} with stream or remux candidates.</span></label><ul className="mt-2 ml-5 list-disc space-y-1 text-[11px] text-muted-foreground">{optimizationDiscovery.otherOperationCandidates.map(candidate => <li key={candidate.mediaItemId}><span className="text-foreground">{candidate.label}</span> · {candidate.candidateReasons.map(optimizationCandidateReasonLabel).join(' · ')} · {formatBytes(candidate.estimatedSavingsBytes ?? undefined)} estimated savings</li>)}</ul></section>}
          </div>
        ) : mode === 'preview' && preflightData ? (
          /* Preflight Preview Mode */
          <div className="p-5 sm:p-6 space-y-4">
            {message && <div role={isSuccess ? 'status' : 'alert'} className={`rounded-xl border p-3 text-xs ${isSuccess ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400' : 'border-destructive/20 bg-destructive/10 text-destructive'}`}>{message}</div>}
            {/* Summary card */}
            <OptimizationReviewSummary title="Review" estimatedSavingsBytes={preflightData.estimatedSavingsBytes} coverage={preflightData.savingsCoverage ?? 'insufficient'} scopeSummary={`${preflightData.episodes.length} episodes · ${preflightData.episodes.filter(ep => ep.samplingRole === 'measured').length} measured`}>
              <div className="divide-y divide-border/40 rounded-xl border border-border/40 bg-background/40" aria-label="Plan summary">
                <div className="p-3 text-xs text-muted-foreground">Playback target: {targetProfile?.name ?? 'None selected'}</div>
                <div className="p-3 text-xs text-muted-foreground">{preflightData.episodes.filter(e => e.operations.includes('stream_pruning') || e.operations.includes('subtitle_pruning')).length} episodes will have streams removed</div>
                <div className="p-3 text-xs text-muted-foreground">{preflightData.episodes.filter(e => e.operations.includes('video_transcode') || e.operations.includes('audio_transcode') || e.operations.includes('container_change')).length} episodes need output changes</div>
                <details className="group">
                  <summary className="flex cursor-pointer list-none items-center gap-3 p-3">
                    <span className="text-emerald-400">✓</span><span className="min-w-0 flex-1"><span className="block text-sm font-semibold">Up to date</span><span className="block text-xs text-muted-foreground">{preflightData.episodes.filter(e => e.decisionStatus === 'already_optimized').length} episodes need no changes</span></span>
                  </summary>
                </details>
                <details className="group">
                  <summary className="flex cursor-pointer list-none items-center gap-3 p-3">
                    <span className="text-amber-300">?</span><span className="min-w-0 flex-1"><span className="block text-sm font-semibold">Needs attention</span><span className="block text-xs text-muted-foreground">{preflightData.episodes.filter(e => e.decisionStatus === 'insufficient_evidence').length} need analysis · {preflightData.episodes.filter(e => e.decisionStatus === 'measurement_failed').length} failed · {preflightData.episodes.filter(e => e.decisionStatus === 'quality_threshold_unmet').length} below quality target · {preflightData.episodes.filter(e => e.decisionStatus === 'no_savings').length} with no savings</span></span>
                  </summary>
                </details>
              </div>
            </OptimizationReviewSummary>

            <button disabled={busy} className="text-xs underline" onClick={() => {
              setBusy(true)
              setMessage('')
              setIsSuccess(false)
              void window.electronAPI.seriesAnalyzeByIdentity(seriesIdentityKey, sourceId, libraryId)
                .then(async () => {
                  await runPreflight()
                  setMessage('Review updated.')
                  setIsSuccess(true)
                })
                .catch(error => {
                  const message = error instanceof Error ? error.message : String(error)
                  setMessage(message)
                  setIsSuccess(false)
                  addToast({ type: 'error', title: 'Show analysis failed', message })
                })
                .finally(() => setBusy(false))
            }}>Analyze show using series analysis</button>
            <p className="text-xs">Ready {preflightData.episodes.filter(ep => ep.compatible && ep.decisionStatus === 'actionable').length} · Samples {preflightData.episodes.filter(ep => ep.compatible && ep.decisionStatus === 'sample_required').length} · Blocked {preflightData.episodes.filter(ep => !ep.compatible).length}</p>
            {/* Episodes breakdown */}
            <div className="space-y-2">
              <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                Episodes ({preflightData.episodes.length})
              </div>
              <div className="space-y-2">
                {preflightData.episodes.map(ep => (
                  <OptimizationReviewItem
                    key={ep.mediaItemId}
                    item={ep}
                    targetSelected={Boolean(targetProfileId)}
                    badges={<>{getSourceTierBadge(ep.sourceTier)}{getAdvisoryBadges(ep.operations, ep.compatible, ep.decisionStatus)}</>}
                  >
                    <p className="text-[11px] text-muted-foreground">{formatBytes(ep.sourceSize)} · {ep.hdrFormat}</p>
                    {ep.samplingRole === 'projected' && <p className="text-xs text-amber-300">Savings projected from {ep.sampleRepresentativeLabel}.</p>}
                    {ep.decisionStatus === 'insufficient_evidence' && ep.reason?.startsWith('Not sampled:') && ep.sourceAnalysis?.video && <button className="text-xs underline" disabled={busy} onClick={() => { logOptimizationDiagnostic('TVOptimizationUI', 'info', 'preflight.representative.reselected', { preflightId: preflightData.preflightId, mediaItemId: ep.mediaItemId, samplingGroupKey: ep.samplingGroupKey }); void prepareAlternateRepresentative(ep).catch(error => { const message = error instanceof Error ? error.message : String(error); setMessage(message); addToast({ type: 'error', title: 'Could not retry representative sample', message }) }) }}>Use this episode as the sample for its technical group</button>}
                    {ep.sourceAnalysis?.video ? <details className="text-[11px]"><summary className="cursor-pointer text-muted-foreground">Source technical evidence</summary><p>{ep.sourceAnalysis.video.codec} · {ep.sourceAnalysis.video.width}×{ep.sourceAnalysis.video.height} · {ep.sourceAnalysis.video.frameRate} fps · {ep.sourceAnalysis.video.bitDepth}-bit · {ep.sourceAnalysis.video.bitrateKbps ? `${Math.round(ep.sourceAnalysis.video.bitrateKbps)} kb/s` : 'bitrate unavailable'} · {ep.hdrFormat} · {ep.sourceCambiMean === undefined ? 'source banding metric unavailable' : `source CAMBI ${ep.sourceCambiMean.toFixed(2)}`} · {ep.sourceSelfVmaf === undefined ? 'source-self control unavailable' : `source-self VMAF ${ep.sourceSelfVmaf.toFixed(2)}`}</p></details> : null}
                    {ep.qualityChoices?.length ? <details className="text-[11px]"><summary className="cursor-pointer text-muted-foreground">Quality measurements</summary><div className="mt-2 grid gap-2">{ep.qualityChoices.map(choice => <div key={choice.profile}><p><strong>{choice.profile === 'transparent' ? 'Higher fidelity' : choice.profile === 'balanced' ? 'Balanced' : 'Smaller file'}:</strong> {choice.status === 'available' ? `${(choice.estimatedSavingsBytes == null ? 'Not measured' : formatBytes(choice.estimatedSavingsBytes))} estimated savings · ${choice.candidate?.encoder}/${choice.candidate?.preset} q${choice.candidate?.quality} · ${choice.candidate?.sampledDurationSeconds.toFixed(0)}s sampled · VMAF ${choice.candidate?.vmafMean.toFixed(1)} mean, ${choice.candidate?.vmafP5.toFixed(1)} p5 · CAMBI ${choice.candidate?.cambiMean.toFixed(2)} output / ${choice.candidate?.sourceCambiMean?.toFixed(2) ?? 'source unavailable'} source · source-self VMAF ${choice.candidate?.sourceSelfVmaf?.toFixed(2) ?? 'unavailable'} · ${((choice.candidate?.encodingDurationMs ?? 0) / 1000).toFixed(1)}s sample encode` : choice.status === 'measurement_incomplete' ? 'Measurements are incomplete' : choice.status === 'incompatible' ? 'Does not meet playback requirements' : choice.status === 'no_positive_savings' ? 'No space saved' : 'No candidate meets this quality setting'}</p>{choice.alternatives && choice.alternatives.length > 1 ? <details className="mt-1"><summary className="cursor-pointer">Compare {choice.alternatives.length} settings</summary><ul className="ml-4 list-disc">{choice.alternatives.map(candidate => <li key={`${candidate.encoder}/${candidate.preset}/${candidate.quality}`}>{candidate.encoder}/{candidate.preset} q{candidate.quality} · {formatBytes(candidate.outputBytes)} / {candidate.sampledDurationSeconds.toFixed(0)}s sampled · VMAF {candidate.vmafMean.toFixed(1)} mean / {candidate.vmafP5.toFixed(1)} p5 · CAMBI {candidate.cambiMean.toFixed(2)} · {((candidate.encodingDurationMs ?? 0) / 1000).toFixed(1)}s</li>)}</ul></details> : null}</div>)}</div></details> : null}
                    {ep.samplePaths?.length && <p className="text-xs text-muted-foreground">Measured sample is shown in its representative group below.</p>}
                    {(ep.evidenceStatus || ep.adviceReason) && <details className="text-[11px]"><summary className="cursor-pointer text-muted-foreground">Analysis details</summary>{ep.evidenceStatus && <p>{ep.evidenceStatus}</p>}{ep.adviceReason && <p>{ep.adviceReason}</p>}</details>}
                  </OptimizationReviewItem>
                ))}
              </div>
            </div>

            {sampleApprovalGroups.map(group => <section key={group.id} className="space-y-2 rounded-xl border border-primary/30 bg-primary/5 p-3">
              <h4 className="text-sm font-semibold">Measured sample group · {group.representativeLabel}</h4>
              <p className="text-xs text-muted-foreground">Other episodes use these settings; their savings are projected.</p>
              <ul className="space-y-1 text-xs">{group.episodes.map(item => <li key={item.mediaItemId} className="flex justify-between gap-3"><span>{item.label}{item.mediaItemId === group.representativeMediaItemId ? ' · measured representative' : ' · uses representative settings'}</span><span>{item.mediaItemId === group.representativeMediaItemId ? 'Sample-based projection: ' : 'Representative-based projection: '}<EstimatedSavingsDisplay bytes={item.estimatedSavingsBytes} /></span></li>)}</ul>
              <div className="flex flex-wrap gap-2">{group.samplePaths.map((sample, index) => <button key={`${sample}-${index}`} type="button" className="underline text-xs" onClick={() => { const mediaItemId = group.representativeMediaItemId; void window.electronAPI.openShowSample(preflightData.preflightId, mediaItemId, index).catch(error => { const message = error instanceof Error ? error.message : String(error); setMessage(message); addToast({ type: 'error', title: 'Could not open measured sample', message }) }) }}>Play representative sample {index + 1}</button>)}</div>
              <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={reviewedSampleGroups.includes(group.id)} disabled={busy} onChange={event => {
                const approved = event.target.checked
                void window.electronAPI.setShowSampleApproval(preflightData.preflightId, group.id, approved)
                  .then(setReviewedSampleGroups)
                  .catch(error => setMessage(error instanceof Error ? error.message : String(error)))
              }} /><span>I reviewed and approve this measured sample group.</span></label>
            </section>)}

            {preflightData.episodes.some(episode => !episode.compatible) && (
              <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>Some episodes are blocked or need more evidence. Review the details above.</span>
              </div>
            )}
          </div>
        ) : (
          /* Live Monitoring Mode */
          <OptimizationResultsStage summary={batchSummary ?? null} queuePaused={queueState.isPaused} waitingCount={batchQueue.length} queueControlState={batchQueueControlState} retryDisabled={busy} showBatchSummary={!currentTask || !isCurrentTranscode} tasks={batchCompletedTasks} onTogglePause={() => void toggleBatchPause()} onRetry={() => void retryFailedBatchTasks()} onOpenQueue={() => window.dispatchEvent(new Event('taskQueue:open'))}>
            {currentTask && isCurrentTranscode && <OptimizationEncodingProgress
                label={currentTask.label}
                status={currentTaskStatusLabel}
                percent={currentTask.progress?.percentage ?? null}
                phase={currentTask.progress?.phase}
                fps={currentTask.progress?.fps ? `${currentTask.progress.fps} FPS` : null}
                speed={currentTask.progress?.speed}
                eta={currentTask.progress?.eta}
                elapsed={`${Math.floor(currentTaskElapsedSeconds / 60)}m ${currentTaskElapsedSeconds % 60}s`}
              />}
          </OptimizationResultsStage>
        )}


  </OptimizationDialogShell>
}
