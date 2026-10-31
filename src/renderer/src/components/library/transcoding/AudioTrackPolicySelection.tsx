export type AudioTrackPolicy = 'preferred' | 'all'

export interface AudioLanguageOption {
  value: string
  label: string
  group: string
}

export function AudioTrackPolicySelection({ policy, language, languages, disabled = false, onPolicyChange, onLanguageChange }: {
  policy: AudioTrackPolicy
  language: string
  languages: readonly AudioLanguageOption[]
  disabled?: boolean
  onPolicyChange: (policy: AudioTrackPolicy) => void
  onLanguageChange: (language: string) => void
}) {
  const groups = [...new Set(languages.map(option => option.group))]

  return <fieldset className="space-y-2" disabled={disabled}>
    <legend className="text-xs font-semibold">Audio tracks</legend>
    <label className="block space-y-1.5 text-xs font-semibold">Keep
      <select aria-label="Audio track policy" value={policy} onChange={event => onPolicyChange(event.target.value as AudioTrackPolicy)} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground">
        <option value="preferred">Preferred language and protected tracks</option>
        <option value="all">All audio tracks</option>
      </select>
    </label>
    {policy === 'preferred' && <label className="block space-y-1.5 text-xs font-semibold">Original audio language
      <select aria-label="Original audio language" value={language} onChange={event => onLanguageChange(event.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground">
        <option value="">Choose language</option>
        {groups.map(group => <optgroup key={group} label={group}>{languages.filter(option => option.group === group).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</optgroup>)}
      </select>
    </label>}
  </fieldset>
}
