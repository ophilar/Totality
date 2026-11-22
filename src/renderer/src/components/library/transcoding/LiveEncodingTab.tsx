import { useState, useRef, useEffect } from 'react'
import {
  Terminal,
  ChevronDown,
  ChevronUp,
  Copy,
  Zap,
  Play
} from 'lucide-react'
import { useToast } from '@/contexts/ToastContext'
import type { TranscodeProgress, TranscodingParams } from './types'
import { OptimizationEncodingProgress } from './OptimizationEncodingProgress'
import { OptimizationTerminalState } from './OptimizationTerminalState'

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

  const copyLogs = async () => {
    if (logLines.length === 0) return
    try {
      await navigator.clipboard.writeText(logLines.join('\n'))
      addToast({ title: 'Logs copied to clipboard', type: 'success' })
    } catch (error) {
      addToast({ title: 'Could not copy logs', message: error instanceof Error ? error.message : String(error), type: 'error' })
    }
  }

  return (
    <div className="space-y-6">
      {status === 'complete' ? (
        <OptimizationTerminalState state="complete" itemLabel={mediaTitle} onClose={onClose} />
      ) : status === 'failed' ? (
        <OptimizationTerminalState state="failed" itemLabel={mediaTitle} error={progress?.error} onClose={onClose} onRetry={onStart} />
      ) : status === 'encoding' ? (
        <div className="space-y-6 py-2 animate-in fade-in duration-200">
          <OptimizationEncodingProgress
            label={mediaTitle}
            status="Running"
            percent={progress?.percent ?? null}
            phase={progress?.status}
            fps={progress?.fps ? `${progress.fps} FPS` : null}
            speed={progress?.speed}
            eta={progress?.eta}
            onCancel={onCancel}
          />

          {/* Strategy Summary */}
          {params && <details className="rounded-xl border border-border/40 bg-muted/20 p-3 text-xs text-muted-foreground">
            <summary className="cursor-pointer font-medium">Plan details</summary>
            <p className="pt-2">{params.summary}</p>
          </details>}
        </div>
      ) : (
        /* Idle / Ready to Encode State */
        <div className="text-center space-y-6 py-8">
          <div className="w-16 h-16 bg-primary/10 text-primary rounded-2xl flex items-center justify-center mx-auto">
            <Zap className="w-8 h-8" />
          </div>
          <div className="space-y-2">
            <h4 className="text-xl font-bold">Ready to start</h4>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">Review settings before starting.</p>
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
            <span>Technical log ({logLines.length})</span>
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
                Copy log
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
                <p className="text-zinc-500 italic">No logs yet.</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
