import type { PlaybackDecisionProvider, PlaybackStreamDecision, ProviderPlaybackDecision } from '@main/services/PlaybackCompatibilityService'
import type { PlaybackTargetDefinition, PlaybackTargetProfile } from '@main/types/playbackTarget'

export interface PlexPlaybackDecisionResponse {
  overall?: string
  video?: PlaybackStreamDecision
  audio?: PlaybackStreamDecision
  subtitle?: PlaybackStreamDecision
  evidence?: string
}
export interface PlexPlaybackDecisionTransport { request(input: { plexId: string; client: NonNullable<PlaybackTargetDefinition['client']> }): Promise<PlexPlaybackDecisionResponse> }

const modes = new Set(['direct-play', 'direct-stream', 'transcode', 'conversion'])
function mode(value: string | undefined, field: string): ProviderPlaybackDecision['overall'] { if (!value || !modes.has(value)) throw new Error(`Plex playback response has invalid ${field}`); return value as ProviderPlaybackDecision['overall'] }

export class PlexPlaybackDecisionProvider implements PlaybackDecisionProvider {
  constructor(private readonly transport: PlexPlaybackDecisionTransport) {}
  async getDecision(input: { plexId: string; profile: PlaybackTargetProfile }): Promise<ProviderPlaybackDecision> {
    const client = input.profile.definition.client
    if (!client) throw new Error('Playback client identity is required')
    const response = await this.transport.request({ plexId: input.plexId, client })
    return { provider: 'plex', overall: mode(response.overall, 'overall'), video: response.video ?? 'unknown', audio: response.audio ?? 'unknown', subtitle: response.subtitle ?? 'unknown', evidence: response.evidence || 'Plex playback response' }
  }
}
