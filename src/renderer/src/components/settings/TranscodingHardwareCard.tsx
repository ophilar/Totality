import { useEffect, useState } from 'react'
import { Cpu, RefreshCw, AlertTriangle } from 'lucide-react'
import type { TranscodingCapabilities } from '@main/services/TranscodingCapabilities'
import type { GpuInfo } from '@main/services/utils/GpuDetector'

export function TranscodingHardwareCard() {
  const [capabilities, setCapabilities] = useState<TranscodingCapabilities | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = async (refresh = false) => {
    setError(null)
    refresh ? setRefreshing(true) : setLoading(true)
    try {
      const next = refresh
        ? await window.electronAPI.refreshCapabilities()
        : await window.electronAPI.getCapabilities()
      setCapabilities(next)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => { queueMicrotask(() => { void load() }) }, [])

  const selectGpu = async (value: string) => {
    try {
      const gpuId = (value && value !== 'undefined') ? value : null
      setCapabilities(await window.electronAPI.setSelectedGpu(gpuId))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return (
    <div className="border border-border/40 rounded-lg overflow-hidden bg-card/30">
      <div className="flex items-center gap-3 p-4">
        <Cpu className="w-5 h-5 text-muted-foreground shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm">Transcoding hardware</p>
          <p className="text-xs text-muted-foreground">One verified GPU selection is used throughout the app.</p>
        </div>
        <button type="button" onClick={() => void load(true)} disabled={loading || refreshing} className="p-2 rounded-md hover:bg-muted disabled:opacity-50" aria-label="Refresh hardware capabilities">
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>
      <div className="px-4 pb-4 space-y-3 border-t border-border/30 pt-3">
        {loading ? <p className="text-xs text-muted-foreground">Detecting verified encoders...</p> : capabilities && <>
          <label className="block text-xs font-medium text-muted-foreground">Selected device</label>
          <select value={capabilities.selectedGpuId || ''} onChange={(event) => void selectGpu(event.target.value)} className="w-full px-3 py-2 bg-background border border-border/30 rounded-md text-sm">
            <option value="">Software CPU encoding</option>
            {(capabilities.gpus || []).map((gpu: GpuInfo) => <option key={gpu.id} value={gpu.id}>{gpu.name} ({gpu.vendor})</option>)}
          </select>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            <div><span className="text-muted-foreground">Engines:</span> {capabilities.engines.join(', ') || 'none'}</div>
            <div><span className="text-muted-foreground">Encoders:</span> {capabilities.encoders.join(', ') || 'none'}</div>
          </div>
          <p className="text-[10px] text-muted-foreground">Snapshot: {new Date(capabilities.detectedAt).toLocaleString()}</p>
        </>}
        {error && <div className="flex gap-2 items-start text-xs text-red-400"><AlertTriangle className="w-4 h-4 shrink-0" />{error}</div>}
      </div>
    </div>
  )
}
