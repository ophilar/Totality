import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { DeduplicationService } from '@main/services/DeduplicationService'
import { setupTestDb, cleanupTestDb } from '@tests/TestUtils'

describe('DeduplicationService (Real DB)', () => {
  let service: DeduplicationService
  let db: Awaited<ReturnType<typeof setupTestDb>>

  beforeEach(async () => {
    db = await setupTestDb()
    service = new DeduplicationService()
    
    // Setup sources and data
    await db.sources.upsertSource({ source_id: 's1', source_type: 'local', display_name: 'S1', connection_config: '{}', is_enabled: 1 })
  })

  afterEach(() => {
    cleanupTestDb()
  })

  it('should detect duplicates by TMDB ID', async () => {
    const _id1 = await db.media.upsertItem({ source_id: 's1', plex_id: 'p1', tmdb_id: '100', title: 'Movie A', type: 'movie', file_path: '/p1', resolution: '1080p' })
    const _id2 = await db.media.upsertItem({ source_id: 's1', plex_id: 'p2', tmdb_id: '100', title: 'Movie A', type: 'movie', file_path: '/p2', resolution: '4K' })

    await service.scanForDuplicates('s1')

    const duplicates = await db.duplicates.getPendingDuplicates('s1')
    expect(duplicates).toHaveLength(1)
    expect(duplicates[0].external_id).toBe('100')
  })

  it('should resolve duplicates by merging versions', async () => {
    const _id1 = await db.media.upsertItem({ source_id: 's1', plex_id: 'p1', tmdb_id: '200', title: 'Movie B', type: 'movie', file_path: '/p1', resolution: '1080p' })
    const id2 = await db.media.upsertItem({ source_id: 's1', plex_id: 'p2', tmdb_id: '200', title: 'Movie B', type: 'movie', file_path: '/p2', resolution: '4K' })

    await service.scanForDuplicates('s1')
    const duplicates = await db.duplicates.getPendingDuplicates('s1')
    const dupId = duplicates[0].id!

    // Resolve: keep id2 (4K) as primary
    const outcome = await service.resolveDuplicate(dupId, id2, false)
    expect(outcome.status).toBe('kept')

    const resolved = await db.duplicates.getById(dupId)
    expect(resolved.status).toBe('resolved')
    expect(resolved.resolution_strategy).toBe('kept_canonical')
    
    // Check if item2 exists
    const item2 = await db.media.getItem(id2)
    expect(item2).toBeDefined()
  })

  it('reports a policy-blocked deletion and leaves the group pending', async () => {
    const id1 = await db.media.upsertItem({ source_id: 's1', plex_id: 'blocked-1', tmdb_id: '400', title: 'Movie D', type: 'movie', file_path: 'blocked-1.mkv' })
    await db.media.upsertItem({ source_id: 's1', plex_id: 'blocked-2', tmdb_id: '400', title: 'Movie D', type: 'movie', file_path: 'blocked-2.mkv' })
    await service.scanForDuplicates('s1')
    const [group] = await db.duplicates.getPendingDuplicates('s1')

    const outcome = await service.resolveDuplicate(group.id!, id1, true)

    expect(outcome).toMatchObject({ status: 'policy-blocked', committedCount: 0, requestedCount: 1 })
    expect((await db.duplicates.getById(group.id!))?.status).toBe('pending')
  })

  it('deletes requested files and records only a completed resolution', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'totality-duplicates-'))
    try {
      const keptPath = path.join(directory, 'kept.mkv')
      const discardedPath = path.join(directory, 'discarded.mkv')
      await fs.writeFile(keptPath, 'kept')
      await fs.writeFile(discardedPath, 'discarded')
      const keepId = await db.media.upsertItem({ source_id: 's1', plex_id: 'delete-1', tmdb_id: '500', title: 'Movie E', type: 'movie', file_path: keptPath })
      await db.media.upsertItem({ source_id: 's1', plex_id: 'delete-2', tmdb_id: '500', title: 'Movie E', type: 'movie', file_path: discardedPath })
      await service.scanForDuplicates('s1')
      const [group] = await db.duplicates.getPendingDuplicates('s1')
      await db.config.setSetting('dup_policy_auto_delete', 'true')

      const outcome = await service.resolveDuplicate(group.id!, keepId, true)

      expect(outcome).toMatchObject({ status: 'deleted', committedCount: 1, requestedCount: 1 })
      await expect(fs.access(discardedPath)).rejects.toThrow()
      expect((await db.duplicates.getById(group.id!))?.status).toBe('resolved')
    } finally {
      await fs.rm(directory, { recursive: true, force: true })
    }
  })

  it('keeps a group pending when requested file deletion fails', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'totality-duplicates-'))
    try {
      const keepPath = path.join(directory, 'keep.mkv')
      const missingPath = path.join(directory, 'missing.mkv')
      await fs.writeFile(keepPath, 'kept')
      const keepId = await db.media.upsertItem({ source_id: 's1', plex_id: 'missing-1', tmdb_id: '600', title: 'Movie F', type: 'movie', file_path: keepPath })
      await db.media.upsertItem({ source_id: 's1', plex_id: 'missing-2', tmdb_id: '600', title: 'Movie F', type: 'movie', file_path: missingPath })
      await service.scanForDuplicates('s1')
      const [group] = await db.duplicates.getPendingDuplicates('s1')
      await db.config.setSetting('dup_policy_auto_delete', 'true')

      const outcome = await service.resolveDuplicate(group.id!, keepId, true)

      expect(outcome).toMatchObject({ status: 'failed', committedCount: 0, requestedCount: 1 })
      expect(outcome.errors[0].message).toMatch(/ENOENT/)
      expect((await db.duplicates.getById(group.id!))?.status).toBe('pending')
    } finally {
      await fs.rm(directory, { recursive: true, force: true })
    }
  })

  it('does not persist groups when the scan is cancelled before analysis completes', async () => {
    await db.media.upsertItem({ source_id: 's1', plex_id: 'cancel-1', tmdb_id: '300', title: 'Movie C', type: 'movie', file_path: '/cancel-1' })
    await db.media.upsertItem({ source_id: 's1', plex_id: 'cancel-2', tmdb_id: '300', title: 'Movie C', type: 'movie', file_path: '/cancel-2' })
    const controller = new AbortController()
    controller.abort()

    await expect(service.scanForDuplicates('s1', controller.signal)).rejects.toThrow('aborted')
    expect(await db.duplicates.getPendingDuplicates('s1')).toHaveLength(0)
  })
})



