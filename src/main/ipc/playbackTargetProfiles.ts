import { z } from 'zod'
import { IPC_CHANNELS } from '@main/constants/ipcChannels'
import { createValidatedIpcHandler } from '@main/ipc/utils/createHandler'
import { getDatabase } from '@main/database/BetterSQLiteService'
import type { PlaybackTargetDefinition, PlaybackTargetProfile } from '@main/types/playbackTarget'
import crypto from 'node:crypto'

const definition = z.object({
  containers: z.array(z.string()).min(1),
  video: z.object({ codecs: z.array(z.string()).min(1), profiles: z.array(z.string()).min(1), levels: z.array(z.number()).min(1), maxWidth: z.number().positive(), maxHeight: z.number().positive(), maxFrameRate: z.number().positive(), bitDepths: z.array(z.number()).min(1) }),
  hdr: z.object({ formats: z.array(z.string()), fallbackRequired: z.boolean() }),
  audio: z.object({ codecs: z.array(z.string()).min(1), maxChannels: z.number().positive(), objectAudio: z.boolean(), outputPath: z.enum(['device', 'passthrough', 'receiver']) }),
  subtitles: z.object({ formats: z.array(z.string()), embedded: z.boolean(), external: z.boolean(), burnIn: z.boolean() }),
  network: z.object({ sustainableBitrate: z.number().positive() }),
  providers: z.object({ plex: z.object({ clientProduct: z.string().min(1), clientPlatform: z.string().min(1), clientVersion: z.string().min(1) }).optional() }).optional(),
})
const profileInput = z.object({ name: z.string().trim().min(1), definition })
const idInput = z.string().min(1)

export function registerPlaybackTargetProfileHandlers(): void {
  const db = getDatabase()
  createValidatedIpcHandler(IPC_CHANNELS.DATABASE.PLAYBACK_TARGET_PROFILES_LIST, z.undefined(), async () => db.playbackTargetProfiles.list())
  createValidatedIpcHandler(IPC_CHANNELS.DATABASE.PLAYBACK_TARGET_PROFILES_CREATE, profileInput, async input => {
    const now = new Date().toISOString()
    const profile: PlaybackTargetProfile = { id: crypto.randomUUID(), name: input.name, definition: input.definition as PlaybackTargetDefinition, isBuiltin: false, createdAt: now, updatedAt: now }
    await db.playbackTargetProfiles.create(profile)
    return profile
  })
  createValidatedIpcHandler(IPC_CHANNELS.DATABASE.PLAYBACK_TARGET_PROFILES_UPDATE, z.object({ id: idInput, ...profileInput.shape }), async input => { await db.playbackTargetProfiles.update(input.id, input.name, input.definition as PlaybackTargetDefinition, new Date().toISOString()); return db.playbackTargetProfiles.get(input.id) })
  createValidatedIpcHandler(IPC_CHANNELS.DATABASE.PLAYBACK_TARGET_PROFILES_DELETE, idInput, async id => { await db.playbackTargetProfiles.delete(id); return true })
  createValidatedIpcHandler(IPC_CHANNELS.DATABASE.PLAYBACK_TARGET_PROFILES_DUPLICATE, z.object({ id: idInput, name: z.string().trim().min(1) }), async input => {
    const source = await db.playbackTargetProfiles.get(input.id)
    if (!source) throw new Error('Playback target profile was not found')
    const now = new Date().toISOString()
    const copy: PlaybackTargetProfile = { id: crypto.randomUUID(), name: input.name, definition: source.definition, isBuiltin: false, createdAt: now, updatedAt: now }
    await db.playbackTargetProfiles.duplicate(input.id, copy)
    return copy
  })
}
