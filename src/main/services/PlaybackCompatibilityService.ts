
import { getDatabase } from '@main/database/getDatabase'
import type { FileAnalysisResult } from '@main/services/MediaFileAnalyzer'
import { evaluatePlaybackTarget, type PlaybackTargetEvaluation, type PlaybackTargetProfile } from '@main/types/playbackTarget'
import { getSourceManager } from '@main/services/SourceManager'
import { PlexPlaybackDecisionProvider } from '@main/providers/plex/PlexPlaybackDecisionProvider'
import { getErrorMessage } from '@main/services/utils/errorUtils'

export type PlaybackDeliveryMode = 'direct-play' | 'direct-stream' | 'transcode'
export type PlaybackStreamDecision = 'copy' | 'transcode' | 'burn' | 'unknown' | 'not-applicable'
export interface ProviderPlaybackDecision { provider: 'plex'; overall: PlaybackDeliveryMode; video: PlaybackStreamDecision; audio: PlaybackStreamDecision; subtitle: PlaybackStreamDecision; evidence: string }
export interface PlaybackDecisionProvider { getDecision(input: { plexId: string; profile: PlaybackTargetProfile }): Promise<ProviderPlaybackDecision> }
export type PlaybackPresentationState = 'compatible' | 'incompatible' | 'provider-decision-unavailable'
export interface PlaybackCompatibilityResult { profile: PlaybackTargetProfile; evaluation: PlaybackTargetEvaluation; providerDecision?: ProviderPlaybackDecision; providerDecisionError?: string; presentation: PlaybackPresentationState }

export class PlaybackCompatibilityService {
  constructor(private readonly db: any = getDatabase(), private readonly providers: Partial<Record<'plex', PlaybackDecisionProvider>> = {}) {}

  async evaluate(mediaItemId: number, profileId: string): Promise<PlaybackCompatibilityResult> {
    const item = await this.db.media.getItemById(mediaItemId)
    if (!item) throw new Error('Media item was not found')
    if (!item.file_path) throw new Error('Media item has no local file path')
    const profile = await this.db.playbackTargetProfiles.get(profileId)
    if (!profile) throw new Error('Playback target profile was not found')
    if (!item.deep_analysis) throw new Error('Media item must be analyzed before compatibility can be evaluated')
    const analysis = JSON.parse(item.deep_analysis) as FileAnalysisResult
    if (!analysis.success || analysis.filePath !== item.file_path) throw new Error('Persisted file analysis is invalid')
    const evaluation = evaluatePlaybackTarget(profile, analysis)
    if (item.source_type !== 'plex' || !item.source_id || !profile.definition.client) return { profile, evaluation, presentation: evaluation.overall }
    const plex = this.providers.plex || await this.getConfiguredPlexProvider(item.source_id)
    if (!plex) return { profile, evaluation, presentation: evaluation.overall }
    try {
      if (!item.plex_id) throw new Error('Plex media identifier is missing')
      const providerDecision = await plex.getDecision({ plexId: item.plex_id, profile })
      return { profile, evaluation, providerDecision, presentation: evaluation.overall }
    } catch (error) {
      return { profile, evaluation, providerDecisionError: getErrorMessage(error), presentation: 'provider-decision-unavailable' }
    }
  }

  private async getConfiguredPlexProvider(sourceId: string): Promise<PlaybackDecisionProvider | undefined> {
    const manager = getSourceManager()
    await manager.initialize()
    const provider = manager.getPlexProvider(sourceId)
    return provider ? new PlexPlaybackDecisionProvider({ request: input => provider.requestPlaybackDecision(input.plexId, input.client!) }) : undefined
  }
}

export type { FileAnalysisResult }
