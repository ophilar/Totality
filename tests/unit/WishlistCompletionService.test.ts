import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WishlistItem } from '../../src/main/types/database'

const db = vi.hoisted(() => ({
  getActiveWishlistItems: vi.fn(),
  updateWishlistItem: vi.fn(),
  getMediaItemsByTmdbIds: vi.fn(),
  getMediaItems: vi.fn(),
  getEpisodeCountBySeriesTmdbId: vi.fn(),
  getEpisodeCountForSeason: vi.fn(),
  getEpisodeCountForSeasonEpisode: vi.fn(),
  getMusicAlbumsByMusicbrainzIds: vi.fn(),
  getMusicTracksByMusicbrainzIds: vi.fn(),
  getMusicAlbums: vi.fn(),
  getMusicTracks: vi.fn(),
}))

vi.mock('electron', () => ({ BrowserWindow: vi.fn() }))
vi.mock('../../src/main/database/getDatabase', () => ({
  getDatabase: () => db,
}))
vi.mock('../../src/main/ipc/utils/safeSend', () => ({ safeSend: vi.fn() }))

import { WishlistCompletionService } from '../../src/main/services/WishlistCompletionService'

const item = (overrides: Partial<WishlistItem>): WishlistItem =>
  ({ id: 1, title: 'Example', status: 'active', reason: 'missing', ...overrides }) as WishlistItem

async function completed(items: WishlistItem[]): Promise<number[]> {
  db.getActiveWishlistItems.mockReturnValue(items)
  await new WishlistCompletionService().checkAndComplete()
  return db.updateWishlistItem.mock.calls.map(([id]) => id as number)
}

describe('WishlistCompletionService identity safety', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    db.getMediaItemsByTmdbIds.mockReturnValue(new Map())
    db.getMediaItems.mockReturnValue([])
    db.getMusicAlbumsByMusicbrainzIds.mockReturnValue(new Map())
    db.getMusicTracksByMusicbrainzIds.mockReturnValue(new Map())
    db.getMusicAlbums.mockReturnValue([])
    db.getMusicTracks.mockReturnValue([])
    db.getEpisodeCountBySeriesTmdbId.mockReturnValue(0)
    db.getEpisodeCountForSeason.mockReturnValue(0)
    db.getEpisodeCountForSeasonEpisode.mockReturnValue(0)
  })

  it('does not substitute a same-title movie when its TMDB identity disagrees', async () => {
    db.getMediaItems.mockReturnValue([{ title: 'Example', year: 2024, type: 'movie' }])
    expect(await completed([item({ media_type: 'movie', tmdb_id: '123', year: 2024 })])).toEqual([])
    expect(db.getMediaItems).not.toHaveBeenCalled()
  })

  it('does not confuse TV episode TMDB identity with movie identity', async () => {
    db.getMediaItemsByTmdbIds.mockReturnValue(new Map([['123', { tmdb_id: '123', type: 'episode' }]]))
    expect(await completed([item({ media_type: 'movie', tmdb_id: '123' })])).toEqual([])
  })

  it('completes a movie when its TMDB identity and type match', async () => {
    db.getMediaItemsByTmdbIds.mockReturnValue(new Map([['123', { tmdb_id: '123', type: 'movie' }]]))
    expect(await completed([item({ media_type: 'movie', tmdb_id: '123' })])).toEqual([1])
  })

  it('requires an unambiguous title-and-year match without an external identity', async () => {
    db.getMediaItems.mockReturnValue([{ title: 'Example', year: 2024, type: 'movie' }])
    expect(await completed([item({ media_type: 'movie', year: 2024 })])).toEqual([1])
    db.updateWishlistItem.mockClear()
    db.getMediaItems.mockReturnValue([
      { title: 'Example', year: 2024, type: 'movie' },
      { title: 'Example', year: 2024, type: 'movie' },
    ])
    expect(await completed([item({ media_type: 'movie', year: 2024 })])).toEqual([])
  })

  it('checks a specific season instead of treating series-level evidence as ownership', async () => {
    expect(await completed([item({ media_type: 'season', series_title: 'Example', season_number: 5, tmdb_id: '10' })])).toEqual([])
    expect(db.getEpisodeCountBySeriesTmdbId).toHaveBeenCalledWith('10', 5)
    db.updateWishlistItem.mockClear()
    db.getEpisodeCountBySeriesTmdbId.mockReturnValue(3)
    expect(await completed([item({ media_type: 'season', series_title: 'Example', season_number: 5, tmdb_id: '10' })])).toEqual([1])
  })

  it('does not substitute an album title when its MusicBrainz ID disagrees', async () => {
    db.getMusicAlbums.mockReturnValue([{ title: 'Example', artist_name: 'Artist' }])
    expect(await completed([item({ media_type: 'album', musicbrainz_id: 'album-42', artist_name: 'Artist' })])).toEqual([])
    expect(db.getMusicAlbums).not.toHaveBeenCalled()
  })

  it('requires the artist to match when an album has no external ID', async () => {
    db.getMusicAlbums.mockReturnValue([{ title: 'Example', artist_name: 'Different Artist' }])
    expect(await completed([item({ media_type: 'album', artist_name: 'Artist' })])).toEqual([])
    db.updateWishlistItem.mockClear()
    db.getMusicAlbums.mockReturnValue([{ title: 'Example', artist_name: 'Artist' }])
    expect(await completed([item({ media_type: 'album', artist_name: 'Artist' })])).toEqual([1])
  })
})
