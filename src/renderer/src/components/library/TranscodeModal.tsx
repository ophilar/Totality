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

import type { TranscodeOptions, TranscodingParams, GpuInfo, Availability, TranscodeProgress } from './transcoding/types'
import { QuickPresetsTab } from './transcoding/QuickPresetsTab'
import { AdvancedTab } from './transcoding/AdvancedTab'
import { LiveEncodingTab } from './transcoding/LiveEncodingTab'

interface TranscodeModalProps {
  mediaId: number
  onClose: () => void
}

export function TranscodeModal({ mediaId, onClose }: TranscodeModalProps) {
  const [media, setMedia] = useState<MediaItem | null>(null)
  const [availability, setAvailability] = useState<Availability | null>(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [params, setParams] = useState<TranscodingParams | null>(null)
  const [gpus, setGpus] = useState<GpuInfo[]>([])
  const [activeTab, setActiveTab] = useState<'presets' | 'advanced' | 'monitor'>('presets')

  const [options, setOptions] = useState<TranscodeOptions>({
    targetCodec: 'av1',
    outputMode: 'copy',
    useGpu: true,
    gpuId: '',
    encoder: '',
    crf: 20,
    preset: 'p6',
    customArgs: '',
    transcodingEngine: 'ffmpeg',
    targetSize: 'ai-recommended'
  })

  const [status, setStatus] = useState<'idle' | 'generating' | 'encoding' | 'complete' | 'failed'>('idle')
  const [progress, setProgress] = useState<TranscodeProgress | null>(null)

  const { addToast } = useToast()

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
          addToast({ title: `Transcode failed: ${p.error || 'Unknown error'}`, type: 'error' })
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
        const p = await window.electronAPI.getParameters(media.id!, { ...options, aiOptimize: false })
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
      const p = await window.electronAPI.getParameters(media.id!, { ...options, aiOptimize: true })
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
    if (!media) return
    setStatus('encoding')
    setActiveTab('monitor')
    try {
      const success = await window.electronAPI.start(media.id!, options)
      if (success) {
        addToast({ title: 'Transcode complete', type: 'success' })
      }
    } catch (err: unknown) {
      if (status !== 'idle') {
        addToast({ title: `Transcode failed: ${err instanceof Error ? err.message : String(err)}`, type: 'error' })
        setStatus('failed')
      }
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
                disabled={!availability?.ffmpeg}
                className="flex items-center gap-2 px-7 py-2.5 bg-primary text-primary-foreground font-black rounded-xl text-xs transition-all disabled:opacity-50 shadow-lg shadow-primary/20 hover:opacity-90"
              >
                <Play className="w-4 h-4 fill-current" />
                Start Transcode Optimization
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}
