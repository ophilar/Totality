import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setupTestDb, cleanupTestDb } from '@tests/TestUtils'
import { PlexProvider } from '@main/providers/plex/PlexProvider'
import { getSeriesCompletenessService } from '@main/services/SeriesCompletenessService'
import { MediaItemType, LibraryType } from '@main/types/database'

describe('Show-Aware Scan & Metadata Integrity', () => {
  let db: any

  beforeEach(async () => {
    db = await setupTestDb()
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanupTestDb()
  })

  describe('SeriesCompletenessService Fallbacks', () => {
    it('should use owned episode count for total_episodes when TMDB is unavailable', async () => {
      const service = getSeriesCompletenessService()
      
      // 1. Setup owned episodes for an unmatched show
      await db.sources.upsertSource({ source_id: 's1', source_type: 'local', display_name: 'Local', connection_config: '{}', is_enabled: 1 })
      await db.media.upsertItem({
        source_id: 's1',
        library_id: '2',
        plex_id: 'ep1',
        title: 'Episode 1',
        type: MediaItemType.Episode,
        series_title: 'Unmatched Show',
        season_number: 1,
        episode_number: 1,
        file_path: '/path/to/ep1.mkv',
        poster_url: 'provider-poster-url'
      } as any)

      // 2. Run analysis without TMDB key
      await db.config.setSetting('tmdb_api_key', '')
      const analysis = await service.analyzeSeries('Unmatched Show', 's1', '2')

      // 3. Verify integrity
      expect(analysis).not.toBeNull()
      expect(analysis!.total_episodes).toBe(1) // Should NOT be 0
      expect(analysis!.owned_episodes).toBe(1)
      expect(analysis!.poster_url).toBe('provider-poster-url') // Should fallback to episode poster
      expect(analysis!.completeness_percentage).toBe(-1)
    })

    it('should preserve existing TMDB ID and poster when re-analyzing without internet', async () => {
      const service = getSeriesCompletenessService()
      
      // 1. Setup a show that ALREADY has metadata
      await db.tvShows.upsertCompleteness({
        series_title: 'Matched Show',
        source_id: 's1',
        library_id: '2',
        total_seasons: 5,
        total_episodes: 100,
        owned_seasons: 1,
        owned_episodes: 1,
        missing_seasons: '[]',
        missing_episodes: '[]',
        completeness_percentage: 1,
        tmdb_id: '12345',
        poster_url: 'existing-poster-url'
      })

      await db.media.upsertItem({
        source_id: 's1', library_id: '2', plex_id: 'ep2', title: 'Ep 1', type: MediaItemType.Episode,
        series_title: 'Matched Show', season_number: 1, episode_number: 1, file_path: '/p2.mkv'
      } as any)

      // 2. Run analysis without TMDB key (simulating offline/no key)
      await db.config.setSetting('tmdb_api_key', '')
      const analysis = await service.analyzeSeries('Matched Show', 's1', '2')

      // 3. Verify metadata is PRESERVED
      expect(analysis!.tmdb_id).toBe('12345')
      expect(analysis!.poster_url).toBe('existing-poster-url')
    })
  })

  describe('Provider Show-Awareness (Plex Simulation)', () => {
    it('should upsert show completeness stubs during initial scan', async () => {
      // 1. Mock Plex response with a show and episodes
      const provider = new PlexProvider({ sourceId: 'p1', sourceName: 'Plex', sourceType: 'plex', connectionConfig: { token: 't' } })
      
      // Mock the internal fetcher to return a show
      vi.spyOn(provider as any, 'getLibraries').mockResolvedValue([{ id: '2', name: 'TV', type: LibraryType.Show }])
      vi.spyOn(provider as any, 'paginatedPlexFetch').mockResolvedValue([
        { ratingKey: 'show1', type: 'show', title: 'Plex Show', thumb: '/thumb.jpg', Guid: [{ id: 'tmdb://999' }] }
      ])
      vi.spyOn(provider as any, 'getShowEpisodes').mockResolvedValue([
        { ratingKey: 'ep1', type: 'episode', title: 'Ep 1', grandparentTitle: 'Plex Show', Media: [{ id: 1, Part: [{ file: 'f.mkv' }] }] }
      ])
      vi.spyOn(provider as any, 'getItemMetadataDetailed').mockResolvedValue({
        ratingKey: 'ep1', type: 'episode', title: 'Ep 1', grandparentTitle: 'Plex Show', Media: [{ id: 1, Part: [{ file: 'f.mkv' }] }]
      })

      // Select a server (mocked)
      ;(provider as any).selectedServer = { uri: 'http://plex:32400', accessToken: 't' }

      // 2. Run Scan
      await provider.scanLibrary('2')

      // 3. Verify the show stub exists in DB BEFORE any analysis
      const show = await db.tvShows.getCompletenessByTitle('Plex Show', 'p1', '2')
      expect(show).not.toBeNull()
      expect(show.tmdb_id).toBe('999')
      expect(show.poster_url).toContain('/thumb.jpg')
    })
  })
})
