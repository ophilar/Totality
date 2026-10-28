/**
 * SeriesCompletenessService Tests
 *
 * Tests series completeness analysis — episode counting, missing episode
 * detection, season 0 handling, and completeness calculation.
 */

vi.mock('../../src/main/database/getDatabase', () => ({
  getDatabase: vi.fn(() => mockDb),
}))

vi.mock('../../src/main/services/TMDBService', () => ({
  getTMDBService: vi.fn(() => mockTmdb),
}))

vi.mock('../../src/main/services/LoggingService', () => ({
  getLoggingService: vi.fn(() => ({
    verbose: vi.fn(),
  })),
}))

const mockDb = {
  getSetting: vi.fn(() => 'fake-key'),
  getMediaItems: vi.fn(() => []),
  getMediaSources: vi.fn(() => []),
  getEpisodes: vi.fn(() => []),
  getSeriesCompletenessByIdentity: vi.fn(() => null),
  upsertSeriesCompleteness: vi.fn(() => 1),
  deleteSeriesCompleteness: vi.fn(),
  getSeriesCompleteness: vi.fn(() => []),
  getAllSeriesCompleteness: vi.fn(() => []),
  updateMediaItemArtwork: vi.fn(),
  getMediaSourceById: vi.fn(() => null),
  startBatch: vi.fn(),
  endBatch: vi.fn(),
  forceSave: vi.fn(),
}

const mockTmdb = {
  initialize: vi.fn(),
  isConfigured: vi.fn(() => true),
  getTVShowDetails: vi.fn(),
  getTVShowWithSeasons: vi.fn(),
  getSeasonDetails: vi.fn(),
  searchTVShow: vi.fn(),
  buildImageUrl: vi.fn((path: string) => path ? `https://img${path}` : null),
}

import { getSeriesCompletenessService } from '../../src/main/services/SeriesCompletenessService'

describe('SeriesCompletenessService', () => {
  let service: ReturnType<typeof getSeriesCompletenessService>

  beforeEach(() => {
    vi.clearAllMocks()
    service = getSeriesCompletenessService()
    service.resetCancellation()
  })

  describe('analyzeSeries', () => {
    it('returns null when no episodes found', async () => {
      mockDb.getEpisodes.mockReturnValue([])

      const result = await service.analyzeSeries('unresolved:src1:lib1:unknown-show', 'src1', 'lib1')

      expect(result).toBeNull()
    })

    it('propagates TMDB configuration errors to the caller', async () => {
      mockDb.getEpisodes.mockReturnValue([
        { season_number: 1, episode_number: 1, series_title: 'Test Show', series_identity_key: 'tmdb:1234' },
      ])
      mockTmdb.getTVShowDetails.mockRejectedValue(new Error('TMDB API key not configured. Please add your API key in Settings.'))

      await expect(service.analyzeSeries('tmdb:1234', 'src1', 'lib1', '1234'))
        .rejects.toThrow('TMDB API key not configured. Please add your API key in Settings.')
    })

    it('creates unmatched result when TMDB ID not found', async () => {
      mockDb.getEpisodes.mockReturnValue([
        { season_number: 1, episode_number: 1, series_tmdb_id: null, title: 'Ep1', series_title: 'No Match Show', series_identity_key: 'unresolved:src1:lib1:no-match-show' },
      ])
      mockTmdb.searchTVShow.mockResolvedValue({ results: [] })
      mockDb.getSeriesCompletenessByIdentity.mockReturnValue({
        series_title: 'No Match Show',
        series_identity_key: 'unresolved:src1:lib1:no-match-show',
        owned_episodes: 1,
        completeness_percentage: 0,
      })

      const result = await service.analyzeSeries('unresolved:src1:lib1:no-match-show', 'src1', 'lib1')

      expect(result).toBeDefined()
      expect(mockDb.upsertSeriesCompleteness).toHaveBeenCalled()
    })

    it('analyzes series with cached TMDB ID', async () => {
      mockDb.getEpisodes.mockReturnValue([
        { season_number: 1, episode_number: 1, series_tmdb_id: '1234', series_title: 'Test Show', series_identity_key: 'tmdb:1234' },
        { season_number: 1, episode_number: 2, series_tmdb_id: '1234', series_title: 'Test Show', series_identity_key: 'tmdb:1234' },
      ])

      mockTmdb.getTVShowDetails.mockResolvedValue({
        poster_path: '/poster.jpg',
        backdrop_path: '/bg.jpg',
        status: 'Ended',
        seasons: [
          { season_number: 1, air_date: '2020-01-01' },
        ],
      })

      mockTmdb.getTVShowWithSeasons.mockResolvedValue({
        'season/1': {
          poster_path: null,
          episodes: [
            { season_number: 1, episode_number: 1, name: 'Pilot', air_date: '2020-01-01' },
            { season_number: 1, episode_number: 2, name: 'Second', air_date: '2020-01-08' },
            { season_number: 1, episode_number: 3, name: 'Third', air_date: '2020-01-15' },
          ],
        },
      })

      mockDb.getSeriesCompletenessByIdentity.mockReturnValue({
        series_title: 'Test Show',
        series_identity_key: 'tmdb:1234',
        total_episodes: 3,
        owned_episodes: 2,
        completeness_percentage: 67,
      })

      const result = await service.analyzeSeries('tmdb:1234', 'src1', 'lib1', '1234')

      expect(result).toBeDefined()
      expect(mockTmdb.getTVShowDetails).toHaveBeenCalledWith('1234')
      expect(mockDb.upsertSeriesCompleteness).toHaveBeenCalled()

      // Check the upsert was called with correct data
      const upsertCall = mockDb.upsertSeriesCompleteness.mock.calls[0][0]
      expect(upsertCall.total_episodes).toBe(3)
      expect(upsertCall.owned_episodes).toBe(2)
      expect(upsertCall.completeness_percentage).toBe(67)
    })

    it('excludes season 0 specials from owned count', async () => {
      mockDb.getEpisodes.mockReturnValue([
        { season_number: 0, episode_number: 1, series_tmdb_id: '100', series_title: 'Show', series_identity_key: 'tmdb:100' }, // Special
        { season_number: 1, episode_number: 1, series_tmdb_id: '100', series_title: 'Show', series_identity_key: 'tmdb:100' },
        { season_number: 1, episode_number: 1, series_tmdb_id: '100', series_title: 'Show', series_identity_key: 'tmdb:100' }, // Duplicate file
        { season_number: 1, episode_number: 2, series_tmdb_id: '100', series_title: 'Show', series_identity_key: 'tmdb:100' }, // Not in TMDB aired catalogue
      ])

      mockTmdb.getTVShowDetails.mockResolvedValue({
        poster_path: null, backdrop_path: null, status: 'Ended',
        seasons: [
          { season_number: 0, air_date: '2019-01-01' },
          { season_number: 1, air_date: '2020-01-01' },
        ],
      })

      mockTmdb.getTVShowWithSeasons.mockResolvedValue({
        'season/1': {
          poster_path: null,
          episodes: [
            { season_number: 1, episode_number: 1, name: 'Ep', air_date: '2020-01-01' },
          ],
        },
      })

      mockDb.getSeriesCompletenessByIdentity.mockReturnValue({ completeness_percentage: 100, series_identity_key: 'tmdb:100' })

      await service.analyzeSeries('tmdb:100', 'src1', 'lib1', '100')

      const upsertCall = mockDb.upsertSeriesCompleteness.mock.calls[0][0]
      // owned_episodes should be 1 (season 0 excluded)
      expect(upsertCall.owned_episodes).toBe(1)
      expect(upsertCall.owned_seasons).toBe(1)
      expect(upsertCall.total_episodes).toBe(1)
      expect(upsertCall.missing_episodes).toEqual([])
      expect(upsertCall.completeness_percentage).toBe(100)
    })

    it('counts only unique owned coordinates in the aired TMDB catalogue', async () => {
      // User has duplicate files and an extra coordinate beyond the aired TMDB catalogue.
      mockDb.getEpisodes.mockReturnValue([
        { season_number: 1, episode_number: 1, series_tmdb_id: '200', series_title: 'Show', series_identity_key: 'tmdb:200' },
        { season_number: 1, episode_number: 2, series_tmdb_id: '200', series_title: 'Show', series_identity_key: 'tmdb:200' },
        { season_number: 1, episode_number: 3, series_tmdb_id: '200', series_title: 'Show', series_identity_key: 'tmdb:200' }, // Extra
      ])

      mockTmdb.getTVShowDetails.mockResolvedValue({
        poster_path: null, backdrop_path: null, status: 'Ended',
        seasons: [{ season_number: 1, air_date: '2020-01-01' }],
      })

      mockTmdb.getTVShowWithSeasons.mockResolvedValue({
        'season/1': {
          poster_path: null,
          episodes: [
            { season_number: 1, episode_number: 1, name: 'Ep', air_date: '2020-01-01' },
            { season_number: 1, episode_number: 2, name: 'Unaired', air_date: '2099-01-01' },
          ],
        },
      })

      mockDb.getSeriesCompletenessByIdentity.mockReturnValue({ completeness_percentage: 100, series_identity_key: 'tmdb:200' })

      await service.analyzeSeries('tmdb:200', 'src1', 'lib1', '200')

      const upsertCall = mockDb.upsertSeriesCompleteness.mock.calls[0][0]
      expect(upsertCall.owned_episodes).toBe(1)
      expect(upsertCall.total_episodes).toBe(1)
      expect(upsertCall.missing_episodes).toEqual([])
      expect(upsertCall.completeness_percentage).toBe(100)
    })
  })

  describe('analyzeAllSeries', () => {
    it('completes with no series to analyze', async () => {
      mockDb.getMediaItems.mockReturnValue([])

      const result = await service.analyzeAllSeries(undefined, 'src1')

      expect(result.completed).toBe(true)
      expect(result.analyzed).toBe(0)
    })
  })
})
