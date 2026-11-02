import { z } from 'zod'
import { IPC_CHANNELS } from '@main/constants/ipcChannels'
import { createValidatedIpcHandler } from '@main/ipc/utils/createHandler'
import { PlaybackCompatibilityService } from '@main/services/PlaybackCompatibilityService'

export function registerPlaybackCompatibilityHandlers(): void {
  const service = new PlaybackCompatibilityService()
  createValidatedIpcHandler(IPC_CHANNELS.DATABASE.PLAYBACK_COMPATIBILITY_EVALUATE, z.object({ mediaItemId: z.number().int().positive(), profileId: z.string().min(1) }), input => service.evaluate(input.mediaItemId, input.profileId))
}
