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
  Info,
  Sliders,
  Cpu,
  Copy
} from 'lucide-react'
import { useToast } from '@/contexts/ToastContext'
import type { MediaItem } from '@main/types/database'

interface TranscodingParams {
  summary: string
  handbrakeArgs: string[]
  ffmpegArgs?: string[]
  expectedSizeReduction?: string
  warnings?: string[]
  encoder?: string
  crf?: number
  preset?: string
}

interface GpuInfo {
  id: string
  name: string
  vendor: 'NVIDIA' | 'Intel' | 'AMD' | 'Apple' | 'Unknown'
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
  const [customize, setCustomize] = useState(false)
  const [gpus, setGpus] = useState<GpuInfo[]>([])
  
  const [options, setOptions] = useState({
    targetCodec: 'av1' as 'av1' | 'hevc',
    preserveSubtitles: true,
    preserveAllAudio: false,
    overwriteOriginal: false,
    useGpu: false,
    gpuId: '',
    encoder: '',
    crf: 22,
    preset: 'fast',
    customArgs: '',
    transcodingEngine: 'handbrake' as 'handbrake' | 'ffmpeg',
    targetSize: 'ai-recommended'
  })
  const [status, setStatus] = useState<'idle' | 'generating' | 'encoding' | 'complete' | 'failed'>('idle')
  const [progress, setProgress] = useState<{ percent: number; fps?: number; eta?: string; error?: string } | null>(null)
  
  const { addToast } = useToast()

  const loadInitialData = useCallback(async () => {
    try {
      setLoading(true)
      const [item, avail, detectedGpus] = await Promise.all([
        window.electronAPI.getMediaItem(mediaId),
        window.electronAPI.checkAvailability(),
        window.electronAPI.gpusList()
      ])
      
      if (item) setMedia(item as MediaItem)
      setAvailability(avail)
      setGpus(detectedGpus || [])
      
      const defaultEngine = avail.handbrake ? 'handbrake' : 'ffmpeg'
      setOptions(prev => ({
        ...prev,
        transcodingEngine: defaultEngine,
        gpuId: detectedGpus && detectedGpus.length > 0 ? detectedGpus[0].id : ''
      }))
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
        if (p.status === 'cancelled') {
          setStatus('idle')
          setProgress(null)
          addToast({ title: 'Optimization cancelled', type: 'info' })
        }
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

  // Dynamically update parameters preview when options change
  useEffect(() => {
    if (status === 'encoding' || status === 'generating' || !media || !media.file_path) return
    
    // Update if params is already generated or if we are customizing parameters
    if (params || customize) {
      const timer = setTimeout(async () => {
        try {
          const paramsOptions = customize 
            ? options 
            : {
                targetCodec: options.targetCodec,
                preserveSubtitles: options.preserveSubtitles,
                preserveAllAudio: options.preserveAllAudio,
                overwriteOriginal: options.overwriteOriginal,
                useGpu: options.useGpu,
                gpuId: options.gpuId,
                targetSize: options.targetSize
              }
          const p = await window.electronAPI.getParameters(media.file_path!, paramsOptions)
          setParams(p)
        } catch (err) {
          console.error('Failed to update parameters preview:', err)
        }
      }, 300)
      return () => clearTimeout(timer)
    }
  }, [options, customize, media, status])

  const generateParams = async () => {
    if (!media || !media.file_path) return
    setGenerating(true)
    setStatus('generating')
    try {
      const paramsOptions = customize 
        ? options 
        : {
            targetCodec: options.targetCodec,
            preserveSubtitles: options.preserveSubtitles,
            preserveAllAudio: options.preserveAllAudio,
            overwriteOriginal: options.overwriteOriginal,
            useGpu: options.useGpu,
            gpuId: options.gpuId,
            targetSize: options.targetSize
          }
      const p = await window.electronAPI.getParameters(media.file_path!, paramsOptions)
      setParams(p)
      
      // Update custom controls with recommendations
      setOptions(prev => ({
        ...prev,
        encoder: p.encoder || prev.encoder,
        crf: p.crf !== undefined ? p.crf : prev.crf,
        preset: p.preset || prev.preset
      }))
      
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
      const transcodeOptions = customize 
        ? options 
        : {
            targetCodec: options.targetCodec,
            preserveSubtitles: options.preserveSubtitles,
            preserveAllAudio: options.preserveAllAudio,
            overwriteOriginal: options.overwriteOriginal,
            useGpu: options.useGpu,
            gpuId: options.gpuId,
            targetSize: options.targetSize
          }
      const success = await window.electronAPI.start(media.id!, transcodeOptions)
      if (success) {
        addToast({ title: 'Transcode complete', type: 'success' })
      }
    } catch (err: any) {
      if (status !== 'idle') {
        addToast({ title: `Transcode failed: ${err.message}`, type: 'error' })
        setStatus('failed')
      }
    }
  }

  const cancelTranscode = async () => {
    try {
      await window.electronAPI.cancel(mediaId)
    } catch (err: any) {
      addToast({ title: `Cancellation failed: ${err.message}`, type: 'error' })
    }
  }

  const copyCommand = () => {
    if (!params || !media || !media.file_path) return
    const inputPath = media.file_path
    const outputExt = '.mkv'
    const outputPath = inputPath.substring(0, inputPath.lastIndexOf('.')) + '_optimized' + outputExt
    
    let fullCmd = ''
    if (options.transcodingEngine === 'ffmpeg') {
      const args = (params.ffmpegArgs || []).map((arg: string) => {
        if (arg === '<input>') return `"${inputPath}"`
        if (arg === '<output>') return `"${outputPath}"`
        return arg
      })
      fullCmd = `ffmpeg ${args.join(' ')}`
    } else {
      fullCmd = `HandBrakeCLI -i "${inputPath}" -o "${outputPath}" ${params.handbrakeArgs.join(' ')}`
    }
    
    navigator.clipboard.writeText(fullCmd)
    addToast({ title: 'Command copied to clipboard!', type: 'success' })
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
                <p className="text-sm text-muted-foreground">Using optimized Handbrake parameters for maximum efficiency.</p>
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
              {!availability?.handbrake && !availability?.ffmpeg && (
                <div className="bg-orange-500/10 border border-orange-500/20 rounded-xl p-4 flex gap-4 animate-in fade-in duration-300">
                  <AlertTriangle className="w-5 h-5 text-orange-500 shrink-0" />
                  <div className="space-y-1">
                    <p className="text-sm font-bold text-orange-500">Transcoding Engine Not Found</p>
                    <p className="text-xs text-muted-foreground leading-normal">
                      Totality requires either HandbrakeCLI or FFmpeg to perform optimization. Please configure them in your settings.
                    </p>
                  </div>
                </div>
              )}

              {!availability?.handbrake && availability?.ffmpeg && (
                <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4 flex gap-4 animate-in fade-in duration-300">
                  <Info className="w-5 h-5 text-blue-500 shrink-0" />
                  <div className="space-y-1">
                    <p className="text-sm font-bold text-blue-500">Using FFmpeg Transcoding Engine</p>
                    <p className="text-xs text-muted-foreground leading-normal">
                      HandBrakeCLI is not configured. Totality will transcode using the fallback FFmpeg engine.
                    </p>
                  </div>
                </div>
              )}

              {/* Options */}
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2 space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground/70">Transcoding Engine</label>
                  <select 
                    value={options.transcodingEngine}
                    onChange={(e) => setOptions({...options, transcodingEngine: e.target.value as any})}
                    className="w-full bg-muted border border-border/50 rounded-xl p-2.5 text-sm font-medium outline-hidden focus:border-primary transition-all"
                  >
                    {availability?.handbrake && <option value="handbrake">HandBrake CLI</option>}
                    {availability?.ffmpeg && <option value="ffmpeg">FFmpeg</option>}
                  </select>
                </div>
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
                    checked={options.useGpu} 
                    onChange={(e) => setOptions({...options, useGpu: e.target.checked})}
                    className="w-4 h-4 rounded border-border text-primary focus:ring-primary/20"
                  />
                  <div className="flex-1">
                    <p className="text-sm font-semibold flex items-center gap-2">
                      Use GPU Acceleration
                    </p>
                    <p className="text-[11px] text-muted-foreground">Accelerate transcode speed using compatible hardware encoders.</p>
                  </div>
                </label>

                {options.useGpu && gpus.length > 0 && (
                  <div className="space-y-2 p-3 bg-muted/10 border border-border/20 rounded-xl animate-in slide-in-from-top-2 duration-200">
                    <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground/70 flex items-center gap-2">
                      <Cpu className="w-3.5 h-3.5" />
                      Select GPU Device
                    </label>
                    <select 
                      value={options.gpuId}
                      onChange={(e) => setOptions({...options, gpuId: e.target.value})}
                      className="w-full bg-muted border border-border/50 rounded-xl p-2 text-xs font-medium outline-hidden focus:border-primary transition-all"
                    >
                      {gpus.map(gpu => (
                        <option key={gpu.id} value={gpu.id}>
                          {gpu.name} ({gpu.vendor})
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                
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
                
                <div className="space-y-3 p-4 bg-muted/10 border border-border/20 rounded-2xl">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Target Size Constraint</p>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setOptions({ ...options, targetSize: 'ai-recommended' })}
                      className={`flex flex-col gap-1 p-3 rounded-xl border text-left transition-all ${options.targetSize === 'ai-recommended' ? 'bg-primary/5 border-primary ring-1 ring-primary' : 'bg-muted/10 border-border/30 hover:bg-muted/20'}`}
                    >
                      <span className="text-xs font-bold">Auto (AI Recommend)</span>
                      <span className="text-[10px] text-muted-foreground">Preserve quality & optimize.</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setOptions({ ...options, targetSize: options.targetSize === 'ai-recommended' ? '' : options.targetSize })}
                      className={`flex flex-col gap-1 p-3 rounded-xl border text-left transition-all ${options.targetSize !== 'ai-recommended' ? 'bg-primary/5 border-primary ring-1 ring-primary' : 'bg-muted/10 border-border/30 hover:bg-muted/20'}`}
                    >
                      <span className="text-xs font-bold">Custom Size Limit</span>
                      <span className="text-[10px] text-muted-foreground">Target specific file size.</span>
                    </button>
                  </div>
                  {options.targetSize !== 'ai-recommended' && (
                    <div className="mt-2 animate-in fade-in duration-200">
                      <input
                        type="text"
                        value={options.targetSize}
                        onChange={(e) => setOptions({ ...options, targetSize: e.target.value })}
                        placeholder="e.g., 500MB, 2GB, 700MB"
                        className="w-full px-3 py-2 bg-background border border-border/50 rounded-xl text-sm focus:outline-hidden focus:ring-2 focus:ring-primary/20"
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* Customization Toggle */}
              <div className="flex justify-between items-center pt-2">
                <button
                  type="button"
                  onClick={() => setCustomize(!customize)}
                  className={`flex items-center gap-2 text-xs font-bold uppercase tracking-wider transition-all ${customize ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  <Sliders className="w-3.5 h-3.5" />
                  Customize Parameters Manually
                </button>
              </div>

              {customize && (
                <div className="bg-muted/30 border border-border/50 rounded-2xl p-5 space-y-4 animate-in slide-in-from-top-2 duration-300">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Video Encoder</label>
                      <select 
                        value={options.encoder}
                        onChange={(e) => setOptions({...options, encoder: e.target.value})}
                        className="w-full bg-muted border border-border/50 rounded-xl p-2.5 text-xs font-medium outline-hidden focus:border-primary transition-all"
                      >
                        <option value="">Auto (Use Default)</option>
                        <option value="svt_av1">SVT-AV1 (CPU)</option>
                        <option value="svt_av1_10bit">SVT-AV1 10-bit (CPU)</option>
                        <option value="nvenc_av1">AV1 NVENC (NVIDIA)</option>
                        <option value="nvenc_av1_10bit">AV1 NVENC 10-bit (NVIDIA)</option>
                        <option value="qsv_av1">AV1 QSV (Intel)</option>
                        <option value="av1_amf">AV1 AMF (AMD)</option>
                        <option value="x265">x265 (CPU)</option>
                        <option value="x265_10bit">x265 10-bit (CPU)</option>
                        <option value="nvenc_h265">HEVC NVENC (NVIDIA)</option>
                        <option value="nvenc_h265_10bit">HEVC NVENC 10-bit (NVIDIA)</option>
                        <option value="qsv_h265">HEVC QSV (Intel)</option>
                        <option value="qsv_h265_10bit">HEVC QSV 10-bit (Intel)</option>
                        <option value="hevc_amf">HEVC AMF (AMD)</option>
                        <option value="vt_h265">HEVC VideoToolbox (Apple)</option>
                        <option value="x264">x264 (CPU)</option>
                        <option value="nvenc_h264">H.264 NVENC (NVIDIA)</option>
                        <option value="qsv_h264">H.264 QSV (Intel)</option>
                        <option value="vce_h264">H.264 VCE (AMD)</option>
                        <option value="vt_h264">H.264 VideoToolbox (Apple)</option>
                      </select>
                    </div>

                    <div className="space-y-2">
                      <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Preset / Speed</label>
                      <select 
                        value={options.preset}
                        onChange={(e) => setOptions({...options, preset: e.target.value})}
                        className="w-full bg-muted border border-border/50 rounded-xl p-2.5 text-xs font-medium outline-hidden focus:border-primary transition-all"
                      >
                        <option value="ultrafast">Ultrafast</option>
                        <option value="superfast">Superfast</option>
                        <option value="veryfast">Veryfast</option>
                        <option value="faster">Faster</option>
                        <option value="fast">Fast</option>
                        <option value="medium">Medium</option>
                        <option value="slow">Slow</option>
                        <option value="slower">Slower</option>
                        <option value="veryslow">Veryslow</option>
                        <option value="placebo">Placebo</option>
                        <option value="hq">HQ (Hardware)</option>
                        <option value="hp">HP (Hardware)</option>
                      </select>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Constant Quality (CRF: {options.crf})</label>
                      <input 
                        type="number"
                        min="0"
                        max="51"
                        value={options.crf}
                        onChange={(e) => setOptions({...options, crf: parseInt(e.target.value) || 0})}
                        className="w-16 bg-muted border border-border/50 rounded-lg p-1 text-center text-xs outline-hidden focus:border-primary"
                      />
                    </div>
                    <input 
                      type="range" 
                      min="0" 
                      max="51" 
                      value={options.crf} 
                      onChange={(e) => setOptions({...options, crf: parseInt(e.target.value)})}
                      className="w-full h-1.5 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Custom Arguments</label>
                    <input 
                      type="text" 
                      placeholder="e.g. --decomb --denoise=light" 
                      value={options.customArgs}
                      onChange={(e) => setOptions({...options, customArgs: e.target.value})}
                      className="w-full bg-muted border border-border/50 rounded-xl p-2.5 text-xs outline-hidden focus:border-primary transition-all font-mono"
                    />
                  </div>
                </div>
              )}

              {/* Parameters Preview / Strategy View */}
              {params ? (
                <div className="bg-primary/5 border border-primary/20 rounded-2xl p-5 space-y-4 animate-in slide-in-from-bottom-2 duration-300">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-primary">
                      <Settings className="w-3.5 h-3.5" />
                      {customize ? 'Custom Optimization Strategy' : 'AI Optimization Strategy'}
                    </div>
                    <div className="flex items-center gap-3">
                      {params.expectedSizeReduction && !customize && (
                        <div className="bg-green-500/10 text-green-500 text-[10px] font-black px-2 py-0.5 rounded uppercase">
                          ~{params.expectedSizeReduction} SAVINGS
                        </div>
                      )}
                      <button 
                        onClick={copyCommand}
                        className="p-1.5 hover:bg-muted text-muted-foreground hover:text-foreground rounded-lg transition-all flex items-center gap-1.5 text-[10px] font-bold uppercase border border-border/30"
                        title="Copy CLI command to clipboard"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        Copy Command
                      </button>
                    </div>
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
                      {options.transcodingEngine === 'ffmpeg' ? (
                        <>ffmpeg ... {(params.ffmpegArgs || []).join(' ')}</>
                      ) : (
                        <>HandBrakeCLI ... {params.handbrakeArgs.join(' ')}</>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <button 
                  onClick={generateParams}
                  disabled={generating || (!availability?.handbrake && !availability?.ffmpeg)}
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
        {status === 'encoding' && (
          <div className="p-6 bg-muted/10 border-t border-border/10 flex justify-center">
            <button 
              onClick={cancelTranscode}
              className="px-8 py-3 bg-red-500 hover:bg-red-600 text-white font-bold rounded-xl text-sm transition-all"
            >
              Cancel Optimization
            </button>
          </div>
        )}

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
              disabled={(!params && !customize) || (!availability?.handbrake && !availability?.ffmpeg)}
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
