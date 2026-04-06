import { describe, it, expect, beforeEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { TVShowRepository } from '../../src/main/database/repositories/TVShowRepository'
import { MediaRepository } from '../../src/main/database/repositories/MediaRepository'
import { runMigrations } from '../../src/main/database/DatabaseMigration'
import type { MediaItem, SeriesCompleteness } from '../../src/main/types/database'

describe('TVShowRepository', () => {
  let db: Database.Database
  let repo: TVShowRepository
  let mediaRepo: MediaRepository

  beforeEach(() => {
    db = new DatabaseSync(':memory:')
    runMigrations(db)
    repo = new TVShowRepository(db)
    mediaRepo = new MediaRepository(db)
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

  it('should return TV show summaries with episode counts', () => {
    // Use repository method instead of raw SQL to ensure all NOT NULL columns are handled
    repo.upsertSeriesCompleteness({
      series_title: 'Breaking Bad',
      source_id: 'src-1',
      library_id: 'lib-1',
      total_seasons: 5,
      total_episodes: 62,
      owned_seasons: 1,
      owned_episodes: 2,
      completeness_percentage: 50,
    } as SeriesCompleteness)

    // Insert actual episodes
    mediaRepo.upsertMediaItem(mockEpisode('Breaking Bad', 1, 1))
    mediaRepo.upsertMediaItem(mockEpisode('Breaking Bad', 1, 2))

    const summaries = repo.getTVShowSummaries()
    expect(summaries).toHaveLength(1)
    expect(summaries[0].series_title).toBe('Breaking Bad')
    expect(summaries[0].current_episodes).toBe(2)
  })

  it('should filter TV shows by search query', () => {
    repo.upsertSeriesCompleteness({
      series_title: 'The Wire',
      total_seasons: 5,
      total_episodes: 60,
      owned_seasons: 5,
      owned_episodes: 60,
      completeness_percentage: 100,
    } as SeriesCompleteness)
    
    repo.upsertSeriesCompleteness({
      series_title: 'Breaking Bad',
      total_seasons: 5,
      total_episodes: 62,
      owned_seasons: 5,
      owned_episodes: 62,
      completeness_percentage: 100,
    } as SeriesCompleteness)

    const results = repo.getTVShowSummaries({ searchQuery: 'Wire' })
    expect(results).toHaveLength(1)
    expect(results[0].series_title).toBe('The Wire')
  })

  it('should retrieve episodes for a specific show', () => {
    mediaRepo.upsertMediaItem(mockEpisode('Breaking Bad', 1, 1))
    mediaRepo.upsertMediaItem(mockEpisode('The Wire', 1, 1))

    const episodes = repo.getTVShowEpisodes('Breaking Bad')
    expect(episodes).toHaveLength(1)
    expect(episodes[0].series_title).toBe('Breaking Bad')
  })
})
