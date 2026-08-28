import { useState, useEffect, useCallback } from 'react'
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
import type { TVShowSummary, MediaItem } from './types'
import type { GpuInfo, ShowTranscodePreflight } from './transcoding/types'
import { TranscodingDeviceSelector } from './transcoding/TranscodingDeviceSelector'
import { formatLanguage, isSameLanguage, LANGUAGE_OPTIONS } from './mediaUtils'
import type { QueuedTask, TaskQueueState } from '@main/types/database'
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
  const [mode, setMode] = useState<'config' | 'preview' | 'monitoring'>('config')
  const [optimizationMode, setOptimizationMode] = useState<'smart' | 'remux_only' | 'transcode'>('smart')
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
  const [message, setMessage] = useState('')
  const [isSuccess, setIsSuccess] = useState(false)
  const [busy, setBusy] = useState(false)
  const [preflightData, setPreflightData] = useState<ShowTranscodePreflight | null>(null)

  // Live Task Queue tracking state for monitoring mode
  const [queueState, setQueueState] = useState<TaskQueueState>({
    currentTask: null,
    queue: [],
    isPaused: false,
    completedTasks: []
  })

  const handleUseGpuChange = useCallback((next: boolean) => setUseGpu(next), [])
  const handleGpuIdChange = useCallback((id: string) => setGpuId(id), [])

  // Auto-detect available audio languages and provider original language from series metadata / episodes
  useEffect(() => {
    let isMounted = true
    async function loadLanguages() {
      if (!show.series_title) return
      let provLang = (show as TVShowSummary & { original_language?: string }).original_language || ''
      let fileLangs: string[] = []

      try {
        if (window.electronAPI.seriesGetAudioLanguages) {
          const res = await window.electronAPI.seriesGetAudioLanguages(show.series_title, show.source_id)
          if (Array.isArray(res)) {
            fileLangs = res
          }
        }
      } catch (err) {
        console.error('Failed to get series audio languages:', err)
      }

      try {
        if ((!provLang || fileLangs.length === 0) && window.electronAPI.seriesGetEpisodes) {
          const episodes = await window.electronAPI.seriesGetEpisodes(show.series_title, show.source_id)
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
  }, [show.series_title, show.source_id])

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
      const selected = detectedGpus.find((gpu: GpuInfo) => gpu.id === capabilities.selectedGpuId)
      if (selected) {
        setGpuId(selected.id)
        setUseGpu(true)
      } else {
        setUseGpu(false)
      }
    }).catch(err => {
      console.error('Failed to load GPU capabilities for show transcoding:', err)
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
      console.error('[ShowTranscodeModal] Failed to load queue state', error)
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

  const getCleanOptions = () => {
    const whitelist = subtitleList.length > 0 ? subtitleList : undefined
    return {
      targetCodec: codec,
      transcodingEngine: 'ffmpeg' as const,
      outputMode,
      useGpu: optimizationMode === 'remux_only' ? false : useGpu,
      gpuId: useGpu && optimizationMode !== 'remux_only' ? gpuId : undefined,
      optimizationMode,
      streamSelection: audio === 'all'
        ? { audio, subtitle: 'all' as const, subtitleLanguageWhitelist: whitelist, defaultSubtitle: 'preserve' as const }
        : { audio, originalLanguage: language.trim().toLowerCase(), subtitle: 'all' as const, subtitleLanguageWhitelist: whitelist, defaultSubtitle: 'preserve' as const }
    }
  }

  const runPreflight = async () => {
    if (!show.source_id || !codec || !audio || !outputMode || (audio === 'original-and-protected' && !language.trim())) {
      throw new Error('Please choose a video codec, audio policy, output mode, and original language.')
    }
    const preflight = await window.electronAPI.preflightShow({
      seriesTitle: show.series_title,
      seriesIdentityKey: (show as TVShowSummary & { series_identity_key?: string }).series_identity_key,
      sourceId: show.source_id,
      options: getCleanOptions()
    })
    setPreflightData(preflight)
    return preflight
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
      if (!preflightData.compatible) {
        const blockingReasons = preflightData.episodes
          .filter((episode: { compatible: boolean }) => !episode.compatible)
          .map((episode: { reason?: string }) => episode.reason || 'Unknown incompatibility')
          .join('; ')
        throw new Error(`Incompatible episodes detected: ${blockingReasons}`)
      }
      const requiresApproval = preflightData.episodes.some((episode: { decisionStatus?: string }) => episode.decisionStatus === 'sample_required')
      if (requiresApproval && !window.confirm('Video samples require your approval. Review playback in your preferred player, then choose OK to authorize this show.')) return
      if (requiresApproval) await window.electronAPI.approveShow(preflightData.preflightId)
      const queued = await window.electronAPI.queueShow(preflightData.preflightId)
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

  const submit = async () => {
    setBusy(true)
    setMessage('')
    setIsSuccess(false)
    try {
      const preflight = await runPreflight()
      if (!preflight.compatible) {
        const blockingReasons = preflight.episodes
          .filter((episode: { compatible: boolean }) => !episode.compatible)
          .map((episode: { reason?: string }) => episode.reason || 'Unknown incompatibility')
          .join('; ')
        throw new Error(`Incompatible episodes detected: ${blockingReasons}`)
      }
      const requiresApproval = preflight.episodes.some((episode: { decisionStatus?: string }) => episode.decisionStatus === 'sample_required')
      if (requiresApproval && !window.confirm('Video samples require your approval. Review playback in your preferred player, then choose OK to authorize this show.')) return
      if (requiresApproval) await window.electronAPI.approveShow(preflight.preflightId)
      const queued = await window.electronAPI.queueShow(preflight.preflightId)
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
      setIsSuccess(false)
      addToast({
        type: 'error',
        title: 'Preflight Failed',
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
      await window.electronAPI.taskQueueCancelCurrent()
      addToast({ title: 'Cancelled current episode encoding', type: 'info' })
    } catch (error) {
      window.electronAPI.log.error('ShowTranscodeModal', 'Failed to cancel current transcode task', error)
    }
  }

  const handleClearQueue = async () => {
    try {
      await window.electronAPI.taskQueueClearQueue()
      addToast({ title: 'Cleared all transcoding tasks from queue', type: 'info' })
    } catch (error) {
      window.electronAPI.log.error('ShowTranscodeModal', 'Failed to clear transcode queue', error)
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
  const currentTask = queueState.currentTask
  const isCurrentTranscode = currentTask?.type === TaskType.Transcode ||
    (currentTask && (currentTask.label.toLowerCase().includes('transcode') || currentTask.label.toLowerCase().includes('optimize') || currentTask.progress?.fps !== undefined || Boolean(currentTask.mediaItemId)))

  const currentPercent = currentTask?.progress?.percentage ?? 0
  const currentFps = currentTask?.progress?.fps ? `${currentTask.progress.fps} FPS` : 'Encoding'
  const currentSpeed = currentTask?.progress?.fps ? `${(currentTask.progress.fps / 24).toFixed(1)}x` : '1.0x'
  const currentEta = currentTask?.progress?.eta || 'Calculating...'

  // SVG Circular Gauge calculation
  const radius = 56
  const strokeWidth = 7
  const normalizedRadius = radius - strokeWidth * 0.5
  const circumference = normalizedRadius * 2 * Math.PI
  const strokeDashoffset = circumference - ((Math.min(Math.max(currentPercent, 0), 100)) / 100) * circumference

  return createPortal(
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200"
      onClick={busy ? undefined : onClose}
    >
      <div 
        className="relative bg-card border border-border sm:rounded-2xl shadow-2xl max-w-2xl w-full overflow-hidden flex flex-col animate-in zoom-in-95 duration-200"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-border/20 flex justify-between items-center bg-muted/20">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-primary/10 rounded-xl text-primary">
              {mode === 'monitoring' ? <Activity className="w-5 h-5 animate-pulse" /> : <Zap className="w-5 h-5 fill-current" />}
            </div>
            <div>
              <h3 className="text-lg font-bold leading-tight flex items-center gap-2">
                {mode === 'monitoring' ? 'Live Series Optimization' : mode === 'preview' ? 'Optimization Plan Preview' : 'Batch Optimize Series'}
              </h3>
              <p className="text-xs text-muted-foreground truncate max-w-[420px]">{show.series_title}</p>
            </div>
          </div>
          {!busy && (
            <button 
              onClick={onClose}
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
            {/* Optimization Mode Selection */}
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-primary" /> Optimization Strategy
              </label>
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
                    <span className="font-bold text-xs">Audio & Subs Prune</span>
                    <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-400">Instant</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-tight">
                    Lossless container cleanup with -c:v copy (no video re-encoding).
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
                    Force full GPU video transcoding for all episodes.
                  </p>
                </button>
              </div>
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
                <span className="text-xs font-bold uppercase px-2.5 py-1 rounded-full bg-primary/15 text-primary border border-primary/30">
                  {optimizationMode === 'smart' ? 'Smart (TRaSH)' : optimizationMode === 'remux_only' ? 'Lossless Stream Copy' : 'Full Transcode'}
                </span>
              </div>

              {/* Action Breakdown Counters */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                <div className="bg-background/80 p-2.5 rounded-xl border border-border/30 text-center">
                  <div className="text-[10px] text-blue-400 font-bold uppercase tracking-wider">Video Transcode</div>
                  <div className="text-base font-black text-foreground">
                    {preflightData.episodes.filter(e => e.recommendedAction === 'video_transcode').length}
                  </div>
                </div>
                <div className="bg-background/80 p-2.5 rounded-xl border border-amber-500/30 text-center">
                  <div className="text-[10px] text-amber-300 font-bold uppercase tracking-wider">Insufficient Evidence</div>
                  <div className="text-base font-black text-foreground">
                    {preflightData.episodes.filter(e => e.decisionStatus === 'insufficient_evidence').length}
                  </div>
                </div>
                <div className="bg-background/80 p-2.5 rounded-xl border border-border/30 text-center">
                  <div className="text-[10px] text-emerald-400 font-bold uppercase tracking-wider">Lossless Copy</div>
                  <div className="text-base font-black text-foreground">
                    {preflightData.episodes.filter(e => e.recommendedAction === 'stream_pruning').length}
                  </div>
                </div>
                <div className="bg-background/80 p-2.5 rounded-xl border border-border/30 text-center">
                  <div className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">Already Optimized</div>
                  <div className="text-base font-black text-foreground">
                    {preflightData.episodes.filter(e => e.recommendedAction === 'already_optimized').length}
                  </div>
                </div>
              </div>
            </div>

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
                  All queued tasks for this show have finished processing.
                </p>
              </div>
            )}

            {/* Upcoming Queue Items */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-bold text-muted-foreground uppercase tracking-wider">
                <span className="flex items-center gap-1.5">
                  <ListOrdered className="w-3.5 h-3.5 text-primary" /> Upcoming Episodes in Queue ({queueState.queue.length})
                </span>
                <div className="flex items-center gap-2">
                  {queueState.isPaused && (
                    <span className="px-2 py-0.5 rounded-full bg-yellow-500/20 text-yellow-400 text-[10px]">Queue Paused</span>
                  )}
                  {queueState.queue.length > 0 && (
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
                {queueState.queue.length === 0 ? (
                  <div className="p-3 text-center text-xs text-muted-foreground">
                    No further episodes in queue
                  </div>
                ) : (
                  queueState.queue.slice(0, 15).map((task: QueuedTask, idx: number) => (
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
                onClick={onClose}
                className="px-5 py-2 bg-muted hover:bg-muted/80 rounded-xl text-xs font-bold transition-all cursor-pointer"
              >
                Cancel
              </button>

              <div className="flex items-center gap-2">
                <button
                  disabled={busy}
                  onClick={() => void handlePreviewPlan()}
                  className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-border bg-card/60 hover:bg-card text-xs font-bold transition-all disabled:opacity-50 cursor-pointer"
                  title="Preview preflight actions and source tiers"
                >
                  <Eye className="w-4 h-4 text-primary" />
                  <span>Preview Plan</span>
                </button>

                <button 
                  disabled={busy}
                  onClick={() => void submit()}
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
                      <span>Preflight & Queue Series</span>
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
                disabled={busy || !preflightData?.compatible}
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
                    <span>Queue All Episodes ({preflightData?.episodes.length || 0})</span>
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
                  <span>{queueState.isPaused ? 'Resume' : 'Pause'}</span>
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

                {(queueState.queue.length > 0 || Boolean(currentTask)) && (
                  <button
                    onClick={handleClearQueue}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-destructive/30 bg-destructive/10 hover:bg-destructive/20 text-destructive text-xs font-bold transition-all cursor-pointer"
                    title="Clear all tasks from queue"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Clear All</span>
                  </button>
                )}
              </div>

              <button 
                onClick={onClose}
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


