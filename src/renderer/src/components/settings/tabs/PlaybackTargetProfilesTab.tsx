import { useCallback, useEffect, useState } from 'react'
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
    'providers.plex.clientProduct': definition.providers?.plex?.clientProduct ?? '',
    'providers.plex.clientPlatform': definition.providers?.plex?.clientPlatform ?? '',
    'providers.plex.clientVersion': definition.providers?.plex?.clientVersion ?? '',
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
  const plex = {
    clientProduct: text['providers.plex.clientProduct'].trim(),
    clientPlatform: text['providers.plex.clientPlatform'].trim(),
    clientVersion: text['providers.plex.clientVersion'].trim(),
  }
  if (plex.clientProduct || plex.clientPlatform || plex.clientVersion) {
    if (Object.values(plex).some(value => !value)) return { error: 'Complete all Plex client identity fields or clear all three.' }
    base.providers = { ...base.providers, plex }
  } else if (base.providers) {
    delete base.providers.plex
    if (!Object.keys(base.providers).length) delete base.providers
  }
  if (!draft.name.trim()) return { error: 'Profile name is required.' }
  for (const key of ['containers', 'video.codecs', 'video.profiles', 'video.levels', 'video.bitDepths', 'audio.codecs'] as const) {
    if (!(parsed[key] as unknown[]).length) return { error: `${key} is required.` }
  }
  const validation = playbackTargetProfileInputSchema.safeParse({ name: draft.name, definition: base })
  if (!validation.success) return { error: validation.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join(' · ') }
  return { definition: validation.data.definition as PlaybackTargetDefinition }
}

function TextField({ label, value, onChange, type = 'text', unit }: { label: string; value: string; onChange: (value: string) => void; type?: string; unit?: string }) {
  return <label className="block min-w-0 text-sm">{label}<div className="mt-1 flex"><input type={type} step={type === 'number' ? 'any' : undefined} value={value} onChange={event => onChange(event.target.value)} className="w-full min-w-0 rounded border border-border bg-background px-2 py-1" />{unit && <span className="border-y border-r border-border bg-muted px-2 py-1 text-muted-foreground">{unit}</span>}</div></label>
}

function ListField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <TextField label={label} value={value} onChange={onChange} />
}

function ChoiceSelect({ label, value, onChange }: { label: string; value?: boolean; onChange: (value: boolean | undefined) => void }) {
  return <label className="block min-w-0 text-sm">{label}<select value={value === undefined ? '' : String(value)} onChange={event => onChange(event.target.value === '' ? undefined : event.target.value === 'true')} className="mt-1 w-full rounded border border-border bg-background px-2 py-1"><option value="">Choose</option><option value="true">Yes</option><option value="false">No</option></select></label>
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
    setError(storedDefault && !loaded.some(profile => profile.id === storedDefault) ? 'The saved default profile no longer exists. Choose a replacement.' : null)
  }, [])

  useEffect(() => { void loadProfiles().catch(e => setError(e instanceof Error ? e.message : String(e))) }, [loadProfiles])

  const runProfileAction = (action: () => void) => {
    if (hasUnsavedChanges()) { setPendingProfileAction(() => action); return }
    action()
  }

  const selectProfile = (profile: PlaybackTargetProfile) => runProfileAction(() => {
    setSelectedId(profile.id)
    setDraft(profile.isBuiltin ? null : createDraft(profile.name, profile.definition))
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
      await loadProfiles()
      const saved = (await window.electronAPI.listPlaybackTargetProfiles()).find(profile => profile.id === savedId)
      if (saved) setDraft(createDraft(saved.name, saved.definition))
      return true
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); return false } finally { setIsSaving(false) }
  }

  const copyProfile = (profile: PlaybackTargetProfile) => runProfileAction(() => { void (async () => {
    try {
      const copy = await window.electronAPI.duplicatePlaybackTargetProfile(profile.id, `${profile.name} copy`)
      await loadProfiles()
      setSelectedId(copy.id)
      setDraft(createDraft(copy.name, copy.definition))
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  })() })

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
    if (!selectedProfile || selectedProfile.isBuiltin) return true
    return JSON.stringify(draft) !== JSON.stringify(createDraft(selectedProfile.name, selectedProfile.definition))
  }
  useEffect(() => { onDirtyChange(hasUnsavedChanges()) })
  const field = (key: string) => draft?.text[key] ?? ''
  const setText = (key: string, value: string) => setDraft(current => current ? { ...current, text: { ...current.text, [key]: value } } : current)

  return <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden p-4">
    <div><h2 className="text-lg font-semibold">Playback targets</h2><p className="text-xs text-muted-foreground">Describe what each player can handle. Targets guide compatibility and optimization.</p></div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {pendingProfileAction && <div role="dialog" aria-modal="true" aria-labelledby="profile-unsaved-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"><section className="w-full max-w-md space-y-4 rounded-xl border border-border bg-card p-5 shadow-xl"><h3 id="profile-unsaved-title" className="font-semibold">Unsaved playback profile</h3><p className="text-sm text-muted-foreground">Save your changes before switching profiles?</p><div className="flex flex-wrap justify-end gap-2"><button type="button" className="rounded border border-border px-3 py-2 text-sm" onClick={() => setPendingProfileAction(null)}>Keep editing</button><button type="button" className="rounded border border-border px-3 py-2 text-sm" onClick={() => { const action = pendingProfileAction; setPendingProfileAction(null); action() }}>Discard</button><button type="button" disabled={isSaving} className="rounded bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50" onClick={() => void save().then(saved => { if (saved && pendingProfileAction) { const action = pendingProfileAction; setPendingProfileAction(null); action() } })}>{isSaving ? 'Saving…' : 'Save'}</button></div></section></div>}
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-hidden lg:grid-cols-[240px_minmax(0,1fr)]">
      <section className="min-h-0 space-y-3 overflow-y-auto">
        <div className="flex items-center justify-between"><h3 className="font-medium">Profiles</h3><button className="text-sm text-primary" onClick={createProfile}>New</button></div>
        <label className="block text-sm">Default for optimization<select value={defaultProfileId ?? ''} onChange={event => void setDefault(event.target.value)} className="mt-1 w-full rounded border border-border bg-background px-2 py-2"><option value="" disabled>Choose a profile</option>{profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label>
        <div className="space-y-1">{profiles.map(profile => <button key={profile.id} className={`w-full rounded-lg border p-3 text-left text-sm ${selectedId === profile.id ? 'border-primary bg-primary/10' : 'border-border/50 hover:bg-muted/40'}`} onClick={() => selectProfile(profile)}><span className="block truncate">{profile.name}</span><span className="text-xs text-muted-foreground">{profile.isBuiltin ? 'Built-in · read only' : 'Custom'}</span></button>)}</div>
      </section>
      <section className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-border/50">
        {!draft ? <div className="space-y-3 overflow-y-auto p-4">{selectedProfile ? <><h3 className="font-medium">{selectedProfile.name}</h3><p className="text-sm text-muted-foreground">Built-in targets are read only. Copy this profile to customize its capabilities.</p><button onClick={() => void copyProfile(selectedProfile)} className="rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground">Create editable copy</button></> : <p className="text-sm text-muted-foreground">Select a profile or create one.</p>}</div> : <>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
            <TextField label="Profile name" value={draft.name} onChange={name => setDraft(current => current ? { ...current, name } : current)} />
            <section className="space-y-3 rounded-lg border border-border/50 p-3"><h3 className="font-medium">Video</h3><div className="grid gap-3 sm:grid-cols-2"><ListField label="Containers" value={field('containers')} onChange={value => setText('containers', value)} /><ListField label="Codecs" value={field('video.codecs')} onChange={value => setText('video.codecs', value)} /><ListField label="Profiles" value={field('video.profiles')} onChange={value => setText('video.profiles', value)} /><ListField label="Levels" value={field('video.levels')} onChange={value => setText('video.levels', value)} /><ListField label="Bit depths" value={field('video.bitDepths')} onChange={value => setText('video.bitDepths', value)} /><TextField label="Maximum width" type="number" value={field('video.maxWidth')} onChange={value => setText('video.maxWidth', value)} unit="px" /><TextField label="Maximum height" type="number" value={field('video.maxHeight')} onChange={value => setText('video.maxHeight', value)} unit="px" /><TextField label="Maximum frame rate" type="number" value={field('video.maxFrameRate')} onChange={value => setText('video.maxFrameRate', value)} unit="fps" /></div></section>
            <section className="space-y-3 rounded-lg border border-border/50 p-3"><h3 className="font-medium">HDR</h3><ListField label="Supported formats (comma separated; blank means none)" value={field('hdr.formats')} onChange={value => setText('hdr.formats', value)} /><ChoiceSelect label="Require HDR fallback" value={draft.choices.hdrFallbackRequired} onChange={value => updateChoice('hdrFallbackRequired', value)} /></section>
            <section className="space-y-3 rounded-lg border border-border/50 p-3"><h3 className="font-medium">Audio</h3><div className="grid gap-3 sm:grid-cols-2"><ListField label="Codecs" value={field('audio.codecs')} onChange={value => setText('audio.codecs', value)} /><TextField label="Maximum channels" type="number" value={field('audio.maxChannels')} onChange={value => setText('audio.maxChannels', value)} /><label className="block text-sm">Output path<select value={draft.choices.outputPath ?? ''} onChange={event => updateChoice('outputPath', (event.target.value || undefined) as Draft['choices']['outputPath'])} className="mt-1 w-full rounded border border-border bg-background px-2 py-1"><option value="">Choose output path</option><option value="device">Device</option><option value="passthrough">Passthrough</option><option value="receiver">Receiver</option></select></label><ChoiceSelect label="Supports object audio" value={draft.choices.objectAudio} onChange={value => updateChoice('objectAudio', value)} /></div></section>
            <section className="space-y-3 rounded-lg border border-border/50 p-3"><h3 className="font-medium">Subtitles</h3><ListField label="Formats (comma separated; blank means none)" value={field('subtitles.formats')} onChange={value => setText('subtitles.formats', value)} /><div className="grid gap-3 sm:grid-cols-2"><ChoiceSelect label="Embedded subtitles" value={draft.choices.subtitlesEmbedded} onChange={value => updateChoice('subtitlesEmbedded', value)} /><ChoiceSelect label="External subtitles" value={draft.choices.subtitlesExternal} onChange={value => updateChoice('subtitlesExternal', value)} /><ChoiceSelect label="Subtitle burn-in" value={draft.choices.subtitlesBurnIn} onChange={value => updateChoice('subtitlesBurnIn', value)} /></div></section>
            <section className="space-y-3 rounded-lg border border-border/50 p-3"><h3 className="font-medium">Network</h3><TextField label="Sustainable bitrate" type="number" value={field('network.mbps')} onChange={value => setText('network.mbps', value)} unit="Mbps" /></section>
            <details className="rounded-lg border border-border/50 p-3"><summary className="cursor-pointer font-medium">Advanced · Plex and container rules</summary><div className="mt-3 space-y-3"><TextField label="Plex client product" value={field('providers.plex.clientProduct')} onChange={value => setText('providers.plex.clientProduct', value)} /><TextField label="Plex platform" value={field('providers.plex.clientPlatform')} onChange={value => setText('providers.plex.clientPlatform', value)} /><TextField label="Plex version" value={field('providers.plex.clientVersion')} onChange={value => setText('providers.plex.clientVersion', value)} /><label className="block text-sm">Container rules (JSON array)<textarea value={draft.containerRulesText} onChange={event => setDraft(current => current ? { ...current, containerRulesText: event.target.value } : current)} rows={6} className="mt-1 w-full rounded border border-border bg-background p-2 font-mono text-xs" /></label></div></details>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/50 bg-card p-3"><button onClick={() => void remove()} disabled={!selectedId || !selectedProfile || selectedProfile.isBuiltin} className="text-sm text-destructive disabled:opacity-50">Delete</button><div className="flex gap-2"><button onClick={() => { setDraft(selectedProfile && !selectedProfile.isBuiltin ? createDraft(selectedProfile.name, selectedProfile.definition) : null); setError(null) }} className="rounded-lg border border-border px-3 py-2 text-sm">Cancel</button><button disabled={isSaving} onClick={() => void save()} className="rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50">{isSaving ? 'Saving…' : 'Save'}</button></div></div>
        </>}
      </section>
    </div>
  </div>
}
