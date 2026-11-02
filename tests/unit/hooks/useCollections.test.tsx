/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useCollections } from '@/components/library/hooks/useCollections'
import type { MediaItem, MovieCollectionData } from '@/components/library/types'

describe('useCollections', () => {
  it('indexes collection membership once instead of reparsing it for every movie lookup', () => {
    const ownedMovieIds = '["101","102"]'
    const collection = {
      tmdb_collection_id: 'collection-1',
      collection_name: 'Indexed Collection',
      owned_movie_ids: ownedMovieIds,
      missing_movies: '[]',
    } as MovieCollectionData
    const parseSpy = vi.spyOn(JSON, 'parse')

    const { result } = renderHook(() => useCollections([], [collection]))

    expect(result.current.getCollectionForMovie({ tmdb_id: '101' } as MediaItem)).toBe(collection)
    expect(result.current.getCollectionForMovie({ tmdb_id: '102' } as MediaItem)).toBe(collection)
    expect(result.current.getCollectionForMovie({ tmdb_id: '999' } as MediaItem)).toBeUndefined()

    const membershipParses = parseSpy.mock.calls.filter(([value]) => value === ownedMovieIds)
    expect(membershipParses).toHaveLength(1)
    parseSpy.mockRestore()
  })
})
