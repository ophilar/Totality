import type { TranscodeOptions } from './types'
import { Check, Film, Sparkles, Video } from 'lucide-react'
import { OPTIMIZATION_CHOICE_ACCENTS } from './optimizationChoiceAccents'

export type OptimizationMethod = NonNullable<TranscodeOptions['optimizationMode']>

export const OPTIMIZATION_METHODS: ReadonlyArray<{ value: OptimizationMethod; label: string; description: string; accent: keyof typeof OPTIMIZATION_CHOICE_ACCENTS }> = [
  { value: 'smart', label: 'Smart', description: 'Reduce file size when measured results meet your quality setting.', accent: 'recommended' },
  { value: 'remux_only', label: 'Keep video', description: 'Clean up audio and subtitles without re-encoding video.', accent: 'preserve' },
  { value: 'transcode', label: 'Re-encode video', description: 'Compress video using your selected quality.', accent: 'compress' },
]

export function OptimizationMethodSelection({ value, onChange, disabled = false }: {
  value: OptimizationMethod
  onChange: (value: OptimizationMethod) => void
  disabled?: boolean
}) {
  return <fieldset className="space-y-2">
    <legend className="text-sm font-semibold">Optimization method</legend>
    <div role="radiogroup" aria-label="Optimization method" className="grid gap-2 sm:grid-cols-3">
      {OPTIMIZATION_METHODS.map(method => {
        const Icon = method.value === 'smart' ? Sparkles : method.value === 'remux_only' ? Film : Video
        return <label key={method.value} className={`flex min-h-24 cursor-pointer items-start gap-3 rounded-lg border px-3 py-3 text-sm focus-within:ring-2 focus-within:ring-primary ${value === method.value ? 'border-primary bg-muted/40' : 'border-border/60 bg-card hover:bg-muted/30'} ${disabled ? 'cursor-not-allowed' : ''}`}>
          <input type="radio" name="optimization-method" value={method.value} checked={value === method.value} disabled={disabled} onChange={() => onChange(method.value)} className="sr-only" />
          <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${OPTIMIZATION_CHOICE_ACCENTS[method.accent]}`} aria-hidden="true" />
          <span className="min-w-0 flex-1 space-y-1">
            <span className="flex items-center justify-between gap-2">
              <span className="font-semibold">{method.label}</span>
              {value === method.value && <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />}
            </span>
            <span className="block text-xs leading-5 text-muted-foreground">{method.description}</span>
          </span>
        </label>
      })}
    </div>
  </fieldset>
}
