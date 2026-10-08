import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockDb = {
  getEpisodes: vi.fn(),
  getEpisodesForSeries: vi.fn(),
  upsertSeriesCompleteness: vi.fn(),
  getSeriesCompletenessByIdentity: vi.fn(),
  getMediaSourceById: vi.fn(),
  startBatch: vi.fn(),
  commitBatch: vi.fn(),
  getAllSeriesCompleteness: vi.fn(),
  getMediaItems: vi.fn(),
}

const mockTMDB = {
  initialize: vi.fn(),
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

    expect(mockDb.getEpisodesForSeries).not.toHaveBeenCalled()
    expect(mockDb.getEpisodes).not.toHaveBeenCalled()
  })

  it('queries database strictly by seriesIdentityKey via db.getEpisodes without calling getEpisodesForSeries', async () => {
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
    expect(mockDb.getEpisodesForSeries).not.toHaveBeenCalled()
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
    expect(mockDb.getEpisodesForSeries).not.toHaveBeenCalled()

    expect(ukShow?.series_identity_key).toBe('tmdb:2996')
    expect(usShow?.series_identity_key).toBe('tmdb:2353')
  })
})
