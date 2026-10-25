import { useEffect, useState } from 'react'
import { Activity, AlertCircle, CheckCircle2, Loader2, Pause, Play, X } from 'lucide-react'
import type { ActivityOperation } from '@main/ipc/utils/OperationRequestRegistry'
import { getActiveThemeClass } from '../../contexts/ThemeContext'
import { useMenuClose } from '../../hooks/useMenuClose'

export function ActivityPanel() {
  const [isOpen, setIsOpen] = useState(false)
  const [operations, setOperations] = useState<ActivityOperation[]>([])
  const [error, setError] = useState<string>()
  const panelRef = useMenuClose({ isOpen, onClose: () => setIsOpen(false) })
  const activeCount = operations.filter(operation => !operation.outcome).length

  useEffect(() => {
    const applySnapshot = (snapshot: { operations: ActivityOperation[] }) => {
      setOperations(snapshot.operations)
      setError(undefined)
    }
    const unsubscribe = window.electronAPI.onOperationsUpdated?.(applySnapshot)
    window.electronAPI.operationsGetActivity().then(applySnapshot).catch(reason => {
      setError(reason instanceof Error ? reason.message : String(reason))
    })
    return () => unsubscribe?.()
  }, [])

  const handlePause = async (operation: ActivityOperation) => {
    try {
      const { status } = await window.electronAPI.operationsSetPaused(operation.requestId, operation.state !== 'paused')
      if (status === 'missing' || status === 'committing') setError(`Preflight is ${status === 'missing' ? 'no longer active' : 'finishing'}; refresh activity to see its final state.`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  const handleStop = async (operation: ActivityOperation) => {
    try {
      const { status } = await window.electronAPI.dbCancelOperation(operation.requestId)
      if (status === 'missing' || status === 'committing') setError(`Preflight is ${status === 'missing' ? 'no longer active' : 'finishing'}; refresh activity to see its final state.`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  const handleDismiss = async (operation: ActivityOperation) => {
    try {
      await window.electronAPI.operationsDismiss(operation.requestId)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  return (
    <div ref={panelRef} className="relative">
      <button
        onClick={() => setIsOpen(open => !open)}
        className={`relative p-2 rounded-md transition-colors ${isOpen ? 'bg-white text-black' : 'text-white hover:bg-white/10'}`}
        aria-label="Activity"
        aria-expanded={isOpen}
        aria-haspopup="true"
      >
        {activeCount > 0 ? <Loader2 className="w-5 h-5 animate-spin" /> : <Activity className="w-5 h-5" />}
        {activeCount > 0 && <span className="absolute -top-1 -right-1 bg-white text-black text-[10px] font-medium rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">{activeCount > 99 ? '99+' : activeCount}</span>}
      </button>

      <section
        className={`${getActiveThemeClass()} absolute right-0 top-full mt-2 w-[min(28rem,calc(100vw-1rem))] max-h-[min(32rem,calc(100vh-5rem))] bg-card rounded-2xl shadow-2xl z-50 flex flex-col overflow-hidden transition-all duration-200 ${isOpen ? 'translate-y-0 opacity-100' : '-translate-y-2 opacity-0 pointer-events-none'}`}
        aria-label="Background activity"
        aria-hidden={!isOpen}
      >
        <header className="flex items-center justify-between p-4 border-b border-border/30">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Activity</h2>
            {activeCount > 0 && <span className="text-xs text-muted-foreground">{activeCount} active</span>}
          </div>
          <button onClick={() => setIsOpen(false)} className="p-1.5 rounded-md hover:bg-muted text-muted-foreground" aria-label="Close activity">
            <X className="w-4 h-4" />
          </button>
        </header>

        {error && <p role="alert" className="px-4 py-2 text-xs text-destructive">Activity update failed: {error}</p>}
        <div className="min-h-0 overflow-y-auto">
          {operations.length === 0 ? (
            <div className="py-10 px-4 text-center">
              <Activity className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No background activity</p>
              <p className="text-xs text-muted-foreground/60 mt-1">Long-running work and its progress will appear here.</p>
            </div>
          ) : operations.map(operation => (
            <article key={operation.requestId} className="px-4 py-3 border-b border-border/20">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{operation.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{operation.outcome?.message ?? operation.phase ?? operation.context ?? operation.state}</p>
                </div>
                {operation.outcome ? (
                  <div className="flex shrink-0 items-center gap-2">
                    {operation.outcome.hasResult && operation.resultId && <button onClick={() => window.dispatchEvent(new CustomEvent('tvOptimization:review', { detail: { preflightId: operation.resultId } }))} className="text-xs text-primary hover:text-primary/80">Review</button>}
                    <button onClick={() => void handleDismiss(operation)} className="text-xs text-muted-foreground hover:text-foreground">Dismiss</button>
                  </div>
                ) : operation.kind === 'optimization-preflight' ? (
                  <div className="flex shrink-0 items-center gap-2">
                    {operation.entity && <button onClick={() => window.dispatchEvent(new CustomEvent('tvOptimization:resume', { detail: { requestId: operation.requestId, entity: operation.entity } }))} className="text-xs text-primary hover:text-primary/80">Return</button>}
                    <button onClick={() => void handlePause(operation)} className="text-xs text-muted-foreground hover:text-foreground" aria-label={operation.state === 'paused' ? 'Resume preflight' : 'Pause preflight'} title={operation.state === 'paused' ? 'Resume' : 'Pause'}>
                      {operation.state === 'paused' ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
                    </button>
                    <button onClick={() => void handleStop(operation)} className="text-xs text-destructive hover:text-destructive/80" aria-label="Stop preflight" title="Stop"><X className="w-4 h-4" /></button>
                  </div>
                ) : null}
              </div>
              {operation.progress && <div className="mt-2 h-1.5 overflow-hidden rounded bg-muted"><div className="h-full bg-primary transition-[width] duration-300" style={{ width: `${Math.max(0, Math.min(100, operation.progress.percentage))}%` }} /></div>}
              {operation.progress?.currentItem && <p className="mt-1 text-[11px] text-muted-foreground truncate">{operation.progress.currentItem}</p>}
              {operation.outcome?.hasResult && !operation.resultId && <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground"><CheckCircle2 className="w-3 h-3" />Completed</p>}
              {operation.state === 'failed' && <p className="mt-1 flex items-center gap-1 text-[11px] text-destructive"><AlertCircle className="w-3 h-3" />Failed</p>}
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}
