import type { TranscodeOptions } from './types'
import { Check, Copy, FileWarning, ShieldCheck } from 'lucide-react'
import { OPTIMIZATION_CHOICE_ACCENTS } from './optimizationChoiceAccents'

export const OUTPUT_HANDLING_CHOICES: ReadonlyArray<{ value: NonNullable<TranscodeOptions['outputMode']>; title: string; description: string }> = [
  { value: 'replace', title: 'Replace original', description: 'Use the new file after it is verified.' },
  { value: 'quarantine-replace', title: 'Replace and keep backup', description: 'Keep the original as a backup.' },
  { value: 'copy', title: 'Save a copy', description: 'Keep the original unchanged.' },
]

export function OutputHandlingSelection({ value, onChange, disabled = false }: {
  value: TranscodeOptions['outputMode']
  onChange: (value: NonNullable<TranscodeOptions['outputMode']>) => void
  disabled?: boolean
}) {
  const accents = {
    replace: { icon: FileWarning, color: OPTIMIZATION_CHOICE_ACCENTS.compress },
    'quarantine-replace': { icon: ShieldCheck, color: OPTIMIZATION_CHOICE_ACCENTS.recommended },
    copy: { icon: Copy, color: OPTIMIZATION_CHOICE_ACCENTS.preserve },
  }
  return <fieldset className="space-y-2">
    <legend className="text-sm font-semibold">Save output</legend>
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      {OUTPUT_HANDLING_CHOICES.map(choice => {
        const AccentIcon = accents[choice.value].icon
        return <label key={choice.value} className={`cursor-pointer ${disabled ? 'cursor-not-allowed' : ''}`}>
        <input type="radio" name="optimization-output-handling" value={choice.value} checked={value === choice.value} onChange={() => onChange(choice.value)} disabled={disabled} className="peer sr-only" />
        <span className={`block min-h-12 rounded-lg border p-3 text-left ${value === choice.value ? 'border-primary bg-muted/40' : 'border-border/60 bg-card hover:bg-muted/30'} peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary`}>
          <span className="flex items-center justify-between gap-2 text-xs font-semibold"><span className="flex items-center gap-2"><AccentIcon className={`h-4 w-4 ${accents[choice.value].color}`} aria-hidden="true" />{choice.title}</span>{value === choice.value && <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />}</span>
          <span className="mt-1 block text-xs text-muted-foreground">{choice.description}</span>
        </span>
      </label>})}
    </div>
  </fieldset>
}
