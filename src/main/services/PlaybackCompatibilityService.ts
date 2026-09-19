import { getDatabase, type BetterSQLiteService } from '@main/database/BetterSQLiteService'
import { getMediaFileAnalyzer, type FileAnalysisResult } from '@main/services/MediaFileAnalyzer'
import { evaluatePlaybackTarget, type PlaybackTargetEvaluation, type PlaybackTargetProfile } from '@main/types/playbackTarget'
import { getSourceManager } from '@main/services/SourceManager'
import { PlexPlaybackDecisionProvider } from '@main/providers/plex/PlexPlaybackDecisionProvider'

export type PlaybackDeliveryMode = 'direct-play' | 'direct-stream' | 'transcode'
export interface ProviderPlaybackDecision { provider: 'plex'; overall: PlaybackDeliveryMode; video: PlaybackDeliveryMode; audio: PlaybackDeliveryMode; subtitle: PlaybackDeliveryMode; evidence: string }
export interface PlaybackDecisionProvider { getDecision(input: { plexId: string; profile: PlaybackTargetProfile }): Promise<ProviderPlaybackDecision> }
export type PlaybackPresentationState = 'compatible' | 'incompatible' | 'conflict' | 'provider-decision-unavailable'
export interface PlaybackCompatibilityResult { profile: PlaybackTargetProfile; evaluation: PlaybackTargetEvaluation; providerDecision?: ProviderPlaybackDecision; providerDecisionError?: string; presentation: PlaybackPresentationState }

export class PlaybackCompatibilityService {
  constructor(private readonly db: BetterSQLiteService = getDatabase(), private readonly analyzer = getMediaFileAnalyzer(), private readonly providers: Partial<Record<'plex', PlaybackDecisionProvider>> = {}) {}

  async analyze(mediaItemId: number, profileId: string): Promise<PlaybackCompatibilityResult> {
    const item = await this.db.media.getItemById(mediaItemId)
    if (!item) throw new Error('Media item was not found')
    if (!item.file_path) throw new Error('Media item has no local file path')
    const profile = await this.db.playbackTargetProfiles.get(profileId)
    if (!profile) throw new Error('Playback target profile was not found')
    const analysis = await this.analyzer.analyzeFile(item.file_path)
    const evaluation = evaluatePlaybackTarget(profile, analysis)
    if (item.source_type !== 'plex' || !item.source_id || !profile.definition.providers?.plex) return { profile, evaluation, presentation: evaluation.overall }
    const plex = this.providers.plex || await this.getConfiguredPlexProvider(item.source_id)
    if (!plex) return { profile, evaluation, presentation: evaluation.overall }
    try {
      if (!item.plex_id) throw new Error('Plex media identifier is missing')
      const providerDecision = await plex.getDecision({ plexId: item.plex_id, profile })
      const providerCompatible = providerDecision.overall === 'direct-play'
      return { profile, evaluation, providerDecision, presentation: providerCompatible === (evaluation.overall === 'compatible') ? (evaluation.overall) : 'conflict' }
    } catch (error) {
      return { profile, evaluation, providerDecisionError: error instanceof Error ? error.message : String(error), presentation: 'provider-decision-unavailable' }
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
