import { useState, useEffect, useCallback, useMemo, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  Zap,
  X,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Layers,
  ShieldCheck,
  Sparkles,
  Volume2,
  FileCheck,
  Gauge,
  Clock,
  Activity,
  Languages,
  Scissors,
  Eye,
  ArrowLeft
} from 'lucide-react'
import { useToast } from '@/contexts/ToastContext'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import type { TVShowSummary, MediaItem } from './types'
import type { GpuInfo, PlannedOptimizationOperation, ShowTranscodePreflight } from './transcoding/types'
import { EncoderPolicySelector } from './transcoding/EncoderPolicySelector'
import { formatLanguage, getOptimizationContainer, isSameLanguage, LANGUAGE_OPTIONS, parseLanguageWhitelist } from './mediaUtils'
import { describeDiagnosticError, logOptimizationDiagnostic } from './optimizationDiagnostics'
import { EstimatedSavingsDisplay } from './EstimatedSavingsDisplay'
import { PlaybackCompatibilityFindings } from './PlaybackCompatibilityPanel'
import { getTVShowIdentity } from './tv/showIdentity'
import type { QueueState, QueuedTask } from '@main/types/taskQueue'
import { getPlaybackTargetContainers, recommendPlaybackTargetContainer, type PlaybackTargetProfile } from '@main/types/playbackTarget'
import type { OptimizationQualityProfile } from '@main/services/MeasuredOptimizationPolicy'
import { getHardwareEncoder } from '@main/services/TranscodingCapabilities'
import { TaskType } from '@main/types/database'
import { SETTING_KEYS } from '@shared/settingKeys'
import { normalizeAudioCodec, normalizeVideoCodec } from '@main/services/MediaNormalizer'

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
  const outcome = decisionStatus === 'quality_threshold_unmet' ? 'Quality threshold unmet'
    : decisionStatus === 'measurement_failed' ? 'Measurement failed'
      : decisionStatus === 'no_savings' ? 'No savings in tested encodes' : undefined
  if (outcome) {
    badges.push(<span key={decisionStatus} className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1"><AlertCircle className="w-3 h-3" />{outcome}</span>)
  } else if (decisionStatus === 'insufficient_evidence') {
    badges.push(
      <span key="insufficient-evidence" className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1">
        <AlertCircle className="w-3 h-3" /> Insufficient Evidence
      </span>
    )
  } else if (!compatible) {
    badges.push(
      <span key="incompatible" className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-destructive/20 text-destructive border border-destructive/30 flex items-center gap-1">
        <AlertCircle className="w-3 h-3" /> Incompatible
      </span>
    )
  } else if (decisionStatus === 'sample_required') {
    badges.push(
      <span key="sample-required" className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-blue-500/20 text-blue-300 border border-blue-500/30 flex items-center gap-1">
        <Eye className="w-3 h-3" /> Sample Required
      </span>
    )
  } else if (decisionStatus === 'already_optimized') {
    badges.push(
      <span key="already-optimized" className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-muted text-muted-foreground border border-border/40 flex items-center gap-1">
        <CheckCircle2 className="w-3 h-3" /> Already Optimized
      </span>
    )
  }
  if (compatible) {
    for (const operation of operations) {
      if (operation === 'video_transcode') {
        badges.push(
        <span key={operation} className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-blue-500/20 text-blue-400 border border-blue-500/30 flex items-center gap-1">
          <Zap className="w-3 h-3" /> Video Transcode
        </span>
        )
      } else if (operation === 'stream_pruning') {
        badges.push(
          <span key={operation} className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
            <Scissors className="w-3 h-3" /> Stream Pruning
          </span>
        )
      } else if (operation === 'subtitle_pruning') {
        badges.push(
          <span key={operation} className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
            <Scissors className="w-3 h-3" /> Subtitle Pruning
          </span>
        )
      } else if (operation === 'audio_transcode') {
        badges.push(
          <span key={operation} className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 flex items-center gap-1">
            <Volume2 className="w-3 h-3" /> Audio Transcode
          </span>
        )
      } else if (operation === 'container_change') {
        badges.push(
          <span key={operation} className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-purple-500/20 text-purple-300 border border-purple-500/30 flex items-center gap-1">
            <Layers className="w-3 h-3" /> Container Change
          </span>
        )
      }
    }
  }
  return <div className="flex flex-wrap justify-end gap-1">{badges}</div>
}

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '0 B'
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function ShowTranscodeModal({ show, episode, seasonNumber, onClose, initialPreflight, resumeRequestId }: { show: TVShowSummary; episode?: MediaItem; seasonNumber?: number; onClose: () => void; initialPreflight?: ShowTranscodePreflight | null; resumeRequestId?: string | null }) {
  const { addToast } = useToast()
  const { seriesIdentityKey, sourceId, libraryId } = getTVShowIdentity(show)
  const [mode, setMode] = useState<'config' | 'preview' | 'monitoring'>('config')
  const [optimizationMode, setOptimizationMode] = useState<'smart' | 'remux_only' | 'transcode'>('smart')
  const [removeUnnecessaryStreams, setRemoveUnnecessaryStreams] = useState(true)
  const [adjustToTarget, setAdjustToTarget] = useState(true)
  const [targetProfileId, setTargetProfileId] = useState('')
  const [targetProfileName, setTargetProfileName] = useState('')
  const [playbackPolicy, setPlaybackPolicy] = useState<'allow-transcoding' | 'avoid-video-transcoding' | 'direct-play'>('allow-transcoding')
  const [targetProfiles, setTargetProfiles] = useState<PlaybackTargetProfile[]>([])
  const [targetProfilesLoading, setTargetProfilesLoading] = useState(true)
  const targetProfile = targetProfiles.find(profile => profile.id === targetProfileId)
  const sourceContainer = getOptimizationContainer(episode?.container)
  const sourceVideoCodec = episode?.video_codec?.toLowerCase()
  const sourceTargetCodec = normalizeVideoCodec(sourceVideoCodec) === 'HEVC' ? 'hevc' : normalizeVideoCodec(sourceVideoCodec) === 'AV1' ? 'av1' : undefined
  const sourceHdrFormat = episode?.hdr_format?.toUpperCase()
  const recommendedAudioCodec = targetProfile && episode?.audio_codec
    && episode.audio_channels <= targetProfile.definition.audio.maxChannels
    && (!episode.has_object_audio || targetProfile.definition.audio.objectAudio)
    && !targetProfile.definition.audio.codecs.some(codec => normalizeAudioCodec(codec) === normalizeAudioCodec(episode.audio_codec))
    ? (['eac3', 'ac3', 'aac'] as const).find(codec =>
      (episode.audio_channels >= 6 ? codec !== 'aac' : codec === 'aac')
      && targetProfile.definition.audio.codecs.some(supportedCodec => normalizeAudioCodec(supportedCodec) === normalizeAudioCodec(codec))
    )
    : undefined
  const [qualityProfile, setQualityProfile] = useState<OptimizationQualityProfile | ''>('transparent')
  const qualityPreferenceScopes = useMemo(() => episode?.id
    ? [`item:${sourceId}:${episode.id}`, `show:${sourceId}:${libraryId}:${seriesIdentityKey}`]
    : seasonNumber !== undefined
      ? [`season:${sourceId}:${libraryId}:${seriesIdentityKey}:${seasonNumber}`, `show:${sourceId}:${libraryId}:${seriesIdentityKey}`]
      : [`show:${sourceId}:${libraryId}:${seriesIdentityKey}`], [episode, sourceId, libraryId, seriesIdentityKey, seasonNumber])
  const [encoderPolicy, setEncoderPolicy] = useState<'automatic' | 'hardware' | 'software' | 'compare' | ''>('automatic')
  const useHardwareEncoder = encoderPolicy === 'hardware' || encoderPolicy === 'compare'
  const [targetContainer, setTargetContainer] = useState<'mkv' | 'mp4' | ''>('')
  const [targetContainerSelection, setTargetContainerSelection] = useState<'automatic' | 'user-selected'>('automatic')
  const [targetAudioCodec, setTargetAudioCodec] = useState<'aac' | 'ac3' | 'eac3' | ''>('')
  const [targetHdrFormat, setTargetHdrFormat] = useState<'SDR' | 'HDR10' | ''>('')
  const [reviewedEpisodes, setReviewedEpisodes] = useState<number[]>([])
  const [activeBatchId, setActiveBatchId] = useState<string>()
  const [codec, setCodec] = useState<'hevc' | 'av1' | ''>('')
  const [audio, setAudio] = useState<'all' | 'original-and-protected'>('original-and-protected')
  const [language, setLanguage] = useState('')
  const [subtitleWhitelist, setSubtitleWhitelist] = useState('')
  const [newSubtitleInput, setNewSubtitleInput] = useState('')
  const [detectedLanguages, setDetectedLanguages] = useState<string[]>([])
  const [providerLanguage, setProviderLanguage] = useState<string>('')
  const [outputMode, setOutputMode] = useState<'copy' | 'quarantine-replace' | 'replace'>('quarantine-replace')
  const [gpuId, setGpuId] = useState('')
  const [gpus, setGpus] = useState<GpuInfo[]>([])
  const [deviceEncoders, setDeviceEncoders] = useState<Record<string, string[]>>({})
  const [message, setMessage] = useState('')
  const [isSuccess, setIsSuccess] = useState(false)
  const [busy, setBusy] = useState(false)
  const [preflightData, setPreflightData] = useState<ShowTranscodePreflight | null>(null)
  const [preflightTermination, setPreflightTermination] = useState<'cancelling' | 'finishing' | null>(null)
  const [preflightProgress, setPreflightProgress] = useState<{ percentage: number; phase?: string; currentItem?: string } | null>(null)
  const [preflightOperationState, setPreflightOperationState] = useState<'queued' | 'running' | 'pausing' | 'paused' | 'finishing' | null>(null)
  const [quarantineFiles, setQuarantineFiles] = useState<Array<{ mediaItemId: number; label: string; path: string; size: number; modifiedAt: string; owned: boolean }>>([])
  const modalRef = useRef<HTMLDivElement | null>(null)
  const activePreflightRequestId = useRef<string | null>(null)
  const activePreflightTaskId = useRef<string | null>(null)
  const rejectPreflightWait = useRef<((error: Error) => void) | null>(null)
  const backgroundPreflight = useRef(false)
  const startedPreflightHere = useRef(false)

  // Live Task Queue tracking state for monitoring mode
  const [queueState, setQueueState] = useState<QueueState>({
    currentTask: null,
    queue: [],
    isPaused: false,
    completedTasks: []
  })

  useFocusTrap(true, modalRef)

  useEffect(() => {
    if (!initialPreflight) return
    setPreflightData(initialPreflight)
    setReviewedEpisodes([])
    setMode('preview')
  }, [initialPreflight])

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
      const request = saved.request as import('@main/services/TranscodingService').ShowTranscodeRequest
      const result = saved.result as ShowTranscodePreflight
      const options = request.options
      setOptimizationMode(options.optimizationMode ?? 'smart')
      setRemoveUnnecessaryStreams(options.streamSelection?.audio !== 'all')
      setAdjustToTarget(options.optimizationMode !== 'remux_only')
      setTargetProfileId(options.targetProfileId ?? '')
      setPlaybackPolicy(options.playbackPolicy ?? 'allow-transcoding')
      setTargetProfileName(targetProfiles.find(profile => profile.id === options.targetProfileId)?.name ?? '')
      setQualityProfile(options.qualityProfile ?? '')
      setEncoderPolicy(options.encoderPolicy ?? '')
      setTargetContainer(options.targetContainer ?? '')
      setTargetContainerSelection(options.targetContainerSelection ?? 'automatic')
      setTargetAudioCodec(options.targetAudioCodec ?? '')
      setTargetHdrFormat(options.targetHdrFormat ?? '')
      setCodec(options.targetCodec ?? '')
      setAudio(options.streamSelection?.audio === 'all' ? 'all' : 'original-and-protected')
      setLanguage(options.streamSelection?.audio === 'original-and-protected' ? options.streamSelection.originalLanguage : '')
      setSubtitleWhitelist(options.streamSelection?.subtitleLanguageWhitelist?.join(', ') ?? '')
      setOutputMode(options.outputMode ?? 'quarantine-replace')
      setGpuId(options.gpuId ?? '')
      setActiveBatchId(result.batchId)
      setPreflightData(result)
      setReviewedEpisodes([])
      setMessage('')
      setMode('preview')
      logOptimizationDiagnostic('TVOptimizationUI', 'info', 'preflight.reused', { preflightId: result.preflightId, batchId: result.batchId, seriesIdentityKey, seasonNumber, mediaItemId: episode?.id })
    }).catch(error => setMessage(error instanceof Error ? error.message : String(error)))
    return () => { mounted = false }
  }, [initialPreflight, resumeRequestId, targetProfilesLoading, seriesIdentityKey, sourceId, libraryId, show.series_title, episode?.id, seasonNumber, targetProfiles])

  useEffect(() => {
    if (initialPreflight) return
    let mounted = true
    let finished = false
    const requestOf = (task: QueuedTask) => (task.options as { request?: { seriesIdentityKey?: string; sourceId?: string; libraryId?: string; mediaItemId?: number; seasonNumber?: number } } | undefined)?.request
    const matchesScope = (task: QueuedTask) => {
      const request = requestOf(task)
      return task.type === 'optimization-preflight' && request?.sourceId === sourceId && request.libraryId === libraryId &&
        request.seriesIdentityKey === seriesIdentityKey && request.mediaItemId === episode?.id && request.seasonNumber === seasonNumber
    }
    const updateTask = async (state: QueueState) => {
      if (!mounted || finished) return
      const tasks = [state.currentTask, ...state.queue, ...state.completedTasks].filter((task): task is QueuedTask => task !== null)
      const task = resumeRequestId
        ? tasks.find(candidate => (candidate.options as { requestId?: string } | undefined)?.requestId === resumeRequestId)
        : activePreflightTaskId.current
          ? tasks.find(candidate => candidate.id === activePreflightTaskId.current)
          : startedPreflightHere.current ? undefined : tasks.filter(candidate => matchesScope(candidate) && ['queued', 'running'].includes(candidate.status))
            .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0]
      if (!task) return
      activePreflightTaskId.current = task.id
      activePreflightRequestId.current = (task.options as { requestId?: string } | undefined)?.requestId ?? null
      backgroundPreflight.current = false
      if (task.status === 'queued' || task.status === 'running') {
        setBusy(true)
        setPreflightOperationState(state.isPaused ? 'paused' : task.status === 'queued' ? 'queued' : 'running')
        setPreflightProgress({
          percentage: task.progress?.percentage ?? 0,
          phase: state.isPaused ? 'Preflight paused' : task.progress?.phase ?? (task.status === 'queued' ? 'Waiting in task queue' : seasonNumber === undefined ? 'Preflighting series' : `Preflighting season ${seasonNumber}`),
          currentItem: task.progress?.currentItem ?? task.label,
        })
        return
      }
      finished = true
      activePreflightRequestId.current = null
      activePreflightTaskId.current = null
      if (task.status === 'completed' && typeof task.result?.preflightId === 'string') {
        try {
          const saved = await window.electronAPI.getShowPreflight(task.result.preflightId) as { result: ShowTranscodePreflight } | undefined
          if (!mounted) return
          if (!saved) throw new Error('The saved optimization review could not be found')
          setPreflightData(saved.result)
          setReviewedEpisodes([])
          setMode('preview')
        } catch (error) {
          setMessage(error instanceof Error ? error.message : String(error))
        }
      } else if (task.status === 'failed') {
        setMessage(task.error ?? 'Optimization preflight failed')
      }
      if (mounted) {
        setBusy(false)
        setPreflightProgress(null)
        setPreflightOperationState(null)
      }
    }
    const unsubscribe = window.electronAPI.onTaskQueueUpdated?.(state => {
      if (resumeRequestId || activePreflightTaskId.current || !startedPreflightHere.current) setQueueState(state)
      void updateTask(state)
    })
    void window.electronAPI.taskQueueGetState().then(state => { if (mounted) { setQueueState(state); void updateTask(state) } }).catch(error => setMessage(error instanceof Error ? error.message : String(error)))
    return () => {
      mounted = false
      unsubscribe?.()
    }
  }, [initialPreflight, resumeRequestId, seriesIdentityKey, sourceId, libraryId, episode?.id, seasonNumber])

  useEffect(() => {
    let mounted = true
    void Promise.all([
      window.electronAPI.listPlaybackTargetProfiles(),
      window.electronAPI.getSetting('optimization_default_target_profile_id'),
      window.electronAPI.getSetting(SETTING_KEYS.subtitle_preferred_languages)
    ]).then(([profiles, configuredId, configuredSubtitleLanguages]) => {
      const profile = profiles.find(candidate => candidate.id === configuredId)
      if (mounted) {
        setTargetProfiles(profiles)
        setSubtitleWhitelist(configuredSubtitleLanguages || '')
        if (profile) { setTargetProfileId(profile.id); setTargetProfileName(profile.name) }
        else if (configuredId) setMessage(`Configured playback target ${configuredId} was not found. Choose another target or select no playback target.`)
      }
    }).catch(error => setMessage(error instanceof Error ? error.message : String(error)))
      .finally(() => { if (mounted) setTargetProfilesLoading(false) })
    return () => { mounted = false }
  }, [addToast])

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
  }, [initialPreflight, qualityPreferenceScopes, episode])

  useEffect(() => {
    if (preflightData) return
    const sourceVideo = { codec: episode?.video_codec, profile: episode?.video_profile, hdrFormat: episode?.hdr_format }
    const supportedContainers = targetProfile ? getPlaybackTargetContainers(targetProfile, sourceVideo) : ['matroska', 'mp4']
    const preferredContainer: 'mkv' | 'mp4' | '' = !episode
      ? ''
      : targetProfile
      ? recommendPlaybackTargetContainer(targetProfile, sourceVideo, episode?.container)
      : sourceContainer || 'mkv'
    setTargetContainer(preferredContainer)
    setTargetContainerSelection('automatic')
    const targetSupports = (candidate: 'hevc' | 'av1') => !targetProfile || targetProfile.definition.video.codecs.some(codec => normalizeVideoCodec(codec) === normalizeVideoCodec(candidate))
    const selectedCodec = sourceTargetCodec && targetSupports(sourceTargetCodec)
      ? sourceTargetCodec
      : (['hevc', 'av1'] as const).find(targetSupports) ?? ''
    setCodec(selectedCodec)

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
    setTargetHdrFormat(targetProfile && episode ? recommendedHdr : '')
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
  }, [preflightData, episode, seriesIdentityKey, sourceTargetCodec, sourceHdrFormat, sourceContainer, targetProfile])


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
  }, [preflightData, mode, onClose, seriesIdentityKey, episode?.id])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') void handleClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleClose])

  const loadQuarantine = async () => {
    try {
      const files = await window.electronAPI.listShowQuarantine(show.series_title, sourceId, seriesIdentityKey, libraryId)
      setQuarantineFiles(files)
    } catch (error) { addToast({ type: 'error', title: 'Quarantine inspection', message: String(error) }) }
  }

  const purgeQuarantine = async () => {
    if (quarantineFiles.length === 0 || !window.confirm(`Permanently delete ${quarantineFiles.length} quarantined original${quarantineFiles.length === 1 ? '' : 's'} for this show?`)) return
    try {
      const result = await window.electronAPI.purgeShowQuarantine(show.series_title, sourceId, seriesIdentityKey, libraryId)
      setQuarantineFiles([])
      addToast({ type: 'success', title: 'Quarantine Purged', message: `Deleted ${result.purged} quarantined original${result.purged === 1 ? '' : 's'}.` })
    } catch (error) { addToast({ type: 'error', title: 'Quarantine cleanup', message: String(error) }) }
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
                    console.error('[ShowTranscodeModal] Failed to parse episode audio tracks for language detection', error)
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

      if (provLang) {
        const matchingFileCode = fileLangs.find(code => isSameLanguage(code, provLang))
        setLanguage(matchingFileCode || provLang.toLowerCase())
      }
    }

    loadLanguages()
    return () => { isMounted = false }
  }, [show, sourceId, seriesIdentityKey, libraryId])

  useEffect(() => {
    let isMounted = true
    window.electronAPI.transcodingGetCapabilities().then((capabilities) => {
      if (!isMounted || !capabilities) return
      const detectedGpus = capabilities.gpus || []
      setGpus(detectedGpus)
      setDeviceEncoders(capabilities.deviceEncoders)
      const selected = detectedGpus.find((gpu: GpuInfo) => gpu.id === capabilities.selectedGpuId)
      setGpuId(selected?.id || '')
    }).catch(err => {
      addToast({ type: 'error', title: 'Encoder capabilities', message: String(err) })
    })
    return () => { isMounted = false }
  }, [addToast])

  // Subscribe to TaskQueue state updates
  useEffect(() => {
    const unsubscribe = window.electronAPI.onTaskQueueUpdated?.((state) => {
      setQueueState(state)
    })
    window.electronAPI.taskQueueGetState?.().then((state) => {
      setQueueState(state)
    }).catch((error) => {
      addToast({ type: 'error', title: 'Show queue state', message: String(error) })
    })

    return () => {
      unsubscribe?.()
    }
  }, [addToast])

  const subtitleList = parseLanguageWhitelist(subtitleWhitelist)

  const handleAddSubtitleTag = (code: string) => {
    const clean = code.trim().toLowerCase()
    if (!clean) return
    if (!subtitleList.includes(clean)) {
      const next = [...subtitleList, clean].join(', ')
      setSubtitleWhitelist(next)
    }
    setNewSubtitleInput('')
  }

  const handleRemoveSubtitleTag = (code: string) => {
    const next = subtitleList.filter(c => c !== code).join(', ')
    setSubtitleWhitelist(next)
  }

  const getCleanOptions = (overrides: { removeUnnecessaryStreams?: boolean; adjustToTarget?: boolean; targetProfileId?: string } = {}) => {
    const shouldRemoveStreams = overrides.removeUnnecessaryStreams ?? removeUnnecessaryStreams
    const shouldAdjustToTarget = overrides.adjustToTarget ?? adjustToTarget
    const effectiveTargetProfileId = overrides.targetProfileId ?? targetProfileId
    const whitelist = shouldRemoveStreams && subtitleList.length > 0 ? subtitleList : undefined
    const effectiveAudio = shouldRemoveStreams ? audio : 'all' as const
    const effectiveOptimizationMode = shouldAdjustToTarget ? optimizationMode : 'remux_only' as const
    return {
      targetCodec: codec || undefined,
      playbackPolicy,
      qualityProfile: qualityProfile || undefined,
      encoderPolicy: encoderPolicy || undefined,
      targetContainer: shouldAdjustToTarget ? targetContainer || undefined : undefined,
      targetContainerSelection: shouldAdjustToTarget ? targetContainerSelection : 'automatic',
      targetAudioCodec: shouldAdjustToTarget ? targetAudioCodec || undefined : undefined,
      targetHdrFormat: shouldAdjustToTarget && effectiveTargetProfileId ? targetHdrFormat || undefined : undefined,
      transcodingEngine: 'ffmpeg' as const,
      outputMode,
      gpuId: useHardwareEncoder && effectiveOptimizationMode !== 'remux_only' ? gpuId : undefined,
      optimizationMode: effectiveOptimizationMode,
      targetProfileId: (overrides.targetProfileId ?? targetProfileId) || null,
      streamSelection: effectiveAudio === 'all'
        ? { audio: 'all' as const, subtitle: 'all' as const, subtitleLanguageWhitelist: whitelist, defaultSubtitle: 'preserve' as const }
        : { audio: effectiveAudio, originalLanguage: language.trim().toLowerCase(), subtitle: 'all' as const, subtitleLanguageWhitelist: whitelist, defaultSubtitle: 'preserve' as const }
    }
  }

  const runPreflight = async (overrides: { removeUnnecessaryStreams?: boolean; adjustToTarget?: boolean; targetProfileId?: string; representativeMediaItemId?: number } = {}) => {
    const { representativeMediaItemId, ...optionOverrides } = overrides
    const shouldRemoveStreams = overrides.removeUnnecessaryStreams ?? removeUnnecessaryStreams
    const shouldAdjustToTarget = overrides.adjustToTarget ?? adjustToTarget
    const effectiveTargetProfileId = overrides.targetProfileId ?? targetProfileId
    const missingSettings: string[] = []
    if (!outputMode) missingSettings.push('output mode')
    if (shouldRemoveStreams && audio === 'original-and-protected' && !language.trim()) missingSettings.push('original language for stream pruning')
    if (shouldAdjustToTarget && optimizationMode !== 'remux_only') {
      if (!codec) missingSettings.push('video codec')
      if (!qualityProfile) missingSettings.push('visual quality threshold')
      if (!encoderPolicy) missingSettings.push('encoder policy')
      if (!targetContainer && targetContainerSelection === 'user-selected') missingSettings.push('output container')
      const dynamicHdrSource = ['DOLBY VISION', 'HDR10+'].includes(sourceHdrFormat ?? '')
      if (effectiveTargetProfileId && !targetHdrFormat && (optimizationMode === 'transcode' || (episode && !dynamicHdrSource))) missingSettings.push('output color format for the selected playback target')
    }
    if (playbackPolicy !== 'allow-transcoding' && !effectiveTargetProfileId) missingSettings.push('playback target for the selected playback policy')
    const settings = {
      seriesIdentityKey, mediaItemId: episode?.id, sourceId, libraryId, optimizationMode, outputMode,
      seasonNumber,
      codec: codec || null, qualityProfile: qualityProfile || null, encoderPolicy: encoderPolicy || null,
      targetContainer: targetContainer || null, targetHdrFormat: targetHdrFormat || null,
      gpuId: gpuId || null, removeUnnecessaryStreams: shouldRemoveStreams,
      adjustToTarget: shouldAdjustToTarget, targetProfileId: effectiveTargetProfileId || null, playbackPolicy
    }
    logOptimizationDiagnostic('TVOptimizationUI', 'info', 'preflight.requested', settings)
    if (missingSettings.length > 0) {
      const error = `Complete these settings before measuring samples: ${missingSettings.join(', ')}.`
      logOptimizationDiagnostic('TVOptimizationUI', 'warn', 'preflight.validation.failed', { ...settings, missingSettings })
      throw new Error(error)
    }
    setReviewedEpisodes([])
    if (preflightData) {
      await window.electronAPI.discardShow(preflightData.preflightId)
      setPreflightData(null)
    }
    const requestId = crypto.randomUUID()
    backgroundPreflight.current = false
    activePreflightRequestId.current = requestId
    setPreflightTermination(null)
    setPreflightProgress({ percentage: 0, phase: 'Starting preflight', currentItem: episode ? `Loading ${episode.title}` : seasonNumber === undefined ? 'Loading series episodes' : `Loading season ${seasonNumber} episodes` })
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
      logOptimizationDiagnostic('TVOptimizationUI', 'info', 'preflight.returned', { preflightId: preflight.preflightId, batchId: preflight.batchId, episodeCount: preflight.episodeCount, compatible: preflight.episodes.filter(item => item.compatible).length, savingsBytes: preflight.estimatedSavingsBytes, savingsCoverage: preflight.savingsCoverage })
      if (!backgroundPreflight.current) setPreflightData(preflight)
      return preflight
    } catch (error) {
      const cancelled = error instanceof DOMException && error.name === 'AbortError'
      logOptimizationDiagnostic('TVOptimizationUI', cancelled ? 'info' : 'error', cancelled ? 'preflight.cancelled' : 'preflight.failed', {
        seriesIdentityKey, mediaItemId: episode?.id, sourceId, libraryId, requestId,
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

  const updatePlan = async (next: { removeUnnecessaryStreams?: boolean; adjustToTarget?: boolean; targetProfileId?: string }) => {
    logOptimizationDiagnostic('TVOptimizationUI', 'info', 'plan.settings.changed', { seriesIdentityKey, mediaItemId: episode?.id, changes: next })
    if (next.removeUnnecessaryStreams !== undefined) setRemoveUnnecessaryStreams(next.removeUnnecessaryStreams)
    if (next.adjustToTarget !== undefined) setAdjustToTarget(next.adjustToTarget)
    if (next.targetProfileId !== undefined) {
      setTargetProfileId(next.targetProfileId)
      setTargetProfileName(targetProfiles.find(profile => profile.id === next.targetProfileId)?.name || '')
      if (!next.targetProfileId) setTargetHdrFormat('')
    }
    setBusy(true)
    setMessage('')
    setIsSuccess(false)
    try {
      await runPreflight(next)
    } catch (error) {
      logOptimizationDiagnostic('TVOptimizationUI', 'error', 'plan.refresh.failed', { seriesIdentityKey, mediaItemId: episode?.id, error: describeDiagnosticError(error) })
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const handlePreviewPlan = async () => {
    setBusy(true)
    setMessage('')
    setIsSuccess(false)
    try {
      const preflight = await runPreflight()
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
        title: 'Preflight Failed',
        message: errMsg
      })
    } finally {
      if (!backgroundPreflight.current) setBusy(false)
    }
  }

  const handleQueueFromPreview = async () => {
    if (!preflightData) return
    setBusy(true)
    setMessage('')
    try {
      const requiresApproval = preflightData.episodes.some(episode => episode.compatible && episode.decisionStatus === 'sample_required')
      logOptimizationDiagnostic('TVOptimizationUI', 'info', 'queue.requested', { preflightId: preflightData.preflightId, batchId: preflightData.batchId, requiresSampleApproval: requiresApproval, reviewedEpisodeCount: reviewedEpisodes.length })
      if (preflightData.episodes.some(episode => episode.compatible && episode.samplePaths?.length && !reviewedEpisodes.includes(episode.mediaItemId))) throw new Error('Play and approve the winning samples for every eligible episode.')
      if (requiresApproval) await window.electronAPI.approveShow(preflightData.preflightId)
      if (qualityProfile) {
        const raw = await window.electronAPI.getSetting(SETTING_KEYS.optimization_quality_preferences)
        const preferences = raw ? JSON.parse(raw) as Record<string, OptimizationQualityProfile> : {}
        await window.electronAPI.setSetting(SETTING_KEYS.optimization_quality_preferences, JSON.stringify({ ...preferences, [qualityPreferenceScopes[0]]: qualityProfile }))
      }
      const queued = await window.electronAPI.queueShow(preflightData.preflightId)
      logOptimizationDiagnostic('TVOptimizationUI', 'info', 'queue.completed', { batchId: queued.batchId, queuedMediaItemIds: queued.queuedMediaItemIds })
      setActiveBatchId(queued.batchId)
      setIsSuccess(true)
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

  // Filter tasks belonging to transcoding
  const vendor = gpus.find(gpu => gpu.id === gpuId)?.vendor
  const selectedGpu = gpus.find(gpu => gpu.id === gpuId)
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
  const codecRecommendation = targetProfile
    ? sourceTargetCodec === codec
      ? `Source codec is supported by ${targetProfile.name}.`
      : `Preferred codec supported by ${targetProfile.name}.`
    : sourceTargetCodec === codec
      ? 'Preserves the source codec.'
      : 'HEVC is the preferred broadly supported codec.'
  const containerRecommendation = !episode
    ? targetProfile
      ? 'System resolves the container per episode using matching target rules, then preserves the source when allowed.'
      : 'System preserves each episode source container when possible.'
    : targetProfile
    ? sourceContainer === targetContainer
      ? `Preserves the source container supported by ${targetProfile.name}.`
      : `Container supported by ${targetProfile.name}.`
    : sourceContainer === targetContainer
      ? 'Preserves the source container.'
      : 'MKV is the recommended general-purpose container.'
  const colorRecommendation = !targetProfile
    ? 'Source color is preserved.'
    : !episode
      ? 'Color is resolved per episode from its source; Smart preserves Dolby Vision and HDR10+ video.'
    : ['DOLBY VISION', 'HDR10+'].includes(sourceHdrFormat ?? '') && optimizationMode !== 'transcode'
      ? 'Smart preserves dynamic HDR by copying the video stream. Full Transcode requires choosing SDR or HDR10.'
    : !sourceHdrFormat || ['SDR', 'NONE'].includes(sourceHdrFormat)
      ? 'Source is SDR; output stays SDR.'
      : targetHdrFormat === sourceHdrFormat
        ? `Preserves source ${sourceHdrFormat} supported by ${targetProfile.name}.`
        : `Uses ${targetHdrFormat} for compatibility with ${targetProfile.name}.`
  const profileSupportedContainers = targetProfile
    ? getPlaybackTargetContainers(targetProfile, { codec: episode?.video_codec, profile: episode?.video_profile, hdrFormat: episode?.hdr_format })
    : ['matroska', 'mp4']
  const verifiedResults = queueState.completedTasks.filter(task => task.batchId === activeBatchId && task.status === 'completed' && typeof task.result?.physicallyReclaimedBytes === 'number').map(task => task.result!)
  const batchQueue = queueState.queue.filter(task => task.batchId === activeBatchId)
  const currentTask = queueState.currentTask?.batchId === activeBatchId ? queueState.currentTask : null
  const isCurrentTranscode = currentTask?.type === TaskType.Transcode

  const currentPercent = currentTask?.progress?.percentage ?? 0
  const currentFps = currentTask?.progress?.fps ? `${currentTask.progress.fps} FPS` : 'Encoding'
  const currentSpeed = currentTask?.progress?.speed || 'Measuring…'
  const currentEta = currentTask?.progress?.eta || 'Calculating...'

  // SVG Circular Gauge calculation
  const radius = 56
  const strokeWidth = 7
  const normalizedRadius = radius - strokeWidth * 0.5
  const circumference = normalizedRadius * 2 * Math.PI
  const strokeDashoffset = circumference - ((Math.min(Math.max(currentPercent, 0), 100)) / 100) * circumference
  const preflightProgressPanel = busy && preflightProgress ? (
    <div role="status" aria-live="polite" className="rounded-xl border border-primary/30 bg-primary/5 p-3 space-y-2">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="font-semibold">{preflightOperationState === 'paused' ? 'Preflight paused' : preflightProgress.phase || (seasonNumber === undefined ? 'Preflighting series' : `Preflighting season ${seasonNumber}`)}</span>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground tabular-nums">{preflightProgress.percentage}%</span>
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
      <div
        role="progressbar"
        aria-label="Series preflight progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={preflightProgress.percentage}
        className="h-1.5 overflow-hidden rounded-full bg-muted"
      >
        <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${preflightProgress.percentage}%` }} />
      </div>
      <p className="text-xs text-muted-foreground break-words">{preflightProgress.currentItem || 'Preparing episode checks…'}</p>
      <p className="text-[11px] text-muted-foreground">Pause stops the active sample and keeps completed work. Close this window to leave the task in the queue.</p>
    </div>
  ) : null

  return createPortal(
    <div
      ref={modalRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="show-transcode-modal-title"
      tabIndex={-1}
      className="fixed inset-0 z-250 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200"
      onClick={() => void handleClose()}
    >
      <div
        className="relative bg-card border border-border sm:rounded-2xl shadow-2xl max-w-2xl w-full h-dvh sm:h-auto sm:max-h-[92vh] overflow-hidden flex flex-col animate-in zoom-in-95 duration-200"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-border/20 flex justify-between items-center bg-muted/20">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-primary/10 rounded-xl text-primary">
              {mode === 'monitoring' ? <Activity className="w-5 h-5 animate-pulse" /> : <Zap className="w-5 h-5 fill-current" />}
            </div>
            <div>
              <h3 id="show-transcode-modal-title" className="text-lg font-bold leading-tight flex items-center gap-2">
                {mode === 'monitoring' ? (seasonNumber === undefined ? 'Live Series Optimization' : `Live Season ${seasonNumber} Optimization`) : mode === 'preview' ? (seasonNumber === undefined ? 'Optimization Plan Preview' : `Season ${seasonNumber} Optimization Plan`) : seasonNumber === undefined ? 'Batch Optimize Series' : `Optimize Season ${seasonNumber}`}
              </h3>
              <p className="text-xs text-muted-foreground truncate max-w-[420px]">{show.series_title}{seasonNumber === undefined ? '' : ` · Season ${seasonNumber}`}</p>
            </div>
          </div>
          <button
            onClick={() => void handleClose()}
            className={`rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-all cursor-pointer ${busy ? 'px-2.5 py-1.5 text-xs font-semibold' : 'p-1.5'}`}
            title={busy ? 'Continue in background' : 'Close'}
          >
            {busy ? 'Continue in background' : <X className="w-5 h-5" />}
          </button>
        </div>

        {/* Content */}
        {mode === 'config' ? (
          <div className="p-5 sm:p-6 space-y-5 max-h-[72vh] overflow-y-auto">
            {preflightProgressPanel}
            <div className="rounded-xl border border-border/40 bg-muted/20 p-3 flex items-center justify-between gap-3">
              <div className="min-w-0"><div className="text-xs font-bold">Quarantined originals</div><div className="text-[11px] text-muted-foreground">{quarantineFiles.length} retained file{quarantineFiles.length === 1 ? '' : 's'} · {formatBytes(quarantineFiles.reduce((total, file) => total + file.size, 0))}{quarantineFiles.some(file => !file.owned) && ' · Unowned backups require separate review'}</div></div>
              <div className="flex gap-2 shrink-0"><button type="button" onClick={loadQuarantine} className="px-2.5 py-1.5 text-xs rounded-lg border border-border hover:bg-muted">List</button><button type="button" onClick={purgeQuarantine} disabled={quarantineFiles.length === 0 || quarantineFiles.some(file => !file.owned)} className="px-2.5 py-1.5 text-xs rounded-lg border border-red-500/40 text-red-300 disabled:opacity-40">Purge</button></div>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Optimization plan</label>
              <label className="block space-y-1.5 text-xs font-semibold">Playback target
                <select aria-label="Playback target" value={targetProfileId} onChange={event => {
                  const profileId = event.target.value
                  logOptimizationDiagnostic('TVOptimizationUI', 'info', 'playback.target.selected', { targetProfileId: profileId || null })
                  setTargetProfileId(profileId)
                  setTargetProfileName(targetProfiles.find(profile => profile.id === profileId)?.name || '')
                  if (!profileId) setTargetHdrFormat('')
                }} disabled={busy || targetProfilesLoading} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground">
                  <option value="">{targetProfilesLoading ? 'Loading playback targets…' : 'No playback target'}</option>
                  {targetProfiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
                </select>
              </label>
              <label className="block space-y-1.5 text-xs font-semibold">Playback
                <select aria-label="Playback policy" value={playbackPolicy} onChange={event => {
                  const policy = event.target.value as typeof playbackPolicy
                  logOptimizationDiagnostic('TVOptimizationUI', 'info', 'playback.policy.selected', { playbackPolicy: policy })
                  setPlaybackPolicy(policy)
                }} disabled={busy} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground">
                  <option value="allow-transcoding">Let Plex adapt</option>
                  <option value="avoid-video-transcoding">Avoid video transcoding</option>
                  <option value="direct-play">Direct Play only</option>
                </select>
              </label>
              {!targetProfile && <p className="text-xs text-muted-foreground">Playback compatibility will not be evaluated. Measured quality and output-size checks still apply.</p>}
              <div className="divide-y divide-border/40 rounded-xl border border-border/40 bg-card/40">
                <label className="flex items-center justify-between gap-4 p-3 cursor-pointer">
                  <span><span className="block text-sm font-semibold">Remove unnecessary streams</span><span className="block text-xs text-muted-foreground">Apply the selected audio and subtitle policies.</span></span>
                  <input type="checkbox" checked={removeUnnecessaryStreams} onChange={event => setRemoveUnnecessaryStreams(event.target.checked)} className="h-4 w-4 accent-primary" />
                </label>
                <label className="flex items-center justify-between gap-4 p-3 cursor-pointer">
                  <span><span className="block text-sm font-semibold">Adjust output</span><span className="block text-xs text-muted-foreground">Allow measured video and container changes. Playback compatibility is checked when a target is selected.</span></span>
                  <input type="checkbox" checked={adjustToTarget} onChange={event => setAdjustToTarget(event.target.checked)} className="h-4 w-4 accent-primary" />
                </label>
              </div>
            </div>
            <details open className="space-y-2 rounded-xl border border-border/40 bg-card/20 p-3">
              <summary className="cursor-pointer list-none text-xs font-bold uppercase tracking-wider text-muted-foreground">Target adjustment options</summary>
            <div className="space-y-2 pt-3">
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-primary" /> Strategy
              </label>
              <p className="text-xs text-muted-foreground">Choose video-preserving cleanup or measured lossy compression. Video-preserving cleanup copies the original video stream; the compression quality setting allows re-encoding only when measured samples meet its threshold.</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <button
                  type="button"
                  onClick={() => { logOptimizationDiagnostic('TVOptimizationUI', 'info', 'strategy.selected', { mode: 'smart' }); setOptimizationMode('smart') }}
                  className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                    optimizationMode === 'smart'
                      ? 'border-primary bg-primary/10 shadow-sm ring-1 ring-primary'
                      : 'border-border bg-card/60 hover:bg-card'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-xs">Smart</span>
                    <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400">Recommended</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-tight">
                    Transcodes Remuxes & lossless stream-prunes WEB-DLs with dub bloat.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => { logOptimizationDiagnostic('TVOptimizationUI', 'info', 'strategy.selected', { mode: 'remux_only' }); setOptimizationMode('remux_only') }}
                  className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                    optimizationMode === 'remux_only'
                      ? 'border-primary bg-primary/10 shadow-sm ring-1 ring-primary'
                      : 'border-border bg-card/60 hover:bg-card'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-xs">Audio &amp; Subs Prune</span>
                    <span className="sr-only">Preserve Video</span>
                    <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-400">Instant</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-tight">
                    Copy the original video stream unchanged while applying selected audio and subtitle cleanup.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => { logOptimizationDiagnostic('TVOptimizationUI', 'info', 'strategy.selected', { mode: 'transcode' }); setOptimizationMode('transcode') }}
                  className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                    optimizationMode === 'transcode'
                      ? 'border-primary bg-primary/10 shadow-sm ring-1 ring-primary'
                      : 'border-border bg-card/60 hover:bg-card'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-xs">Full Transcode</span>
                    <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400">Override</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-tight">
                    Allow video re-encoding for eligible episodes, then keep only candidates that meet the selected visual-quality threshold.
                  </p>
                </button>
              </div>
            </div>
            </details>

            <details open className="space-y-3 rounded-xl border border-border/40 bg-card/20 p-3">
              <summary className="cursor-pointer list-none text-xs font-bold uppercase tracking-wider text-muted-foreground">Output settings</summary>
              <p className="text-xs text-muted-foreground">Recommended settings are already selected and will be used for measurement. Change any choice if you prefer.</p>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <label className="space-y-1">Quality preference<select aria-label="Quality preference" value={qualityProfile} onChange={e => { const value = e.target.value as OptimizationQualityProfile; logOptimizationDiagnostic('TVOptimizationUI', 'info', 'quality.preference.selected', { qualityProfile: value }); setQualityProfile(value) }}><option value="">Choose a quality preference</option><option value="transparent">Higher fidelity</option><option value="maximum_savings">Smaller file</option><option value="balanced">Balanced · advanced</option></select><span className="block text-[10px] text-muted-foreground">The review compares both outcomes from the same measured samples. Keep the original when the savings are not worthwhile.</span></label>
              <EncoderPolicySelector value={encoderPolicy} hardwareAvailable={hardwareAvailable} softwareAvailable={softwareAvailable} recommendation={hardwareAvailable ? `Verified ${hardwareEncoder} on ${selectedGpu?.name ?? 'selected GPU'} for ${codec?.toUpperCase()}.` : softwareAvailable ? `No verified hardware encoder for ${codec?.toUpperCase()}; software is available.` : `No verified encoder is available for ${codec?.toUpperCase()}.`} onChange={policy => { logOptimizationDiagnostic('TVOptimizationUI', 'info', 'encoder.policy.selected', { encoderPolicy: policy ?? '' }); setEncoderPolicy(policy ?? '') }} />
              <label className="space-y-1">Output container<select aria-label="Container" value={targetContainer} onChange={e => { const value = e.target.value as typeof targetContainer; logOptimizationDiagnostic('TVOptimizationUI', 'info', 'output.container.selected', { targetContainer: value || null, selection: value ? 'user-selected' : 'automatic' }); setTargetContainer(value); setTargetContainerSelection(value ? 'user-selected' : 'automatic') }}>{!episode && <option value="">Automatic per episode</option>}{episode && !targetContainer && <option value="">No supported container available</option>}{profileSupportedContainers.filter(container => ['matroska', 'mp4'].includes(container.toLowerCase())).map(container => <option key={container} value={container.toLowerCase() === 'matroska' ? 'mkv' : 'mp4'}>{container}</option>)}</select><span className="block text-[10px] text-muted-foreground">{targetContainerSelection === 'automatic' ? 'Automatic' : 'Selected'} · {containerRecommendation}</span></label>
              {targetProfile && episode && ['DOLBY VISION', 'HDR10+'].includes(sourceHdrFormat ?? '') && optimizationMode !== 'transcode'
                ? <p className="self-center text-xs text-muted-foreground">{colorRecommendation}</p>
                : targetProfile ? <label className="space-y-1">Output color<select aria-label="Output color" value={targetHdrFormat} onChange={e => { const value = e.target.value as typeof targetHdrFormat; logOptimizationDiagnostic('TVOptimizationUI', 'info', 'output.color.selected', { targetHdrFormat: value }); setTargetHdrFormat(value) }}><option value="">{episode ? 'Choose conversion' : 'Automatic per episode'}</option><option value="SDR">SDR</option>{targetProfile.definition.hdr.formats.includes('HDR10') && <option value="HDR10">HDR10</option>}</select><span className="block text-[10px] text-muted-foreground">{targetHdrFormat ? `Suggested: ${targetHdrFormat}` : episode ? 'Choose a conversion' : 'Automatic'} · {colorRecommendation}</span></label> : <p className="self-center text-xs text-muted-foreground">{colorRecommendation}</p>}
              <label>Audio conversion<select aria-label="Audio conversion" value={targetAudioCodec} onChange={e => { const value = e.target.value as typeof targetAudioCodec; logOptimizationDiagnostic('TVOptimizationUI', 'info', 'audio.conversion.selected', { targetAudioCodec: value }); setTargetAudioCodec(value) }}><option value="">Preserve source{episode?.audio_codec ? ` (${episode.audio_codec})` : ''}; convert only for compatibility</option>{(targetProfile?.definition.audio.codecs ?? ['aac', 'ac3', 'eac3']).filter(codec => ['aac', 'ac3', 'eac3'].includes(codec)).map(codec => <option key={codec} value={codec}>{codec.toUpperCase()}{codec === recommendedAudioCodec ? ' (recommended for target compatibility)' : ''}</option>)}</select>{episode?.audio_codec && /dts.?hd|truehd|flac|pcm/i.test(episode.audio_codec) && <span className="block text-muted-foreground">{episode.audio_codec} is lossless; converting to a listed codec is lossy and should be selected only when the playback target requires it or measured savings justify it.</span>}</label>
            </div>
            {/* Codec Selection */}
            {optimizationMode !== 'remux_only' && (
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-primary" /> Target Video Codec
                </label>
                <p className="text-[10px] text-muted-foreground">Suggested: {codec ? codec.toUpperCase() : 'Unavailable'} · {codecRecommendation}</p>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => { logOptimizationDiagnostic('TVOptimizationUI', 'info', 'video.codec.selected', { targetCodec: 'av1' }); setCodec('av1') }}
                    disabled={Boolean(targetProfile && !targetProfile.definition.video.codecs.some(codec => normalizeVideoCodec(codec) === 'AV1'))}
                    className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                      codec === 'av1'
                        ? 'border-primary bg-primary/10 shadow-sm ring-1 ring-primary'
                        : 'border-border bg-card/60 hover:bg-card'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-bold text-sm">AV1</span>
                      <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-primary/20 text-primary">High Efficiency</span>
                    </div>
                    <p className="text-xs text-muted-foreground">High compression efficiency with visual fidelity.</p>
                  </button>

                  <button
                    type="button"
                    onClick={() => { logOptimizationDiagnostic('TVOptimizationUI', 'info', 'video.codec.selected', { targetCodec: 'hevc' }); setCodec('hevc') }}
                    disabled={Boolean(targetProfile && !targetProfile.definition.video.codecs.some(codec => normalizeVideoCodec(codec) === 'HEVC'))}
                    className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                      codec === 'hevc'
                        ? 'border-primary bg-primary/10 shadow-sm ring-1 ring-primary'
                        : 'border-border bg-card/60 hover:bg-card'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-bold text-sm">HEVC (H.265)</span>
                      <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground">Compatibility</span>
                    </div>
                    <p className="text-xs text-muted-foreground">Broad device hardware decoding support.</p>
                  </button>
                </div>
              </div>
            )}

            </details>
            <details open className="space-y-3 rounded-xl border border-border/40 bg-card/20 p-3">
              <summary className="cursor-pointer list-none text-xs font-bold uppercase tracking-wider text-muted-foreground">Stream policy</summary>
            {/* Audio Track Policy */}
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Volume2 className="w-3.5 h-3.5 text-primary" /> Audio Stream Policy
              </label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setAudio('original-and-protected')}
                  className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                    audio === 'original-and-protected'
                      ? 'border-primary bg-primary/10 shadow-sm ring-1 ring-primary'
                      : 'border-border bg-card/60 hover:bg-card'
                  }`}
                >
                  <span className="font-bold text-xs block mb-1">Original + Protected Tracks</span>
                  <p className="text-[11px] text-muted-foreground">Preserves primary audio language, Atmos/object audio, and commentaries.</p>
                </button>

                <button
                  type="button"
                  onClick={() => setAudio('all')}
                  className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                    audio === 'all'
                      ? 'border-primary bg-primary/10 shadow-sm ring-1 ring-primary'
                      : 'border-border bg-card/60 hover:bg-card'
                  }`}
                >
                  <span className="font-bold text-xs block mb-1">Copy All Audio Tracks</span>
                  <p className="text-[11px] text-muted-foreground">Retains all dubs, accessibility, and auxiliary streams as-is.</p>
                </button>
              </div>

              {audio === 'original-and-protected' && (
                <div className="mt-3 flex items-center gap-2">
                  <label htmlFor="show-original-language-select" className="text-xs text-muted-foreground shrink-0 font-medium">Original Language:</label>
                  <select
                    id="show-original-language-select"
                    aria-label="Original Language"
                    value={language}
                    onChange={e => setLanguage(e.target.value)}
                    className="px-3 py-1.5 text-xs rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer"
                  >
                    {!language && <option value="">Select language...</option>}
                    {detectedLanguages.length > 0 && (
                      <optgroup label="Available in files">
                        {detectedLanguages.map(code => {
                          const isDefault = providerLanguage && isSameLanguage(code, providerLanguage)
                          const label = code === 'und'
                            ? 'Undetermined / Untagged (und)'
                            : isDefault
                              ? `${formatLanguage(code)} (${code}) (Provider Default: ${formatLanguage(providerLanguage)})`
                              : `${formatLanguage(code)} (${code})`
                          return (
                            <option key={`detected-${code}`} value={code}>
                              {label}
                            </option>
                          )
                        })}
                      </optgroup>
                    )}
                    <optgroup label={detectedLanguages.length > 0 ? "Other Languages" : "Languages"}>
                      {language && !LANGUAGE_OPTIONS.some(opt => opt.code === language) && !detectedLanguages.includes(language) && (
                        <option key={`selected-${language}`} value={language}>
                          {providerLanguage && isSameLanguage(language, providerLanguage)
                            ? `${formatLanguage(language)} (${language}) (Provider Default: ${formatLanguage(providerLanguage)})`
                            : `${formatLanguage(language)} (${language})`}
                        </option>
                      )}
                      {LANGUAGE_OPTIONS.filter(opt => !detectedLanguages.some(dl => isSameLanguage(dl, opt.code))).map(opt => {
                        const isDefault = providerLanguage && isSameLanguage(opt.code, providerLanguage)
                        const label = isDefault
                          ? `${formatLanguage(opt.code)} (${opt.code}) (Provider Default: ${formatLanguage(providerLanguage)})`
                          : opt.label
                        return (
                          <option key={`all-${opt.code}`} value={opt.code}>
                            {label}
                          </option>
                        )
                      })}
                    </optgroup>
                  </select>
                </div>
              )}
            </div>

            {/* Subtitle Language Whitelist */}
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Languages className="w-3.5 h-3.5 text-primary" /> Subtitle Language Whitelist
                </span>
                <span className="text-[10px] lowercase font-normal text-muted-foreground">independent of audio</span>
              </label>
              <p className="text-[11px] text-muted-foreground">
                Blank keeps every subtitle. Selecting ISO-639 codes (e.g. eng, heb, spa) removes other subtitle streams.
              </p>

              <div className="flex flex-wrap items-center gap-1.5 p-2 bg-background/60 border border-border/40 rounded-xl min-h-[42px]">
                {subtitleList.map(code => (
                  <span
                    key={code}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-primary/10 border border-primary/20 text-primary text-xs font-bold"
                  >
                    <span>{formatLanguage(code)} ({code})</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveSubtitleTag(code)}
                      className="hover:bg-primary/20 rounded-full p-0.5 transition-colors cursor-pointer"
                      title={`Remove ${code}`}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
                <div className="flex items-center gap-1 flex-1 min-w-[120px]">
                  <input
                    type="text"
                    value={newSubtitleInput}
                    onChange={e => setNewSubtitleInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ',') {
                        e.preventDefault()
                        handleAddSubtitleTag(newSubtitleInput)
                      }
                    }}
                    placeholder={subtitleList.length === 0 ? "Add language codes (e.g. eng, heb)..." : "+ Add code"}
                    className="w-full bg-transparent px-2 py-0.5 text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
                  />
                  {newSubtitleInput.trim() && (
                    <button
                      type="button"
                      onClick={() => handleAddSubtitleTag(newSubtitleInput)}
                      className="px-2 py-0.5 text-[10px] font-bold rounded bg-primary text-primary-foreground hover:bg-primary/90 cursor-pointer"
                    >
                      Add
                    </button>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
                <span className="font-semibold text-[10px] uppercase tracking-wider">Presets:</span>
                {['eng', 'heb', 'spa', 'fre', 'ger', 'ita', 'jpn', 'kor', 'zho', 'und'].map(code => {
                  const isAdded = subtitleList.includes(code)
                  return (
                    <button
                      key={code}
                      type="button"
                      onClick={() => {
                        if (isAdded) handleRemoveSubtitleTag(code)
                        else handleAddSubtitleTag(code)
                      }}
                      className={`px-2 py-0.5 rounded text-[10px] border transition-colors cursor-pointer ${
                        isAdded
                          ? 'bg-primary/20 border-primary text-primary font-bold'
                          : 'bg-card border-border/40 text-muted-foreground hover:bg-muted'
                      }`}
                    >
                      {code} {isAdded ? '✓' : '+'}
                    </button>
                  )
                })}
              </div>
            </div>

            </details>
            <details className="space-y-3 rounded-xl border border-border/40 bg-card/20 p-3">
              <summary className="cursor-pointer list-none text-xs font-bold uppercase tracking-wider text-muted-foreground">Execution and output</summary>
            {/* Output Mode */}
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <FileCheck className="w-3.5 h-3.5 text-primary" /> Output & Verification Mode
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <button
                  type="button"
                  onClick={() => setOutputMode('replace')}
                  className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                    outputMode === 'replace'
                      ? 'border-primary bg-primary/10 shadow-sm ring-1 ring-primary'
                      : 'border-border bg-card/60 hover:bg-card'
                  }`}
                >
                  <div className="flex items-center gap-1 font-bold text-xs mb-1">
                    <Zap className="w-3.5 h-3.5 text-primary" />
                    <span>Direct Replace</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">In-place replacement with zero residual storage footprint.</p>
                </button>

                <button
                  type="button"
                  onClick={() => setOutputMode('quarantine-replace')}
                  className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                    outputMode === 'quarantine-replace'
                      ? 'border-primary bg-primary/10 shadow-sm ring-1 ring-primary'
                      : 'border-border bg-card/60 hover:bg-card'
                  }`}
                >
                  <div className="flex items-center gap-1 font-bold text-xs mb-1">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
                    <span>Quarantine & Replace</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">Replaces original and retains timestamped backup.</p>
                </button>

                <button
                  type="button"
                  onClick={() => setOutputMode('copy')}
                  className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                    outputMode === 'copy'
                      ? 'border-primary bg-primary/10 shadow-sm ring-1 ring-primary'
                      : 'border-border bg-card/60 hover:bg-card'
                  }`}
                >
                  <span className="font-bold text-xs block mb-1">Create Sibling Copy</span>
                  <p className="text-[11px] text-muted-foreground">Preserves original intact and outputs an optimized sister file.</p>
                </button>
              </div>
            </div>

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
        ) : mode === 'preview' && preflightData ? (
          /* Preflight Preview Mode */
          <div className="p-5 sm:p-6 space-y-4 max-h-[72vh] overflow-y-auto">
            {preflightProgressPanel}
            {message && <div role={isSuccess ? 'status' : 'alert'} className={`rounded-xl border p-3 text-xs ${isSuccess ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400' : 'border-destructive/20 bg-destructive/10 text-destructive'}`}>{message}</div>}
            {/* Summary card */}
            <div className="bg-muted/20 border border-border/30 rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-bold text-foreground">Preflight Optimization Plan</h4>
                  <p className="text-xs text-muted-foreground">{preflightData.episodes.length} episodes analyzed; only evidenced actions can be queued</p>
                  <p className="text-xs text-muted-foreground">{preflightData.episodes.filter(ep => ep.samplingRole === 'measured').length} episode samples measured · {preflightData.episodes.filter(ep => ep.samplingRole === 'projected').length} episodes use representative settings. Compatibility is inspected per episode.</p>
                  <p className="text-xs text-muted-foreground">Quality metrics use VMAF {preflightData.measurementModel ?? 'model unavailable'}.</p>
                  <p className="text-sm font-semibold">Selected series plan total: <EstimatedSavingsDisplay bytes={preflightData.estimatedSavingsBytes} /> · {preflightData.savingsCoverage ?? 'insufficient'} evidence{preflightData.savingsBasis === 'sample_based_projection' ? ' · Sample-based projection' : preflightData.savingsBasis === 'mixed_sample_projection' ? ' · Includes sample-based projections' : preflightData.savingsBasis === 'representative_sample_projection' || preflightData.savingsBasis === 'mixed_representative_sample_projection' ? ' · Includes representative-sample projections' : ''}</p>
                </div>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">Playback target
                  <select value={targetProfileId} onChange={event => { void updatePlan({ targetProfileId: event.target.value }) }} disabled={busy || targetProfilesLoading} className="rounded-lg border border-border bg-background px-2 py-1 text-xs text-foreground">
                    <option value="">{targetProfilesLoading ? 'Loading…' : 'No playback target'}</option>
                    {targetProfiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
                  </select>
                </label>
              </div>
              {!targetProfile && <p className="text-xs text-muted-foreground">Playback compatibility was not evaluated; measured quality and output-size checks still apply.</p>}

              <div className="divide-y divide-border/40 rounded-xl border border-border/40 bg-background/40">
                <details open={removeUnnecessaryStreams} className="group">
                  <summary className="flex cursor-pointer list-none items-center gap-3 p-3">
                    <input type="checkbox" checked={removeUnnecessaryStreams} onChange={event => { event.preventDefault(); void updatePlan({ removeUnnecessaryStreams: event.target.checked }) }} className="h-4 w-4 accent-primary" />
                    <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">Remove unnecessary streams</span><span className="block text-xs text-muted-foreground">{preflightData.episodes.filter(e => e.operations.includes('stream_pruning') || e.operations.includes('subtitle_pruning')).length} episodes · preserve only the selected audio and subtitle policy</span></span>
                  </summary>
                  <div className="border-t border-border/40 px-10 py-3 text-xs text-muted-foreground">Audio: {audio === 'all' ? 'all tracks' : 'original and protected tracks'} · Subtitles: {subtitleList.length ? subtitleList.join(', ') : 'preserve all'}</div>
                </details>
                <details open={adjustToTarget} className="group">
                  <summary className="flex cursor-pointer list-none items-center gap-3 p-3">
                    <input type="checkbox" checked={adjustToTarget} onChange={event => { event.preventDefault(); void updatePlan({ adjustToTarget: event.target.checked }) }} className="h-4 w-4 accent-primary" />
                    <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">Adjust output</span><span className="block text-xs text-muted-foreground">{preflightData.episodes.filter(e => e.operations.includes('video_transcode') || e.operations.includes('audio_transcode') || e.operations.includes('container_change')).length} episodes · apply the selected output strategy</span></span>
                  </summary>
                  <div className="border-t border-border/40 px-10 py-3 text-xs text-muted-foreground">Playback target: {targetProfileName || 'none'} · Codec: {codec ? codec.toUpperCase() : 'select codec'} · Strategy: {optimizationMode}</div>
                </details>
                <details className="group">
                  <summary className="flex cursor-pointer list-none items-center gap-3 p-3">
                    <span className="text-emerald-400">✓</span><span className="min-w-0 flex-1"><span className="block text-sm font-semibold">Already optimized</span><span className="block text-xs text-muted-foreground">{preflightData.episodes.filter(e => e.decisionStatus === 'already_optimized').length} episodes need no changes</span></span>
                  </summary>
                </details>
                <details className="group">
                  <summary className="flex cursor-pointer list-none items-center gap-3 p-3">
                    <span className="text-amber-300">?</span><span className="min-w-0 flex-1"><span className="block text-sm font-semibold">Review or analysis required</span><span className="block text-xs text-muted-foreground">{preflightData.episodes.filter(e => e.decisionStatus === 'insufficient_evidence').length} awaiting evidence · {preflightData.episodes.filter(e => e.decisionStatus === 'measurement_failed').length} measurement failures · {preflightData.episodes.filter(e => e.decisionStatus === 'quality_threshold_unmet').length} below quality requirements · {preflightData.episodes.filter(e => e.decisionStatus === 'no_savings').length} without savings in tested encodes</span></span>
                  </summary>
                </details>
              </div>
            </div>

            <button disabled={busy} className="text-xs underline" onClick={() => {
              setBusy(true)
              setMessage('')
              setIsSuccess(false)
              void window.electronAPI.seriesAnalyzeByIdentity(seriesIdentityKey, sourceId, libraryId)
                .then(async () => {
                  await runPreflight()
                  setMessage('Series analysis completed and the optimization plan was refreshed.')
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
            <p className="text-xs">Actionable: {preflightData.episodes.filter(ep => ep.compatible && ep.decisionStatus === 'actionable').length} · Transcode episodes: {preflightData.episodes.filter(ep => ep.compatible && ep.decisionStatus === 'sample_required').length} · Samples to review: {preflightData.episodes.filter(ep => ep.samplePaths?.length).length} · Blocked: {preflightData.episodes.filter(ep => !ep.compatible).length}</p>
            {/* Episodes breakdown */}
            <div className="space-y-2">
              <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                Episode Advisory Breakdown ({preflightData.episodes.length})
              </div>
              <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                {preflightData.episodes.map(ep => (
                  <div
                    key={ep.mediaItemId || ep.label}
                    className="p-3 bg-background/60 border border-border/30 rounded-xl space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-xs text-foreground truncate">{ep.label}</span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {getSourceTierBadge(ep.sourceTier)}
                        {getAdvisoryBadges(ep.operations, ep.compatible, ep.decisionStatus)}
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                      <span className="truncate max-w-[340px]">
                        {ep.adviceReason || ep.reason || (ep.compatible ? 'Ready for optimization' : 'Incompatible')}
                      </span>
                      <span className="shrink-0 font-mono text-[10px]">
                        {formatBytes(ep.sourceSize)} • {ep.hdrFormat}
                      </span>
                    </div>
                    {ep.samplingRole === 'measured' && <p className="text-xs text-primary">Encode samples measured from this episode.</p>}
                    {ep.samplingRole === 'projected' && <p className="text-xs text-amber-300">Uses measured settings from {ep.sampleRepresentativeLabel}; this episode’s savings are projected.</p>}
                    {ep.decisionStatus === 'insufficient_evidence' && ep.reason?.startsWith('Not sampled:') && ep.sourceAnalysis?.video && <button className="text-xs underline" disabled={busy} onClick={() => { logOptimizationDiagnostic('TVOptimizationUI', 'info', 'preflight.representative.reselected', { preflightId: preflightData.preflightId, mediaItemId: ep.mediaItemId }); void runPreflight({ representativeMediaItemId: ep.mediaItemId }).catch(error => { const message = error instanceof Error ? error.message : String(error); setMessage(message); addToast({ type: 'error', title: 'Could not retry representative sample', message }) }) }}>Use this episode as the sample for its technical group</button>}
                    {ep.sourceAnalysis?.video ? <details className="text-[11px]"><summary className="cursor-pointer text-muted-foreground">Source technical evidence</summary><p>{ep.sourceAnalysis.video.codec} · {ep.sourceAnalysis.video.width}×{ep.sourceAnalysis.video.height} · {ep.sourceAnalysis.video.frameRate} fps · {ep.sourceAnalysis.video.bitDepth}-bit · {ep.sourceAnalysis.video.bitrateKbps ? `${Math.round(ep.sourceAnalysis.video.bitrateKbps)} kb/s` : 'bitrate unavailable'} · {ep.hdrFormat} · {ep.sourceCambiMean === undefined ? 'source banding metric unavailable' : `source CAMBI ${ep.sourceCambiMean.toFixed(2)}`} · {ep.sourceSelfVmaf === undefined ? 'source-self control unavailable' : `source-self VMAF ${ep.sourceSelfVmaf.toFixed(2)}`}</p></details> : null}
                    {ep.qualityChoices?.length ? <div className="grid gap-1 rounded-md bg-muted/30 p-2 text-[11px]">{ep.qualityChoices.map(choice => <div key={choice.profile}><p><strong>{choice.profile === 'transparent' ? 'Higher fidelity' : 'Smaller file'}:</strong> {choice.status === 'available' ? `${formatBytes(choice.estimatedSavingsBytes ?? 0)} estimated savings · ${choice.candidate?.encoder}/${choice.candidate?.preset} q${choice.candidate?.quality} · ${choice.candidate?.sampledDurationSeconds.toFixed(0)}s sampled · VMAF ${choice.candidate?.vmafMean.toFixed(1)} mean, ${choice.candidate?.vmafP5.toFixed(1)} p5 · CAMBI ${choice.candidate?.cambiMean.toFixed(2)} output / ${choice.candidate?.sourceCambiMean?.toFixed(2) ?? 'source unavailable'} source · source-self VMAF ${choice.candidate?.sourceSelfVmaf?.toFixed(2) ?? 'unavailable'} · ${((choice.candidate?.encodingDurationMs ?? 0) / 1000).toFixed(1)}s sample encode` : choice.status === 'measurement_incomplete' ? 'More candidate measurements are pending' : choice.status === 'incompatible' ? 'Measured candidates do not meet playback requirements' : 'No measured candidate meets this quality requirement'}</p>{choice.alternatives && choice.alternatives.length > 1 ? <details className="mt-1"><summary className="cursor-pointer">Compare {choice.alternatives.length} non-dominated measured configurations</summary><ul className="ml-4 list-disc">{choice.alternatives.map(candidate => <li key={`${candidate.encoder}/${candidate.preset}/${candidate.quality}`}>{candidate.encoder}/{candidate.preset} q{candidate.quality} · {formatBytes(candidate.outputBytes)} / {candidate.sampledDurationSeconds.toFixed(0)}s sampled · VMAF {candidate.vmafMean.toFixed(1)} mean / {candidate.vmafP5.toFixed(1)} p5 · CAMBI {candidate.cambiMean.toFixed(2)} · {((candidate.encodingDurationMs ?? 0) / 1000).toFixed(1)}s</li>)}</ul></details> : null}</div>)}</div> : null}
                    {ep.changes?.map(change => <p key={change} className="text-xs">{change}</p>)}
                    {ep.targetCompatibility && <PlaybackCompatibilityFindings evaluation={ep.targetCompatibility} targetName={ep.targetProfile?.name} />}
                    {ep.samplePaths?.length && <div className="text-xs space-y-2">{ep.samplePaths.map((sample, index) => <button key={sample} className="mr-2 underline" onClick={() => { logOptimizationDiagnostic('TVOptimizationUI', 'info', 'sample.playback.requested', { preflightId: preflightData.preflightId, mediaItemId: ep.mediaItemId, sampleIndex: index }); void window.electronAPI.openShowSample(preflightData.preflightId, ep.mediaItemId, index).then(() => logOptimizationDiagnostic('TVOptimizationUI', 'info', 'sample.playback.opened', { preflightId: preflightData.preflightId, mediaItemId: ep.mediaItemId, sampleIndex: index })).catch(error => { logOptimizationDiagnostic('TVOptimizationUI', 'error', 'sample.playback.failed', { preflightId: preflightData.preflightId, mediaItemId: ep.mediaItemId, sampleIndex: index, error: describeDiagnosticError(error) }); const message = error instanceof Error ? error.message : String(error); setMessage(message); addToast({ type: 'error', title: 'Could not open measured sample', message }) }) }}>Play sample {index + 1}</button>)}<label className="block"><input type="checkbox" checked={reviewedEpisodes.includes(ep.mediaItemId)} onChange={event => { const reviewed = event.target.checked; logOptimizationDiagnostic('TVOptimizationUI', 'info', 'sample.review.acknowledged', { preflightId: preflightData.preflightId, mediaItemId: ep.mediaItemId, reviewed }); setReviewedEpisodes(ids => reviewed ? [...ids, ep.mediaItemId] : ids.filter(id => id !== ep.mediaItemId)) }} /> I approve playback of these samples and the listed conversions</label></div>}
                    <div className="flex items-center justify-between text-[10px] text-muted-foreground/80">
                      <span>{ep.evidenceStatus ? `Evidence: ${ep.evidenceStatus} (${ep.confidence || 'none'})` : 'Evidence: unavailable'}</span>
                      <span>Selected plan: <EstimatedSavingsDisplay bytes={ep.estimatedSavingsBytes} /> · {ep.savingsCoverage ?? 'insufficient'} evidence{ep.savingsBasis === 'video_sample_encode' ? ' · Sample-based projection' : ep.savingsBasis === 'representative_video_sample_projection' ? ' · Representative-sample projection' : ''}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {preflightData.episodes.some(episode => !episode.compatible) && (
              <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>Some episodes are blocked or need more evidence. Review the details above.</span>
              </div>
            )}
          </div>
        ) : (
          /* Live Monitoring Mode */
          <div className="p-5 sm:p-6 space-y-6">
              {verifiedResults.length > 0 && <div className="rounded-xl border border-border/40 p-3 text-xs">Encoded reduction: {formatBytes(verifiedResults.reduce((sum: number, result: any) => sum + Number(result.encodedReductionBytes || 0), 0))} · Retained originals: {formatBytes(verifiedResults.reduce((sum: number, result: any) => sum + Number(result.retainedOriginalBytes || 0), 0))} · Disk space change: {(verifiedResults.reduce((sum: number, result: any) => sum + Number(result.physicallyReclaimedBytes || 0), 0) / (1024 * 1024)).toFixed(1)} MB reclaimed</div>}
            {/* Active Episode Gauge & Status */}
            {currentTask && isCurrentTranscode ? (
              <div className="space-y-5">
                <div className="flex flex-col sm:flex-row items-center gap-6 bg-muted/20 border border-border/30 rounded-2xl p-5">
                  {/* Circular Speedometer Gauge */}
                  <div className="relative w-28 h-28 shrink-0 flex items-center justify-center">
                    <svg className="w-full h-full -rotate-90 transform" viewBox="0 0 128 128">
                      <circle
                        cx="64"
                        cy="64"
                        r={normalizedRadius}
                        stroke="currentColor"
                        strokeWidth={strokeWidth}
                        className="text-muted/30 fill-none"
                      />
                      <circle
                        cx="64"
                        cy="64"
                        r={normalizedRadius}
                        stroke="currentColor"
                        strokeWidth={strokeWidth}
                        strokeDasharray={circumference}
                        strokeDashoffset={strokeDashoffset}
                        strokeLinecap="round"
                        className="text-primary fill-none transition-all duration-300 ease-out"
                      />
                    </svg>
                    <div className="absolute flex flex-col items-center justify-center text-center">
                      <span className="text-xl font-black text-foreground">{Math.round(currentPercent)}%</span>
                      <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Progress</span>
                    </div>
                  </div>

                  {/* Current Item Meta & Status */}
                  <div className="flex-1 min-w-0 space-y-2 text-center sm:text-left">
                    <div className="flex items-center justify-center sm:justify-start gap-2">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                      <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">Encoding Episode</span>
                    </div>
                    <h4 className="text-sm font-bold text-foreground truncate">{currentTask.label}</h4>
                    <p className="text-xs text-muted-foreground capitalize">{currentTask.progress?.phase || 'Optimizing media streams...'}</p>

                    {/* Linear Progress Bar */}
                    <div className="h-2 bg-muted/40 rounded-full overflow-hidden w-full">
                      <div
                        className="h-full bg-primary transition-all duration-300"
                        style={{ width: `${currentPercent}%` }}
                      />
                    </div>
                  </div>
                </div>

                {/* Telemetry Strip */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-background/80 p-3 rounded-xl border border-border/30 text-center">
                    <div className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider flex items-center justify-center gap-1.5 mb-1">
                      <Gauge className="w-3.5 h-3.5 text-primary" /> Framerate
                    </div>
                    <div className="text-sm font-black text-primary">{currentFps}</div>
                  </div>

                  <div className="bg-background/80 p-3 rounded-xl border border-border/30 text-center">
                    <div className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider flex items-center justify-center gap-1.5 mb-1">
                      <Zap className="w-3.5 h-3.5 text-yellow-400" /> Speed
                    </div>
                    <div className="text-sm font-black text-foreground">{currentSpeed}</div>
                  </div>

                  <div className="bg-background/80 p-3 rounded-xl border border-border/30 text-center">
                    <div className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider flex items-center justify-center gap-1.5 mb-1">
                      <Clock className="w-3.5 h-3.5 text-blue-400" /> ETA
                    </div>
                    <div className="text-sm font-black text-foreground truncate">{currentEta}</div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-8 space-y-3 bg-muted/10 rounded-2xl border border-border/20">
                <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto" />
                <h4 className="text-base font-bold">Series Optimization Complete or Idle</h4>
                <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                  {batchQueue.length ? 'This batch is waiting in the queue.' : 'No episodes from this batch remain in the queue. Review task history for failures.'}
                </p>
              </div>
            )}

            <div className="flex items-center justify-between rounded-xl border border-border/30 p-3 text-sm">
              <span>{batchQueue.length} episodes queued{queueState.isPaused ? ' · queue paused' : ''}</span>
              <button type="button" onClick={() => window.dispatchEvent(new Event('taskQueue:open'))} className="text-primary hover:underline">Open Task Queue</button>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="p-4 sm:p-5 bg-muted/10 border-t border-border/10 flex items-center justify-between gap-3">
          {mode === 'config' ? (
            <>
              <button
                onClick={() => void handleClose()}
                disabled={preflightTermination !== null}
                title={preflightTermination === 'cancelling' ? 'Cancelling optimization review' : preflightTermination === 'finishing' ? 'Finishing optimization review' : undefined}
                className="px-5 py-2 bg-muted hover:bg-muted/80 rounded-xl text-xs font-bold transition-all cursor-pointer"
              >
                {preflightTermination === 'cancelling' ? 'Stopping…' : preflightTermination === 'finishing' ? 'Finishing…' : activePreflightRequestId.current ? 'Stop preflight' : 'Cancel'}
              </button>

              <div className="flex items-center gap-2">
                <button
                  disabled={busy || targetProfilesLoading}
                  onClick={() => void handlePreviewPlan()}
                  className="flex items-center gap-2 px-6 py-2.5 bg-primary text-primary-foreground font-black rounded-xl text-xs transition-all disabled:opacity-50 shadow-lg shadow-primary/20 hover:opacity-90 cursor-pointer"
                >
                  {busy ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>{seasonNumber === undefined ? 'Preflighting Series…' : `Preflighting Season ${seasonNumber}…`}</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      <span>Measure & Review Series</span>
                    </>
                  )}
                </button>
              </div>
            </>
          ) : mode === 'preview' ? (
            <>
              <button
                onClick={() => setMode('config')}
                className="flex items-center gap-1.5 px-4 py-2 bg-muted hover:bg-muted/80 rounded-xl text-xs font-bold transition-all cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Back to Settings</span>
              </button>

              <button
                disabled={busy || !preflightData?.compatible || preflightData.episodes.some(ep => ep.compatible && ep.samplePaths?.length && !reviewedEpisodes.includes(ep.mediaItemId))}
                onClick={() => void handleQueueFromPreview()}
                className="flex items-center gap-2 px-6 py-2.5 bg-primary text-primary-foreground font-black rounded-xl text-xs transition-all disabled:opacity-50 shadow-lg shadow-primary/20 hover:opacity-90 cursor-pointer"
              >
                {busy ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Queueing Episodes…</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    <span>Queue Eligible Episodes</span>
                  </>
                )}
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={() => window.dispatchEvent(new Event('taskQueue:open'))} className="text-sm text-primary hover:underline">Open Task Queue</button>

              <button
                onClick={() => void handleClose()}
                className="px-5 py-2 bg-primary text-primary-foreground hover:opacity-90 rounded-xl text-xs font-bold transition-all shadow-md shadow-primary/20 cursor-pointer"
              >
                Run in Background
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
