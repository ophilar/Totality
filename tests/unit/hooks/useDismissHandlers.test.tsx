/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDismissHandlers } from '@/components/library/hooks/useDismissHandlers'
import type {
  MediaItem,
  MissingEpisode,
  MissingAlbum,
  SeriesCompletenessData,
  MovieCollectionData,
  ArtistCompletenessData,
} from '@/components/library/types'
import { emitDismissUpgrade, emitDismissCollectionMovie } from '@/utils/dismissEvents'

vi.mock('@/utils/dismissEvents', () => ({
  emitDismissUpgrade: vi.fn(),
  emitDismissCollectionMovie: vi.fn(),
}))

describe('useDismissHandlers', () => {
  const mockAddExclusion = vi.fn()
  const mockRemoveExclusion = vi.fn()
  const mockLogError = vi.fn()

  const setPaginatedMovies = vi.fn()
  const setSelectedShowEpisodes = vi.fn()
  const setSeriesCompleteness = vi.fn()
  const setSelectedCollection = vi.fn()
  const setMovieCollections = vi.fn()
  const setArtistCompleteness = vi.fn()
  const setSelectedMissingItem = vi.fn()
  const addToast = vi.fn()


  beforeEach(() => {
    vi.clearAllMocks()

    // Setup window.electronAPI mock
    window.electronAPI = {
      addExclusion: mockAddExclusion,
      removeExclusion: mockRemoveExclusion,
      log: {
        error: mockLogError,
      },
    } as unknown as typeof window.electronAPI
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function createOptions(overrides = {}) {
    return {
      setPaginatedMovies,
      setSelectedShowEpisodes,
      seriesCompleteness: new Map<string, SeriesCompletenessData>(),
      setSeriesCompleteness,
      selectedCollection: null as MovieCollectionData | null,
      setSelectedCollection,
      setMovieCollections,
      setArtistCompleteness,
      selectedMissingItem: null,
      setSelectedMissingItem,
      addToast,
      ...overrides,
    }
  }

  describe('handleDismissUpgrade', () => {
    it('successfully dismisses upgrade for a movie, emits event, adds toast, and handles undo', async () => {
      mockAddExclusion.mockResolvedValue('ex-123')
      mockRemoveExclusion.mockResolvedValue(undefined)

      const options = createOptions()
      const { result } = renderHook(() => useDismissHandlers(options))

      const item = {
        id: 1,
        title: 'Test Movie',
        needs_upgrade: true,
        tier_quality: 'LOW',
      } as MediaItem

      await act(async () => {
        await result.current.handleDismissUpgrade(item)
      })

      expect(mockAddExclusion).toHaveBeenCalledWith('media_upgrade', 1, undefined, undefined, 'Test Movie')

      // Check state updates for paginated movies
      expect(setPaginatedMovies).toHaveBeenCalledTimes(1)
      const movieUpdater = setPaginatedMovies.mock.calls[0][0]
      const updatedMovies = movieUpdater([{ id: 1, needs_upgrade: true, tier_quality: 'LOW' } as MediaItem])
      expect(updatedMovies).toEqual([{ id: 1, needs_upgrade: false, tier_quality: 'MEDIUM' }])

      // Check state updates for show episodes
      expect(setSelectedShowEpisodes).toHaveBeenCalledTimes(1)
      const epUpdater = setSelectedShowEpisodes.mock.calls[0][0]
      const updatedEps = epUpdater([{ id: 1, needs_upgrade: true, tier_quality: 'HIGH' } as MediaItem])
      expect(updatedEps).toEqual([{ id: 1, needs_upgrade: false, tier_quality: 'HIGH' }])

      expect(emitDismissUpgrade).toHaveBeenCalledWith({ mediaId: 1 })
      expect(addToast).toHaveBeenCalledWith({
        type: 'success',
        title: 'Upgrade dismissed',
        message: '"Test Movie" removed from upgrade recommendations',
        duration: 8000,
        action: expect.objectContaining({
          label: 'Undo',
          onClick: expect.any(Function),
        }),
      })

      // Test undo action
      const undoAction = addToast.mock.calls[0][0].action.onClick
      await act(async () => {
        await undoAction()
      })

      expect(mockRemoveExclusion).toHaveBeenCalledWith('ex-123')
      expect(setPaginatedMovies).toHaveBeenCalledTimes(2)
      const movieUndoUpdater = setPaginatedMovies.mock.calls[1][0]
      expect(movieUndoUpdater([{ id: 1, needs_upgrade: false } as MediaItem])).toEqual([{ id: 1, needs_upgrade: true }])

      expect(setSelectedShowEpisodes).toHaveBeenCalledTimes(2)
      const epUndoUpdater = setSelectedShowEpisodes.mock.calls[1][0]
      expect(epUndoUpdater([{ id: 1, needs_upgrade: false } as MediaItem])).toEqual([{ id: 1, needs_upgrade: true }])
    })

    it('formats title correctly when item is an episode (has series_title)', async () => {
      mockAddExclusion.mockResolvedValue('ex-456')

      const options = createOptions()
      const { result } = renderHook(() => useDismissHandlers(options))

      const item = {
        id: 2,
        series_title: 'Breaking Bad',
        season_number: 1,
        episode_number: 5,
        needs_upgrade: true,
        tier_quality: 'MEDIUM',
      } as MediaItem

      await act(async () => {
        await result.current.handleDismissUpgrade(item)
      })

      expect(mockAddExclusion).toHaveBeenCalledWith('media_upgrade', 2, undefined, undefined, 'Breaking Bad S1E5')
      expect(addToast).toHaveBeenCalledWith(expect.objectContaining({
        message: '"Breaking Bad S1E5" removed from upgrade recommendations',
      }))
    })

    it('logs error when addExclusion fails', async () => {
      const err = new Error('Database error')
      mockAddExclusion.mockRejectedValue(err)

      const options = createOptions()
      const { result } = renderHook(() => useDismissHandlers(options))

      await act(async () => {
        await result.current.handleDismissUpgrade({ id: 1, title: 'Error Movie' } as MediaItem)
      })

      expect(mockLogError).toHaveBeenCalledWith('[useDismissHandlers]', 'Failed to dismiss upgrade:', err)
    })

    it('logs error when undo fails', async () => {
      mockAddExclusion.mockResolvedValue('ex-123')
      const undoErr = new Error('Undo error')
      mockRemoveExclusion.mockRejectedValue(undoErr)

      const options = createOptions()
      const { result } = renderHook(() => useDismissHandlers(options))

      await act(async () => {
        await result.current.handleDismissUpgrade({ id: 1, title: 'Undo Fail' } as MediaItem)
      })

      const undoAction = addToast.mock.calls[0][0].action.onClick
      await act(async () => {
        await undoAction()
      })

      expect(mockLogError).toHaveBeenCalledWith('[useDismissHandlers]', 'Failed to undo dismissed upgrade:', undoErr)
    })
  })

  describe('handleDismissMissingEpisode', () => {
    it('successfully dismisses a missing episode and updates series completeness state', async () => {
      mockAddExclusion.mockResolvedValue('ex-789')

      const seriesMap = new Map<string, SeriesCompletenessData>()
      seriesMap.set('show-1', {
        missing_episodes: JSON.stringify([
          { season_number: 1, episode_number: 1, title: 'Pilot' },
          { season_number: 1, episode_number: 2, title: 'Ep 2' },
        ]),
        missing_seasons: JSON.stringify([1]),
      } as SeriesCompletenessData)

      const options = createOptions({ seriesCompleteness: seriesMap })
      const { result } = renderHook(() => useDismissHandlers(options))

      const episode: MissingEpisode = { season_number: 1, episode_number: 1, title: 'Pilot' }

      await act(async () => {
        await result.current.handleDismissMissingEpisode(episode, 'Test Show', 'tmdb-100', 'show-1')
      })

      expect(mockAddExclusion).toHaveBeenCalledWith('series_episode', undefined, 'S1E1', 'tmdb-100', 'Test Show S1E1')

      expect(setSeriesCompleteness).toHaveBeenCalledTimes(1)
      const mapUpdater = setSeriesCompleteness.mock.calls[0][0]
      const nextMap = mapUpdater(seriesMap)
      const updatedData = nextMap.get('show-1')

      expect(JSON.parse(updatedData.missing_episodes)).toEqual([{ season_number: 1, episode_number: 2, title: 'Ep 2' }])
      expect(JSON.parse(updatedData.missing_seasons)).toEqual([1])
      expect(addToast).toHaveBeenCalledWith({ type: 'success', title: 'Item dismissed', message: '"Test Show S1E1" removed from recommendations' })
    })

    it('falls back to seriesTitle when tmdbId is not provided', async () => {
      mockAddExclusion.mockResolvedValue('ex-789')

      const seriesMap = new Map<string, SeriesCompletenessData>()
      seriesMap.set('show-1', {
        missing_episodes: JSON.stringify([{ season_number: 2, episode_number: 3 }]),
        missing_seasons: JSON.stringify([2]),
      } as SeriesCompletenessData)

      const options = createOptions({ seriesCompleteness: seriesMap })
      const { result } = renderHook(() => useDismissHandlers(options))

      await act(async () => {
        await result.current.handleDismissMissingEpisode({ season_number: 2, episode_number: 3 }, 'Show Name', undefined, 'show-1')
      })

      expect(mockAddExclusion).toHaveBeenCalledWith('series_episode', undefined, 'S2E3', 'Show Name', 'Show Name S2E3')
    })

    it('logs error on failure', async () => {
      const err = new Error('Failure')
      mockAddExclusion.mockRejectedValue(err)

      const options = createOptions()
      const { result } = renderHook(() => useDismissHandlers(options))

      await act(async () => {
        await result.current.handleDismissMissingEpisode({ season_number: 1, episode_number: 1 }, 'Show', 'tmdb-1', 'show-1')
      })

      expect(mockLogError).toHaveBeenCalledWith('[useDismissHandlers]', 'Failed to dismiss missing episode:', err)
    })
  })

  describe('handleDismissMissingSeason', () => {
    it('dismisses all missing episodes in a season and updates series completeness', async () => {
      mockAddExclusion.mockResolvedValue('ex-season')

      const seriesMap = new Map<string, SeriesCompletenessData>()
      seriesMap.set('show-1', {
        missing_episodes: JSON.stringify([
          { season_number: 1, episode_number: 1 },
          { season_number: 1, episode_number: 2 },
          { season_number: 2, episode_number: 1 },
        ]),
        missing_seasons: JSON.stringify([1, 2]),
      } as SeriesCompletenessData)

      const options = createOptions({ seriesCompleteness: seriesMap })
      const { result } = renderHook(() => useDismissHandlers(options))

      await act(async () => {
        await result.current.handleDismissMissingSeason(1, 'Great Show', 'tmdb-200', 'show-1')
      })

      expect(mockAddExclusion).toHaveBeenCalledTimes(2)
      expect(mockAddExclusion).toHaveBeenNthCalledWith(1, 'series_episode', undefined, 'S1E1', 'tmdb-200', 'Great Show S1E1')
      expect(mockAddExclusion).toHaveBeenNthCalledWith(2, 'series_episode', undefined, 'S1E2', 'tmdb-200', 'Great Show S1E2')

      expect(setSeriesCompleteness).toHaveBeenCalledTimes(1)
      const mapUpdater = setSeriesCompleteness.mock.calls[0][0]
      const nextMap = mapUpdater(seriesMap)
      const updatedData = nextMap.get('show-1')

      expect(JSON.parse(updatedData.missing_episodes)).toEqual([{ season_number: 2, episode_number: 1 }])
      // Season 1 should now be removed from missing_seasons because no season 1 episodes remain
      expect(JSON.parse(updatedData.missing_seasons)).toEqual([2])
      expect(addToast).toHaveBeenCalledWith({ type: 'success', title: 'Season dismissed', message: '2 missing episodes from Season 1 removed' })
    })

    it('logs error if dismissing season fails', async () => {
      const err = new Error('Season dismiss failed')

      const seriesMap = new Map<string, SeriesCompletenessData>()
      seriesMap.set('show-1', {
        missing_episodes: JSON.stringify([{ season_number: 1, episode_number: 1 }]),
        missing_seasons: JSON.stringify([1]),
      } as SeriesCompletenessData)

      mockAddExclusion.mockRejectedValue(err)

      const options = createOptions({ seriesCompleteness: seriesMap })
      const { result } = renderHook(() => useDismissHandlers(options))

      await act(async () => {
        await result.current.handleDismissMissingSeason(1, 'Show', 'tmdb-1', 'show-1')
      })

      expect(mockLogError).toHaveBeenCalledWith('[useDismissHandlers]', 'Failed to dismiss missing season:', err)
    })
  })

  describe('handleDismissCollectionMovie', () => {
    it('returns early if selectedCollection is null', async () => {
      const options = createOptions({ selectedCollection: null })
      const { result } = renderHook(() => useDismissHandlers(options))

      await act(async () => {
        await result.current.handleDismissCollectionMovie('movie-1', 'Movie One')
      })

      expect(mockAddExclusion).not.toHaveBeenCalled()
    })

    it('dismisses a movie from a collection, updates collections state, and emits event', async () => {
      mockAddExclusion.mockResolvedValue('ex-col')

      const collection: MovieCollectionData = {
        tmdb_collection_id: 'col-1',
        collection_name: 'Hero Saga',
        owned_movies: 2,
        total_movies: 3,
        missing_movies: JSON.stringify([{ tmdb_id: 'movie-1', title: 'Movie One' }]),
        completeness_percentage: 66.6,
      } as MovieCollectionData

      const options = createOptions({ selectedCollection: collection })
      const { result } = renderHook(() => useDismissHandlers(options))

      await act(async () => {
        await result.current.handleDismissCollectionMovie('movie-1', 'Movie One')
      })

      expect(mockLogError).not.toHaveBeenCalled()
      expect(mockAddExclusion).toHaveBeenCalledWith('collection_movie', undefined, 'movie-1', 'col-1', 'Movie One')

      // Check setSelectedCollection update
      expect(setSelectedCollection).toHaveBeenCalledTimes(1)
      const colUpdater = setSelectedCollection.mock.calls[0][0]
      const updatedSelectedCol = colUpdater(collection)
      expect(updatedSelectedCol).toEqual({
        ...collection,
        missing_movies: '[]',
        total_movies: 2,
        completeness_percentage: 100,
      })

      // Check setMovieCollections update
      expect(setMovieCollections).toHaveBeenCalledTimes(1)
      const collectionsUpdater = setMovieCollections.mock.calls[0][0]
      const updatedList = collectionsUpdater([collection, { tmdb_collection_id: 'col-2', total_movies: 1 } as MovieCollectionData])
      expect(updatedList).toHaveLength(1)
      expect(updatedList[0].tmdb_collection_id).toBe('col-1')

      expect(emitDismissCollectionMovie).toHaveBeenCalledWith({ collectionId: 'col-1', tmdbId: 'movie-1' })
      expect(addToast).toHaveBeenCalledWith({
        type: 'success',
        title: 'Movie dismissed',
        message: '"Movie One" removed from collection recommendations',
      })
    })

    it('logs error when handleDismissCollectionMovie fails', async () => {
      const err = new Error('Collection failure')
      mockAddExclusion.mockRejectedValue(err)

      const collection: MovieCollectionData = {
        tmdb_collection_id: 'col-1',
        missing_movies: '[]',
      } as MovieCollectionData

      const options = createOptions({ selectedCollection: collection })
      const { result } = renderHook(() => useDismissHandlers(options))

      await act(async () => {
        await result.current.handleDismissCollectionMovie('movie-1', 'Movie One')
      })

      expect(mockLogError).toHaveBeenCalledWith('[useDismissHandlers]', 'Failed to dismiss collection movie:', err)
    })
  })

  describe('handleDismissMissingAlbum', () => {
    it('dismisses missing album for album type', async () => {
      mockAddExclusion.mockResolvedValue('ex-album')

      const artistMap = new Map<string, ArtistCompletenessData>()
      artistMap.set('Radiohead', {
        artist_name: 'Radiohead',
        missing_albums: JSON.stringify([{ musicbrainz_id: 'mb-album-1', title: 'Kid A' }]),
        missing_eps: '[]',
        missing_singles: '[]',
      } as ArtistCompletenessData)

      const options = createOptions()
      const { result } = renderHook(() => useDismissHandlers(options))

      const album: MissingAlbum = { musicbrainz_id: 'mb-album-1', title: 'Kid A', album_type: 'album' }

      await act(async () => {
        await result.current.handleDismissMissingAlbum(album, 'Radiohead', 'mb-artist-1')
      })

      expect(mockAddExclusion).toHaveBeenCalledWith('artist_album', undefined, 'mb-album-1', 'mb-artist-1', 'Kid A')

      expect(setArtistCompleteness).toHaveBeenCalledTimes(1)
      const mapUpdater = setArtistCompleteness.mock.calls[0][0]
      const updatedMap = mapUpdater(artistMap)
      expect(JSON.parse(updatedMap.get('Radiohead')!.missing_albums)).toEqual([])
      expect(addToast).toHaveBeenCalledWith({ type: 'success', title: 'Album dismissed', message: '"Kid A" removed from recommendations' })
    })

    it('dismisses missing ep and single types', async () => {
      mockAddExclusion.mockResolvedValue('ex-ep')

      const artistMap = new Map<string, ArtistCompletenessData>()
      artistMap.set('Radiohead', {
        artist_name: 'Radiohead',
        missing_eps: JSON.stringify([{ musicbrainz_id: 'mb-ep-1', title: 'EP 1' }]),
        missing_singles: JSON.stringify([{ musicbrainz_id: 'mb-single-1', title: 'Single 1' }]),
      } as ArtistCompletenessData)

      const options = createOptions()
      const { result } = renderHook(() => useDismissHandlers(options))

      const ep: MissingAlbum = { musicbrainz_id: 'mb-ep-1', title: 'EP 1', album_type: 'ep' }
      const single: MissingAlbum = { musicbrainz_id: 'mb-single-1', title: 'Single 1', album_type: 'single' }

      await act(async () => {
        await result.current.handleDismissMissingAlbum(ep, 'Radiohead')
      })
      expect(mockAddExclusion).toHaveBeenCalledWith('artist_album', undefined, 'mb-ep-1', 'Radiohead', 'EP 1')

      await act(async () => {
        await result.current.handleDismissMissingAlbum(single, 'Radiohead')
      })
      expect(mockAddExclusion).toHaveBeenCalledWith('artist_album', undefined, 'mb-single-1', 'Radiohead', 'Single 1')

      expect(setArtistCompleteness).toHaveBeenCalledTimes(2)
      const secondUpdater = setArtistCompleteness.mock.calls[1][0]
      const secondUpdatedMap = secondUpdater(artistMap)
      expect(JSON.parse(secondUpdatedMap.get('Radiohead')!.missing_singles)).toEqual([])
    })

    it('logs error when handleDismissMissingAlbum fails', async () => {
      const err = new Error('Album fail')
      mockAddExclusion.mockRejectedValue(err)

      const options = createOptions()
      const { result } = renderHook(() => useDismissHandlers(options))

      await act(async () => {
        await result.current.handleDismissMissingAlbum({ musicbrainz_id: 'mb-1', title: 'Album', album_type: 'album' }, 'Artist')
      })

      expect(mockLogError).toHaveBeenCalledWith('[useDismissHandlers]', 'Failed to dismiss missing album:', err)
    })
  })

  describe('handleDismissAllMissingInCollection', () => {
    it('returns early when selectedCollection is null or has empty missing_movies', async () => {
      const optionsNull = createOptions({ selectedCollection: null })
      const { result: resultNull } = renderHook(() => useDismissHandlers(optionsNull))

      await act(async () => {
        await resultNull.current.handleDismissAllMissingInCollection()
      })
      expect(mockAddExclusion).not.toHaveBeenCalled()

      const emptyCollection: MovieCollectionData = {
        tmdb_collection_id: 'col-1',
        missing_movies: '[]',
      } as MovieCollectionData

      const optionsEmpty = createOptions({ selectedCollection: emptyCollection })
      const { result: resultEmpty } = renderHook(() => useDismissHandlers(optionsEmpty))

      await act(async () => {
        await resultEmpty.current.handleDismissAllMissingInCollection()
      })
      expect(mockAddExclusion).not.toHaveBeenCalled()
    })

    it('dismisses all missing movies in collection, dispatches event, and updates state', async () => {
      mockAddExclusion.mockResolvedValue('ex-all')
      const dispatchEventSpy = vi.spyOn(window, 'dispatchEvent')

      const collection: MovieCollectionData = {
        tmdb_collection_id: 'col-100',
        collection_name: 'Trilogy',
        owned_movies: 1,
        total_movies: 3,
        missing_movies: JSON.stringify([
          { tmdb_id: 'm1', title: 'Movie 1' },
          { tmdb_id: 'm2', title: 'Movie 2' },
        ]),
        completeness_percentage: 33.3,
      } as MovieCollectionData

      const options = createOptions({ selectedCollection: collection })
      const { result } = renderHook(() => useDismissHandlers(options))

      await act(async () => {
        await result.current.handleDismissAllMissingInCollection()
      })

      expect(mockAddExclusion).toHaveBeenCalledTimes(2)
      expect(mockAddExclusion).toHaveBeenNthCalledWith(1, 'collection_movie', undefined, 'm1', 'col-100', 'Movie 1')
      expect(mockAddExclusion).toHaveBeenNthCalledWith(2, 'collection_movie', undefined, 'm2', 'col-100', 'Movie 2')

      expect(setSelectedCollection).toHaveBeenCalledTimes(1)
      const selectedUpdater = setSelectedCollection.mock.calls[0][0]
      expect(selectedUpdater(collection)).toEqual({
        ...collection,
        missing_movies: '[]',
        total_movies: 1,
        completeness_percentage: 100,
      })

      expect(setMovieCollections).toHaveBeenCalledTimes(1)

      expect(dispatchEventSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'exclusions-changed' }))
      expect(addToast).toHaveBeenCalledWith({
        type: 'success',
        title: 'Collection dismissed',
        message: '2 missing films removed from "Trilogy"',
      })
    })

    it('logs error and shows error toast on failure', async () => {
      const err = new Error('Batch exclusion failed')
      mockAddExclusion.mockRejectedValue(err)

      const collection: MovieCollectionData = {
        tmdb_collection_id: 'col-100',
        collection_name: 'Trilogy',
        missing_movies: JSON.stringify([{ tmdb_id: 'm1', title: 'Movie 1' }]),
      } as MovieCollectionData

      const options = createOptions({ selectedCollection: collection })
      const { result } = renderHook(() => useDismissHandlers(options))

      await act(async () => {
        await result.current.handleDismissAllMissingInCollection()
      })

      expect(mockLogError).toHaveBeenCalledWith('[useDismissHandlers]', 'Failed to dismiss all collection movies:', err)
      expect(addToast).toHaveBeenCalledWith({
        type: 'error',
        title: 'Dismiss failed',
        message: 'Could not dismiss collection movies',
      })
    })
  })

  describe('handleDismissMissingItem', () => {
    it('returns early when selectedMissingItem is null', () => {
      const options = createOptions({ selectedMissingItem: null })
      const { result } = renderHook(() => useDismissHandlers(options))

      act(() => {
        result.current.handleDismissMissingItem()
      })

      expect(setSelectedMissingItem).not.toHaveBeenCalled()
    })

    it('delegates to episode dismiss handler when selectedMissingItem type is episode', async () => {
      mockAddExclusion.mockResolvedValue('ex-ep')

      const seriesMap = new Map<string, SeriesCompletenessData>()
      seriesMap.set('show-1', {
        missing_episodes: JSON.stringify([{ season_number: 1, episode_number: 1 }]),
        missing_seasons: JSON.stringify([1]),
      } as SeriesCompletenessData)

      const selectedMissingItem = {
        type: 'episode' as const,
        title: 'Ep Title',
        seasonNumber: 1,
        episodeNumber: 1,
        seriesTitle: 'Show Title',
        seriesMapKey: 'show-1',
        tmdbId: 'tmdb-55',
        airDate: '2023-01-01',
      }

      const options = createOptions({ selectedMissingItem, seriesCompleteness: seriesMap })
      const { result } = renderHook(() => useDismissHandlers(options))

      act(() => {
        result.current.handleDismissMissingItem()
      })

      expect(mockAddExclusion).toHaveBeenCalledWith('series_episode', undefined, 'S1E1', 'tmdb-55', 'Show Title S1E1')
      expect(setSelectedMissingItem).toHaveBeenCalledWith(null)
    })

    it('delegates to season dismiss handler when selectedMissingItem type is season', async () => {
      mockAddExclusion.mockResolvedValue('ex-season')

      const seriesMap = new Map<string, SeriesCompletenessData>()
      seriesMap.set('show-1', {
        missing_episodes: JSON.stringify([{ season_number: 2, episode_number: 1 }]),
        missing_seasons: JSON.stringify([2]),
      } as SeriesCompletenessData)

      const selectedMissingItem = {
        type: 'season' as const,
        title: 'Season 2',
        seasonNumber: 2,
        seriesTitle: 'Show Title',
        seriesMapKey: 'show-1',
        tmdbId: 'tmdb-55',
      }

      const options = createOptions({ selectedMissingItem, seriesCompleteness: seriesMap })
      const { result } = renderHook(() => useDismissHandlers(options))

      act(() => {
        result.current.handleDismissMissingItem()
      })

      expect(mockAddExclusion).toHaveBeenCalledWith('series_episode', undefined, 'S2E1', 'tmdb-55', 'Show Title S2E1')
      expect(setSelectedMissingItem).toHaveBeenCalledWith(null)
    })

    it('delegates to movie collection dismiss handler when selectedMissingItem type is movie', async () => {
      mockAddExclusion.mockResolvedValue('ex-movie')

      const selectedCollection: MovieCollectionData = {
        tmdb_collection_id: 'col-1',
        missing_movies: '[]',
      } as MovieCollectionData

      const selectedMissingItem = {
        type: 'movie' as const,
        title: 'Movie Title',
        tmdbId: 'movie-tmdb-1',
      }

      const options = createOptions({ selectedMissingItem, selectedCollection })
      const { result } = renderHook(() => useDismissHandlers(options))

      act(() => {
        result.current.handleDismissMissingItem()
      })

      expect(mockAddExclusion).toHaveBeenCalledWith('collection_movie', undefined, 'movie-tmdb-1', 'col-1', 'Movie Title')
      expect(setSelectedMissingItem).toHaveBeenCalledWith(null)
    })
  })
})
