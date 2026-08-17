import { useState, useRef, useEffect } from 'react'
import { 
  RefreshCw, 
  CheckCircle2, 
  AlertTriangle, 
  Gauge, 
  Clock, 
  Terminal, 
  ChevronDown, 
  ChevronUp, 
  Copy, 
  Zap, 
  Info,
  XCircle,
  Play
} from 'lucide-react'
import { useToast } from '@/contexts/ToastContext'
import type { TranscodeProgress, TranscodingParams } from './types'

export interface LiveEncodingTabProps {
  status: 'idle' | 'generating' | 'encoding' | 'complete' | 'failed'
  progress: TranscodeProgress | null
  params: TranscodingParams | null
  mediaTitle?: string
  onCancel: () => void
  onStart: () => void
  onClose: () => void
}

export function LiveEncodingTab({
  status,
  progress,
  params,
  mediaTitle,
  onCancel,
  onStart,
  onClose
}: LiveEncodingTabProps) {
  const { addToast } = useToast()
  const [showLogs, setShowLogs] = useState(false)
  const [logLines, setLogLines] = useState<string[]>([])
  const logContainerRef = useRef<HTMLDivElement>(null)
  const lastProgressLogTimeRef = useRef<number>(0)

  // Accumulate logs when progress updates or contains log entries with throttling
  useEffect(() => {
    if (progress) {
      if (progress.logs && progress.logs.length > 0) {
        queueMicrotask(() => { setLogLines(progress.logs || []) })
      } else if (progress.error) {
        queueMicrotask(() => { setLogLines(prev => [...prev, `[ERROR] ${progress.error}`]) })
      } else if (progress.fps || progress.percent) {
        const now = Date.now()
        if (now - lastProgressLogTimeRef.current >= 1000) {
          lastProgressLogTimeRef.current = now
          const line = `[PROGRESS] ${progress.percent.toFixed(1)}% | ${progress.fps || 0} FPS | ETA: ${progress.eta || 'N/A'}`
          queueMicrotask(() => {
            setLogLines(prev => {
              if (prev.length === 0 || prev[prev.length - 1] !== line) {
                return [...prev, line]
              }
              return prev
            })
          })
        }
      }
    }
  }, [progress])

  // Auto-scroll logs to bottom
  useEffect(() => {
    if (showLogs && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight
    }
  }, [logLines, showLogs])

  const copyLogs = () => {
    if (logLines.length === 0) return
    navigator.clipboard.writeText(logLines.join('\n'))
    addToast({ title: 'Logs copied to clipboard', type: 'success' })
  }

  const percent = progress?.percent ?? 0
  const fps = progress?.fps ? `${progress.fps} FPS` : '0 FPS'
  const speed = progress?.speed || (progress?.fps ? `${(progress.fps / 24).toFixed(1)}x` : '1.0x')
  const eta = progress?.eta || 'Calculating...'

  // SVG Circular Gauge calculation
  const radius = 64
  const strokeWidth = 8
  const normalizedRadius = radius - strokeWidth * 0.5
  const circumference = normalizedRadius * 2 * Math.PI
  const strokeDashoffset = circumference - (percent / 100) * circumference

  return (
    <div className="space-y-6">
      {status === 'complete' ? (
        <div className="text-center space-y-5 py-8 animate-in zoom-in-95 duration-200">
          <div className="w-20 h-20 bg-green-500/15 text-green-400 rounded-full flex items-center justify-center mx-auto shadow-lg shadow-green-500/10">
            <CheckCircle2 className="w-12 h-12" />
          </div>
          <div className="space-y-2">
            <h4 className="text-2xl font-black">Optimization Complete!</h4>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              {mediaTitle ? `"${mediaTitle}"` : 'Media file'} has been successfully transcoded with zero-copy VRAM pipeline.
            </p>
          </div>

          <div className="pt-4 flex justify-center">
            <button 
              onClick={onClose}
              className="px-8 py-3 bg-primary text-primary-foreground font-bold rounded-xl hover:opacity-90 transition-all shadow-lg shadow-primary/20"
            >
              Close Monitor
            </button>
          </div>
        </div>
      ) : status === 'failed' ? (
        <div className="text-center space-y-5 py-8 animate-in zoom-in-95 duration-200">
          <div className="w-20 h-20 bg-red-500/15 text-red-400 rounded-full flex items-center justify-center mx-auto shadow-lg shadow-red-500/10">
            <AlertTriangle className="w-12 h-12" />
          </div>
          <div className="space-y-2">
            <h4 className="text-2xl font-black text-red-400">Encoding Failed</h4>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              {progress?.error || 'An error occurred during transcoding execution.'}
            </p>
          </div>

          <div className="flex justify-center gap-3 pt-4">
            <button 
              onClick={onClose}
              className="px-6 py-2.5 bg-muted hover:bg-muted/80 rounded-xl text-sm font-bold transition-all"
            >
              Close
            </button>
            <button 
              onClick={onStart}
              className="flex items-center gap-2 px-6 py-2.5 bg-primary text-primary-foreground font-bold rounded-xl hover:opacity-90 transition-all"
            >
              <RefreshCw className="w-4 h-4" />
              Retry Transcode
            </button>
          </div>
        </div>
      ) : status === 'encoding' ? (
        <div className="space-y-6 py-2 animate-in fade-in duration-200">
          {/* Header State */}
          <div className="flex items-center justify-between bg-primary/5 border border-primary/20 rounded-2xl p-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-primary/10 rounded-xl text-primary animate-spin">
                <RefreshCw className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-foreground">Live Hardware Transcoding Active</h4>
                <p className="text-xs text-muted-foreground">Streaming GPU VRAM Anti-Stutter Pipeline</p>
              </div>
            </div>
            <button
              onClick={onCancel}
              className="px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5"
            >
              <XCircle className="w-4 h-4" />
              Cancel Transcode
            </button>
          </div>

          {/* Central Progress Section with Gauge */}
          <div className="flex flex-col md:flex-row items-center gap-6 bg-muted/20 border border-border/40 rounded-2xl p-6">
            {/* Circular Gauge */}
            <div className="relative flex items-center justify-center shrink-0">
              <svg
                height={radius * 2}
                width={radius * 2}
                className="transform -rotate-90"
              >
                <circle
                  stroke="currentColor"
                  fill="transparent"
                  strokeWidth={strokeWidth}
                  r={normalizedRadius}
                  cx={radius}
                  cy={radius}
                  className="text-muted/40"
                />
                <circle
                  stroke="currentColor"
                  fill="transparent"
                  strokeWidth={strokeWidth}
                  strokeDasharray={circumference + ' ' + circumference}
                  style={{ strokeDashoffset }}
                  strokeLinecap="round"
                  r={normalizedRadius}
                  cx={radius}
                  cy={radius}
                  className="text-primary transition-all duration-300 ease-out"
                />
              </svg>
              <div className="absolute flex flex-col items-center justify-center text-center">
                <span className="text-2xl font-black tracking-tight">{percent.toFixed(1)}%</span>
                <span className="text-[10px] uppercase font-bold text-muted-foreground">Progress</span>
              </div>
            </div>

            {/* Statistics Grid */}
            <div className="flex-1 w-full space-y-4">
              {/* Linear Progress Bar */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs font-bold">
                  <span className="text-muted-foreground">Encoding Progress</span>
                  <span className="text-primary font-mono">{percent.toFixed(1)}%</span>
                </div>
                <div className="h-3 bg-muted rounded-full overflow-hidden p-0.5 border border-border/30">
                  <div 
                    className="h-full bg-gradient-to-r from-primary/80 to-primary rounded-full transition-all duration-300 ease-out"
                    style={{ width: `${percent}%` }}
                  />
                </div>
              </div>

              {/* Metric Cards Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="bg-muted/40 border border-border/30 rounded-xl p-2.5 text-center">
                  <div className="flex items-center justify-center gap-1 text-[10px] font-bold text-muted-foreground uppercase">
                    <Gauge className="w-3 h-3 text-primary" />
                    Speed
                  </div>
                  <div className="text-sm font-bold font-mono text-foreground pt-0.5">{fps}</div>
                </div>

                <div className="bg-muted/40 border border-border/30 rounded-xl p-2.5 text-center">
                  <div className="flex items-center justify-center gap-1 text-[10px] font-bold text-muted-foreground uppercase">
                    <Zap className="w-3 h-3 text-emerald-400" />
                    Multiplier
                  </div>
                  <div className="text-sm font-bold font-mono text-emerald-400 pt-0.5">{speed}</div>
                </div>

                <div className="bg-muted/40 border border-border/30 rounded-xl p-2.5 text-center">
                  <div className="flex items-center justify-center gap-1 text-[10px] font-bold text-muted-foreground uppercase">
                    <Clock className="w-3 h-3 text-amber-400" />
                    ETA
                  </div>
                  <div className="text-sm font-bold font-mono text-amber-400 pt-0.5">{eta}</div>
                </div>
              </div>
            </div>
          </div>

          {/* Strategy Summary */}
          {params && (
            <div className="bg-muted/20 border border-border/40 rounded-xl p-3 flex items-start gap-2.5 text-xs text-muted-foreground">
              <Info className="w-4 h-4 text-primary shrink-0 mt-0.5" />
              <div>
                <span className="font-bold text-foreground">Pipeline Strategy: </span>
                <span>{params.summary}</span>
              </div>
            </div>
          )}
        </div>
      ) : (
        /* Idle / Ready to Encode State */
        <div className="text-center space-y-6 py-8">
          <div className="w-16 h-16 bg-primary/10 text-primary rounded-2xl flex items-center justify-center mx-auto">
            <Zap className="w-8 h-8" />
          </div>
          <div className="space-y-2">
            <h4 className="text-xl font-bold">Ready to Launch Hardware Transcode</h4>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Configure options in Quick Presets or Advanced Settings, then press Start Optimization to begin live encoding.
            </p>
          </div>

          <div className="pt-2 flex justify-center">
            <button 
              onClick={onStart}
              className="flex items-center gap-2 px-8 py-3 bg-primary text-primary-foreground font-black rounded-xl text-sm transition-all shadow-lg shadow-primary/20 hover:opacity-90"
            >
              <Play className="w-4 h-4 fill-current" />
              Start Optimization
            </button>
          </div>
        </div>
      )}

      {/* Collapsible Live Log Drawer */}
      <div className="bg-black/60 border border-border/50 rounded-2xl overflow-hidden">
        <button
          onClick={() => setShowLogs(!showLogs)}
          className="w-full px-4 py-3 bg-muted/20 hover:bg-muted/30 flex items-center justify-between text-xs font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-all"
        >
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-primary" />
            <span>Live Encoding Console Log ({logLines.length} lines)</span>
          </div>
          <div className="flex items-center gap-2">
            {showLogs ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </div>
        </button>

        {showLogs && (
          <div className="p-4 pt-2 border-t border-border/30 space-y-3 animate-in fade-in duration-200">
            <div className="flex justify-end">
              <button
                onClick={copyLogs}
                disabled={logLines.length === 0}
                className="flex items-center gap-1.5 text-[11px] font-bold text-muted-foreground hover:text-foreground disabled:opacity-40 transition-all"
              >
                <Copy className="w-3 h-3" />
                Copy Terminal Log
              </button>
            </div>
            <div
              ref={logContainerRef}
              className="h-44 overflow-y-auto bg-black/80 p-3 rounded-xl font-mono text-[11px] text-zinc-300 space-y-1 custom-scrollbar"
            >
              {logLines.length > 0 ? (
                logLines.map((line, i) => (
                  <div key={i} className="leading-relaxed break-all">
                    {line}
                  </div>
                ))
              ) : (
                <p className="text-zinc-500 italic">No output logged yet. Start transcode to see stderr output.</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
