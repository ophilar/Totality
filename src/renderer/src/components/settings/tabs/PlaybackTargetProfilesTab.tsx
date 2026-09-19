import { useEffect, useState } from 'react'
import type { PlaybackTargetProfile } from '@main/types/playbackTarget'

export function PlaybackTargetProfilesTab() {
  const [profiles, setProfiles] = useState<PlaybackTargetProfile[]>([])
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { void window.electronAPI.listPlaybackTargetProfiles().then(setProfiles).catch(e => setError(e instanceof Error ? e.message : String(e))) }, [])
  const duplicate = async (profile: PlaybackTargetProfile) => { try { const copy = await window.electronAPI.duplicatePlaybackTargetProfile({ id: profile.id, name: `${profile.name} copy` }); setProfiles(current => [...current, copy]) } catch (e) { setError(e instanceof Error ? e.message : String(e)) } }
  return <div className="space-y-4"><div><h2 className="text-lg font-semibold">Playback targets</h2><p className="text-sm text-muted-foreground">Declared capabilities used to assess media compatibility.</p></div>{error && <p className="text-sm text-destructive">{error}</p>}<div className="space-y-2">{profiles.map(profile => <div key={profile.id} className="flex items-center justify-between rounded-lg border border-border/50 p-3"><div><div className="font-medium">{profile.name}</div><div className="text-xs text-muted-foreground">{profile.isBuiltin ? 'Bundled baseline · read-only' : 'User profile'}</div></div>{profile.isBuiltin && <button className="text-sm text-primary" onClick={() => void duplicate(profile)}>Duplicate</button>}</div>)}</div></div>
}
