export type OptimizationContainerOption = { value: string; label: string }

export function OptimizationContainerSelection({ value, options, placeholder, disabled = false, onChange }: {
  value: string
  options: readonly OptimizationContainerOption[]
  placeholder?: string
  disabled?: boolean
  onChange: (value: string) => void
}) {
  return <label className="block space-y-1.5 text-xs font-semibold">Container
    <select aria-label="Container" value={value} disabled={disabled} onChange={event => onChange(event.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-normal disabled:opacity-50">
      {placeholder && <option value="">{placeholder}</option>}
      {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  </label>
}
