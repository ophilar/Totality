import { useState, useCallback, useMemo, type Dispatch, type SetStateAction } from 'react'
import type { MediaItem, MovieCollectionData } from '@/components/library/types'

interface UseCollectionsReturn {
  showCollectionModal: boolean
  setShowCollectionModal: Dispatch<SetStateAction<boolean>>
  selectedCollection: MovieCollectionData | null
  setSelectedCollection: Dispatch<SetStateAction<MovieCollectionData | null>>
  getCollectionForMovie: (movie: MediaItem) => MovieCollectionData | undefined
  getOwnedMoviesForCollection: (collection: MovieCollectionData) => MediaItem[]
  ownedMoviesForSelectedCollection: MediaItem[]
}

/**
 * Hook to manage movie collection state and lookups
 *
 * Provides functions to find which collection a movie belongs to,
 * and to get owned movies for a collection. Also manages modal state.
 *
 * @param items All media items (used for owned movie lookups)
 * @param movieCollections All movie collections data
 * @returns Collection state, modal controls, and lookup functions
 */
export function useCollections(
  items: MediaItem[],
  movieCollections: MovieCollectionData[]
): UseCollectionsReturn {
  const [showCollectionModal, setShowCollectionModal] = useState(false)
  const [selectedCollection, setSelectedCollection] = useState<MovieCollectionData | null>(null)

  const collectionByMovieId = useMemo(() => {
    const index = new Map<string, MovieCollectionData>()
    for (const collection of movieCollections) {
      const ownedIds = JSON.parse(collection.owned_movie_ids || '[]') as string[]
      for (const tmdbId of ownedIds) {
        // Preserve the previous Array.find semantics when bad data places a movie in multiple collections.
        if (!index.has(tmdbId)) index.set(tmdbId, collection)
      }
    }
    return index
  }, [movieCollections])

  const getCollectionForMovie = useCallback(
    (movie: MediaItem): MovieCollectionData | undefined => {
      if (!movie.tmdb_id) return undefined
      return collectionByMovieId.get(movie.tmdb_id)
    },
    [collectionByMovieId]
  )

  const getOwnedMoviesForCollection = useCallback(
    (collection: MovieCollectionData): MediaItem[] => {
      const ownedIds = new Set(JSON.parse(collection.owned_movie_ids || '[]') as string[])
      return items.filter(
        (item) => item.type === 'movie' && item.tmdb_id && ownedIds.has(item.tmdb_id)
      )
    },
    [items]
  )

  const ownedMoviesForSelectedCollection = useMemo(() => {
    if (!selectedCollection) return []
    return getOwnedMoviesForCollection(selectedCollection)
  }, [selectedCollection, getOwnedMoviesForCollection])

  return {
    showCollectionModal,
    setShowCollectionModal,
    selectedCollection,
    setSelectedCollection,
    getCollectionForMovie,
    getOwnedMoviesForCollection,
    ownedMoviesForSelectedCollection,
  }
}
