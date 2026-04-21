
import { RefreshCw } from 'lucide-react'
import { useSources } from '../../../contexts/SourceContext'

export const ScanningStatus: React.FC = () => {
  const { isScanning, scanProgress } = useSources()

  if (!isScanning || scanProgress.size === 0) return null

  // Get the first active progress
  const progressList = Array.from(scanProgress.values())
  const activeProgress = progressList[0]

  if (!activeProgress) return null

  return (
    <div className="hidden lg:flex items-center gap-3 px-4 py-1.5 bg-primary/10 border border-primary/20 rounded-full animate-in fade-in slide-in-from-left-4 duration-500 max-w-[300px]">
      <div className="relative flex items-center justify-center shrink-0">
        <RefreshCw className="w-4 h-4 text-primary animate-spin" />
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-1 h-1 bg-primary rounded-full animate-ping" />
        </div>
      </div>
      
      <div className="min-w-0 flex-1">
        <div className="flex justify-between items-center gap-4">
          <span className="text-[10px] font-bold text-primary uppercase tracking-wider truncate">
            {activeProgress.phase === 'fetching' ? 'Discovering' : 
             activeProgress.phase === 'analyzing' ? 'Analyzing' : 
             activeProgress.phase === 'processing' ? 'Processing' : 'Saving'}...
          </span>
          <span className="text-[10px] font-mono text-primary/70 shrink-0">
            {Math.round(activeProgress.percentage)}%
          </span>
        </div>
        <div className="h-1 w-full bg-primary/20 rounded-full mt-1 overflow-hidden">
          <div 
            className="h-full bg-primary transition-all duration-500 ease-out"
            style={{ width: `${activeProgress.percentage}%` }}
          />
        </div>
        {activeProgress.currentItem && (
          <div className="text-[9px] text-muted-foreground truncate mt-0.5 max-w-full italic">
            {activeProgress.currentItem}
          </div>
        )}
      </div>
    </div>
  )
}
