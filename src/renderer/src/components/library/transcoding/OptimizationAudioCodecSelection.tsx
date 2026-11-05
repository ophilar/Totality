export type OptimizationAudioCodecOption = { value: string; label: string }

export function OptimizationAudioCodecSelection({ value, options, placeholder, disabled = false, onChange }: {
  value: string
  options: readonly OptimizationAudioCodecOption[]
  placeholder: string
  disabled?: boolean
  onChange: (value: string) => void
}) {
  return <label className="block space-y-1.5 text-xs font-semibold">Audio
    <select aria-label="Audio" value={value} disabled={disabled} onChange={event => onChange(event.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground disabled:opacity-50">
      <option value="">{placeholder}</option>
      {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  </label>
}
