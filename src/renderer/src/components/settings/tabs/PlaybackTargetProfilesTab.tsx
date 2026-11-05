import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronRight, Monitor, Pencil, Plus, RotateCcw, Save, Star, Trash2 } from 'lucide-react'
import type { PlaybackTargetDefinition, PlaybackTargetProfile } from '@main/types/playbackTarget'
import { playbackTargetProfileInputSchema } from '@shared/playbackTargetValidation'

type Draft = {
  name: string
  definition: PlaybackTargetDefinition
  text: Record<string, string>
  containerRulesText: string
  choices: {
    hdrFallbackRequired?: boolean
    objectAudio?: boolean
    outputPath?: PlaybackTargetDefinition['audio']['outputPath']
    subtitlesEmbedded?: boolean
    subtitlesExternal?: boolean
    subtitlesBurnIn?: boolean
  }
}

const listKeys = [
  'containers', 'video.codecs', 'video.profiles', 'video.levels', 'video.bitDepths',
  'hdr.formats', 'audio.codecs', 'subtitles.formats',
] as const

function valuesFrom(definition: PlaybackTargetDefinition): Record<string, string> {
  return {
    containers: definition.containers.join(', '),
    'video.codecs': definition.video.codecs.join(', '),
    'video.profiles': definition.video.profiles.join(', '),
    'video.levels': definition.video.levels.join(', '),
    'video.bitDepths': definition.video.bitDepths.join(', '),
    'hdr.formats': definition.hdr.formats.join(', '),
    'audio.codecs': definition.audio.codecs.join(', '),
    'subtitles.formats': definition.subtitles.formats.join(', '),
    'video.maxWidth': String(definition.video.maxWidth || ''),
    'video.maxHeight': String(definition.video.maxHeight || ''),
    'video.maxFrameRate': String(definition.video.maxFrameRate || ''),
    'audio.maxChannels': String(definition.audio.maxChannels || ''),
    'network.mbps': definition.network.sustainableBitrate ? String(definition.network.sustainableBitrate / 1_000_000) : '',
    'client.product': definition.client?.product ?? '',
    'client.platform': definition.client?.platform ?? '',
    'client.version': definition.client?.version ?? '',
  }
}

function createDraft(name: string, definition: PlaybackTargetDefinition): Draft {
  return {
    name, definition: structuredClone(definition), text: valuesFrom(definition),
    containerRulesText: JSON.stringify(definition.video.containerRules ?? [], null, 2),
    choices: {
      hdrFallbackRequired: definition.hdr.fallbackRequired,
      objectAudio: definition.audio.objectAudio,
      outputPath: definition.audio.outputPath,
      subtitlesEmbedded: definition.subtitles.embedded,
      subtitlesExternal: definition.subtitles.external,
      subtitlesBurnIn: definition.subtitles.burnIn,
    },
  }
}

function emptyDefinition(): PlaybackTargetDefinition {
  return {
    containers: [],
    video: { codecs: [], profiles: [], levels: [], maxWidth: 0, maxHeight: 0, maxFrameRate: 0, bitDepths: [] },
    hdr: { formats: [], fallbackRequired: false },
    audio: { codecs: [], maxChannels: 0, objectAudio: false, outputPath: 'device' },
    subtitles: { formats: [], embedded: false, external: false, burnIn: false },
    network: { sustainableBitrate: 0 },
  }
}

function buildDefinition(draft: Draft): { definition?: PlaybackTargetDefinition; error?: string } {
  const parsed: Record<string, string[] | number[]> = {}
  for (const key of listKeys) {
    const raw = draft.text[key].trim()
    const tokens = raw ? raw.split(',').map(value => value.trim()) : []
    if (tokens.some(value => !value)) return { error: `Remove the empty entry in ${key}.` }
    if (key === 'video.levels' || key === 'video.bitDepths') {
      const numbers = tokens.map(Number)
      if (numbers.some(value => !Number.isFinite(value) || value <= 0)) return { error: `${key} must contain positive numbers.` }
      parsed[key] = numbers
    } else parsed[key] = [...new Set(tokens)]
  }
  const numericFields = ['video.maxWidth', 'video.maxHeight', 'video.maxFrameRate', 'audio.maxChannels', 'network.mbps'] as const
  const numbers = Object.fromEntries(numericFields.map(key => [key, Number(draft.text[key])])) as Record<typeof numericFields[number], number>
  if (numericFields.some(key => !draft.text[key].trim() || !Number.isFinite(numbers[key]) || numbers[key] <= 0)) return { error: 'Enter positive values for every numeric limit.' }

  let containerRules: PlaybackTargetDefinition['video']['containerRules']
  try {
    containerRules = JSON.parse(draft.containerRulesText) as PlaybackTargetDefinition['video']['containerRules']
    if (!Array.isArray(containerRules)) return { error: 'Container rules must be a JSON array.' }
  } catch {
    return { error: 'Container rules contain invalid JSON.' }
  }
  const base = structuredClone(draft.definition)
  const choices = draft.choices
  if (choices.hdrFallbackRequired === undefined || choices.objectAudio === undefined || choices.outputPath === undefined
    || choices.subtitlesEmbedded === undefined || choices.subtitlesExternal === undefined || choices.subtitlesBurnIn === undefined) {
    return { error: 'Choose each HDR, audio, and subtitle capability before saving.' }
  }
  base.hdr.fallbackRequired = choices.hdrFallbackRequired
  base.audio.objectAudio = choices.objectAudio
  base.audio.outputPath = choices.outputPath
  base.subtitles.embedded = choices.subtitlesEmbedded
  base.subtitles.external = choices.subtitlesExternal
  base.subtitles.burnIn = choices.subtitlesBurnIn
  const text = draft.text
  base.containers = parsed.containers as string[]
  base.video.codecs = parsed['video.codecs'] as string[]
  base.video.profiles = parsed['video.profiles'] as string[]
  base.video.levels = parsed['video.levels'] as number[]
  base.video.bitDepths = parsed['video.bitDepths'] as number[]
  base.video.maxWidth = numbers['video.maxWidth']
  base.video.maxHeight = numbers['video.maxHeight']
  base.video.maxFrameRate = numbers['video.maxFrameRate']
  base.video.containerRules = containerRules.length ? containerRules : undefined
  base.hdr.formats = parsed['hdr.formats'] as string[]
  base.audio.codecs = parsed['audio.codecs'] as string[]
  base.audio.maxChannels = numbers['audio.maxChannels']
  base.subtitles.formats = parsed['subtitles.formats'] as string[]
  base.network.sustainableBitrate = Math.round(numbers['network.mbps'] * 1_000_000)
  const client = {
    product: text['client.product'].trim(),
    platform: text['client.platform'].trim(),
    version: text['client.version'].trim(),
  }
  if (Object.values(client).some(Boolean)) {
    if (Object.values(client).some(value => !value)) return { error: 'Complete all client identity fields or clear all three.' }
    base.client = client
  } else delete base.client
  if (!draft.name.trim()) return { error: 'Profile name is required.' }
  for (const key of ['containers', 'video.codecs', 'video.profiles', 'video.levels', 'video.bitDepths', 'audio.codecs'] as const) {
    if (!(parsed[key] as unknown[]).length) return { error: `${key} is required.` }
  }
  const validation = playbackTargetProfileInputSchema.safeParse({ name: draft.name, definition: base })
  if (!validation.success) return { error: validation.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join(' · ') }
  return { definition: validation.data.definition as PlaybackTargetDefinition }
}

function TextField({ label, value, onChange, type = 'text', unit }: { label: string; value: string; onChange: (value: string) => void; type?: string; unit?: string }) {
  return <label className="block min-w-0 space-y-1.5 text-sm font-medium text-foreground">{label}<div className="flex"><input type={type} step={type === 'number' ? 'any' : undefined} value={value} onChange={event => onChange(event.target.value)} className="w-full min-w-0 rounded-md border border-border/60 bg-background px-3 py-2 font-normal shadow-sm transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary" />{unit && <span className="flex items-center rounded-r-md border border-l-0 border-border/60 bg-muted/50 px-3 text-xs text-muted-foreground">{unit}</span>}</div></label>
}

function ListField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <TextField label={label} value={value} onChange={onChange} />
}

function ChoiceSelect({ label, value, onChange }: { label: string; value?: boolean; onChange: (value: boolean | undefined) => void }) {
  return <label className="block min-w-0 space-y-1.5 text-sm font-medium text-foreground">{label}<select value={value === undefined ? '' : String(value)} onChange={event => onChange(event.target.value === '' ? undefined : event.target.value === 'true')} className="w-full rounded-md border border-border/60 bg-background px-3 py-2 font-normal shadow-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary"><option value="">Choose</option><option value="true">Yes</option><option value="false">No</option></select></label>
}

function ProfileSummaryCard({ title, items }: { title: string; items: Array<{ label: string; value: string }> }) {
  return <section className="rounded-lg border border-border/40 bg-card/30 p-3.5">
    <h4 className="text-sm font-semibold">{title}</h4>
    <dl className="mt-3 space-y-2 text-xs">
      {items.map(item => <div key={item.label} className="flex items-start justify-between gap-3"><dt className="shrink-0 text-muted-foreground">{item.label}</dt><dd className="min-w-0 text-right text-foreground">{item.value}</dd></div>)}
    </dl>
  </section>
}

export function PlaybackTargetProfilesTab({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) {
  const [profiles, setProfiles] = useState<PlaybackTargetProfile[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [defaultProfileId, setDefaultProfileId] = useState<string | null>(null)
  const [pendingProfileAction, setPendingProfileAction] = useState<(() => void) | null>(null)

  const loadProfiles = useCallback(async () => {
    const [loaded, storedDefault] = await Promise.all([
      window.electronAPI.listPlaybackTargetProfiles(),
      window.electronAPI.getSetting('optimization_default_target_profile_id'),
    ])
    setProfiles(loaded)
    setDefaultProfileId(storedDefault || null)
    setSelectedId(current => current && loaded.some(profile => profile.id === current) ? current : loaded[0]?.id ?? null)
    setError(storedDefault && !loaded.some(profile => profile.id === storedDefault) ? 'The saved default profile no longer exists. Choose a replacement with its star.' : null)
    return loaded
  }, [])

  useEffect(() => { void loadProfiles().catch(e => setError(e instanceof Error ? e.message : String(e))) }, [loadProfiles])

  const runProfileAction = (action: () => void) => {
    if (hasUnsavedChanges()) { setPendingProfileAction(() => action); return }
    action()
  }

  const selectProfile = (profile: PlaybackTargetProfile) => runProfileAction(() => {
    setSelectedId(profile.id)
    setDraft(null)
    setError(null)
  })

  const createProfile = () => runProfileAction(() => {
    setSelectedId(null)
    setDraft({ ...createDraft('', emptyDefinition()), choices: {} })
    setError(null)
  })
  const updateChoice = <K extends keyof Draft['choices']>(key: K, value: Draft['choices'][K]) => {
    setDraft(current => current ? { ...current, choices: { ...current.choices, [key]: value } } : current)
  }

  const save = async (): Promise<boolean> => {
    if (!draft) return false
    const parsed = buildDefinition(draft)
    if (parsed.error || !parsed.definition) { setError(parsed.error ?? 'Profile definition is incomplete.'); return false }
    setIsSaving(true)
    setError(null)
    try {
      let savedId = selectedId
      if (selectedId) await window.electronAPI.updatePlaybackTargetProfile({ id: selectedId, name: draft.name.trim(), definition: parsed.definition })
      else {
        const created = await window.electronAPI.createPlaybackTargetProfile({ name: draft.name.trim(), definition: parsed.definition })
        savedId = created.id
        setSelectedId(savedId)
      }
      const loaded = await loadProfiles()
      const saved = loaded.find(profile => profile.id === savedId)
      if (saved) setDraft(null)
      return true
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); return false } finally { setIsSaving(false) }
  }

  const remove = async () => {
    if (!selectedId || !window.confirm('Delete this playback profile?')) return
    try { await window.electronAPI.deletePlaybackTargetProfile(selectedId); setDraft(null); setSelectedId(null); await loadProfiles() }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }

  const setDefault = async (profileId: string) => {
    try {
      await window.electronAPI.setSetting('optimization_default_target_profile_id', profileId)
      setDefaultProfileId(profileId)
      setError(null)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }

  const selectedProfile = profiles.find(profile => profile.id === selectedId)
  function hasUnsavedChanges(): boolean {
    if (!draft) return false
    if (!selectedProfile) return true
    return JSON.stringify(draft) !== JSON.stringify(createDraft(selectedProfile.name, selectedProfile.definition))
  }
  const dirtyState = hasUnsavedChanges()
  const lastDirtyState = useRef(dirtyState)
  useEffect(() => {
    if (lastDirtyState.current === dirtyState) return
    lastDirtyState.current = dirtyState
    onDirtyChange(dirtyState)
  }, [dirtyState, onDirtyChange])
  const field = (key: string) => draft?.text[key] ?? ''
  const setText = (key: string, value: string) => setDraft(current => current ? { ...current, text: { ...current.text, [key]: value } } : current)
  const editSelectedProfile = () => {
    if (selectedProfile) setDraft(createDraft(selectedProfile.name, selectedProfile.definition))
  }

  const sectionClass = 'space-y-4 rounded-xl border border-border/40 bg-muted/20 p-4'
  const sectionTitleClass = 'text-sm font-semibold text-foreground'
  const selectClass = 'mt-1.5 w-full rounded-md border border-border/60 bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary'
  const secondaryButtonClass = 'inline-flex items-center justify-center gap-2 rounded-lg border border-border/60 bg-background px-3 py-2 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary disabled:pointer-events-none disabled:opacity-50'
  const primaryButtonClass = 'inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary disabled:pointer-events-none disabled:opacity-50'

  return <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-hidden p-5">
    <header className="flex items-start gap-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Monitor className="h-5 w-5" aria-hidden="true" /></span>
      <div><h2 className="text-lg font-semibold tracking-tight">Playback targets</h2><p className="mt-0.5 text-sm text-muted-foreground">Set the formats and limits each player supports.</p></div>
    </header>
    {error && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>}
    {pendingProfileAction && <div role="dialog" aria-modal="true" aria-labelledby="profile-unsaved-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"><section className="w-full max-w-md space-y-4 rounded-xl border border-border bg-card p-5 shadow-xl"><h3 id="profile-unsaved-title" className="font-semibold">Unsaved playback profile</h3><p className="text-sm text-muted-foreground">Save your changes before switching profiles?</p><div className="flex flex-wrap justify-end gap-2"><button type="button" className={secondaryButtonClass} onClick={() => setPendingProfileAction(null)}>Keep editing</button><button type="button" className={secondaryButtonClass} onClick={() => { const action = pendingProfileAction; setPendingProfileAction(null); action() }}>Discard</button><button type="button" disabled={isSaving} className={primaryButtonClass} onClick={() => void save().then(saved => { if (saved && pendingProfileAction) { const action = pendingProfileAction; setPendingProfileAction(null); action() } })}>{isSaving ? 'Saving…' : 'Save'}</button></div></section></div>}
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-hidden lg:grid-cols-[230px_minmax(0,1fr)]">
      <aside className="min-h-0 overflow-y-auto pr-1">
        <section className="overflow-hidden rounded-lg border border-border/40 bg-card/30">
          <div className="flex items-center justify-between border-b border-border/30 px-4 py-3"><h3 className="text-sm font-semibold">Profiles</h3><button type="button" aria-label="Create profile" title="Create profile" onClick={createProfile} className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"><Plus className="h-4 w-4" /></button></div>
          <div className="space-y-1 p-2">{profiles.map(profile => {
            const isDefault = defaultProfileId === profile.id
            return <div key={profile.id} className={`flex items-center gap-1 rounded-md border transition-colors ${selectedId === profile.id ? 'border-primary/50 bg-primary/10' : 'border-transparent hover:border-border/40 hover:bg-muted/30'}`}>
              <button type="button" aria-current={selectedId === profile.id ? 'true' : undefined} className="flex min-w-0 flex-1 items-center gap-2.5 px-2.5 py-3 text-left" onClick={() => selectProfile(profile)}><span className="truncate text-sm font-medium">{profile.name}</span><ChevronRight className="ml-auto h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" /></button>
              <button type="button" aria-label={isDefault ? `${profile.name} is the default playback target` : `Set ${profile.name} as the default playback target`} aria-pressed={isDefault} title={isDefault ? 'Default playback target' : 'Set as default playback target'} disabled={isDefault} onClick={() => void setDefault(profile.id)} className="mr-1.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-amber-400 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-default disabled:text-amber-400"><Star className={`h-4 w-4 ${isDefault ? 'fill-current' : ''}`} aria-hidden="true" /></button>
            </div>
          })}</div>
        </section>
      </aside>
      <section className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-border/40 bg-card/30">
        {!draft ? <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 sm:p-5">{selectedProfile ? <>
          <header className="flex items-center justify-between gap-3 border-b border-border/30 pb-3"><div className="flex min-w-0 items-center gap-2"><Monitor className="h-5 w-5 shrink-0 text-muted-foreground" /><h3 className="truncate text-base font-semibold">{selectedProfile.name}</h3></div><div className="flex shrink-0 items-center gap-2"><button type="button" onClick={editSelectedProfile} className={primaryButtonClass}><Pencil className="h-4 w-4" />Edit</button><button type="button" aria-label={`Delete ${selectedProfile.name}`} title="Delete profile" onClick={() => void remove()} className="flex h-9 w-9 items-center justify-center rounded-lg border border-destructive/40 text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-destructive"><Trash2 className="h-4 w-4" /></button></div></header>
          <div className="grid gap-3 sm:grid-cols-2">
            <ProfileSummaryCard title="Video" items={[{ label: 'Containers', value: selectedProfile.definition.containers.join(', ') }, { label: 'Codecs', value: selectedProfile.definition.video.codecs.join(', ') }, { label: 'Resolution', value: `${selectedProfile.definition.video.maxWidth} × ${selectedProfile.definition.video.maxHeight}` }, { label: 'Frame rate', value: `Up to ${selectedProfile.definition.video.maxFrameRate} fps` }]} />
            <ProfileSummaryCard title="HDR" items={[{ label: 'Formats', value: selectedProfile.definition.hdr.formats.join(', ') || 'None' }, { label: 'HDR fallback', value: selectedProfile.definition.hdr.fallbackRequired ? 'Required' : 'Not required' }]} />
            <ProfileSummaryCard title="Audio" items={[{ label: 'Codecs', value: selectedProfile.definition.audio.codecs.join(', ') }, { label: 'Channels', value: `Up to ${selectedProfile.definition.audio.maxChannels}` }, { label: 'Output path', value: selectedProfile.definition.audio.outputPath }, { label: 'Object audio', value: selectedProfile.definition.audio.objectAudio ? 'Supported' : 'Not supported' }]} />
            <ProfileSummaryCard title="Subtitles" items={[{ label: 'Formats', value: selectedProfile.definition.subtitles.formats.join(', ') || 'None' }, { label: 'Embedded', value: selectedProfile.definition.subtitles.embedded ? 'Supported' : 'Not supported' }, { label: 'External', value: selectedProfile.definition.subtitles.external ? 'Supported' : 'Not supported' }, { label: 'Burn in', value: selectedProfile.definition.subtitles.burnIn ? 'Supported' : 'Not supported' }]} />
            <ProfileSummaryCard title="Network" items={[{ label: 'Sustainable bitrate', value: `${(selectedProfile.definition.network.sustainableBitrate / 1_000_000).toLocaleString()} Mbps` }]} />
            {selectedProfile.definition.client && <ProfileSummaryCard title="Client identity" items={[{ label: 'Product', value: selectedProfile.definition.client.product }, { label: 'Platform', value: selectedProfile.definition.client.platform }, { label: 'Version', value: selectedProfile.definition.client.version }]} />}
          </div>
          {selectedProfile.definition.video.containerRules?.length ? <details className="rounded-lg border border-border/40 bg-card/30 p-3"><summary className="cursor-pointer text-sm font-medium">Container rules</summary><pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-xs text-muted-foreground">{JSON.stringify(selectedProfile.definition.video.containerRules, null, 2)}</pre></details> : null}
        </> : <div className="flex h-full flex-col items-center justify-center p-8 text-center"><Monitor className="mb-3 h-8 w-8 text-muted-foreground" /><p className="text-sm text-muted-foreground">Choose a profile or create one.</p></div>}</div> : <>
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 sm:p-5">
            <div><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Playback target</p><h3 className="mt-1 text-base font-semibold">{selectedId ? 'Edit profile' : 'New profile'}</h3></div>
            <section className={sectionClass}><h4 className={sectionTitleClass}>Profile</h4><TextField label="Profile name" value={draft.name} onChange={name => setDraft(current => current ? { ...current, name } : current)} /></section>
            <section className={sectionClass}><div><h4 className={sectionTitleClass}>Video</h4><p className="mt-0.5 text-xs text-muted-foreground">Supported formats and maximum picture size.</p></div><div className="grid gap-4 sm:grid-cols-2"><ListField label="Containers" value={field('containers')} onChange={value => setText('containers', value)} /><ListField label="Codecs" value={field('video.codecs')} onChange={value => setText('video.codecs', value)} /><ListField label="Profiles" value={field('video.profiles')} onChange={value => setText('video.profiles', value)} /><ListField label="Levels" value={field('video.levels')} onChange={value => setText('video.levels', value)} /><ListField label="Bit depths" value={field('video.bitDepths')} onChange={value => setText('video.bitDepths', value)} /><TextField label="Maximum width" type="number" value={field('video.maxWidth')} onChange={value => setText('video.maxWidth', value)} unit="px" /><TextField label="Maximum height" type="number" value={field('video.maxHeight')} onChange={value => setText('video.maxHeight', value)} unit="px" /><TextField label="Maximum frame rate" type="number" value={field('video.maxFrameRate')} onChange={value => setText('video.maxFrameRate', value)} unit="fps" /></div></section>
            <section className={sectionClass}><div><h4 className={sectionTitleClass}>HDR</h4><p className="mt-0.5 text-xs text-muted-foreground">High dynamic range support and fallback behavior.</p></div><div className="grid gap-4 sm:grid-cols-2"><ListField label="Supported formats" value={field('hdr.formats')} onChange={value => setText('hdr.formats', value)} /><ChoiceSelect label="Require HDR fallback" value={draft.choices.hdrFallbackRequired} onChange={value => updateChoice('hdrFallbackRequired', value)} /></div></section>
            <section className={sectionClass}><div><h4 className={sectionTitleClass}>Audio</h4><p className="mt-0.5 text-xs text-muted-foreground">Codec support, channel limit, and output route.</p></div><div className="grid gap-4 sm:grid-cols-2"><ListField label="Codecs" value={field('audio.codecs')} onChange={value => setText('audio.codecs', value)} /><TextField label="Maximum channels" type="number" value={field('audio.maxChannels')} onChange={value => setText('audio.maxChannels', value)} /><label className="block min-w-0 space-y-1.5 text-sm font-medium">Output path<select value={draft.choices.outputPath ?? ''} onChange={event => updateChoice('outputPath', (event.target.value || undefined) as Draft['choices']['outputPath'])} className={selectClass}><option value="">Choose output path</option><option value="device">Device</option><option value="passthrough">Passthrough</option><option value="receiver">Receiver</option></select></label><ChoiceSelect label="Supports object audio" value={draft.choices.objectAudio} onChange={value => updateChoice('objectAudio', value)} /></div></section>
            <section className={sectionClass}><div><h4 className={sectionTitleClass}>Subtitles</h4><p className="mt-0.5 text-xs text-muted-foreground">Formats and supported playback methods.</p></div><ListField label="Formats" value={field('subtitles.formats')} onChange={value => setText('subtitles.formats', value)} /><div className="grid gap-4 sm:grid-cols-2"><ChoiceSelect label="Embedded subtitles" value={draft.choices.subtitlesEmbedded} onChange={value => updateChoice('subtitlesEmbedded', value)} /><ChoiceSelect label="External subtitles" value={draft.choices.subtitlesExternal} onChange={value => updateChoice('subtitlesExternal', value)} /><ChoiceSelect label="Subtitle burn in" value={draft.choices.subtitlesBurnIn} onChange={value => updateChoice('subtitlesBurnIn', value)} /></div></section>
            <section className={sectionClass}><div><h4 className={sectionTitleClass}>Network</h4><p className="mt-0.5 text-xs text-muted-foreground">Sustainable network bitrate for this target.</p></div><TextField label="Sustainable bitrate" type="number" value={field('network.mbps')} onChange={value => setText('network.mbps', value)} unit="Mbps" /></section>
            <details className="rounded-xl border border-border/40 bg-muted/20 p-4"><summary className="cursor-pointer text-sm font-semibold">Advanced settings</summary><p className="mt-1 text-xs text-muted-foreground">Client identity and container-specific rules.</p><div className="mt-4 space-y-4"><div className="grid gap-4 sm:grid-cols-2"><TextField label="Client product" value={field('client.product')} onChange={value => setText('client.product', value)} /><TextField label="Client platform" value={field('client.platform')} onChange={value => setText('client.platform', value)} /><TextField label="Client version" value={field('client.version')} onChange={value => setText('client.version', value)} /></div><label className="block space-y-1.5 text-sm font-medium">Container rules <span className="font-normal text-muted-foreground">(JSON)</span><textarea value={draft.containerRulesText} onChange={event => setDraft(current => current ? { ...current, containerRulesText: event.target.value } : current)} rows={6} className="w-full rounded-md border border-border/60 bg-background p-3 font-mono text-xs shadow-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary" /></label></div></details>
          </div>
          <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-border/40 bg-muted/20 px-4 py-3 sm:px-5"><button type="button" onClick={() => { setDraft(null); setError(null) }} className={secondaryButtonClass}><RotateCcw className="h-4 w-4" />Cancel</button><button type="button" disabled={isSaving} onClick={() => void save()} className={primaryButtonClass}><Save className="h-4 w-4" />{isSaving ? 'Saving…' : 'Save changes'}</button></footer>
        </>}
      </section>
    </div>
  </div>
}
