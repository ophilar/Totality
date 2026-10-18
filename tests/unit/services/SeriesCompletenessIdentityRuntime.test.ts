import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockDb = {
  getEpisodes: vi.fn(),
  upsertSeriesCompleteness: vi.fn(),
  getSeriesCompletenessByIdentity: vi.fn(),
  getMediaSourceById: vi.fn(),
  startBatch: vi.fn(),
  endBatch: vi.fn(),
  commitBatch: vi.fn(),
  getAllSeriesCompleteness: vi.fn(),
  getMediaItems: vi.fn(),
}

const mockTMDB = {
  initialize: vi.fn(),
  isConfigured: vi.fn(() => true),
  getTVShowDetails: vi.fn(),
  getTVShowWithSeasons: vi.fn(),
  buildImageUrl: vi.fn(),
  findByExternalId: vi.fn(),
  searchTVShow: vi.fn(),
}

vi.mock('../../../src/main/database/getDatabase', () => ({
  getDatabase: () => mockDb,
}))

vi.mock('../../../src/main/services/TMDBService', () => ({
  getTMDBService: () => mockTMDB,
}))

vi.mock('../../../src/main/services/LoggingService', () => ({
  getLoggingService: () => ({
    verbose: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

import { SeriesCompletenessService } from '../../../src/main/services/SeriesCompletenessService'

describe('SeriesCompletenessService - Runtime Identity Path Enforcement', () => {
  let service: SeriesCompletenessService

  beforeEach(() => {
    vi.clearAllMocks()
    mockTMDB.getTVShowDetails.mockResolvedValue({
      poster_path: '/poster.jpg',
      backdrop_path: '/backdrop.jpg',
      status: 'Ended',
      seasons: [],
    })
    mockTMDB.buildImageUrl.mockImplementation((path: string) => `https://image.tmdb.org/t/p/w500${path}`)
    service = new SeriesCompletenessService()
  })

  it('rejects raw title queries and strictly requires canonical series identity keys', async () => {
    await expect(service.analyzeSeries('Doctor Who')).rejects.toThrow(
      /analyzeSeries requires a canonical series identity key/
    )

    await expect(service.analyzeSeries('Breaking Bad', 'src-1', 'lib-1')).rejects.toThrow(
      /Title-based lookups are not permitted/
    )

    expect(mockDb.getEpisodes).not.toHaveBeenCalled()
  })

  it('queries database strictly by seriesIdentityKey via db.getEpisodes', async () => {
    mockDb.getEpisodes.mockReturnValue([
      {
        id: 101,
        title: 'Pilot',
        series_title: 'Breaking Bad',
        season_number: 1,
        episode_number: 1,
        series_identity_key: 'tmdb:1396',
      },
    ])

    mockTMDB.getTVShowWithSeasons.mockResolvedValue({
      seasons: [{ season_number: 1, episode_count: 7 }],
      'season/1': {
        season_number: 1,
        episodes: [
          { episode_number: 1, name: 'Pilot' },
          { episode_number: 2, name: 'Cat\'s in the Bag...' },
        ],
      },
    })

    mockDb.getSeriesCompletenessByIdentity.mockReturnValue({
      id: 1,
      series_title: 'Breaking Bad',
      series_identity_key: 'tmdb:1396',
      completeness_percentage: 50,
    })

    const result = await service.analyzeSeries('tmdb:1396', 'src-1', 'lib-1')

    expect(mockDb.getEpisodes).toHaveBeenCalledWith('', 'src-1', 'tmdb:1396', 'lib-1')
    expect(result).toBeDefined()
    expect(result?.series_identity_key).toBe('tmdb:1396')
  })

  it('prevents title collision by isolating same-titled shows via distinct identity keys', async () => {
    // Show 1: The Office (UK)
    mockDb.getEpisodes.mockImplementation((_title, _src, key) => {
      if (key === 'tmdb:2996') {
        return [
          {
            id: 201,
            title: 'Downsize',
            series_title: 'The Office',
            season_number: 1,
            episode_number: 1,
            series_identity_key: 'tmdb:2996',
          },
        ]
      }
      if (key === 'tmdb:2353') {
        return [
          {
            id: 301,
            title: 'Pilot',
            series_title: 'The Office',
            season_number: 1,
            episode_number: 1,
            series_identity_key: 'tmdb:2353',
          },
        ]
      }
      return []
    })

    mockTMDB.getTVShowWithSeasons.mockResolvedValue({
      seasons: [{ season_number: 1, episode_count: 6 }],
      'season/1': {
        season_number: 1,
        episodes: [{ episode_number: 1, name: 'Episode 1' }],
      },
    })

    mockDb.getSeriesCompletenessByIdentity.mockImplementation((key) => ({
      id: key === 'tmdb:2996' ? 2996 : 2353,
      series_title: 'The Office',
      series_identity_key: key,
    }))

    const ukShow = await service.analyzeSeries('tmdb:2996', 'src-uk', 'lib-uk')
    const usShow = await service.analyzeSeries('tmdb:2353', 'src-us', 'lib-us')

    expect(mockDb.getEpisodes).toHaveBeenCalledWith('', 'src-uk', 'tmdb:2996', 'lib-uk')
    expect(mockDb.getEpisodes).toHaveBeenCalledWith('', 'src-us', 'tmdb:2353', 'lib-us')

    expect(ukShow?.series_identity_key).toBe('tmdb:2996')
    expect(usShow?.series_identity_key).toBe('tmdb:2353')
  })

  it('analyzeAllSeries groups episodes strictly by persisted series_identity_key', async () => {
    mockDb.getMediaItems.mockReturnValue([
      {
        id: 401,
        title: 'Episode 1',
        type: 'episode',
        series_title: 'Keyed Show',
        series_identity_key: 'tmdb:99999',
        source_id: 'src-1',
        library_id: 'lib-1',
        series_tmdb_id: 99999,
        season_number: 1,
        episode_number: 1,
      },
    ])
    mockDb.getEpisodes.mockReturnValue([
      {
        id: 401,
        title: 'Episode 1',
        type: 'episode',
        series_title: 'Keyed Show',
        series_identity_key: 'tmdb:99999',
        season_number: 1,
        episode_number: 1,
      },
    ])
    mockTMDB.getTVShowWithSeasons.mockResolvedValue({
      seasons: [{ season_number: 1, episode_count: 1 }],
      'season/1': {
        season_number: 1,
        episodes: [{ episode_number: 1, name: 'Episode 1' }],
      },
    })
    mockDb.getSeriesCompletenessByIdentity.mockReturnValue({
      id: 999,
      series_title: 'Keyed Show',
      series_identity_key: 'tmdb:99999',
    })

    const result = await service.analyzeAllSeries(undefined, 'src-1', 'lib-1', {
      skipRecentlyAnalyzed: false,
    })

    expect(result.analyzed).toBe(1)
    expect(mockDb.getEpisodes).toHaveBeenCalledWith('', 'src-1', 'tmdb:99999', 'lib-1')
  })

  it('analyzeAllSeries fails visibly with an invariant violation error when an unkeyed episode is encountered', async () => {
    mockDb.getMediaItems.mockReturnValue([
      {
        id: 402,
        title: 'Corrupt Episode',
        type: 'episode',
        series_title: 'Unkeyed Show',
        series_identity_key: '', // Invariant violation: unkeyed
        source_id: 'src-1',
        library_id: 'lib-1',
        season_number: 1,
        episode_number: 2,
      },
    ])

    await expect(
      service.analyzeAllSeries(undefined, 'src-1', 'lib-1', {
        skipRecentlyAnalyzed: false,
      })
    ).rejects.toThrow(/Invariant violation: episode media_item 402 .* has no persisted series_identity_key/)
  })
})
