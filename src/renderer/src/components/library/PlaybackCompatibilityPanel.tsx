import { useEffect, useState } from 'react'
import type { PlaybackTargetProfile } from '@main/types/playbackTarget'
import type { PlaybackCompatibilityResult } from '@main/services/PlaybackCompatibilityService'

export function PlaybackCompatibilityPanel({ mediaId }: { mediaId: number }) {
  const [profiles, setProfiles] = useState<PlaybackTargetProfile[]>([])
  const [selected, setSelected] = useState('')
  const [result, setResult] = useState<PlaybackCompatibilityResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { void window.electronAPI.listPlaybackTargetProfiles().then(items => { setProfiles(items); setSelected(items[0]?.id || '') }).catch(e => setError(e instanceof Error ? e.message : String(e))) }, [])
  const analyze = async () => { if (!selected) return; setError(null); try { setResult(await window.electronAPI.analyzePlaybackCompatibility({ mediaItemId: mediaId, profileId: selected })) } catch (e) { setError(e instanceof Error ? e.message : String(e)) } }
  return <section className="mt-4 rounded-lg border border-border/50 p-4"><div className="flex items-center justify-between gap-3"><h3 className="font-semibold">Playback compatibility</h3><div className="flex gap-2"><select className="rounded border border-border bg-background px-2 py-1 text-sm" value={selected} onChange={e => setSelected(e.target.value)}>{profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select><button className="rounded bg-primary px-3 py-1 text-sm text-primary-foreground" onClick={() => void analyze()} disabled={!selected}>Analyze</button></div></div>{error && <p className="mt-2 text-sm text-destructive">{error}</p>}{result && <div className="mt-3 space-y-2 text-sm"><div>Profile assessment: <strong>{result.evaluation.overall}</strong></div><div>Presentation: <strong>{result.presentation}</strong></div>{result.providerDecisionError && <div className="text-muted-foreground">Plex decision unavailable: {result.providerDecisionError}</div>}<div className="grid grid-cols-2 gap-2">{Object.entries(result.evaluation.findings).map(([dimension, finding]) => <div key={dimension} className="rounded bg-muted/30 p-2"><span className="capitalize">{dimension}</span>: {finding.status}</div>)}</div></div>}</section>
}
