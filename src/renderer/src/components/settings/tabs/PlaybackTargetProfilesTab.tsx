import { useCallback, useEffect, useState } from 'react'
import type { PlaybackTargetDefinition, PlaybackTargetProfile } from '@main/types/playbackTarget'

type Draft = { name: string; definition: PlaybackTargetDefinition }

const parseList = (value: string) => [...new Set(value.split(',').map(item => item.trim()).filter(Boolean))]
const parseNumbers = (value: string) => [...new Set(value.split(',').map(item => Number(item.trim())).filter(Number.isFinite))]
const listValue = (values: string[]) => values.join(', ')
const numberListValue = (values: number[]) => values.join(', ')

function ListField({ label, value, onChange }: { label: string; value: string[]; onChange: (value: string[]) => void }) {
  return <label className="block text-sm">{label}<input value={listValue(value)} onChange={event => onChange(parseList(event.target.value))} className="mt-1 w-full rounded border border-border bg-background px-2 py-1" /></label>
}

function NumberListField({ label, value, onChange }: { label: string; value: number[]; onChange: (value: number[]) => void }) {
  return <label className="block text-sm">{label}<input value={numberListValue(value)} onChange={event => onChange(parseNumbers(event.target.value))} className="mt-1 w-full rounded border border-border bg-background px-2 py-1" /></label>
}

function validateDraft(draft: Draft): string | null {
  const { definition } = draft
  if (!draft.name.trim()) return 'Profile name is required.'
  if (!definition.containers.length || !definition.video.codecs.length || !definition.video.profiles.length || !definition.video.levels.length || !definition.video.bitDepths.length) return 'Containers, video codecs, profiles, levels, and bit depths are required.'
  if (!definition.audio.codecs.length || !definition.hdr.formats.length || !definition.subtitles.formats.length) return 'Audio codecs, HDR formats, and subtitle formats are required.'
  if ([definition.video.maxWidth, definition.video.maxHeight, definition.video.maxFrameRate, definition.audio.maxChannels, definition.network.sustainableBitrate].some(value => value <= 0)) return 'Numeric limits must be greater than zero.'
  if ([...definition.video.levels, ...definition.video.bitDepths].some(value => value <= 0)) return 'Video levels and bit depths must be greater than zero.'
  return null
}

const emptyDefinition = (): PlaybackTargetDefinition => ({
  containers: ['matroska'],
  video: { codecs: ['hevc'], profiles: ['main'], levels: [51], maxWidth: 3840, maxHeight: 2160, maxFrameRate: 60, bitDepths: [8, 10] },
  hdr: { formats: ['hdr10'], fallbackRequired: true },
  audio: { codecs: ['aac', 'ac3', 'eac3'], maxChannels: 8, objectAudio: true, outputPath: 'passthrough' },
  subtitles: { formats: ['srt', 'ass', 'pgs'], embedded: true, external: true, burnIn: false },
  network: { sustainableBitrate: 100000 },
})

export function PlaybackTargetProfilesTab() {
  const [profiles, setProfiles] = useState<PlaybackTargetProfile[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  const loadProfiles = useCallback(async () => {
    setError(null)
    const loaded = await window.electronAPI.listPlaybackTargetProfiles()
    setProfiles(loaded)
    if (!selectedId && loaded[0]) setSelectedId(loaded[0].id)
  }, [selectedId])

  useEffect(() => { void loadProfiles().catch(e => setError(e instanceof Error ? e.message : String(e))) }, [loadProfiles])

  const selectProfile = (profile: PlaybackTargetProfile) => {
    setSelectedId(profile.id)
    setDraft({ name: profile.name, definition: structuredClone(profile.definition) })
  }

  const createProfile = () => { setSelectedId(null); setDraft({ name: 'New profile', definition: emptyDefinition() }) }

  const save = async () => {
    if (!draft) return
    const validationError = validateDraft(draft)
    if (validationError) { setError(validationError); return }
    setIsSaving(true); setError(null)
    try {
      if (selectedId) await window.electronAPI.updatePlaybackTargetProfile({ id: selectedId, ...draft })
      else { const created = await window.electronAPI.createPlaybackTargetProfile(draft); setSelectedId(created.id) }
      await loadProfiles()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setIsSaving(false) }
  }

  const remove = async () => {
    if (!selectedId || !window.confirm('Delete this playback profile?')) return
    try { await window.electronAPI.deletePlaybackTargetProfile(selectedId); setDraft(null); setSelectedId(null); await loadProfiles() }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }

  const updateDefinition = (update: (definition: PlaybackTargetDefinition) => PlaybackTargetDefinition) => {
    if (draft) setDraft({ ...draft, definition: update(draft.definition) })
  }

  return <div className="grid min-h-0 grid-cols-1 gap-5 lg:grid-cols-[240px_1fr]">
    <section className="space-y-3"><div className="flex items-center justify-between"><div><h2 className="text-lg font-semibold">Playback profiles</h2><p className="text-xs text-muted-foreground">Profiles used for compatibility checks.</p></div><button className="text-sm text-primary" onClick={createProfile}>New</button></div><div className="space-y-1">{profiles.map(profile => <button key={profile.id} className={`w-full rounded-lg border p-3 text-left text-sm ${selectedId === profile.id ? 'border-primary bg-primary/10' : 'border-border/50 hover:bg-muted/40'}`} onClick={() => selectProfile(profile)}>{profile.name}</button>)}</div>{!profiles.length && <p className="rounded-lg border border-border/50 p-3 text-sm text-muted-foreground">No profiles yet.</p>}</section>
    <section className="min-w-0 space-y-4 rounded-xl border border-border/50 p-4">{error && <p className="text-sm text-destructive">{error}</p>}{!draft ? <p className="text-sm text-muted-foreground">Select a profile or create a new one.</p> : <><input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" aria-label="Profile name" /><div className="space-y-4 text-sm"><ListField label="Containers" value={draft.definition.containers} onChange={containers => updateDefinition(d => ({ ...d, containers }))} /><div className="grid grid-cols-1 gap-3 md:grid-cols-2"><ListField label="Video codecs" value={draft.definition.video.codecs} onChange={codecs => updateDefinition(d => ({ ...d, video: { ...d.video, codecs } }))} /><ListField label="Video profiles" value={draft.definition.video.profiles} onChange={profiles => updateDefinition(d => ({ ...d, video: { ...d.video, profiles } }))} /><NumberListField label="Video levels" value={draft.definition.video.levels} onChange={levels => updateDefinition(d => ({ ...d, video: { ...d.video, levels } }))} /><NumberListField label="Bit depths" value={draft.definition.video.bitDepths} onChange={bitDepths => updateDefinition(d => ({ ...d, video: { ...d.video, bitDepths } }))} /><label>Max width<input type="number" value={draft.definition.video.maxWidth} onChange={e => updateDefinition(d => ({ ...d, video: { ...d.video, maxWidth: Number(e.target.value) } }))} className="mt-1 w-full rounded border border-border bg-background px-2 py-1" /></label><label>Max height<input type="number" value={draft.definition.video.maxHeight} onChange={e => updateDefinition(d => ({ ...d, video: { ...d.video, maxHeight: Number(e.target.value) } }))} className="mt-1 w-full rounded border border-border bg-background px-2 py-1" /></label><label>Max frame rate<input type="number" value={draft.definition.video.maxFrameRate} onChange={e => updateDefinition(d => ({ ...d, video: { ...d.video, maxFrameRate: Number(e.target.value) } }))} className="mt-1 w-full rounded border border-border bg-background px-2 py-1" /></label><ListField label="HDR formats" value={draft.definition.hdr.formats} onChange={formats => updateDefinition(d => ({ ...d, hdr: { ...d.hdr, formats } }))} /><ListField label="Audio codecs" value={draft.definition.audio.codecs} onChange={codecs => updateDefinition(d => ({ ...d, audio: { ...d.audio, codecs } }))} /><label>Max audio channels<input type="number" value={draft.definition.audio.maxChannels} onChange={e => updateDefinition(d => ({ ...d, audio: { ...d.audio, maxChannels: Number(e.target.value) } }))} className="mt-1 w-full rounded border border-border bg-background px-2 py-1" /></label><label>Audio output<select value={draft.definition.audio.outputPath} onChange={e => updateDefinition(d => ({ ...d, audio: { ...d.audio, outputPath: e.target.value as PlaybackTargetDefinition['audio']['outputPath'] } }))} className="mt-1 w-full rounded border border-border bg-background px-2 py-1"><option value="device">Device</option><option value="passthrough">Passthrough</option><option value="receiver">Receiver</option></select></label><ListField label="Subtitle formats" value={draft.definition.subtitles.formats} onChange={formats => updateDefinition(d => ({ ...d, subtitles: { ...d.subtitles, formats } }))} /><label>Network bitrate<input type="number" value={draft.definition.network.sustainableBitrate} onChange={e => updateDefinition(d => ({ ...d, network: { sustainableBitrate: Number(e.target.value) } }))} className="mt-1 w-full rounded border border-border bg-background px-2 py-1" /></label></div><div className="flex flex-wrap gap-4"><label className="flex gap-2"><input type="checkbox" checked={draft.definition.hdr.fallbackRequired} onChange={e => updateDefinition(d => ({ ...d, hdr: { ...d.hdr, fallbackRequired: e.target.checked } }))} /> HDR fallback</label><label className="flex gap-2"><input type="checkbox" checked={draft.definition.audio.objectAudio} onChange={e => updateDefinition(d => ({ ...d, audio: { ...d.audio, objectAudio: e.target.checked } }))} /> Object audio</label><label className="flex gap-2"><input type="checkbox" checked={draft.definition.subtitles.embedded} onChange={e => updateDefinition(d => ({ ...d, subtitles: { ...d.subtitles, embedded: e.target.checked } }))} /> Embedded subtitles</label><label className="flex gap-2"><input type="checkbox" checked={draft.definition.subtitles.external} onChange={e => updateDefinition(d => ({ ...d, subtitles: { ...d.subtitles, external: e.target.checked } }))} /> External subtitles</label><label className="flex gap-2"><input type="checkbox" checked={draft.definition.subtitles.burnIn} onChange={e => updateDefinition(d => ({ ...d, subtitles: { ...d.subtitles, burnIn: e.target.checked } }))} /> Burn in subtitles</label></div></div><div className="flex justify-between"><button className="text-sm text-destructive" onClick={() => void remove()}>Delete</button><div className="flex gap-2"><button className="rounded-lg border border-border px-3 py-2 text-sm" onClick={() => setDraft(null)}>Cancel</button><button disabled={isSaving} className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50" onClick={() => void save()}>{isSaving ? 'Saving…' : 'Save'}</button></div></div></>}</section>
  </div>
}
