import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { SourceRepository } from '@main/database/repositories/SourceRepository'
import { LibraryType } from '@main/types/database'
import { setupTestDb, cleanupTestDb } from '@tests/TestUtils'

describe('SourceRepository (Real DB) - Perf', () => {
  let repo: SourceRepository
  let db: Awaited<ReturnType<typeof setupTestDb>>

  beforeEach(async () => {
    db = await setupTestDb()
    repo = db.sources
  })

  afterEach(() => {
    cleanupTestDb()
  })

  it('perf setLibrariesEnabled', async () => {
    const sourceId = 'src-perf'
    await repo.upsertSource({
      source_id: sourceId,
      source_type: 'plex',
      display_name: 'Test Plex',
      connection_config: '{}',
      is_enabled: 1,
    })

    const libs = []
    for (let i = 0; i < 500; i++) {
        libs.push({
            id: `lib${i}`,
            name: `Library ${i}`,
            type: i % 2 === 0 ? LibraryType.Movie : LibraryType.Show,
            enabled: i % 2 === 0
        })
    }

    const start = performance.now()
    await repo.setLibrariesEnabled(sourceId, libs)
    const end = performance.now()

    console.log(`Initial insert 500 libs: ${end - start}ms`)

    // update half
    for (let i = 0; i < 500; i++) {
        libs[i].enabled = !libs[i].enabled
    }

    const start2 = performance.now()
    await repo.setLibrariesEnabled(sourceId, libs)
    const end2 = performance.now()

    console.log(`Update 500 libs: ${end2 - start2}ms`)
  })
})
