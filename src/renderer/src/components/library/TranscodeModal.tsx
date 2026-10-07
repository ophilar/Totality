import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import type { MediaItem } from '@main/types/database'
import type { TranscodingCapabilities } from '@main/services/TranscodingCapabilities'
import type { TranscodeOptions } from '@main/services/TranscodingService'

interface Props { mediaItem: MediaItem; onClose: () => void }
interface Preflight { duration?: number; fileSize?: number; video?: { codec?: string; resolution?: string; hdrFormat?: string }; audio?: unknown[] }

export function TranscodeModal({ mediaItem, onClose }: Props) {
  const [capabilities, setCapabilities] = useState<TranscodingCapabilities | null>(null)
  const [preflight, setPreflight] = useState<Preflight | null>(null)
  const [mode, setMode] = useState<'remux_only' | 'transcode' | ''>('')
  const [codec, setCodec] = useState<'hevc' | 'av1' | ''>('')
  const [encoder, setEncoder] = useState('')
  const [gpuId, setGpuId] = useState('')
  const [progress, setProgress] = useState<number | null>(null)
  const [output, setOutput] = useState<{ outputPath: string; outputSize: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let active = true
    Promise.all([
      window.electronAPI.transcodingGetCapabilities(),
      window.electronAPI.transcodingPreflightRemux(mediaItem.id!),
    ]).then(([caps, evidence]) => {
      if (!active) return
      setCapabilities(caps)
      setPreflight(evidence as Preflight)
    }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : String(reason)) })
    const unsubscribe = window.electronAPI.onTranscodingProgress(event => {
      if (event.mediaItemId === mediaItem.id) setProgress(event.progress)
    })
    return () => { active = false; unsubscribe() }
  }, [mediaItem.id])

  const availableEncoders = (capabilities?.verifiedEncoders ?? []).filter(value => codec === 'hevc'
    ? /(?:hevc|h265|x265)/i.test(value)
    : codec === 'av1' ? /(?:av1|svt)/i.test(value) : false)
  const canSubmit = Boolean(preflight && mode && (mode === 'remux_only' || (codec && encoder && (encoder.startsWith('nvenc_') || encoder.startsWith('qsv_') ? gpuId : true))))

  const run = async () => {
    if (!mediaItem.id || !canSubmit) return
    setBusy(true)
    setProgress(0)
    setError(null)
    const options: TranscodeOptions = mode === 'remux_only'
      ? { optimizationMode: 'remux_only', encoder: 'remux', useGpu: false }
      : {
          optimizationMode: 'transcode', targetCodec: codec || undefined,
          encoder, useGpu: encoder.startsWith('nvenc_') || encoder.startsWith('qsv_'),
          ...(gpuId ? { gpuId } : {}),
        }
    try {
      setOutput(await window.electronAPI.transcodingTranscode(mediaItem.id, options, crypto.randomUUID()))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  return <div className="fixed inset-0 z-[250] flex items-center justify-center bg-black/70 p-4" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose() }}>
    <section className="w-full max-w-xl rounded-xl border border-border bg-card p-5 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="transcode-title">
      <header className="flex items-start justify-between gap-4">
        <div><h2 id="transcode-title" className="text-lg font-semibold">Optimize {mediaItem.title}</h2><p className="mt-1 text-sm text-muted-foreground">Creates a separate output file. Your source stays untouched.</p></div>
        <button className="rounded p-1 hover:bg-muted" onClick={onClose} disabled={busy} aria-label="Close"><X className="h-5 w-5" /></button>
      </header>
      {error && <p role="alert" className="mt-4 rounded bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
      {!preflight && !error && <p className="mt-5 text-sm text-muted-foreground">Checking source access and media details…</p>}
      {preflight && <div className="mt-5 space-y-4">
        <div className="rounded-md bg-muted/40 p-3 text-sm"><div>{preflight.video?.resolution || 'Unknown resolution'} · {preflight.video?.codec || 'Unknown codec'}</div><div className="text-muted-foreground">{preflight.fileSize?.toLocaleString() ?? 'Unknown'} bytes · {preflight.video?.hdrFormat || 'No HDR data'}</div></div>
        <label className="block text-sm">Operation<select className="mt-1 w-full rounded border border-border bg-background p-2" value={mode} onChange={event => setMode(event.target.value as typeof mode)}><option value="">Choose explicitly</option><option value="remux_only">Lossless remux</option><option value="transcode">Re-encode video</option></select></label>
        {mode === 'transcode' && <div className="grid grid-cols-2 gap-3">
          <label className="text-sm">Video codec<select className="mt-1 w-full rounded border border-border bg-background p-2" value={codec} onChange={event => { setCodec(event.target.value as typeof codec); setEncoder(''); setGpuId('') }}><option value="">Choose codec</option><option value="hevc">HEVC</option><option value="av1">AV1</option></select></label>
          <label className="text-sm">Verified encoder<select className="mt-1 w-full rounded border border-border bg-background p-2" value={encoder} onChange={event => { setEncoder(event.target.value); setGpuId('') }}><option value="">Choose encoder</option>{availableEncoders.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
          {(encoder.startsWith('nvenc_') || encoder.startsWith('qsv_')) && <label className="col-span-2 text-sm">GPU<select className="mt-1 w-full rounded border border-border bg-background p-2" value={gpuId} onChange={event => setGpuId(event.target.value)}><option value="">Choose GPU</option>{capabilities?.gpus.map(gpu => <option key={gpu.id} value={gpu.id}>{gpu.name}</option>)}</select></label>}
        </div>}
        {progress !== null && busy && <div className="text-sm">Progress: {progress}%</div>}
        {output && <div role="status" className="break-all rounded bg-muted/40 p-3 text-sm">Created {output.outputPath} ({output.outputSize.toLocaleString()} bytes){preflight.fileSize !== undefined && <span className="block">{output.outputSize < preflight.fileSize ? `${(preflight.fileSize - output.outputSize).toLocaleString()} bytes smaller than the source` : `${(output.outputSize - preflight.fileSize).toLocaleString()} bytes larger than the source`}</span>}</div>}
        <footer className="flex justify-end gap-2"><button className="rounded border border-border px-4 py-2 text-sm" onClick={onClose} disabled={busy}>Close</button><button className="rounded bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50" onClick={run} disabled={!canSubmit || busy || !!output}>{busy ? 'Working…' : 'Create output'}</button></footer>
      </div>}
    </section>
  </div>
}
