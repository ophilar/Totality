import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { MovieCollectionRepository } from '@main/database/repositories/MovieCollectionRepository'
import { setupTestDb, cleanupTestDb } from '@tests/TestUtils'

describe('MovieCollectionRepository (Real DB)', () => {
  let repo: MovieCollectionRepository
  let db: any

  beforeEach(async () => {
    db = await setupTestDb()
    repo = db.movieCollections
  })

  afterEach(() => {
    cleanupTestDb()
  })

  it('should upsert and retrieve collections', async () => {
    const col = {
      tmdb_collection_id: 'col-123',
      collection_name: 'Marvel Cinematic Universe',
      total_movies: 20,
      owned_movies: 5,
      completeness_percentage: 25,
      source_id: 's1',
      library_id: 'l1'
    }

    await repo.upsertCollection(col as any)
    
    const collections = await repo.getCollections('s1')
    expect(collections).toHaveLength(1)
    expect(collections[0].collection_name).toBe('Marvel Cinematic Universe')
  })

  it('should get incomplete collections', async () => {
    await repo.upsertCollection({ tmdb_collection_id: 'c1', collection_name: 'Complete', completeness_percentage: 100, source_id: 's1', total_movies: 1, owned_movies: 1 } as any)
    await repo.upsertCollection({ tmdb_collection_id: 'c2', collection_name: 'Incomplete', completeness_percentage: 50, source_id: 's1', total_movies: 2, owned_movies: 1 } as any)
    
    const incomplete = await repo.getIncompleteCollections('s1')
    expect(incomplete).toHaveLength(1)
    expect(incomplete[0].collection_name).toBe('Incomplete')
  })

  it('should delete a collection', async () => {
    await repo.upsertCollection({ tmdb_collection_id: 'c1', collection_name: 'A', completeness_percentage: 50, source_id: 's1', total_movies: 2, owned_movies: 1 } as any)
    
    const cols = await repo.getCollections('s1')
    await repo.deleteCollection(cols[0].id!)
    
    expect(await repo.getCollections('s1')).toHaveLength(0)
  })
})
