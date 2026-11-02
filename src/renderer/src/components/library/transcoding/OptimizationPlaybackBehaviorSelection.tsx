import type { TranscodeOptions } from './types'

type PlaybackPolicy = NonNullable<TranscodeOptions['playbackPolicy']>

const PLAYBACK_POLICIES: readonly { value: PlaybackPolicy; label: string }[] = [
  { value: 'allow-transcoding', label: 'Let Plex adapt' },
  { value: 'avoid-video-transcoding', label: 'Avoid video transcoding' },
  { value: 'direct-play', label: 'Direct Play only' },
]

export function OptimizationPlaybackBehaviorSelection({ value, disabled, onChange }: {
  value: PlaybackPolicy
  disabled?: boolean
  onChange: (value: PlaybackPolicy) => void
}) {
  return <label className="block space-y-1.5 text-xs font-semibold">
    Playback behavior
    <select aria-label="Playback behavior" value={value} onChange={event => onChange(event.target.value as PlaybackPolicy)} disabled={disabled} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground">
      {PLAYBACK_POLICIES.map(policy => <option key={policy.value} value={policy.value}>{policy.label}</option>)}
    </select>
  </label>
}
