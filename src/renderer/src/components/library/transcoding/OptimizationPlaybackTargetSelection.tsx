import type { PlaybackTargetProfile } from '@main/types/playbackTarget'

export function OptimizationPlaybackTargetSelection({
  profiles,
  value,
  onChange,
  loading = false,
  disabled = false,
  error,
}: {
  profiles: PlaybackTargetProfile[]
  value: string
  onChange: (value: string) => void
  loading?: boolean
  disabled?: boolean
  error?: string | null
}) {
  return <label className="block space-y-1.5 text-xs font-semibold">Playback target
    <select aria-label="Playback target" value={value} onChange={event => onChange(event.target.value)} disabled={disabled || loading} aria-invalid={Boolean(error)} aria-describedby={error ? 'optimization-playback-target-error' : undefined} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground">
      <option value="">{loading ? 'Loading playback targets…' : 'No playback target'}</option>
      {profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
    </select>
    {error && <span id="optimization-playback-target-error" role="alert" className="block font-normal text-destructive">{error}</span>}
  </label>
}
