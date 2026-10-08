import type { PlaybackDecisionProvider, ProviderPlaybackDecision } from '@main/services/PlaybackCompatibilityService'
import type { PlaybackTargetProfile } from '@main/types/playbackTarget'

export interface PlexPlaybackDecisionResponse {
  overall?: string
  video?: string
  audio?: string
  subtitle?: string
  evidence?: string
}
export interface PlexPlaybackDecisionTransport { request(input: { plexId: string; client: NonNullable<PlaybackTargetProfile['definition']['providers']>['plex'] }): Promise<PlexPlaybackDecisionResponse> }

const modes = new Set(['direct-play', 'direct-stream', 'transcode'])
function mode(value: string | undefined, field: string): ProviderPlaybackDecision['overall'] { if (!value || !modes.has(value)) throw new Error(`Plex playback response has invalid ${field}`); return value as ProviderPlaybackDecision['overall'] }

export class PlexPlaybackDecisionProvider implements PlaybackDecisionProvider {
  constructor(private readonly transport: PlexPlaybackDecisionTransport) {}
  async getDecision(input: { plexId: string; profile: PlaybackTargetProfile }): Promise<ProviderPlaybackDecision> {
    const client = input.profile.definition.providers?.plex
    if (!client) throw new Error('Plex client context is required')
    const response = await this.transport.request({ plexId: input.plexId, client })
    return { provider: 'plex', overall: mode(response.overall, 'overall'), video: mode(response.video, 'video'), audio: mode(response.audio, 'audio'), subtitle: mode(response.subtitle, 'subtitle'), evidence: response.evidence || 'Plex playback response' }
  }
}
