import { useEffect, useState } from 'react'
import { AlertTriangle, Cpu, RefreshCw } from 'lucide-react'
import type { TranscodingCapabilities } from '@main/services/TranscodingCapabilities'

export function TranscodingHardwareCard() {
  const [capabilities, setCapabilities] = useState<TranscodingCapabilities | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [selectingGpu, setSelectingGpu] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    window.electronAPI.getCapabilities()
      .then(value => { if (active) setCapabilities(value) })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : String(reason)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  const refresh = async () => {
    setRefreshing(true)
    setError(null)
    try {
      setCapabilities(await window.electronAPI.refreshCapabilities())
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setRefreshing(false)
    }
  }

  const selectGpu = async (gpuId: string | null) => {
    setSelectingGpu(true)
    setError(null)
    try {
      setCapabilities(await window.electronAPI.setSelectedGpu(gpuId))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setSelectingGpu(false)
    }
  }

  return (
    <section className="rounded-lg border border-border/40 bg-card/30 p-4" aria-labelledby="transcoding-hardware-title">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Cpu className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
          <div>
            <h3 id="transcoding-hardware-title" className="text-sm font-semibold">GPU optimization</h3>
            <p className="mt-1 text-xs text-muted-foreground">Select the GPU used for video encoding. Totality verifies available encoders through FFmpeg.</p>
          </div>
        </div>
        <button type="button" onClick={() => void refresh()} disabled={loading || refreshing} className="rounded p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-50" aria-label="Refresh hardware capabilities">
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>
      {loading ? (
        <p className="mt-3 text-xs text-muted-foreground">Detecting GPUs and verified encoders…</p>
      ) : capabilities && (
        <div className="mt-3 space-y-3 border-t border-border/30 pt-3">
          <label className="block text-xs font-medium text-muted-foreground" htmlFor="transcoding-gpu">Selected device</label>
          <select
            id="transcoding-gpu"
            value={capabilities.selectedGpuId ?? ''}
            onChange={event => void selectGpu(event.target.value || null)}
            disabled={selectingGpu || refreshing}
            className="w-full rounded-md border border-border/30 bg-background px-3 py-2 text-sm disabled:opacity-50"
          >
            <option value="">Software CPU encoding</option>
            {capabilities.gpus.map(gpu => (
              <option key={gpu.id} value={gpu.id}>{gpu.name} ({gpu.vendor})</option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            Verified encoders: {capabilities.verifiedEncoders.length ? capabilities.verifiedEncoders.join(', ') : 'none'}
          </p>
          {capabilities.probeFailures.length > 0 && (
            <div role="status" className="space-y-1 text-xs text-amber-500">
              {capabilities.probeFailures.map(failure => <p key={failure}>{failure}</p>)}
            </div>
          )}
        </div>
      )}
      {error && <p role="alert" className="mt-3 flex items-start gap-2 text-xs text-destructive"><AlertTriangle className="h-4 w-4 shrink-0" />{error}</p>}
    </section>
  )
}
