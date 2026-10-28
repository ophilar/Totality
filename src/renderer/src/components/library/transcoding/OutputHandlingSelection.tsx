import type { TranscodeOptions } from './types'

const choices: Array<{ value: NonNullable<TranscodeOptions['outputMode']>; title: string; description: string }> = [
  { value: 'replace', title: 'Replace original', description: 'Replaces the source file after the output is verified.' },
  { value: 'quarantine-replace', title: 'Replace with backup', description: 'Retains a timestamped original in quarantine.' },
  { value: 'copy', title: 'Create a copy', description: 'Keeps the original and writes a sibling file.' },
]

export function OutputHandlingSelection({ value, onChange }: {
  value: TranscodeOptions['outputMode']
  onChange: (value: NonNullable<TranscodeOptions['outputMode']>) => void
}) {
  return <fieldset className="space-y-2">
    <legend className="text-sm font-semibold">Output handling</legend>
    <div role="radiogroup" aria-label="Output handling" className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      {choices.map(choice => <button
        key={choice.value}
        type="button"
        role="radio"
        aria-checked={value === choice.value}
        onClick={() => onChange(choice.value)}
        className={`min-h-12 rounded-lg border p-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${value === choice.value ? 'border-primary bg-primary/10' : 'border-border/50 bg-muted/20 hover:bg-muted/40'}`}
      >
        <span className="block text-xs font-semibold">{choice.title}</span>
        <span className="mt-1 block text-xs text-muted-foreground">{choice.description}</span>
      </button>)}
    </div>
  </fieldset>
}
