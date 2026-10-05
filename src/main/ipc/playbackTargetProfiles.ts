import { z } from 'zod'
import { IPC_CHANNELS } from '@main/constants/ipcChannels'
import { createValidatedIpcHandler } from '@main/ipc/utils/createHandler'
import { getDatabase } from '@main/database/BetterSQLiteService'
import type { PlaybackTargetDefinition, PlaybackTargetProfile } from '@main/types/playbackTarget'
import crypto from 'node:crypto'
import { playbackTargetProfileInputSchema } from '@shared/playbackTargetValidation'

const idInput = z.string().min(1)

export function registerPlaybackTargetProfileHandlers(): void {
  const db = getDatabase()
  createValidatedIpcHandler(IPC_CHANNELS.DATABASE.PLAYBACK_TARGET_PROFILES_LIST, z.undefined(), async () => db.playbackTargetProfiles.list())
  createValidatedIpcHandler(IPC_CHANNELS.DATABASE.PLAYBACK_TARGET_PROFILES_CREATE, playbackTargetProfileInputSchema, async input => {
    const now = new Date().toISOString()
    const profile: PlaybackTargetProfile = { id: crypto.randomUUID(), name: input.name, definition: input.definition as PlaybackTargetDefinition, isBuiltin: false, createdAt: now, updatedAt: now }
    await db.playbackTargetProfiles.create(profile)
    return profile
  })
  createValidatedIpcHandler(IPC_CHANNELS.DATABASE.PLAYBACK_TARGET_PROFILES_UPDATE, z.object({ id: idInput, ...playbackTargetProfileInputSchema.shape }), async input => { await db.playbackTargetProfiles.update(input.id, input.name, input.definition as PlaybackTargetDefinition, new Date().toISOString()); return db.playbackTargetProfiles.get(input.id) })
  createValidatedIpcHandler(IPC_CHANNELS.DATABASE.PLAYBACK_TARGET_PROFILES_DUPLICATE, z.object({ sourceId: idInput, name: z.string().trim().min(1) }), async input => {
    const now = new Date().toISOString()
    const source = await db.playbackTargetProfiles.get(input.sourceId)
    if (!source) throw new Error('Playback target profile was not found')
    const copy: PlaybackTargetProfile = { id: crypto.randomUUID(), name: input.name, definition: source.definition, isBuiltin: false, createdAt: now, updatedAt: now }
    await db.playbackTargetProfiles.duplicate(input.sourceId, copy)
    return db.playbackTargetProfiles.get(copy.id)
  })
  createValidatedIpcHandler(IPC_CHANNELS.DATABASE.PLAYBACK_TARGET_PROFILES_DELETE, idInput, async id => {
    const defaultId = await db.config.getSetting('optimization_default_target_profile_id')
    if (defaultId === id) throw new Error('Choose another default profile before deleting this profile')
    await db.playbackTargetProfiles.delete(id)
    return true
  })
}
