import { useState } from 'react'
import type { TVShowSummary } from './types'

export function ShowTranscodeModal({ show, onClose }: { show: TVShowSummary; onClose: () => void }) {
  const [codec, setCodec] = useState<'hevc' | 'av1' | ''>('')
  const [audio, setAudio] = useState<'all' | 'original-and-protected' | ''>('')
  const [language, setLanguage] = useState('')
  const [outputMode, setOutputMode] = useState<'copy' | 'quarantine-replace' | ''>('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    if (!show.source_id || !codec || !audio || !outputMode || (audio === 'original-and-protected' && !language.trim())) {
      setMessage('Choose a codec, audio policy, output mode, and original language when required.')
      return
    }
    setBusy(true); setMessage('')
    try {
      const preflight = await window.electronAPI.preflightShow({
        seriesTitle: show.series_title,
        seriesIdentityKey: (show as TVShowSummary & { series_identity_key?: string }).series_identity_key,
        sourceId: show.source_id,
        options: { targetCodec: codec, transcodingEngine: 'ffmpeg', outputMode, streamSelection: audio === 'all' ? { audio, subtitle: 'all', defaultSubtitle: 'preserve' } : { audio, originalLanguage: language.trim(), subtitle: 'all', defaultSubtitle: 'preserve' } }
      })
      if (!preflight.compatible) throw new Error(preflight.episodes.filter((episode: { compatible: boolean }) => !episode.compatible).map((episode: { reason?: string }) => episode.reason || 'Unknown incompatibility').join('; '))
      await window.electronAPI.queueShow(preflight.preflightId)
      setMessage(`Queued ${preflight.episodeCount} episodes.`)
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) } finally { setBusy(false) }
  }
  return <div className="fixed inset-0 z-150 flex items-center justify-center bg-black/60"><div className="w-full max-w-lg rounded-2xl bg-card p-6 space-y-4"><h2 className="text-lg font-semibold">Transcode {show.series_title}</h2><select value={codec} onChange={e => setCodec(e.target.value as 'hevc' | 'av1' | '')} className="w-full rounded-xl border bg-muted p-2"><option value="">Choose video codec</option><option value="hevc">HEVC</option><option value="av1">AV1</option></select><select value={audio} onChange={e => setAudio(e.target.value as 'all' | 'original-and-protected' | '')} className="w-full rounded-xl border bg-muted p-2"><option value="">Choose audio policy</option><option value="all">Copy all audio</option><option value="original-and-protected">Original language + protected tracks</option></select>{audio === 'original-and-protected' && <input value={language} onChange={e => setLanguage(e.target.value)} placeholder="Original language (ISO code)" className="w-full rounded-xl border bg-muted p-2" />}<select value={outputMode} onChange={e => setOutputMode(e.target.value as 'copy' | 'quarantine-replace' | '')} className="w-full rounded-xl border bg-muted p-2"><option value="">Choose output mode</option><option value="copy">Create sibling copy</option><option value="quarantine-replace">Replace after verification</option></select>{message && <p className="text-sm text-muted-foreground">{message}</p>}<div className="flex justify-end gap-2"><button onClick={onClose} className="rounded-xl bg-muted px-4 py-2">Close</button><button disabled={busy} onClick={() => void submit()} className="rounded-xl bg-primary px-4 py-2 text-primary-foreground">{busy ? 'Preflighting…' : 'Preflight and queue'}</button></div></div></div>
}
