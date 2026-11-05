import { OptimizationAudioCodecSelection } from './OptimizationAudioCodecSelection'

export type OptimizationAudioCodec = 'aac' | 'ac3' | 'eac3'

export function OptimizationAudioConversionSelection({ enabled, codec, sourceCodec, options, disabled = false, onEnabledChange, onCodecChange }: {
  enabled: boolean
  codec: OptimizationAudioCodec | ''
  sourceCodec?: string | null
  options: readonly { value: OptimizationAudioCodec; label: string }[]
  disabled?: boolean
  onEnabledChange: (enabled: boolean) => void
  onCodecChange: (codec: OptimizationAudioCodec | '') => void
}) {
  return <div className="flex flex-wrap items-start gap-3 rounded-xl border border-border/40 bg-muted/20 p-4">
    <label className="flex min-w-0 flex-1 items-start gap-3 text-sm">
      <input type="checkbox" checked={enabled} disabled={disabled} onChange={event => {
        onEnabledChange(event.target.checked)
        if (!event.target.checked) onCodecChange('')
      }} className="mt-0.5" />
      <span className="min-w-0 flex-1">
        <span className="block font-medium">Convert audio</span>
        <span className="block text-xs text-muted-foreground">Protected tracks keep their source codec.</span>
      </span>
    </label>
    {enabled && <div className="w-full sm:w-56">
      <OptimizationAudioCodecSelection
        value={codec}
        placeholder={`Preserve source${sourceCodec ? ` (${sourceCodec})` : ''}`}
        options={options}
        disabled={disabled}
        onChange={value => onCodecChange(value as OptimizationAudioCodec | '')}
      />
    </div>}
  </div>
}
