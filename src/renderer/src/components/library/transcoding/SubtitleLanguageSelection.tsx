import { useId, useState } from 'react'
import { Languages, X } from 'lucide-react'
import { formatLanguage, LANGUAGE_OPTIONS, parseLanguageWhitelist } from '../mediaUtils'

const COMMON_LANGUAGES = ['eng', 'heb', 'spa', 'fre', 'ger', 'ita', 'jpn', 'kor', 'zho', 'und']

export function SubtitleLanguageSelection({ value, onChange, disabled = false }: {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}) {
  const [input, setInput] = useState('')
  const inputId = useId()
  const languages = parseLanguageWhitelist(value)

  const add = (candidate: string) => {
    const additions = parseLanguageWhitelist(candidate)
    if (additions.length > 0) onChange([...new Set([...languages, ...additions])].join(', '))
    setInput('')
  }

  const remove = (language: string) => onChange(languages.filter(item => item !== language).join(', '))

  return <fieldset className="space-y-2" disabled={disabled}>
    <legend className="flex items-center gap-1.5 text-xs font-semibold"><Languages className="h-3.5 w-3.5 text-primary" aria-hidden="true" />Subtitles</legend>
    <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-lg border border-border/40 bg-background/60 p-2">
      {languages.map(language => <span key={language} className="inline-flex items-center gap-1 rounded-md border border-primary/20 bg-primary/10 px-2 py-1 text-xs text-primary">
        {formatLanguage(language)} ({language})
        <button type="button" onClick={() => remove(language)} aria-label={`Remove ${formatLanguage(language)} subtitle`} className="inline-flex min-h-6 min-w-6 items-center justify-center rounded-full hover:bg-primary/20 focus-visible:outline-2 focus-visible:outline-primary"><X className="h-3 w-3" aria-hidden="true" /></button>
      </span>)}
      <label className="sr-only" htmlFor={inputId}>Add subtitle languages</label>
      <input
        id={inputId}
        type="text"
        value={input}
        onChange={event => setInput(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ',') {
            event.preventDefault()
            add(input)
          }
        }}
        placeholder={languages.length ? 'Add language' : 'All subtitles'}
        aria-label="Add subtitle languages"
        className="min-w-32 flex-1 bg-transparent px-1 py-1 text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
      />
      {input.trim() && <button type="button" onClick={() => add(input)} className="inline-flex min-h-6 items-center rounded bg-primary px-2 py-1 text-xs font-semibold text-primary-foreground">Add</button>}
    </div>
    <div role="group" className="flex flex-wrap items-center gap-1" aria-label="Common subtitle languages">
      {COMMON_LANGUAGES.map(language => {
        const selected = languages.includes(language)
        const option = LANGUAGE_OPTIONS.find(item => item.code3 === language || item.code === language)
        const label = option?.label.replace(/\s*\([^)]*\)\s*$/, '') ?? formatLanguage(language)
        return <button key={language} type="button" aria-pressed={selected} onClick={() => selected ? remove(language) : add(language)} className={`min-h-6 rounded border px-2 py-1 text-[10px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${selected ? 'border-primary bg-primary/15 text-primary' : 'border-border/40 bg-card text-muted-foreground hover:bg-muted'}`}>
          {label} {selected ? '✓' : '+'}
        </button>
      })}
    </div>
  </fieldset>
}
