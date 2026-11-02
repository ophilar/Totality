import { z } from 'zod'
import { IPC_CHANNELS } from '@shared/ipcChannels'
import { createValidatedIpcHandler } from '@main/ipc/utils/createHandler'
import { getDatabase } from '@main/database/getDatabase'
import type { PlaybackTargetDefinition, PlaybackTargetProfile } from '@main/types/playbackTarget'
import crypto from 'node:crypto'
import { playbackTargetProfileInputSchema } from '@shared/playbackTargetValidation'
import { SETTING_KEYS } from '@shared/settingKeys'
import { getQualityAnalyzer } from '@main/services/QualityAnalyzer'
import { getTaskQueueService } from '@main/services/TaskQueueService'

const idInput = z.string().min(1)

export function registerPlaybackTargetProfileHandlers(): void {
  createValidatedIpcHandler(IPC_CHANNELS.dbPlaybackTargetProfilesList, z.undefined(), async () => getDatabase().playbackTargetProfiles.list())
  createValidatedIpcHandler(IPC_CHANNELS.dbPlaybackTargetProfilesCreate, playbackTargetProfileInputSchema, async input => {
    const db = getDatabase()
    const now = new Date().toISOString()
    const profile: PlaybackTargetProfile = { id: crypto.randomUUID(), name: input.name, definition: input.definition as PlaybackTargetDefinition, createdAt: now, updatedAt: now }
    await db.playbackTargetProfiles.create(profile)
    return profile
  })
  createValidatedIpcHandler(IPC_CHANNELS.dbPlaybackTargetProfilesUpdate, z.object({ id: idInput, ...playbackTargetProfileInputSchema.shape }), async input => {
    const db = getDatabase()
    await db.playbackTargetProfiles.update(input.id, input.name, input.definition as PlaybackTargetDefinition, new Date().toISOString())
    if (await db.config.getSetting(SETTING_KEYS.optimization_default_target_profile_id) === input.id) {
      getQualityAnalyzer().invalidateThresholdsCache()
      await db.setSetting('optimization.savings_reanalysis_pending', 'true')
      getTaskQueueService().addTask({ type: 'media-analysis', label: 'Measure media files', options: { completedMediaItemIds: [] } })
    }
    return db.playbackTargetProfiles.get(input.id)
  })
  createValidatedIpcHandler(IPC_CHANNELS.dbPlaybackTargetProfilesDuplicate, z.object({ sourceId: idInput, name: z.string().trim().min(1) }), async input => {
    const db = getDatabase()
    const now = new Date().toISOString()
    const source = await db.playbackTargetProfiles.get(input.sourceId)
    if (!source) throw new Error('Playback target profile was not found')
    const copy: PlaybackTargetProfile = { id: crypto.randomUUID(), name: input.name, definition: source.definition, createdAt: now, updatedAt: now }
    await db.playbackTargetProfiles.duplicate(input.sourceId, copy)
    return db.playbackTargetProfiles.get(copy.id)
  })
  createValidatedIpcHandler(IPC_CHANNELS.dbPlaybackTargetProfilesDelete, idInput, async id => {
    const db = getDatabase()
    const defaultId = await db.config.getSetting(SETTING_KEYS.optimization_default_target_profile_id)
    if (defaultId === id) throw new Error('Choose another default profile before deleting this profile')
    await db.playbackTargetProfiles.delete(id)
    return true
  })
}
