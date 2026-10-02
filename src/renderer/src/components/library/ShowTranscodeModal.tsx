import { useState, useEffect, useCallback, useRef } from 'react'
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
  Pause,
  Play,
  XCircle,
  Activity,
  ListOrdered,
  Languages,
  Scissors,
  Eye,
  ArrowLeft,
  Trash2
} from 'lucide-react'
import { useToast } from '@/contexts/ToastContext'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import type { TVShowSummary, MediaItem } from './types'
import type { GpuInfo, ShowTranscodePreflight } from './transcoding/types'
import { TranscodingDeviceSelector } from './transcoding/TranscodingDeviceSelector'
import { formatLanguage, isSameLanguage, LANGUAGE_OPTIONS } from './mediaUtils'
import { getTVShowIdentity } from './tv/showIdentity'
import type { QueuedTask, TaskQueueState } from '@main/types/database'
import type { PlaybackTargetProfile } from '@main/types/playbackTarget'
import type { OptimizationQualityProfile } from '@main/services/MeasuredOptimizationPolicy'
import { TaskType } from '@main/types/database'

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

function getAdvisoryBadge(action?: string, compatible: boolean = true, decisionStatus?: string) {
  if (!compatible) {
    return (
      <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-destructive/20 text-destructive border border-destructive/30 flex items-center gap-1">
        <AlertCircle className="w-3 h-3" /> Incompatible
      </span>
    )
  }
  if (decisionStatus === 'insufficient_evidence') {
    return (
      <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1">
        <AlertCircle className="w-3 h-3" /> Insufficient Evidence
      </span>
    )
  }
  if (decisionStatus === 'sample_required') {
    return (
      <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-blue-500/20 text-blue-300 border border-blue-500/30 flex items-center gap-1">
        <Eye className="w-3 h-3" /> Sample Required
      </span>
    )
  }
  switch (action) {
    case 'video_transcode':
      return (
        <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-blue-500/20 text-blue-400 border border-blue-500/30 flex items-center gap-1">
          <Zap className="w-3 h-3" /> Video Transcode
        </span>
      )
    case 'stream_pruning':
      return (
        <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
          <Scissors className="w-3 h-3" /> Lossless Stream Copy
        </span>
      )
    case 'already_optimized':
      return (
        <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-muted text-muted-foreground border border-border/40 flex items-center gap-1">
          <CheckCircle2 className="w-3 h-3" /> Already Optimized
        </span>
      )
    default:
      return null
  }
}

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '0 B'
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function ShowTranscodeModal({ show, onClose }: { show: TVShowSummary; onClose: () => void }) {
  const { addToast } = useToast()
  const { seriesIdentityKey, sourceId, libraryId } = getTVShowIdentity(show)
  const [mode, setMode] = useState<'config' | 'preview' | 'monitoring'>('config')
  const [optimizationMode, setOptimizationMode] = useState<'smart' | 'remux_only' | 'transcode'>('smart')
  const [removeUnnecessaryStreams, setRemoveUnnecessaryStreams] = useState(true)
  const [adjustToTarget, setAdjustToTarget] = useState(true)
  const [targetProfileId, setTargetProfileId] = useState('')
  const [targetProfileName, setTargetProfileName] = useState('')
  const [targetProfiles, setTargetProfiles] = useState<PlaybackTargetProfile[]>([])
  const [qualityProfile, setQualityProfile] = useState<OptimizationQualityProfile | ''>('')
  const [encoderPolicy, setEncoderPolicy] = useState<'hardware' | 'software' | 'compare' | ''>('')
  const [targetContainer, setTargetContainer] = useState<'mkv' | 'mp4' | ''>('')
  const [targetAudioCodec, setTargetAudioCodec] = useState<'aac' | 'ac3' | 'eac3' | ''>('')
  const [targetHdrFormat, setTargetHdrFormat] = useState<'SDR' | 'HDR10' | ''>('')
  const [reviewedEpisodes, setReviewedEpisodes] = useState<number[]>([])
  const [activeBatchId, setActiveBatchId] = useState<string>()
  const [codec, setCodec] = useState<'hevc' | 'av1'>('av1')
  const [audio, setAudio] = useState<'all' | 'original-and-protected'>('original-and-protected')
  const [language, setLanguage] = useState('')
  const [subtitleWhitelist, setSubtitleWhitelist] = useState('eng, heb, spa')
  const [newSubtitleInput, setNewSubtitleInput] = useState('')
  const [detectedLanguages, setDetectedLanguages] = useState<string[]>([])
  const [providerLanguage, setProviderLanguage] = useState<string>('')
  const [outputMode, setOutputMode] = useState<'copy' | 'quarantine-replace' | 'replace'>('quarantine-replace')
  const [useGpu, setUseGpu] = useState(true)
  const [gpuId, setGpuId] = useState('')
  const [gpus, setGpus] = useState<GpuInfo[]>([])
  const [verifiedEncoders, setVerifiedEncoders] = useState<string[]>([])
  const [message, setMessage] = useState('')
  const [isSuccess, setIsSuccess] = useState(false)
  const [busy, setBusy] = useState(false)
  const [preflightData, setPreflightData] = useState<ShowTranscodePreflight | null>(null)
  const [quarantineFiles, setQuarantineFiles] = useState<Array<{ mediaItemId: number; label: string; path: string; size: number; modifiedAt: string; owned: boolean }>>([])
  const modalRef = useRef<HTMLDivElement | null>(null)

  // Live Task Queue tracking state for monitoring mode
  const [queueState, setQueueState] = useState<TaskQueueState>({
    currentTask: null,
    queue: [],
    isPaused: false,
    completedTasks: []
  })

  useFocusTrap(true, modalRef)

  useEffect(() => {
    let mounted = true
    void Promise.all([
      window.electronAPI.listPlaybackTargetProfiles(),
      window.electronAPI.getSetting('optimization_default_target_profile_id')
    ]).then(([profiles, configuredId]) => {
      const profile = profiles.find(candidate => candidate.id === configuredId)
      if (mounted) {
        setTargetProfiles(profiles)
        if (profile) { setTargetProfileId(profile.id); setTargetProfileName(profile.name) }
      }
    }).catch(error => setMessage(error instanceof Error ? error.message : String(error)))
    return () => { mounted = false }
  }, [])

  const handleUseGpuChange = useCallback((next: boolean) => setUseGpu(next), [])
  const handleGpuIdChange = useCallback((id: string) => setGpuId(id), [])

  const handleClose = useCallback(async () => {
    try {
      if (preflightData && mode !== 'monitoring') await window.electronAPI.discardShow(preflightData.preflightId)
      onClose()
    } catch (error) {
      addToast({ type: 'error', title: 'Discard plan', message: String(error) })
    }
  }, [preflightData, mode, onClose, addToast])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) void handleClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [busy, handleClose])

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
                    window.electronAPI.log.error('ShowTranscodeModal', 'Failed to parse episode audio tracks for language detection', error)
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

  // Load global subtitle preference
  useEffect(() => {
    let isMounted = true
    window.electronAPI.getSetting('subtitle_preferred_languages').then((val) => {
      if (!isMounted) return
      if (val && typeof val === 'string' && val.trim()) {
        setSubtitleWhitelist(val.trim())
      }
    }).catch((error) => {
      console.error('[ShowTranscodeModal] Failed to load subtitle preferences', error)
    })
    return () => { isMounted = false }
  }, [])

  useEffect(() => {
    let isMounted = true
    window.electronAPI.getCapabilities().then((capabilities) => {
      if (!isMounted || !capabilities) return
      const detectedGpus = capabilities.gpus || []
      setGpus(detectedGpus)
      setVerifiedEncoders(capabilities.verifiedEncoders)
      const selected = detectedGpus.find((gpu: GpuInfo) => gpu.id === capabilities.selectedGpuId)
      if (selected) {
        setGpuId(selected.id)
        setUseGpu(true)
      } else {
        setUseGpu(false)
      }
    }).catch(err => {
      addToast({ type: 'error', title: 'Encoder capabilities', message: String(err) })
    })
    return () => { isMounted = false }
  }, [])

  // Subscribe to TaskQueue state updates
  useEffect(() => {
    const unsubscribe = window.electronAPI.onTaskQueueUpdated?.((state) => {
      setQueueState(state as TaskQueueState)
    })
    window.electronAPI.taskQueueGetState?.().then((state) => {
      if (state) setQueueState(state as TaskQueueState)
    }).catch((error) => {
      addToast({ type: 'error', title: 'Show queue state', message: String(error) })
    })

    return () => {
      unsubscribe?.()
    }
  }, [])

  const subtitleList = subtitleWhitelist
    .split(/[,\s]+/)
    .map(s => s.trim().toLowerCase())
    .filter(Boolean)

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
    const whitelist = shouldRemoveStreams && subtitleList.length > 0 ? subtitleList : undefined
    const effectiveAudio = shouldRemoveStreams ? audio : 'all' as const
    const effectiveOptimizationMode = shouldAdjustToTarget ? optimizationMode : 'remux_only' as const
    return {
      targetCodec: codec,
      qualityProfile: qualityProfile || undefined,
      encoderPolicy: encoderPolicy || undefined,
      targetContainer: targetContainer || undefined,
      targetAudioCodec: targetAudioCodec || undefined,
      targetHdrFormat: targetHdrFormat || undefined,
      transcodingEngine: 'ffmpeg' as const,
      outputMode,
      useGpu: effectiveOptimizationMode === 'remux_only' ? false : useGpu,
      gpuId: useGpu && effectiveOptimizationMode !== 'remux_only' ? gpuId : undefined,
      optimizationMode: effectiveOptimizationMode,
      targetProfileId: overrides.targetProfileId ?? targetProfileId,
      streamSelection: effectiveAudio === 'all'
        ? { audio: 'all' as const, subtitle: 'all' as const, subtitleLanguageWhitelist: whitelist, defaultSubtitle: 'preserve' as const }
        : { audio: effectiveAudio, originalLanguage: language.trim().toLowerCase(), subtitle: 'all' as const, subtitleLanguageWhitelist: whitelist, defaultSubtitle: 'preserve' as const }
    }
  }

  const runPreflight = async (overrides: { removeUnnecessaryStreams?: boolean; adjustToTarget?: boolean; targetProfileId?: string } = {}) => {
    const shouldRemoveStreams = overrides.removeUnnecessaryStreams ?? removeUnnecessaryStreams
    if (!targetProfileId || !outputMode || (shouldRemoveStreams && audio === 'original-and-protected' && !language.trim())) {
      throw new Error('A playback profile and output mode are required; choose an original language when stream pruning is enabled.')
    }
    if (adjustToTarget && optimizationMode !== 'remux_only' && (!qualityProfile || !encoderPolicy || !targetContainer || !targetHdrFormat)) throw new Error('Choose quality, encoder policy, container, and output color format before measuring samples.')
    if (preflightData) await window.electronAPI.discardShow(preflightData.preflightId)
    setReviewedEpisodes([])
    const episodes = await window.electronAPI.seriesGetEpisodesByIdentity(show.series_title, sourceId, seriesIdentityKey, libraryId)
    if (episodes.some(episode => !episode.deep_analysis)) {
      setMessage('Analyzing this show before measuring samples…')
      await window.electronAPI.mediaAnalyze({ kind: 'show', title: show.series_title, sourceId, seriesIdentityKey, libraryId })
    }
    const preflight = await window.electronAPI.preflightShow({
      seriesTitle: show.series_title,
      seriesIdentityKey,
      sourceId,
      libraryId,
      options: getCleanOptions(overrides)
    })
    setPreflightData(preflight)
    return preflight
  }

  const updatePlan = async (next: { removeUnnecessaryStreams?: boolean; adjustToTarget?: boolean; targetProfileId?: string }) => {
    if (next.removeUnnecessaryStreams !== undefined) setRemoveUnnecessaryStreams(next.removeUnnecessaryStreams)
    if (next.adjustToTarget !== undefined) setAdjustToTarget(next.adjustToTarget)
    if (next.targetProfileId !== undefined) {
      setTargetProfileId(next.targetProfileId)
      setTargetProfileName(targetProfiles.find(profile => profile.id === next.targetProfileId)?.name || '')
    }
    setBusy(true)
    setMessage('')
    try {
      await runPreflight(next)
    } catch (error) {
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
      setMode('preview')
      if (!preflight.compatible) {
        setMessage('Preflight completed with some incompatibilities.')
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error)
      setMessage(errMsg)
      addToast({
        type: 'error',
        title: 'Preflight Failed',
        message: errMsg
      })
    } finally {
      setBusy(false)
    }
  }

  const handleQueueFromPreview = async () => {
    if (!preflightData) return
    setBusy(true)
    setMessage('')
    try {
      const requiresApproval = preflightData.episodes.some(episode => episode.compatible && episode.decisionStatus === 'sample_required')
      if (preflightData.episodes.some(episode => episode.compatible && episode.samplePaths?.length && !reviewedEpisodes.includes(episode.mediaItemId))) throw new Error('Play and approve the winning samples for every eligible episode.')
      if (requiresApproval) await window.electronAPI.approveShow(preflightData.preflightId)
      const queued = await window.electronAPI.queueShow(preflightData.preflightId)
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

  const handlePauseResume = async () => {
    try {
      if (queueState.isPaused) {
        await window.electronAPI.taskQueueResume()
      } else {
        await window.electronAPI.taskQueuePause()
      }
    } catch (error) {
      window.electronAPI.log.error('ShowTranscodeModal', 'Failed to change transcode queue pause state', error)
    }
  }

  const handleCancelCurrent = async () => {
    try {
      await window.electronAPI.taskQueueCancelCurrent(activeBatchId)
      addToast({ title: 'Cancelled current episode encoding', type: 'info' })
    } catch (error) {
      addToast({ type: 'error', title: 'Cancel episode', message: String(error) })
    }
  }

  const handleClearQueue = async () => {
    try {
      await window.electronAPI.taskQueueClearQueue(activeBatchId)
      addToast({ title: 'Cleared this show batch', type: 'info' })
    } catch (error) {
      addToast({ type: 'error', title: 'Clear show batch', message: String(error) })
    }
  }

  const handleRemoveTask = async (taskId: string) => {
    try {
      await window.electronAPI.taskQueueRemoveTask(taskId)
      addToast({ title: 'Removed task from queue', type: 'info' })
    } catch (error) {
      window.electronAPI.log.error('ShowTranscodeModal', 'Failed to remove transcode task from queue', error)
    }
  }

  // Filter tasks belonging to transcoding
  const vendor = gpus.find(gpu => gpu.id === gpuId)?.vendor
  const hardwareEncoder = vendor === 'NVIDIA' ? (codec === 'av1' ? 'nvenc_av1' : 'nvenc_h265') : vendor === 'Intel' ? (codec === 'av1' ? 'qsv_av1' : 'qsv_h265') : undefined
  const hardwareAvailable = useGpu && hardwareEncoder !== undefined && verifiedEncoders.includes(hardwareEncoder)
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

  return createPortal(
    <div 
      role="dialog"
      aria-modal="true"
      aria-labelledby="show-transcode-modal-title"
      className="fixed inset-0 z-250 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200"
      onClick={busy ? undefined : () => void handleClose()}
    >
      <div 
        ref={modalRef}
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
                {mode === 'monitoring' ? 'Live Series Optimization' : mode === 'preview' ? 'Optimization Plan Preview' : 'Batch Optimize Series'}
              </h3>
              <p className="text-xs text-muted-foreground truncate max-w-[420px]">{show.series_title}</p>
            </div>
          </div>
          {!busy && (
            <button 
              onClick={() => void handleClose()}
              className="p-1.5 hover:bg-muted rounded-full text-muted-foreground hover:text-foreground transition-all cursor-pointer"
              title="Close modal (tasks continue in background)"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Content */}
        {mode === 'config' ? (
          <div className="p-5 sm:p-6 space-y-5 max-h-[72vh] overflow-y-auto">
            <div className="rounded-xl border border-border/40 bg-muted/20 p-3 flex items-center justify-between gap-3">
              <div className="min-w-0"><div className="text-xs font-bold">Quarantined originals</div><div className="text-[11px] text-muted-foreground">{quarantineFiles.length} retained file{quarantineFiles.length === 1 ? '' : 's'} · {formatBytes(quarantineFiles.reduce((total, file) => total + file.size, 0))}{quarantineFiles.some(file => !file.owned) && ' · Unowned backups require separate review'}</div></div>
              <div className="flex gap-2 shrink-0"><button type="button" onClick={loadQuarantine} className="px-2.5 py-1.5 text-xs rounded-lg border border-border hover:bg-muted">List</button><button type="button" onClick={purgeQuarantine} disabled={quarantineFiles.length === 0 || quarantineFiles.some(file => !file.owned)} className="px-2.5 py-1.5 text-xs rounded-lg border border-red-500/40 text-red-300 disabled:opacity-40">Purge</button></div>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Optimization plan</label>
              <div className="rounded-xl border border-border/40 bg-card/40 px-3 py-2 text-xs"><span className="text-muted-foreground">Default playback profile</span><span className="ml-2 font-semibold text-foreground">{targetProfileName || 'Loading…'}</span></div>
              <div className="divide-y divide-border/40 rounded-xl border border-border/40 bg-card/40">
                <label className="flex items-center justify-between gap-4 p-3 cursor-pointer">
                  <span><span className="block text-sm font-semibold">Remove unnecessary streams</span><span className="block text-xs text-muted-foreground">Apply the selected audio and subtitle policies.</span></span>
                  <input type="checkbox" checked={removeUnnecessaryStreams} onChange={event => setRemoveUnnecessaryStreams(event.target.checked)} className="h-4 w-4 accent-primary" />
                </label>
                <label className="flex items-center justify-between gap-4 p-3 cursor-pointer">
                  <span><span className="block text-sm font-semibold">Adjust to target</span><span className="block text-xs text-muted-foreground">Allow target-driven video and container changes. Turn off to keep the video stream unchanged.</span></span>
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
                  onClick={() => setOptimizationMode('smart')}
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
                  onClick={() => setOptimizationMode('remux_only')}
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
                  onClick={() => setOptimizationMode('transcode')}
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
              <summary className="cursor-pointer list-none text-xs font-bold uppercase tracking-wider text-muted-foreground">Target adjustment details</summary>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <label>Visual quality threshold<select aria-label="Quality" value={qualityProfile} onChange={e => setQualityProfile(e.target.value as OptimizationQualityProfile)}><option value="">Select threshold</option><option value="transparent">Highest measured fidelity</option><option value="balanced">Balanced fidelity and savings</option><option value="maximum_savings">More savings, measured loss allowed</option></select></label>
              <label>Encoder policy<select aria-label="Encoder policy" value={encoderPolicy} onChange={e => setEncoderPolicy(e.target.value as typeof encoderPolicy)}><option value="">Select policy</option><option value="hardware" disabled={!hardwareAvailable}>Verified hardware</option><option value="software">Software</option><option value="compare" disabled={!hardwareAvailable}>Compare hardware and software</option></select></label>
              <label>Container<select aria-label="Container" value={targetContainer} onChange={e => setTargetContainer(e.target.value as typeof targetContainer)}><option value="">Select container</option>{targetProfiles.find(profile => profile.id === targetProfileId)?.definition.containers.filter(container => ['matroska', 'mp4'].includes(container)).map(container => <option key={container} value={container === 'matroska' ? 'mkv' : 'mp4'}>{container}</option>)}</select></label>
              <label>Output color<select aria-label="Output color" value={targetHdrFormat} onChange={e => setTargetHdrFormat(e.target.value as typeof targetHdrFormat)}><option value="">Select color format</option><option value="SDR">SDR</option>{targetProfiles.find(profile => profile.id === targetProfileId)?.definition.hdr.formats.includes('HDR10') && <option value="HDR10">HDR10</option>}</select></label>
              <label>Audio conversion<select aria-label="Audio conversion" value={targetAudioCodec} onChange={e => setTargetAudioCodec(e.target.value as typeof targetAudioCodec)}><option value="">Preserve codec; block incompatible tracks</option>{targetProfiles.find(profile => profile.id === targetProfileId)?.definition.audio.codecs.filter(codec => ['aac', 'ac3', 'eac3'].includes(codec)).map(codec => <option key={codec} value={codec}>{codec.toUpperCase()}</option>)}</select></label>
            </div>
            {/* Codec Selection */}
            {optimizationMode !== 'remux_only' && (
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-primary" /> Target Video Codec
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setCodec('av1')}
                    disabled={!targetProfiles.find(profile => profile.id === targetProfileId)?.definition.video.codecs.includes('av1')}
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
                    onClick={() => setCodec('hevc')}
                    disabled={!targetProfiles.find(profile => profile.id === targetProfileId)?.definition.video.codecs.includes('hevc')}
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
                Preserves subtitles matching these ISO-639 codes (e.g. eng, heb, spa). Non-whitelisted subtitles are pruned to eliminate container bloat.
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
            {/* Transcoding Device Selector */}
            {optimizationMode !== 'remux_only' && (
              <TranscodingDeviceSelector
                useGpu={useGpu}
                onUseGpuChange={handleUseGpuChange}
                selectedGpuId={gpuId}
                onSelectedGpuIdChange={handleGpuIdChange}
                gpus={gpus}
                variant="compact"
              />
            )}

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
            {/* Summary card */}
            <div className="bg-muted/20 border border-border/30 rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-bold text-foreground">Preflight Optimization Plan</h4>
                  <p className="text-xs text-muted-foreground">{preflightData.episodes.length} episodes analyzed; only evidenced actions can be queued</p>
                </div>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">Profile
                  <select value={targetProfileId} onChange={event => { void updatePlan({ targetProfileId: event.target.value }) }} disabled={busy} className="rounded-lg border border-border bg-background px-2 py-1 text-xs text-foreground">
                    {targetProfiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
                  </select>
                </label>
              </div>

              <div className="divide-y divide-border/40 rounded-xl border border-border/40 bg-background/40">
                <details open={removeUnnecessaryStreams} className="group">
                  <summary className="flex cursor-pointer list-none items-center gap-3 p-3">
                    <input type="checkbox" checked={removeUnnecessaryStreams} onChange={event => { event.preventDefault(); void updatePlan({ removeUnnecessaryStreams: event.target.checked }) }} className="h-4 w-4 accent-primary" />
                    <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">Remove unnecessary streams</span><span className="block text-xs text-muted-foreground">{preflightData.episodes.filter(e => e.recommendedAction === 'stream_pruning').length} episodes · preserve only the selected audio and subtitle policy</span></span>
                  </summary>
                  <div className="border-t border-border/40 px-10 py-3 text-xs text-muted-foreground">Audio: {audio === 'all' ? 'all tracks' : 'original and protected tracks'} · Subtitles: {subtitleList.length ? subtitleList.join(', ') : 'preserve all'}</div>
                </details>
                <details open={adjustToTarget} className="group">
                  <summary className="flex cursor-pointer list-none items-center gap-3 p-3">
                    <input type="checkbox" checked={adjustToTarget} onChange={event => { event.preventDefault(); void updatePlan({ adjustToTarget: event.target.checked }) }} className="h-4 w-4 accent-primary" />
                    <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">Adjust to target</span><span className="block text-xs text-muted-foreground">{preflightData.episodes.filter(e => e.recommendedAction === 'video_transcode').length} episodes · apply the selected target strategy</span></span>
                  </summary>
                  <div className="border-t border-border/40 px-10 py-3 text-xs text-muted-foreground">Profile: {targetProfileName || 'default playback profile'} · Codec: {codec.toUpperCase()} · Strategy: {optimizationMode}</div>
                </details>
                <details className="group">
                  <summary className="flex cursor-pointer list-none items-center gap-3 p-3">
                    <span className="text-emerald-400">✓</span><span className="min-w-0 flex-1"><span className="block text-sm font-semibold">Already optimized</span><span className="block text-xs text-muted-foreground">{preflightData.episodes.filter(e => e.recommendedAction === 'already_optimized').length} episodes need no changes</span></span>
                  </summary>
                </details>
                <details className="group">
                  <summary className="flex cursor-pointer list-none items-center gap-3 p-3">
                    <span className="text-amber-300">?</span><span className="min-w-0 flex-1"><span className="block text-sm font-semibold">Review or analysis required</span><span className="block text-xs text-muted-foreground">{preflightData.episodes.filter(e => e.decisionStatus === 'insufficient_evidence').length} episodes will be skipped</span></span>
                  </summary>
                </details>
              </div>
            </div>

            <button disabled={busy} className="text-xs underline" onClick={() => { setBusy(true); void window.electronAPI.mediaAnalyze({ kind: 'show', title: show.series_title, sourceId, seriesIdentityKey, libraryId }).then(() => setMessage('Series analysis completed. Refresh the plan.')).catch(error => setMessage(String(error))).finally(() => setBusy(false)) }}>Analyze show using series analysis</button>
            <p className="text-xs">Actionable: {preflightData.episodes.filter(ep => ep.compatible && ep.decisionStatus === 'actionable').length} · Playback review: {preflightData.episodes.filter(ep => ep.compatible && ep.decisionStatus === 'sample_required').length} · Blocked: {preflightData.episodes.filter(ep => !ep.compatible).length} · Unchanged: {preflightData.episodes.filter(ep => ep.decisionStatus === 'already_optimized').length}</p>
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
                        {getAdvisoryBadge(ep.recommendedAction, ep.compatible, ep.decisionStatus)}
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
                    {ep.changes?.map(change => <p key={change} className="text-xs">{change}</p>)}
                    {ep.samplePaths?.length && <div className="text-xs space-y-2">{ep.samplePaths.map((sample, index) => <button key={sample} className="mr-2 underline" onClick={() => void window.electronAPI.openShowSample(preflightData.preflightId, ep.mediaItemId, index).catch(error => setMessage(String(error)))}>Play sample {index + 1}</button>)}<label className="block"><input type="checkbox" checked={reviewedEpisodes.includes(ep.mediaItemId)} onChange={event => setReviewedEpisodes(ids => event.target.checked ? [...ids, ep.mediaItemId] : ids.filter(id => id !== ep.mediaItemId))} /> I approve playback of these samples and the listed conversions</label></div>}
                    <div className="flex items-center justify-between text-[10px] text-muted-foreground/80">
                      <span>{ep.evidenceStatus ? `Evidence: ${ep.evidenceStatus} (${ep.confidence || 'none'})` : 'Evidence: unavailable'}</span>
                      <span>{ep.estimatedSavingsBytes != null ? `Savings: ${formatBytes(ep.estimatedSavingsBytes)}` : 'Savings: unknown'}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {!preflightData.compatible && (
              <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>Some episodes are incompatible and cannot be processed. Review errors above.</span>
              </div>
            )}
          </div>
        ) : (
          /* Live Monitoring Mode */
          <div className="p-5 sm:p-6 space-y-6">
              {verifiedResults.length > 0 && <div className="rounded-xl border border-border/40 p-3 text-xs">Encoded reduction: {formatBytes(verifiedResults.reduce((sum, result) => sum + Number(result.encodedReductionBytes), 0))} · Retained originals: {formatBytes(verifiedResults.reduce((sum, result) => sum + Number(result.retainedOriginalBytes), 0))} · Disk space change: {(verifiedResults.reduce((sum, result) => sum + Number(result.physicallyReclaimedBytes), 0) / (1024 * 1024)).toFixed(1)} MB reclaimed</div>}
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

            {/* Upcoming Queue Items */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-bold text-muted-foreground uppercase tracking-wider">
                <span className="flex items-center gap-1.5">
                  <ListOrdered className="w-3.5 h-3.5 text-primary" /> Upcoming Episodes in Queue ({batchQueue.length})
                </span>
                <div className="flex items-center gap-2">
                  {queueState.isPaused && (
                    <span className="px-2 py-0.5 rounded-full bg-yellow-500/20 text-yellow-400 text-[10px]">Queue Paused</span>
                  )}
                  {batchQueue.length > 0 && (
                    <button
                      onClick={handleClearQueue}
                      className="text-[11px] text-destructive hover:underline font-semibold cursor-pointer"
                      title="Clear remaining queued episodes"
                    >
                      Clear Queue
                    </button>
                  )}
                </div>
              </div>
              <div className="max-h-36 overflow-y-auto rounded-xl border border-border/30 divide-y divide-border/20 bg-background/50">
                {batchQueue.length === 0 ? (
                  <div className="p-3 text-center text-xs text-muted-foreground">
                    No further episodes in queue
                  </div>
                ) : (
                  batchQueue.slice(0, 15).map((task: QueuedTask, idx: number) => (
                    <div key={task.id} className="p-2.5 flex items-center justify-between text-xs gap-2">
                      <span className="truncate flex-1">{idx + 1}. {task.label}</span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-[10px] text-muted-foreground px-2 py-0.5 rounded bg-muted capitalize">{task.status}</span>
                        <button
                          onClick={() => handleRemoveTask(task.id)}
                          className="p-1 rounded hover:bg-muted/80 text-muted-foreground hover:text-destructive transition-colors cursor-pointer"
                          title="Remove from queue"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="p-4 sm:p-5 bg-muted/10 border-t border-border/10 flex items-center justify-between gap-3">
          {mode === 'config' ? (
            <>
              <button
                onClick={() => void handleClose()}
                className="px-5 py-2 bg-muted hover:bg-muted/80 rounded-xl text-xs font-bold transition-all cursor-pointer"
              >
                Cancel
              </button>

              <div className="flex items-center gap-2">
                <button 
                  disabled={busy}
                  onClick={() => void handlePreviewPlan()}
                  className="flex items-center gap-2 px-6 py-2.5 bg-primary text-primary-foreground font-black rounded-xl text-xs transition-all disabled:opacity-50 shadow-lg shadow-primary/20 hover:opacity-90 cursor-pointer"
                >
                  {busy ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Preflighting Series…</span>
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
              <div className="flex items-center gap-2">
                <button
                  onClick={handlePauseResume}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-border bg-card/60 hover:bg-card text-xs font-bold transition-all cursor-pointer"
                  title={queueState.isPaused ? 'Resume transcode queue' : 'Pause transcode queue'}
                >
                  {queueState.isPaused ? <Play className="w-3.5 h-3.5 text-emerald-400" /> : <Pause className="w-3.5 h-3.5 text-yellow-400" />}
                  <span>{queueState.isPaused ? 'Resume Global Queue' : 'Pause Global Queue'}</span>
                </button>

                {currentTask && (
                  <button
                    onClick={handleCancelCurrent}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-destructive/30 bg-destructive/10 hover:bg-destructive/20 text-destructive text-xs font-bold transition-all cursor-pointer"
                    title="Cancel currently encoding episode"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    <span>Cancel Episode</span>
                  </button>
                )}

                {(batchQueue.length > 0 || Boolean(currentTask)) && (
                  <button
                    onClick={handleClearQueue}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-destructive/30 bg-destructive/10 hover:bg-destructive/20 text-destructive text-xs font-bold transition-all cursor-pointer"
                    title="Clear all tasks from queue"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Clear Show Batch</span>
                  </button>
                )}
              </div>

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
