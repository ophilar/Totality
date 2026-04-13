import { getDatabase } from '../database/getDatabase'
import { getQualityAnalyzer } from './QualityAnalyzer'
import { getGeminiService } from './GeminiService'
import {
  QUALITY_REPORT_SYSTEM_PROMPT,
  UPGRADE_PRIORITIES_SYSTEM_PROMPT,
  COMPLETENESS_INSIGHTS_SYSTEM_PROMPT,
  WISHLIST_ADVICE_SYSTEM_PROMPT,
  COMPRESSION_ADVICE_SYSTEM_PROMPT,
} from './ai-system-prompts'

/** Strip null/undefined/empty fields to reduce token usage */
function compact(obj: any): any {
  const result: any = {}
  for (const [k, v] of Object.entries(obj)) {
    if (v !== null && v !== undefined && v !== '') result[k] = v
  }
  return result
}

/**
 * GeminiAnalysisService — Pre-fetches library data and sends to Gemini
 * with specialized prompts for generating reports and insights.
 *
 * Each method streams results back via an onDelta callback.
 */

export class GeminiAnalysisService {
  /**
   * Generate optimal compression parameters for a specific movie or episode.
   * Uses structured JSON output for precision.
   */
  async getCompressionAdvice(
    mediaId: number,
  ): Promise<{ text: string }> {
    const db = getDatabase()
    const item = db.media.getItem(mediaId)

    if (!item) {
      throw new Error(`Media item with ID ${mediaId} not found`)
    }

    // Prepare detailed metadata for the AI
    const metadata = compact({
      title: item.title,
      type: item.type,
      series_title: item.series_title,
      season_number: item.season_number,
      episode_number: item.episode_number,
      year: item.year,
      file_path: item.file_path,
      file_size_bytes: item.file_size,
      duration_ms: item.duration,
      container: item.container,
      video: {
        codec: item.video_codec,
        resolution: item.resolution,
        width: item.width,
        height: item.height,
        bitrate_kbps: item.video_bitrate,
        frame_rate: item.video_frame_rate,
        bit_depth: item.color_bit_depth,
        hdr_format: item.hdr_format,
        profile: item.video_profile,
        level: item.video_level,
      },
      audio_tracks: item.audio_tracks ? JSON.parse(item.audio_tracks) : [],
      quality: {
        tier: item.quality_tier,
        level: item.tier_quality,
        score: item.tier_score,
        efficiency: item.efficiency_score,
      },
    })

    const result = await getGeminiService().sendMessage({
      messages: [
        {
          role: 'user',
          content: `Analyze this media file and provide optimal compression parameters:\n\n${JSON.stringify(metadata, null, 2)}`,
        },
      ],
      system: COMPRESSION_ADVICE_SYSTEM_PROMPT,
      maxTokens: 2048,
    })

    return { text: result.text }
  }

  /**
   * Generate a quality health report for the library.
   */
  async generateQualityReport(
    onDelta: (text: string) => void,
  ): Promise<{ text: string }> {
    const db = getDatabase()
    const stats = db.stats.getLibraryStats()
    const distribution = getQualityAnalyzer().getQualityDistribution()

    const lowQualityItems = db.media.getItems({
      tierQuality: 'LOW',
      sortBy: 'title',
      sortOrder: 'asc',
      limit: 20,
    })

    const dataContext = [
      '## Library Stats',
      JSON.stringify(stats),
      '',
      '## Quality Distribution',
      JSON.stringify(distribution),
      '',
      '## Sample Low-Quality Items (up to 20)',
      JSON.stringify(
        lowQualityItems.map((item: any) => compact({
          title: item.title,
          year: item.year,
          type: item.type,
          resolution: item.resolution,
          video_codec: item.video_codec,
          video_bitrate: item.video_bitrate,
          quality_tier: item.quality_tier,
          tier_quality: item.tier_quality,
        })),
      ),
    ].join('\n')

    const result = await getGeminiService().streamMessage(
      {
        messages: [
          {
            role: 'user',
            content: `Here is my media library data. Please generate a quality health report.\n\n${dataContext}`,
          },
        ],
        system: QUALITY_REPORT_SYSTEM_PROMPT,
        maxTokens: 4096,
      },
      onDelta,
    )

    return { text: result.text }
  }

  /**
   * Generate prioritized upgrade recommendations.
   */
  async generateUpgradePriorities(
    onDelta: (text: string) => void,
  ): Promise<{ text: string }> {
    const db = getDatabase()

    const lowItems = db.media.getItems({
      tierQuality: 'LOW',
      sortBy: 'title',
      sortOrder: 'asc',
      limit: 30,
    })
    const mediumItems = db.media.getItems({
      tierQuality: 'MEDIUM',
      sortBy: 'title',
      sortOrder: 'asc',
      limit: 20,
    })

    const stats = db.stats.getLibraryStats()

    const dataContext = [
      '## Library Overview',
      JSON.stringify(stats),
      '',
      '## LOW Quality Items (up to 30)',
      JSON.stringify(
        lowItems.map((item: any) => compact({
          title: item.title,
          year: item.year,
          type: item.type,
          series_title: item.series_title,
          resolution: item.resolution,
          video_codec: item.video_codec,
          video_bitrate: item.video_bitrate,
          quality_tier: item.quality_tier,
          tier_quality: item.tier_quality,
        })),
      ),
      '',
      '## MEDIUM Quality Items (up to 20)',
      JSON.stringify(
        mediumItems.map((item: any) => compact({
          title: item.title,
          year: item.year,
          type: item.type,
          series_title: item.series_title,
          resolution: item.resolution,
          video_codec: item.video_codec,
          video_bitrate: item.video_bitrate,
          quality_tier: item.quality_tier,
          tier_quality: item.tier_quality,
        })),
      ),
    ].join('\n')

    const result = await getGeminiService().streamMessage(
      {
        messages: [
          {
            role: 'user',
            content: `Here are the items in my library that may need quality upgrades. Please prioritize them.\n\n${dataContext}`,
          },
        ],
        system: UPGRADE_PRIORITIES_SYSTEM_PROMPT,
        maxTokens: 4096,
      },
      onDelta,
    )

    return { text: result.text }
  }

  /**
   * Generate completeness insights.
   */
  async generateCompletenessInsights(
    onDelta: (text: string) => void,
  ): Promise<{ text: string }> {
    const db = getDatabase()

    const incompleteSeries = db.tvShows.getIncomplete()
    const incompleteCollections = db.stats.getIncompleteCollections()
    const stats = db.stats.getLibraryStats()

    const dataContext = [
      '## Library Overview',
      JSON.stringify(stats),
      '',
      `## Incomplete TV Series (${incompleteSeries.length} total, showing up to 30)`,
      JSON.stringify(
        incompleteSeries.slice(0, 30).map((s: any) => {
          let missingCount = 0
          let missingSample: string[] = []
          try {
            const parsed = JSON.parse((s.missing_episodes as string) || '[]')
            missingCount = parsed.length
            missingSample = parsed.slice(0, 5).map((e: any) =>
              `S${e.season_number}E${e.episode_number}`,
            )
          } catch (e) { throw e; }
          return compact({
            series_title: s.series_title,
            total_episodes: s.total_episodes,
            owned_episodes: s.owned_episodes,
            completeness_percentage: s.completeness_percentage,
            status: s.status,
            missing_count: missingCount,
            missing_sample: missingSample.length > 0 ? missingSample : undefined,
          })
        }),
      ),
      '',
      `## Incomplete Movie Collections (${incompleteCollections.length} total, showing up to 30)`,
      JSON.stringify(
        incompleteCollections.slice(0, 30).map((c: any) => {
          let missingCount = 0
          let missingSample: string[] = []
          try {
            const parsed = JSON.parse((c.missing_movies as string) || '[]')
            missingCount = parsed.length
            missingSample = parsed.slice(0, 5).map((m: any) =>
              m.year ? `${m.title} (${m.year})` : `${m.title}`,
            )
          } catch (e) { throw e; }
          return compact({
            collection_name: c.collection_name,
            total_movies: c.total_movies,
            owned_movies: c.owned_movies,
            completeness_percentage: c.completeness_percentage,
            missing_count: missingCount,
            missing_sample: missingSample.length > 0 ? missingSample : undefined,
          })
        }),
      ),
    ].join('\n')

    const result = await getGeminiService().streamMessage(
      {
        messages: [
          {
            role: 'user',
            content: `Here is my collection and series completeness data. Please analyze it and provide insights.\n\n${dataContext}`,
          },
        ],
        system: COMPLETENESS_INSIGHTS_SYSTEM_PROMPT,
        maxTokens: 4096,
      },
      onDelta,
    )

    return { text: result.text }
  }

  /**
   * Generate shopping advice for wishlist items.
   */
  async generateWishlistAdvice(
    onDelta: (text: string) => void,
  ): Promise<{ text: string }> {
    const db = getDatabase()

    const wishlistItems = db.wishlist.getItems({ status: 'active', limit: 50 })
    const stats = db.stats.getLibraryStats()

    const dataContext = [
      '## Library Overview',
      JSON.stringify(stats),
      '',
      `## Wishlist Items (${wishlistItems.length})`,
      JSON.stringify(
        wishlistItems.map((item: any) => compact({
          title: item.title,
          year: item.year,
          media_type: item.media_type,
          reason: item.reason,
          priority: item.priority,
          notes: item.notes,
          series_title: item.series_title,
          collection_name: item.collection_name,
          current_quality_tier: item.current_quality_tier,
          current_quality_level: item.current_quality_level,
        })),
      ),
    ].join('\n')

    const result = await getGeminiService().streamMessage(
      {
        messages: [
          {
            role: 'user',
            content: `Here is my wishlist. Please analyze it and provide shopping advice.\n\n${dataContext}`,
          },
        ],
        system: WISHLIST_ADVICE_SYSTEM_PROMPT,
        maxTokens: 4096,
      },
      onDelta,
    )

    return { text: result.text }
  }
}

// Singleton
let analysisServiceInstance: GeminiAnalysisService | null = null

export function getGeminiAnalysisService(): GeminiAnalysisService {
  if (!analysisServiceInstance) {
    analysisServiceInstance = new GeminiAnalysisService()
  }
  return analysisServiceInstance
}
