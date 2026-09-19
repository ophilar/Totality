import { app } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import baselineProfile from '@main/config/playbackTargetProfiles/plex-webos-4-lg-b8.json'
import type { PlaybackTargetDefinition, PlaybackTargetProfile } from '@main/types/playbackTarget'

export class PlaybackTargetProfileRepository {
  constructor(private readonly profilesDirectory = path.join(app.getPath('userData'), 'playback-target-profiles')) {}
  private async ensureDirectory(): Promise<void> { await fs.mkdir(this.profilesDirectory, { recursive: true }); const builtinPath = this.filePath(baselineProfile.id); try { await fs.access(builtinPath) } catch { await this.write(builtinPath, baselineProfile as PlaybackTargetProfile) } }
  private filePath(id: string): string { if (!/^[-a-zA-Z0-9:_]+$/.test(id)) throw new Error('Invalid playback target profile identifier'); return path.join(this.profilesDirectory, `${id}.json`) }
  private async write(filePath: string, profile: PlaybackTargetProfile): Promise<void> { await fs.writeFile(filePath, `${JSON.stringify(profile, null, 2)}\n`, 'utf8') }
  async list(): Promise<PlaybackTargetProfile[]> { await this.ensureDirectory(); const names = (await fs.readdir(this.profilesDirectory)).filter(name => name.endsWith('.json')); return Promise.all(names.map(async name => JSON.parse(await fs.readFile(path.join(this.profilesDirectory, name), 'utf8')) as PlaybackTargetProfile)) }
  async get(id: string): Promise<PlaybackTargetProfile | null> { await this.ensureDirectory(); try { return JSON.parse(await fs.readFile(this.filePath(id), 'utf8')) as PlaybackTargetProfile } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error } }
  async create(profile: PlaybackTargetProfile): Promise<void> { if (profile.isBuiltin) throw new Error('Built-in profiles cannot be created by users'); await this.ensureDirectory(); const filePath = this.filePath(profile.id); try { await fs.access(filePath); throw new Error('Playback target profile already exists') } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; await this.write(filePath, profile) } }
  async update(id: string, name: string, definition: PlaybackTargetDefinition, updatedAt: string): Promise<void> { const profile = await this.get(id); if (!profile || profile.isBuiltin) throw new Error('User-owned playback target profile was not found'); await this.write(this.filePath(id), { ...profile, name, definition, updatedAt }) }
  async delete(id: string): Promise<void> { const profile = await this.get(id); if (!profile || profile.isBuiltin) throw new Error('User-owned playback target profile was not found'); await fs.unlink(this.filePath(id)) }
  async duplicate(sourceId: string, copy: PlaybackTargetProfile): Promise<void> { const source = await this.get(sourceId); if (!source) throw new Error('Playback target profile was not found'); await this.create({ ...copy, definition: source.definition }) }
}
