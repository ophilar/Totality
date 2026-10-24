import { useEffect, useState } from 'react'
import type { PlaybackTargetEvaluation, PlaybackTargetProfile } from '@main/types/playbackTarget'
import type { PlaybackCompatibilityResult } from '@main/services/PlaybackCompatibilityService'

export function PlaybackCompatibilityFindings({ evaluation, targetName }: { evaluation: PlaybackTargetEvaluation; targetName?: string }) {
  return (
    <details className="rounded-lg border border-border/40 bg-muted/20 p-3">
      <summary className="cursor-pointer text-sm font-medium">{targetName ? `${targetName} · ` : ''}Target compatibility: {evaluation.overall}</summary>
      <div className="mt-3 space-y-2">
        {Object.entries(evaluation.findings).map(([dimension, finding]) => (
          <details key={dimension} className="rounded-md border border-border/30 bg-background/50 p-2 text-xs">
            <summary className="cursor-pointer capitalize">{dimension}: {finding.status}</summary>
            <p className="mt-2 text-muted-foreground">{finding.rule}</p>
            <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap break-words text-muted-foreground">{finding.evidence}</pre>
          </details>
        ))}
      </div>
    </details>
  )
}

export function PlaybackCompatibilityPanel({ mediaId }: { mediaId: number }) {
  const [profiles, setProfiles] = useState<PlaybackTargetProfile[]>([])
  const [selected, setSelected] = useState('')
  const [result, setResult] = useState<PlaybackCompatibilityResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { void window.electronAPI.listPlaybackTargetProfiles().then(items => { setProfiles(items); setSelected(items[0]?.id || '') }).catch(e => setError(e instanceof Error ? e.message : String(e))) }, [])
  useEffect(() => { if (!selected) return; void window.electronAPI.evaluatePlaybackCompatibility({ mediaItemId: mediaId, profileId: selected }).then(setResult).catch(e => setError(e instanceof Error ? e.message : String(e))) }, [mediaId, selected])
  return <section className="mt-4 rounded-lg border border-border/50 p-4"><div className="flex items-center justify-between gap-3"><h3 className="font-semibold">Playback compatibility</h3><select className="rounded border border-border bg-background px-2 py-1 text-sm" value={selected} onChange={e => { setSelected(e.target.value); setError(null) }}>{profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></div>{error && <p className="mt-2 text-sm text-destructive">{error}</p>}{result && <div className="mt-3 space-y-2 text-sm"><PlaybackCompatibilityFindings evaluation={result.evaluation} /><div>Presentation: <strong>{result.presentation}</strong></div>{result.providerDecisionError && <div className="text-muted-foreground">Plex decision unavailable: {result.providerDecisionError}</div>}</div>}</section>
}
