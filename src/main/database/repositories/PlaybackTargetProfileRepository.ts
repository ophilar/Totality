import { app } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { PlaybackTargetDefinition, PlaybackTargetProfile } from '@main/types/playbackTarget'

type StoredPlaybackTargetProfile = PlaybackTargetProfile & {
  isBuiltin?: boolean
  definition: PlaybackTargetDefinition & {
    providers?: { plex?: { clientProduct: string; clientPlatform: string; clientVersion: string } }
  }
}

export class PlaybackTargetProfileRepository {
  constructor(private readonly profilesDirectory = path.join(app.getPath('userData'), 'playback-target-profiles')) {}
  private async ensureDirectory(): Promise<void> { await fs.mkdir(this.profilesDirectory, { recursive: true }) }
  private filePath(id: string): string { if (!/^[-a-zA-Z0-9:_]+$/.test(id)) throw new Error('Invalid playback target profile identifier'); return path.join(this.profilesDirectory, `${encodeURIComponent(id)}.json`) }
  private async write(filePath: string, profile: PlaybackTargetProfile): Promise<void> { await fs.writeFile(filePath, `${JSON.stringify(profile, null, 2)}\n`, 'utf8') }
  private async readStored(filePath: string): Promise<StoredPlaybackTargetProfile> {
    return JSON.parse(await fs.readFile(filePath, 'utf8')) as StoredPlaybackTargetProfile
  }
  private async migrate(filePath: string, stored: StoredPlaybackTargetProfile): Promise<PlaybackTargetProfile> {
    const { isBuiltin, definition, ...profile } = stored
    const { providers, ...capabilities } = definition
    const plexClient = providers?.plex
    const client = definition.client ?? (plexClient ? {
      product: plexClient.clientProduct,
      platform: plexClient.clientPlatform,
      version: plexClient.clientVersion,
    } : undefined)
    const migrated: PlaybackTargetProfile = {
      ...profile,
      definition: { ...capabilities, ...(client ? { client } : {}) },
    }
    if (isBuiltin !== undefined || providers !== undefined) await this.write(filePath, migrated)
    return migrated
  }
  async list(): Promise<PlaybackTargetProfile[]> { await this.ensureDirectory(); const names = (await fs.readdir(this.profilesDirectory)).filter(name => name.endsWith('.json')); return Promise.all(names.map(async name => { const filePath = path.join(this.profilesDirectory, name); return this.migrate(filePath, await this.readStored(filePath)) })) }
  async get(id: string): Promise<PlaybackTargetProfile | null> {
    await this.ensureDirectory()
    const filePath = this.filePath(id)
    let stored: StoredPlaybackTargetProfile
    try { stored = await this.readStored(filePath) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
    return this.migrate(filePath, stored)
  }
  async create(profile: PlaybackTargetProfile): Promise<void> { await this.ensureDirectory(); const filePath = this.filePath(profile.id); try { await fs.access(filePath); throw new Error('Playback target profile already exists') } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; await this.write(filePath, profile) } }
  async update(id: string, name: string, definition: PlaybackTargetDefinition, updatedAt: string): Promise<void> { const profile = await this.get(id); if (!profile) throw new Error('Playback target profile was not found'); await this.write(this.filePath(id), { ...profile, name, definition, updatedAt }) }
  async delete(id: string): Promise<void> { const profile = await this.get(id); if (!profile) throw new Error('Playback target profile was not found'); await fs.unlink(this.filePath(id)) }
  async duplicate(sourceId: string, copy: PlaybackTargetProfile): Promise<void> { const source = await this.get(sourceId); if (!source) throw new Error('Playback target profile was not found'); await this.create({ ...copy, definition: source.definition }) }
}
