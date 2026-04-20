import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { 
  X, 
  Settings, 
  Play, 
  CheckCircle, 
  AlertTriangle, 
  RefreshCw,
  Zap,
  Info
} from 'lucide-react'
import { useToast } from '../../contexts/ToastContext'
import type { MediaItem } from '../../../../main/types/database'

interface TranscodingParams {
  summary: string
  handbrakeArgs: string[]
  expectedSizeReduction?: string
  warnings?: string[]
}

interface TranscodeModalProps {
  mediaId: number
  onClose: () => void
}

export function TranscodeModal({ mediaId, onClose }: TranscodeModalProps) {
  const [media, setMedia] = useState<MediaItem | null>(null)
  const [availability, setAvailability] = useState<{ handbrake: boolean; mkvtoolnix: boolean; ffmpeg: boolean } | null>(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [params, setParams] = useState<TranscodingParams | null>(null)
  const [options, setOptions] = useState({
    targetCodec: 'av1' as 'av1' | 'hevc',
    preserveSubtitles: true,
    preserveAllAudio: false,
    overwriteOriginal: false
  })
  const [status, setStatus] = useState<'idle' | 'generating' | 'encoding' | 'complete' | 'failed'>('idle')
  const [progress, setProgress] = useState<{ percent: number; fps?: number; eta?: string; error?: string } | null>(null)
  
  const { addToast } = useToast()

  const loadInitialData = useCallback(async () => {
    try {
      setLoading(true)
      const [item, avail] = await Promise.all([
        window.electronAPI.getMediaItem(mediaId),
        window.electronAPI.checkAvailability()
      ])
      
      if (item) setMedia(item as MediaItem)
      setAvailability(avail)
    } catch (err) {
      console.error('Failed to load transcode data:', err)
      addToast({ title: 'Failed to initialize', type: 'error' })
    } finally {
      setLoading(false)
    }
  }, [mediaId, addToast])

  useEffect(() => {
    loadInitialData()
  }, [loadInitialData])

  useEffect(() => {
    const unsub = window.electronAPI.onProgress((p: any) => {
      if (p.mediaItemId === mediaId) {
        setProgress(p)
        if (p.status === 'complete') setStatus('complete')
        if (p.status === 'failed') {
            setStatus('failed')
            addToast({ title: `Transcode failed: ${p.error || 'Unknown error'}`, type: 'error' })
        }
      }
    })
    return () => {
      if (typeof unsub === 'function') unsub()
    }
  }, [mediaId, addToast])

  const generateParams = async () => {
    if (!media || !media.file_path) return
    setGenerating(true)
    setStatus('generating')
    try {
      const p = await window.electronAPI.getParameters(media.file_path, options)
      setParams(p)
      setStatus('idle')
    } catch (err: any) {
      addToast({ title: `AI generation failed: ${err.message}`, type: 'error' })
      setStatus('idle')
    } finally {
      setGenerating(false)
    }
  }

  const startTranscode = async () => {
    if (!media) return
    setStatus('encoding')
    try {
      const success = await window.electronAPI.start(media.id!, options)
      if (success) {
        addToast({ title: 'Transcode complete', type: 'success' })
      }
    } catch (err: any) {
      addToast({ title: `Transcode failed: ${err.message}`, type: 'error' })
      setStatus('failed')
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
    <div className="fixed inset-0 z-250 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200" onClick={status === 'encoding' ? undefined : onClose}>
      <div 
        className="relative bg-card border border-border rounded-2xl shadow-2xl max-w-2xl w-full overflow-hidden flex flex-col animate-in zoom-in-95 duration-200"
        onClick={e => e.stopPropagation()}
      >
        <div className="p-6 pb-4 border-b border-border/10 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-lg text-primary">
              <Zap className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold leading-tight">AI Optimizer</h3>
              <p className="text-xs text-muted-foreground truncate max-w-[400px]">{media.title}</p>
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

        <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
          {status === 'encoding' ? (
            <div className="space-y-8 py-8">
              <div className="text-center space-y-2">
                <RefreshCw className="w-12 h-12 animate-spin text-primary mx-auto mb-4" />
                <h4 className="text-xl font-bold">Optimizing Media...</h4>
                <p className="text-sm text-muted-foreground">Using AI-tuned Handbrake parameters for maximum efficiency.</p>
              </div>

              <div className="space-y-3">
                <div className="flex justify-between text-sm font-medium">
                  <span>Progress</span>
                  <span>{progress?.percent.toFixed(1)}%</span>
                </div>
                <div className="h-3 bg-muted rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-primary transition-all duration-300 ease-out" 
                    style={{ width: `${progress?.percent || 0}%` }}
                  />
                </div>
                <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
                  <span>{progress?.fps ? `${progress.fps} FPS` : 'Initializing...'}</span>
                  <span>{progress?.eta ? `ETA: ${progress.eta}` : ''}</span>
                </div>
              </div>

              <div className="bg-muted/30 border border-border/50 rounded-xl p-4 space-y-2">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground/70">
                  <Info className="w-3.5 h-3.5" />
                  Strategy
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed italic">
                  "{params?.summary || 'Encoding with high-efficiency codec settings...'}"
                </p>
              </div>
            </div>
          ) : status === 'complete' ? (
            <div className="text-center space-y-4 py-8">
              <div className="w-16 h-16 bg-green-500/10 text-green-500 rounded-full flex items-center justify-center mx-auto mb-2">
                <CheckCircle className="w-10 h-10" />
              </div>
              <h4 className="text-2xl font-black">Optimization Complete!</h4>
              <p className="text-muted-foreground">The file has been successfully transcoded and the library updated.</p>
              <button 
                onClick={onClose}
                className="px-8 py-3 bg-primary text-primary-foreground font-bold rounded-xl hover:opacity-90 transition-all"
              >
                Close
              </button>
            </div>
          ) : (
            <>
              {/* Tool Availability Check */}
              {!availability?.handbrake && (
                <div className="bg-orange-500/10 border border-orange-500/20 rounded-xl p-4 flex gap-4">
                  <AlertTriangle className="w-5 h-5 text-orange-500 shrink-0" />
                  <div className="space-y-1">
                    <p className="text-sm font-bold text-orange-500">Handbrake CLI Not Found</p>
                    <p className="text-xs text-muted-foreground leading-normal">
                      Totality requires HandbrakeCLI to perform optimization. Please install it and ensure it's in your PATH or set in settings.
                    </p>
                  </div>
                </div>
              )}

              {/* Options */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground/70">Target Codec</label>
                  <select 
                    value={options.targetCodec}
                    onChange={(e) => setOptions({...options, targetCodec: e.target.value as any})}
                    className="w-full bg-muted border border-border/50 rounded-xl p-2.5 text-sm font-medium outline-hidden focus:border-primary transition-all"
                  >
                    <option value="av1">AV1 (Most Efficient)</option>
                    <option value="hevc">HEVC (H.265)</option>
                  </select>
                </div>
                <div className="space-y-2">
                    <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground/70">Mode</label>
                    <div className="flex gap-2">
                        <button 
                            onClick={() => setOptions({...options, overwriteOriginal: false})}
                            className={`flex-1 p-2.5 rounded-xl border text-xs font-bold transition-all ${!options.overwriteOriginal ? 'bg-primary/10 border-primary text-primary' : 'bg-muted border-border/50 text-muted-foreground'}`}
                        >
                            Create Copy
                        </button>
                        <button 
                            onClick={() => setOptions({...options, overwriteOriginal: true})}
                            className={`flex-1 p-2.5 rounded-xl border text-xs font-bold transition-all ${options.overwriteOriginal ? 'bg-orange-500/10 border-orange-500 text-orange-500' : 'bg-muted border-border/50 text-muted-foreground'}`}
                        >
                            Overwrite
                        </button>
                    </div>
                </div>
              </div>

              <div className="space-y-3">
                <label className="flex items-center gap-3 p-3 bg-muted/20 border border-border/30 rounded-xl cursor-pointer hover:bg-muted/30 transition-all group">
                  <input 
                    type="checkbox" 
                    checked={options.preserveSubtitles} 
                    onChange={(e) => setOptions({...options, preserveSubtitles: e.target.checked})}
                    className="w-4 h-4 rounded border-border text-primary focus:ring-primary/20"
                  />
                  <div className="flex-1">
                    <p className="text-sm font-semibold">Preserve Subtitles</p>
                    <p className="text-[11px] text-muted-foreground">Keep all internal subtitle tracks.</p>
                  </div>
                </label>
                <label className="flex items-center gap-3 p-3 bg-muted/20 border border-border/30 rounded-xl cursor-pointer hover:bg-muted/30 transition-all group">
                  <input 
                    type="checkbox" 
                    checked={options.preserveAllAudio} 
                    onChange={(e) => setOptions({...options, preserveAllAudio: e.target.checked})}
                    className="w-4 h-4 rounded border-border text-primary focus:ring-primary/20"
                  />
                  <div className="flex-1">
                    <p className="text-sm font-semibold">Preserve All Audio Tracks</p>
                    <p className="text-[11px] text-muted-foreground">AI normally keeps only main + commentary to save space.</p>
                  </div>
                </label>
              </div>

              {/* AI Parameters View */}
              {params ? (
                <div className="bg-primary/5 border border-primary/20 rounded-2xl p-5 space-y-4 animate-in slide-in-from-bottom-2 duration-300">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-primary">
                      <Settings className="w-3.5 h-3.5" />
                      AI Optimization Strategy
                    </div>
                    {params.expectedSizeReduction && (
                      <div className="bg-green-500/10 text-green-500 text-[10px] font-black px-2 py-0.5 rounded uppercase">
                        ~{params.expectedSizeReduction} SAVINGS
                      </div>
                    )}
                  </div>
                  <p className="text-sm text-foreground/90 leading-relaxed font-medium">
                    {params.summary}
                  </p>
                  
                  {params.warnings && params.warnings.length > 0 && (
                    <div className="space-y-1">
                      {params.warnings.map((w, i) => (
                        <div key={i} className="flex gap-2 text-[11px] text-orange-500 font-medium">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                          <span>{w}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="pt-2">
                    <div className="bg-black/20 p-3 rounded-xl border border-primary/10 font-mono text-[10px] text-muted-foreground break-all">
                      HandBrakeCLI ... {params.handbrakeArgs.join(' ')}
                    </div>
                  </div>
                </div>
              ) : (
                <button 
                  onClick={generateParams}
                  disabled={generating || !availability?.handbrake}
                  className="w-full py-4 bg-muted hover:bg-muted/80 rounded-2xl text-sm font-bold transition-all disabled:opacity-50 flex items-center justify-center gap-3"
                >
                  {generating ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Zap className="w-5 h-5 text-primary" />}
                  Generate AI-Tuned Strategy
                </button>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {status !== 'encoding' && status !== 'complete' && (
          <div className="p-6 bg-muted/10 border-t border-border/10 flex gap-3">
            <button 
              onClick={onClose}
              className="px-6 py-3 bg-muted hover:bg-muted/80 rounded-xl text-sm font-bold transition-all"
            >
              Cancel
            </button>
            <div className="flex-1" />
            <button 
              onClick={startTranscode}
              disabled={!params || !availability?.handbrake}
              className="flex items-center gap-2 px-8 py-3 bg-primary text-primary-foreground font-black rounded-xl text-sm transition-all disabled:opacity-50 shadow-lg shadow-primary/20"
            >
              <Play className="w-4 h-4 fill-current" />
              Start Optimization
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}
