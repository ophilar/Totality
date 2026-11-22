import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PlaybackTargetProfileRepository } from '@main/database/repositories/PlaybackTargetProfileRepository'

describe('PlaybackTargetProfileRepository', () => {
  let profilesDirectory: string

  beforeEach(async () => {
    profilesDirectory = await mkdtemp(path.join(os.tmpdir(), 'totality-playback-profiles-'))
  })

  afterEach(async () => {
    await rm(profilesDirectory, { recursive: true, force: true })
  })

  it('does not create a built-in profile for an empty profile directory', async () => {
    const repository = new PlaybackTargetProfileRepository(profilesDirectory)

    expect(await repository.list()).toEqual([])
  })

  it('migrates the personal Plex profile into an editable profile with generic client identity', async () => {
    const profileId = 'builtin:plex-webos-4-lg-b8'
    const profilePath = path.join(profilesDirectory, `${encodeURIComponent(profileId)}.json`)
    await writeFile(profilePath, JSON.stringify({
      id: profileId,
      name: 'Plex webOS 4 / LG B8',
      isBuiltin: true,
      definition: {
        containers: ['mp4'],
        video: { codecs: ['h264'], profiles: ['High'], levels: [51], maxWidth: 3840, maxHeight: 2160, maxFrameRate: 60, bitDepths: [8] },
        hdr: { formats: ['HDR10'], fallbackRequired: true },
        audio: { codecs: ['aac'], maxChannels: 8, objectAudio: false, outputPath: 'device' },
        subtitles: { formats: ['srt'], embedded: true, external: true, burnIn: false },
        network: { sustainableBitrate: 100_000_000 },
        providers: { plex: { clientProduct: 'Plex for LG', clientPlatform: 'webOS', clientVersion: '4' } },
      },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }), 'utf8')

    const repository = new PlaybackTargetProfileRepository(profilesDirectory)
    const [profile] = await repository.list()
    const persisted = JSON.parse(await readFile(profilePath, 'utf8')) as Record<string, unknown>

    expect(profile).toMatchObject({
      id: profileId,
      name: 'Plex webOS 4 / LG B8',
      definition: { client: { product: 'Plex for LG', platform: 'webOS', version: '4' } },
    })
    expect(profile).not.toHaveProperty('isBuiltin')
    expect(profile.definition).not.toHaveProperty('providers')
    expect(persisted).not.toHaveProperty('isBuiltin')
    expect(persisted.definition).not.toHaveProperty('providers')

    await repository.update(profile.id, 'LG B8', profile.definition, '2026-10-17T00:00:00.000Z')
    await repository.delete(profile.id)
    expect(await repository.get(profile.id)).toBeNull()
  })
})
