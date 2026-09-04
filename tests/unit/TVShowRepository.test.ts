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

  it('sorts TV summaries by weighted efficiency before applying pagination', async () => {
    const addShow = async (title: string, efficiency: number) => {
      await repo.upsertCompleteness({
        series_title: title,
        source_id: 'src-1',
        library_id: 'lib-1',
        total_seasons: 1,
        total_episodes: 1,
        owned_seasons: 1,
        owned_episodes: 1,
        completeness_percentage: 100,
        efficiency_score: efficiency,
        missing_seasons: '[]',
        missing_episodes: '[]',
      } as SeriesCompleteness)
    }

    await addShow('Low Efficiency', 20)
    await addShow('High Efficiency', 90)

    const summaries = await repo.getSummaries({
      sortBy: 'weighted_efficiency',
      sortOrder: 'desc',
      limit: 1,
    })

    expect(summaries.map((summary) => summary.series_title)).toEqual(['High Efficiency'])
  })

  it('preserves unknown recoverable evidence instead of reporting zero optimization', async () => {
    await repo.upsertCompleteness({
      series_title: 'Unmeasured Show',
      source_id: 'src-1',
      library_id: 'lib-1',
      total_seasons: 1,
      total_episodes: 1,
      owned_seasons: 1,
      owned_episodes: 1,
      completeness_percentage: 100,
      storage_debt_bytes: null,
      efficiency_score: null,
      evidence_status: 'insufficient',
      confidence: 'none',
      savings_basis: 'insufficient_data',
      missing_seasons: '[]',
      missing_episodes: '[]',
    })
    await mediaRepo.upsertItem(mockEpisode('Unmeasured Show', 1, 1))

    const [summary] = await repo.getSummaries({ sourceId: 'src-1', libraryId: 'lib-1' })

    expect(summary.total_recoverable_bytes).toBeUndefined()
    expect(summary.weighted_efficiency).toBeNull()
    expect(summary.scored_episode_count).toBe(0)
    expect(summary.unscored_episode_count).toBe(1)
    expect(summary.recommended_action).toBeUndefined()
  })

  it('preserves a measured zero recoverable result as real evidence', async () => {
    await repo.upsertCompleteness({
      series_title: 'Measured Zero Show',
      source_id: 'src-1',
      library_id: 'lib-1',
      total_seasons: 1,
      total_episodes: 1,
      owned_seasons: 1,
      owned_episodes: 1,
      completeness_percentage: 100,
      storage_debt_bytes: 0,
      efficiency_score: 100,
      evidence_status: 'measured',
      confidence: 'high',
      savings_basis: 'video_sample_encode',
      missing_seasons: '[]',
      missing_episodes: '[]',
    })
    await mediaRepo.upsertItem(mockEpisode('Measured Zero Show', 1, 1))

    const [summary] = await repo.getSummaries({ sourceId: 'src-1', libraryId: 'lib-1' })

    expect(summary.total_recoverable_bytes).toBe(0)
    expect(summary.weighted_efficiency).toBe(100)
    expect(summary.scored_episode_count).toBe(1)
    expect(summary.unscored_episode_count).toBe(0)
    expect(summary.recommended_action).toBe('no-optimization')
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

  it('accurately resolves season count and owned counts even when total_seasons is 0 or unanalyzed', async () => {
    await repo.upsertCompleteness({
      series_title: 'Unanalyzed Series',
      source_id: 'src-1',
      library_id: 'lib-1',
      total_seasons: 0,
      total_episodes: 0,
      owned_seasons: 0,
      owned_episodes: 0,
      completeness_percentage: null,
      missing_seasons: '[]',
      missing_episodes: '[]',
    } as SeriesCompleteness)

    await mediaRepo.upsertItem(mockEpisode('Unanalyzed Series', 1, 1))
    await mediaRepo.upsertItem(mockEpisode('Unanalyzed Series', 1, 2))
    await mediaRepo.upsertItem(mockEpisode('Unanalyzed Series', 2, 1))

    const summaries = await repo.getSummaries()
    const summary = summaries.find(s => s.series_title === 'Unanalyzed Series')
    expect(summary).toBeDefined()
    expect(summary?.season_count).toBe(2)
    expect(summary?.owned_seasons).toBe(2)
    expect(summary?.owned_episodes).toBe(3)
    expect(summary?.episode_count).toBe(3)
  })
})
