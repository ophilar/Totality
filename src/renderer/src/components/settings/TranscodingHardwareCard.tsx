import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import type { TranscodingCapabilities } from '@main/services/TranscodingCapabilities'

export function TranscodingHardwareCard() {
  const [capabilities, setCapabilities] = useState<TranscodingCapabilities | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const refresh = async () => {
    setRefreshing(true)
    setError(null)
    try { setCapabilities(await window.electronAPI.transcodingGetCapabilities(true)) }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setRefreshing(false) }
  }

  useEffect(() => {
    let active = true
    window.electronAPI.transcodingGetCapabilities().then(value => { if (active) setCapabilities(value) }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : String(reason)) })
    return () => { active = false }
  }, [])

  return <section className="rounded-lg border border-border/40 bg-card/30 p-4" aria-labelledby="transcoding-hardware-title">
    <div className="flex items-start justify-between gap-3"><div><h3 id="transcoding-hardware-title" className="text-sm font-semibold">Transcoding hardware</h3><p className="mt-1 text-xs text-muted-foreground">Detected devices and encoders verified by FFmpeg.</p></div><button onClick={refresh} disabled={refreshing} className="rounded p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-50" aria-label="Refresh transcoding hardware">{refreshing ? <RefreshCw className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}</button></div>
    {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
    {capabilities && <div className="mt-3 space-y-2 text-sm"><p>FFmpeg: {capabilities.ffmpeg ? 'available' : 'unavailable'}</p><p>GPUs: {capabilities.gpus.length ? capabilities.gpus.map(gpu => `${gpu.name} (${gpu.vendor})`).join(', ') : 'None detected'}</p><p>Verified encoders: {capabilities.verifiedEncoders.length ? capabilities.verifiedEncoders.join(', ') : 'None verified'}</p>{capabilities.probeFailures.length > 0 && <ul className="list-disc pl-5 text-xs text-destructive">{capabilities.probeFailures.map(message => <li key={message}>{message}</li>)}</ul>}</div>}
  </section>
}
