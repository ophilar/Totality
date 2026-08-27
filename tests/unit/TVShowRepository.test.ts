import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { TVShowRepository } from '@main/database/repositories/TVShowRepository'
import { MediaRepository } from '@main/database/repositories/MediaRepository'
import { setupTestDb, cleanupTestDb } from '@tests/TestUtils'
import type { MediaItem, SeriesCompleteness } from '@main/types/database'

describe('TVShowRepository (Real DB)', () => {
  let db: Awaited<ReturnType<typeof setupTestDb>>
  let repo: TVShowRepository
  let mediaRepo: MediaRepository

  beforeEach(async () => {
    db = await setupTestDb()
    repo = db.tvShows
    mediaRepo = db.media
  })

  afterEach(() => {
    cleanupTestDb()
  })

  const mockEpisode = (series: string, season: number, episode: number): MediaItem => ({
    source_id: 'src-1',
    source_type: 'plex',
    library_id: 'lib-1',
    plex_id: `${series}-s${season}e${episode}`,
    title: `Episode ${episode}`,
    series_title: series,
    season_number: season,
    episode_number: episode,
    type: 'episode',
    file_path: `/path/${series}/s${season}e${episode}.mkv`,
    file_size: 1000,
    duration: 3600,
    resolution: '1080p',
    width: 1920,
    height: 1080,
    video_codec: 'h264',
    video_bitrate: 5000,
    audio_codec: 'aac',
    audio_channels: 2,
    audio_bitrate: 192,
  } as MediaItem)

  it('should return TV show summaries with episode counts', async () => {
    await repo.upsertCompleteness({
      series_title: 'Breaking Bad',
      source_id: 'src-1',
      library_id: 'lib-1',
      total_seasons: 5,
      total_episodes: 62,
      owned_seasons: 1,
      owned_episodes: 2,
      completeness_percentage: 50,
      missing_seasons: '[]',
      missing_episodes: '[]',
    } as SeriesCompleteness)

    await mediaRepo.upsertItem(mockEpisode('Breaking Bad', 1, 1))
    await mediaRepo.upsertItem(mockEpisode('Breaking Bad', 1, 2))

    const summaries = await repo.getSummaries()
    expect(summaries).toHaveLength(1)
    expect(summaries[0].series_title).toBe('Breaking Bad')
    expect(summaries[0].current_episodes).toBe(2)
  })

  it('should filter TV shows by search query', async () => {
    await repo.upsertCompleteness({
      series_title: 'The Wire',
      source_id: 'src-1',
      library_id: 'lib-1',
      total_seasons: 5,
      total_episodes: 60,
      owned_seasons: 5,
      owned_episodes: 60,
      completeness_percentage: 100,
      missing_seasons: '[]',
      missing_episodes: '[]',
    } as SeriesCompleteness)
    
    await repo.upsertCompleteness({
      series_title: 'Breaking Bad',
      source_id: 'src-1',
      library_id: 'lib-1',
      total_seasons: 5,
      total_episodes: 62,
      owned_seasons: 5,
      owned_episodes: 62,
      completeness_percentage: 100,
      missing_seasons: '[]',
      missing_episodes: '[]',
    } as SeriesCompleteness)

    const results = await repo.getSummaries({ searchQuery: 'Wire' })
    expect(results).toHaveLength(1)
    expect(results[0].series_title).toBe('The Wire')
  })

  it('should retrieve episodes for a specific show', async () => {
    await mediaRepo.upsertItem(mockEpisode('Breaking Bad', 1, 1))
    await mediaRepo.upsertItem(mockEpisode('The Wire', 1, 1))

    const episodes = await repo.getEpisodes('Breaking Bad')
    expect(episodes).toHaveLength(1)
    expect(episodes[0].series_title).toBe('Breaking Bad')
  })

  it('replaces an identical unresolved summary when a verified identity arrives', async () => {
    const base = {
      series_title: 'Andor',
      source_id: 'src-1',
      library_id: 'lib-1',
      total_seasons: 2,
      total_episodes: 24,
      owned_seasons: 2,
      owned_episodes: 24,
      completeness_percentage: 100,
      missing_seasons: '[]',
      missing_episodes: '[]',
    } as SeriesCompleteness

    await repo.upsertCompleteness(base)
    await repo.upsertCompleteness({ ...base, tmdb_id: '83867' })

    const summaries = await repo.getSummaries()
    expect(summaries).toHaveLength(1)
    expect(summaries[0].series_identity_key).toBe('tmdb:83867')
  })

  it('correctly sorts TV shows by title, recoverable debt, and efficiency', async () => {
    await repo.upsertCompleteness({
      series_title: 'Alpha Show',
      source_id: 'src-1',
      library_id: 'lib-1',
      total_seasons: 1,
      total_episodes: 1,
      owned_seasons: 1,
      owned_episodes: 1,
      completeness_percentage: 100,
      missing_seasons: '[]',
      missing_episodes: '[]',
    } as SeriesCompleteness)

    await repo.upsertCompleteness({
      series_title: 'Beta Show',
      source_id: 'src-1',
      library_id: 'lib-1',
      total_seasons: 1,
      total_episodes: 1,
      owned_seasons: 1,
      owned_episodes: 1,
      completeness_percentage: 100,
      missing_seasons: '[]',
      missing_episodes: '[]',
    } as SeriesCompleteness)

    const ep1Id = await mediaRepo.upsertItem(mockEpisode('Alpha Show', 1, 1))
    const ep2Id = await mediaRepo.upsertItem(mockEpisode('Beta Show', 1, 1))

    // Alpha Show: Low debt (100 MB), High efficiency (95%)
    await db.media.upsertQualityScore({
      media_item_id: ep1Id,
      quality_tier: '1080p',
      tier_quality: 'good',
      tier_score: 95,
      bitrate_tier_score: 95,
      audio_tier_score: 95,
      overall_score: 95,
      efficiency_score: 95,
      storage_debt_bytes: 100 * 1024 * 1024,
    })

    // Beta Show: High debt (5 GB), Low efficiency (40%)
    await db.media.upsertQualityScore({
      media_item_id: ep2Id,
      quality_tier: '1080p',
      tier_quality: 'poor',
      tier_score: 40,
      bitrate_tier_score: 40,
      audio_tier_score: 40,
      overall_score: 40,
      efficiency_score: 40,
      storage_debt_bytes: 5 * 1024 * 1024 * 1024,
    })

    // Sort by recoverable desc (largest debt first)
    const sortedDebtDesc = await repo.getSummaries({ sortBy: 'recoverable', sortOrder: 'desc' })
    expect(sortedDebtDesc[0].series_title).toBe('Beta Show')
    expect(sortedDebtDesc[1].series_title).toBe('Alpha Show')

    // Sort by recoverable asc (smallest debt first)
    const sortedDebtAsc = await repo.getSummaries({ sortBy: 'recoverable', sortOrder: 'asc' })
    expect(sortedDebtAsc[0].series_title).toBe('Alpha Show')
    expect(sortedDebtAsc[1].series_title).toBe('Beta Show')

    // Sort by efficiency desc (highest efficiency first)
    const sortedEffDesc = await repo.getSummaries({ sortBy: 'efficiency', sortOrder: 'desc' })
    expect(sortedEffDesc[0].series_title).toBe('Alpha Show')
    expect(sortedEffDesc[1].series_title).toBe('Beta Show')

    // Sort by efficiency asc (lowest efficiency first)
    const sortedEffAsc = await repo.getSummaries({ sortBy: 'efficiency', sortOrder: 'asc' })
    expect(sortedEffAsc[0].series_title).toBe('Beta Show')
    expect(sortedEffAsc[1].series_title).toBe('Alpha Show')

    // Sort by title asc
    const sortedTitleAsc = await repo.getSummaries({ sortBy: 'title', sortOrder: 'asc' })
    expect(sortedTitleAsc[0].series_title).toBe('Alpha Show')
    expect(sortedTitleAsc[1].series_title).toBe('Beta Show')

    // Sort by title desc
    const sortedTitleDesc = await repo.getSummaries({ sortBy: 'title', sortOrder: 'desc' })
    expect(sortedTitleDesc[0].series_title).toBe('Beta Show')
    expect(sortedTitleDesc[1].series_title).toBe('Alpha Show')
  })
})



