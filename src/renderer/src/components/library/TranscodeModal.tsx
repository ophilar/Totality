import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { 
  X, 
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

import type { TranscodeOptions, TranscodingParams, GpuInfo, Availability, TranscodeProgress } from './transcoding'
import { QuickPresetsTab, AdvancedTab, LiveEncodingTab } from './transcoding'
import { useAnalysisManager } from './hooks/useAnalysisManager'

interface TranscodeModalProps {
  mediaId: number
  onClose: () => void
  mode?: 'transcode' | 'remux'
}

export function TranscodeModal({ mediaId, onClose, mode = 'transcode' }: TranscodeModalProps) {
  const [media, setMedia] = useState<MediaItem | null>(null)
  const [availability, setAvailability] = useState<Availability | null>(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [params, setParams] = useState<TranscodingParams | null>(null)
  const [gpus, setGpus] = useState<GpuInfo[]>([])
  const [activeTab, setActiveTab] = useState<'presets' | 'advanced' | 'monitor' | 'review'>('presets')
  const [preflight, setPreflight] = useState<{ preflightId: string; episodes: Array<{ mediaItemId: number; label: string; compatible: boolean; reason?: string; decisionStatus?: string; params?: TranscodingParams; samplePaths?: string[]; adviceReason?: string }> } | null>(null)
  const [samplesReviewed, setSamplesReviewed] = useState(false)
  const [analysisRequired, setAnalysisRequired] = useState(false)
  const [analysisTaskId, setAnalysisTaskId] = useState<string | null>(null)
  const { analyze, taskQueueState } = useAnalysisManager()
  const analysisTask = taskQueueState
    ? [taskQueueState.currentTask, ...taskQueueState.queue, ...taskQueueState.completedTasks].find(task => task?.id === analysisTaskId)
    : undefined

  const [options, setOptions] = useState<TranscodeOptions>({
    targetCodec: '' as TranscodeOptions['targetCodec'],
    outputMode: 'quarantine-replace',
    useGpu: false,
    gpuId: '',
    encoder: '',
    crf: undefined,
    preset: '',
    customArgs: '',
    transcodingEngine: 'ffmpeg',
    targetSize: '',
    qualityProfile: undefined,
    encoderPolicy: undefined
  })

  const [status, setStatus] = useState<'idle' | 'generating' | 'encoding' | 'complete' | 'failed'>('idle')
  const [progress, setProgress] = useState<TranscodeProgress | null>(null)

  const { addToast } = useToast()
  const failureReportedRef = useRef(false)

  const loadInitialData = useCallback(async () => {
    try {
      setLoading(true)
      const [item, capabilities] = await Promise.all([
        window.electronAPI.getMediaItem(mediaId),
        window.electronAPI.getCapabilities()
      ])
      
      if (item) setMedia(item as MediaItem)
      const avail = capabilities || { ffmpeg: false }
      const detectedGpus = capabilities?.gpus || []
      setAvailability(avail)
      setGpus(detectedGpus)
      
      const defaultEngine = capabilities?.engines?.[0] || 'ffmpeg'
      const firstGpu = detectedGpus.find((gpu: GpuInfo) => gpu.id === capabilities?.selectedGpuId)

      setOptions(prev => ({
        ...prev,
        transcodingEngine: defaultEngine,
        gpuId: firstGpu ? firstGpu.id : '',
        useGpu: Boolean(firstGpu)
      }))
    } catch (err) {
      console.error('Failed to load transcode data:', err)
      addToast({ title: 'Failed to initialize transcoding subsystem', type: 'error' })
    } finally {
      setLoading(false)
    }
  }, [mediaId, addToast])

  useEffect(() => {
    queueMicrotask(() => { void loadInitialData() })
  }, [loadInitialData])

  useEffect(() => {
    const unsub = window.electronAPI.onProgress((p) => {
      if (p.mediaItemId === mediaId) {
        setProgress(p)
        if (p.status === 'encoding' || p.percent > 0) {
          setStatus('encoding')
          setActiveTab('monitor')
        }
        if (p.status === 'complete') {
          setStatus('complete')
          setActiveTab('monitor')
        }
        if (p.status === 'cancelled') {
          setStatus('idle')
          setProgress(null)
          addToast({ title: 'Optimization cancelled', type: 'info' })
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
  }, [mediaId, addToast])

  const paramSequenceRef = useRef(0)

  // Dynamically update parameters preview when options change
  useEffect(() => {
    if (status === 'encoding' || status === 'generating' || !media || !media.file_path) return
    
    const currentSeq = ++paramSequenceRef.current
    const timer = setTimeout(async () => {
      try {
        const p = await window.electronAPI.getParameters(media.id!, options)
        if (paramSequenceRef.current === currentSeq) {
          setParams(p)
        }
      } catch (err) {
        if (paramSequenceRef.current === currentSeq) {
          console.error('Failed to update parameters preview:', err)
        }
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [options, media, status])

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

  const startTranscode = async () => {
    if (!media?.source_id || media.id === undefined) return
    failureReportedRef.current = false
    setStatus('generating')
    try {
      if (!preflight) {
        const result = (mode === 'remux'
          ? await window.electronAPI.preflightRemux(media.id)
          : await window.electronAPI.preflightShow({ mediaItemId: media.id, sourceId: media.source_id, libraryId: media.library_id, options })) as typeof preflight
        if (!result) throw new Error('Optimization review could not be created')
        setPreflight(result)
        setStatus('idle')
        setActiveTab('review')
        return
      }
      const item = preflight.episodes.find(entry => entry.mediaItemId === media.id)
      if (!item?.compatible) throw new Error(item?.reason || 'This file has no safe optimization plan')
      if (item.decisionStatus === 'sample_required' && !samplesReviewed) throw new Error('Review the measured samples before queuing this transcode')
      if (item.decisionStatus === 'sample_required') await window.electronAPI.approveShow(preflight.preflightId)
      await window.electronAPI.queueShow(preflight.preflightId)
      setProgress(null)
      setStatus('encoding')
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
    if (!media?.id) return
    try {
      const accepted = await analyze({ kind: 'item', mediaId: media.id })
      setAnalysisTaskId(accepted.taskId)
      setAnalysisRequired(false)
    } catch (error) {
      addToast({ title: `Analysis could not be queued: ${error instanceof Error ? error.message : String(error)}`, type: 'error' })
    }
  }

  const cancelTranscode = async () => {
    try {
      await window.electronAPI.cancel(mediaId)
    } catch (err: unknown) {
      addToast({ title: `Cancellation failed: ${err instanceof Error ? err.message : String(err)}`, type: 'error' })
    }
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

  return createPortal(
    <div 
      className="fixed inset-0 z-250 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200" 
      onClick={status === 'encoding' ? undefined : onClose}
    >
      <div 
        className="relative bg-card border border-border sm:rounded-2xl shadow-2xl max-w-3xl w-full overflow-hidden flex flex-col animate-in zoom-in-95 duration-200 h-dvh sm:h-auto sm:max-h-[92vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="p-4 sm:p-6 pb-3 sm:pb-4 border-b border-border/10 flex justify-between items-center bg-muted/10">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-primary/10 rounded-xl text-primary">
              <Zap className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold leading-tight flex items-center gap-2">
                AI Transcoder & Optimizer
                <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-primary/20 text-primary">
                  VRAM Passthrough
                </span>
              </h3>
              <p className="text-xs text-muted-foreground truncate max-w-[450px]">{media.title}</p>
            </div>
          </div>
          {status !== 'encoding' && (
            <button 
              onClick={onClose}
              className="p-2 hover:bg-muted rounded-full text-muted-foreground hover:text-foreground transition-all"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

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

          {/* Active Tab Content */}
          {activeTab === 'presets' && (
            <QuickPresetsTab
              options={options}
              setOptions={setOptions}
              params={params}
              gpus={gpus}
            />
          )}

          {activeTab === 'advanced' && (
            <AdvancedTab
              options={options}
              setOptions={setOptions}
              params={params}
              gpus={gpus}
              availability={availability}
            />
          )}

          {activeTab === 'monitor' && (
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
              <button className="text-sm underline" onClick={() => { setPreflight(null); setSamplesReviewed(false); setActiveTab('advanced') }}>Change optimization settings</button>
              {preflight.episodes.map(item => <div key={item.mediaItemId} className="space-y-2 text-sm">
                <p className="font-semibold">{item.label}: {item.compatible ? item.decisionStatus?.replace(/_/g, ' ') : item.reason}</p>
                {item.params?.summary && <p className="text-muted-foreground">{item.params.summary}</p>}
                {item.samplePaths?.map((sample, index) => <button key={sample} className="mr-3 underline" onClick={() => void window.electronAPI.openShowSample(preflight.preflightId, item.mediaItemId, index)}>Open measured sample {index + 1}</button>)}
              </div>)}
              {mode === 'remux' && preflight.episodes.map(item => <p key={item.mediaItemId} className="text-muted-foreground">Retained audio streams are listed in the reviewed preflight plan: {item.adviceReason}</p>)}
              {preflight.episodes.some(item => item.decisionStatus === 'sample_required') && <label className="flex gap-2 text-sm"><input type="checkbox" checked={samplesReviewed} onChange={event => setSamplesReviewed(event.target.checked)} /> I reviewed and approve the measured sample</label>}
            </section>
          )}
          {analysisRequired && <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 space-y-2 text-sm">
            <p className="font-semibold text-amber-200">Current persisted file analysis is required before optimization.</p>
            <p className="text-muted-foreground">Queue Analyze for this item, then refresh this review after the task finishes. Analysis does not approve or queue optimization.</p>
            {analysisTask?.status === 'running' || analysisTask?.status === 'cancelling' ? <p>{analysisTask.status === 'cancelling' ? 'Cancelling analysis…' : `Analyzing${analysisTask.progress?.phase ? ` · ${analysisTask.progress.phase}` : ''}`}</p> : null}
            {analysisTask?.status === 'completed' && <button className="underline" onClick={() => { setPreflight(null); setAnalysisRequired(false); setAnalysisTaskId(null); void startTranscode() }}>Refresh optimization review</button>}
            {analysisTask?.status === 'partial' && <p>Analysis was partial. Review its diagnostics in Activity before refreshing.</p>}
            {analysisTask?.status === 'failed' || analysisTask?.status === 'blocked' ? <p>Analysis did not complete. Review its diagnostics in Activity.</p> : null}
          </div>}
        </div>

        {/* Modal Footer Controls */}
        {status !== 'encoding' && status !== 'complete' && (
          <div className="p-4 sm:p-6 bg-muted/10 border-t border-border/10 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <button 
              onClick={onClose}
              className="px-6 py-2.5 bg-muted hover:bg-muted/80 rounded-xl text-xs font-bold transition-all"
            >
              Cancel
            </button>

            <div className="flex flex-col sm:flex-row items-stretch gap-2 sm:gap-3">
              {analysisRequired && <button onClick={() => void analyzeRequiredEvidence()} disabled={Boolean(analysisTask && ['queued', 'running', 'cancelling'].includes(analysisTask.status))} className="px-5 py-2.5 rounded-xl border border-border text-xs font-bold disabled:opacity-50">{analysisTask?.status === 'queued' ? 'Analysis queued' : 'Analyze item'}</button>}
              <button 
                onClick={generateParams}
                disabled={generating || !availability?.ffmpeg}
                className="flex items-center gap-2 px-5 py-2.5 bg-muted/60 hover:bg-muted rounded-xl text-xs font-bold transition-all disabled:opacity-50"
              >
                {generating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4 text-primary" />}
                Re-Generate AI Tuned Strategy
              </button>

              <button 
                onClick={startTranscode}
                disabled={!availability?.ffmpeg || status === 'generating' || (activeTab === 'review' && preflight?.episodes.some(item => !item.compatible))}
                className="flex items-center gap-2 px-7 py-2.5 bg-primary text-primary-foreground font-black rounded-xl text-xs transition-all disabled:opacity-50 shadow-lg shadow-primary/20 hover:opacity-90"
              >
                <Play className="w-4 h-4 fill-current" />
                {status === 'generating' ? 'Preparing…' : preflight ? (mode === 'remux' ? 'Queue Stream Pruning' : 'Queue Optimization') : 'Review Optimization'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}
