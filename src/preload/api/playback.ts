import { ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '@main/constants/ipcChannels'
import type { PlaybackTargetDefinition, PlaybackTargetProfile } from '@main/types/playbackTarget'
import type { PlaybackCompatibilityResult } from '@main/services/PlaybackCompatibilityService'

export interface PlaybackAPI {
  listPlaybackTargetProfiles: () => Promise<PlaybackTargetProfile[]>
  createPlaybackTargetProfile: (input: { name: string; definition: PlaybackTargetDefinition }) => Promise<PlaybackTargetProfile>
  updatePlaybackTargetProfile: (input: { id: string; name: string; definition: PlaybackTargetDefinition }) => Promise<PlaybackTargetProfile>
  deletePlaybackTargetProfile: (id: string) => Promise<boolean>
  evaluatePlaybackCompatibility: (input: { mediaItemId: number; profileId: string }) => Promise<PlaybackCompatibilityResult>
}

export const playbackApi: PlaybackAPI = {
  listPlaybackTargetProfiles: () => ipcRenderer.invoke(IPC_CHANNELS.DATABASE.PLAYBACK_TARGET_PROFILES_LIST),
  createPlaybackTargetProfile: input => ipcRenderer.invoke(IPC_CHANNELS.DATABASE.PLAYBACK_TARGET_PROFILES_CREATE, input),
  updatePlaybackTargetProfile: input => ipcRenderer.invoke(IPC_CHANNELS.DATABASE.PLAYBACK_TARGET_PROFILES_UPDATE, input),
  deletePlaybackTargetProfile: id => ipcRenderer.invoke(IPC_CHANNELS.DATABASE.PLAYBACK_TARGET_PROFILES_DELETE, id),
  evaluatePlaybackCompatibility: input => ipcRenderer.invoke(IPC_CHANNELS.DATABASE.PLAYBACK_COMPATIBILITY_EVALUATE, input),
}
