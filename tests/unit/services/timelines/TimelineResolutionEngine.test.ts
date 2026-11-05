import { describe, expect, it } from 'vitest'
import type { MediaItem, SeriesCompleteness } from '@main/types/database'
import type { TimelineDefinition } from '@main/services/timelines/ITimelineRecipeProvider'
import { TimelineResolutionEngine } from '@main/services/timelines/TimelineResolutionEngine'

const media = (overrides: Partial<MediaItem> = {}): MediaItem => ({
  id: 1, source_id: 'plex', source_type: 'plex', plex_id: 'plex-1', title: 'The Fellowship of the Ring', type: 'movie', file_path: 'C:/Movies/Fellowship.mkv',
  file_size: 1, duration: 100, resolution: '1080p', width: 1920, height: 1080, video_codec: 'hevc', video_bitrate: 1,
  audio_codec: 'aac', audio_channels: 2, audio_bitrate: 1, year: 2001, tmdb_id: '120',
  ...overrides,
})

const timeline: TimelineDefinition = {
  id: 'lotr', franchise: 'Middle-earth', name: 'Middle-earth order', description: '', version: 1,
  items: [{ order: 1, type: 'movie', title: 'The Fellowship of the Ring', releaseYear: 2001, identifiers: { tmdbId: 120 } }],
}

describe('TimelineResolutionEngine', () => {
  it('matches a title by its stable TMDB identifier', async () => {
    const engine = new TimelineResolutionEngine(() => [media()])
    const result = await engine.resolveTimeline(timeline, 'plex')
    expect(result.matchedCount).toBe(1)
    expect(result.items[0].matchedMediaItem?.plexId).toBe('plex-1')
  })

  it('reports duplicate identities as ambiguous', async () => {
    const engine = new TimelineResolutionEngine(() => [media(), media({ plex_id: 'plex-2' })])
    const result = await engine.resolveTimeline(timeline, 'plex')
    expect(result.ambiguousCount).toBe(1)
    expect(result.items[0].status).toBe('ambiguous')
  })

  it('does not resolve availability until a source is selected', async () => {
    const result = await new TimelineResolutionEngine(() => [media()]).resolveTimeline(timeline)
    expect(result.missingCount).toBe(1)
    expect(result.items[0].reason).toMatch(/select a media source/i)
  })

  it('reports malformed missing episode data with the affected series', async () => {
    const showTimeline: TimelineDefinition = {
      ...timeline,
      items: [{ order: 1, type: 'show', title: 'The Show', releaseYear: 2020, identifiers: { tmdbId: 120 } }],
    }
    const completeness = [{
      series_title: 'The Show',
      tmdb_id: '120',
      missing_episodes: 'invalid JSON',
    }] as unknown as SeriesCompleteness[]
    const engine = new TimelineResolutionEngine(() => [], () => completeness)

    await expect(engine.resolveTimeline(showTimeline, 'plex'))
      .rejects.toThrow('Invalid missing episode data for series "The Show"')
  })

  it('honors cancellation while resolving large guides', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(new TimelineResolutionEngine(() => []).resolveTimeline(timeline, 'plex', controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })
})
