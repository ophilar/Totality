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
  FileCheck
} from 'lucide-react'
import { useToast } from '@/contexts/ToastContext'
import type { TVShowSummary } from './types'
import type { GpuInfo } from './transcoding/types'
import { TranscodingDeviceSelector } from './transcoding/TranscodingDeviceSelector'

export function ShowTranscodeModal({ show, onClose }: { show: TVShowSummary; onClose: () => void }) {
  const { addToast } = useToast()
  const [codec, setCodec] = useState<'hevc' | 'av1'>('av1')
  const [audio, setAudio] = useState<'all' | 'original-and-protected'>('original-and-protected')
  const [language, setLanguage] = useState('en')
  const [outputMode, setOutputMode] = useState<'copy' | 'quarantine-replace'>('quarantine-replace')
  const [useGpu, setUseGpu] = useState(true)
  const [gpuId, setGpuId] = useState('')
  const [gpus, setGpus] = useState<GpuInfo[]>([])
  const [message, setMessage] = useState('')
  const [isSuccess, setIsSuccess] = useState(false)
  const [busy, setBusy] = useState(false)

  const handleUseGpuChange = useCallback((next: boolean) => setUseGpu(next), [])
  const handleGpuIdChange = useCallback((id: string) => setGpuId(id), [])

  useEffect(() => {
    let isMounted = true
    window.electronAPI.getCapabilities().then((capabilities) => {
      if (!isMounted || !capabilities) return
      const detectedGpus = capabilities.gpus || []
      setGpus(detectedGpus)
      const selected = detectedGpus.find((gpu: GpuInfo) => gpu.id === capabilities.selectedGpuId) || detectedGpus[0]
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

  const submit = async () => {
    if (!show.source_id || !codec || !audio || !outputMode || (audio === 'original-and-protected' && !language.trim())) {
      setMessage('Please choose a video codec, audio policy, output mode, and original language.')
      return
    }
    setBusy(true)
    setMessage('')
    setIsSuccess(false)
    try {
      const preflight = await window.electronAPI.preflightShow({
        seriesTitle: show.series_title,
        seriesIdentityKey: (show as TVShowSummary & { series_identity_key?: string }).series_identity_key,
        sourceId: show.source_id,
        options: { 
          targetCodec: codec, 
          transcodingEngine: 'ffmpeg', 
          outputMode,
          useGpu,
          gpuId: useGpu ? gpuId : undefined,
          streamSelection: audio === 'all' 
            ? { audio, subtitle: 'all', defaultSubtitle: 'preserve' } 
            : { audio, originalLanguage: language.trim().toLowerCase(), subtitle: 'all', defaultSubtitle: 'preserve' } 
        }
      })
      if (!preflight.compatible) {
        const blockingReasons = preflight.episodes
          .filter((episode: { compatible: boolean }) => !episode.compatible)
          .map((episode: { reason?: string }) => episode.reason || 'Unknown incompatibility')
          .join('; ')
        throw new Error(`Incompatible episodes detected: ${blockingReasons}`)
      }
      const queued = await window.electronAPI.queueShow(preflight.preflightId)
      setIsSuccess(true)
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


  return createPortal(
    <div 
      className="fixed inset-0 z-250 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200"
      onClick={busy ? undefined : onClose}
    >
      <div 
        className="relative bg-card border border-border sm:rounded-2xl shadow-2xl max-w-xl w-full overflow-hidden flex flex-col animate-in zoom-in-95 duration-200"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-border/20 flex justify-between items-center bg-muted/20">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-primary/10 rounded-xl text-primary">
              <Zap className="w-5 h-5 fill-current" />
            </div>
            <div>
              <h3 className="text-lg font-bold leading-tight flex items-center gap-2">
                Batch Optimize Series
              </h3>
              <p className="text-xs text-muted-foreground truncate max-w-[380px]">{show.series_title}</p>
            </div>
          </div>
          {!busy && (
            <button 
              onClick={onClose}
              className="p-1.5 hover:bg-muted rounded-full text-muted-foreground hover:text-foreground transition-all cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Content */}
        <div className="p-5 sm:p-6 space-y-5">
          {/* Codec Selection */}
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
              <div className="mt-2 flex items-center gap-2">
                <label className="text-xs text-muted-foreground shrink-0">Original Language:</label>
                <input 
                  type="text"
                  value={language} 
                  onChange={e => setLanguage(e.target.value)} 
                  placeholder="e.g. en, ja, fr, es" 
                  className="px-3 py-1.5 text-xs rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary w-28" 
                />
              </div>
            )}
          </div>

          {/* Canonical Transcoding Device Selector */}
          <TranscodingDeviceSelector
            useGpu={useGpu}
            onUseGpuChange={handleUseGpuChange}
            selectedGpuId={gpuId}
            onSelectedGpuIdChange={handleGpuIdChange}
            gpus={gpus}
            variant="compact"
          />

          {/* Output Mode */}
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <FileCheck className="w-3.5 h-3.5 text-primary" /> Output & Verification Mode
            </label>
            <div className="grid grid-cols-2 gap-3">
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
                <p className="text-[11px] text-muted-foreground">Atomic replacement only after rigorous checksum & audio/HDR probe verification.</p>
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

        {/* Footer */}
        <div className="p-4 sm:p-5 bg-muted/10 border-t border-border/10 flex items-center justify-between gap-3">
          <button 
            onClick={onClose}
            className="px-5 py-2 bg-muted hover:bg-muted/80 rounded-xl text-xs font-bold transition-all cursor-pointer"
          >
            {isSuccess ? 'Done' : 'Cancel'}
          </button>

          <button 
            disabled={busy || isSuccess}
            onClick={() => void submit()}
            className="flex items-center gap-2 px-6 py-2.5 bg-primary text-primary-foreground font-black rounded-xl text-xs transition-all disabled:opacity-50 shadow-lg shadow-primary/20 hover:opacity-90 cursor-pointer"
          >
            {busy ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Preflighting Series…</span>
              </>
            ) : isSuccess ? (
              <>
                <CheckCircle2 className="w-4 h-4" />
                <span>Batch Queued</span>
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                <span>Preflight & Queue Series</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

