import { afterEach, beforeEach, expect, test } from 'vitest'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BetterSQLiteService } from '../src/main/database/BetterSQLiteService'
import { reconcileLocalInventory } from '../src/main/providers/local/reconcileLocalInventory'
import type { MediaItem, MediaItemVersion } from '../src/main/types/database'

let directory: string
let database: BetterSQLiteService

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'totality-local-inventory-'))
  database = new BetterSQLiteService(join(directory, 'totality.db'))
  database.initialize()
})

afterEach(() => {
  database.close()
  rmSync(directory, { recursive: true, force: true })
})

function createMovie(filePath: string, plexId: string): number {
  const movie: MediaItem = {
    source_id: 'local-test',
    source_type: 'local',
    library_id: 'movies',
    plex_id: plexId,
    title: plexId,
    type: 'movie',
    file_path: filePath,
    file_size_bytes: 1024,
    duration_ms: 7_200_000,
    resolution: '1080p',
    width: 1920,
    height: 1080,
    video_codec: 'H264',
    video_bitrate_kbps: 5000,
    audio_codec: 'AAC',
    audio_channels: 2,
    audio_bitrate_kbps: 128,
  }
  return database.upsertMediaItem(movie)
}

function createVersion(mediaItemId: number, filePath: string, resolution: string, score: number): MediaItemVersion {
  return {
    media_item_id: mediaItemId,
    version_source: 'local_file',
    file_path: filePath,
    file_size_bytes: 1024,
    duration_ms: 7_200_000,
    resolution,
    width: 1920,
    height: 1080,
    video_codec: 'H264',
    video_bitrate_kbps: 5000,
    audio_codec: 'AAC',
    audio_channels: 2,
    audio_bitrate_kbps: 128,
    quality_tier: resolution,
    tier_score: score,
  }
}

function completeInventory(): ReadonlySet<string> {
  return new Set(readdirSync(directory)
    .filter(name => name.endsWith('.mkv'))
    .map(name => join(directory, name)))
}

test('a complete filesystem inventory removes a deleted movie while retaining existing media', async () => {
  const removedPath = join(directory, 'removed.mkv')
  const retainedPath = join(directory, 'retained.mkv')
  writeFileSync(retainedPath, 'actual file')
  const removedId = createMovie(removedPath, 'removed')
  const retainedId = createMovie(retainedPath, 'retained')

  const result = await reconcileLocalInventory(database, database.getMediaItems({
    sourceId: 'local-test', libraryId: 'movies', type: 'movie',
  }), completeInventory())

  expect(result.removed).toBe(1)
  expect(database.getMediaItem(removedId)).toBeNull()
  expect(database.getMediaItem(retainedId)?.file_path).toBe(retainedPath)
})

test('removing one edition retains the parent and selects its surviving version', async () => {
  const oldBest = join(directory, 'old-best.mkv')
  const remaining = join(directory, 'remaining.mkv')
  writeFileSync(remaining, 'actual file')
  const id = createMovie(oldBest, 'multi-edition')
  database.syncMediaItemVersions(id, [
    createVersion(id, oldBest, '4K', 400),
    createVersion(id, remaining, '1080p', 200),
  ])
  expect(database.getMediaItem(id)?.file_path).toBe(oldBest)

  const result = await reconcileLocalInventory(database, database.getMediaItems({
    sourceId: 'local-test', libraryId: 'movies', type: 'movie',
  }), completeInventory())

  expect(result.removed).toBe(0)
  expect(result.updated).toHaveLength(1)
  expect(database.getMediaItem(id)?.file_path).toBe(remaining)
  expect(database.getMediaItem(id)?.version_count).toBe(1)
  expect(database.getMediaItemVersions(id).map(version => version.file_path)).toEqual([remaining])
  expect(database.getMediaItemByPath(oldBest)).toBeNull()
})

test('an inventory with a missing directory throws before reconciliation and retains stored media', () => {
  const pathInMissingFolder = join(directory, 'absent', 'movie.mkv')
  const id = createMovie(pathInMissingFolder, 'not-confirmed-deleted')
  expect(() => readdirSync(join(directory, 'absent'))).toThrow()
  expect(database.getMediaItem(id)).not.toBeNull()
})
