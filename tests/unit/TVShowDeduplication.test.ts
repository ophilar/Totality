import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setupTestDb, cleanupTestDb } from '@tests/TestUtils'
import { getFileNameParser } from '@main/services/FileNameParser'
import { deriveSeriesIdentityKey } from '@main/services/SeriesIdentityService'
import { mergeDuplicateSeriesCompleteness } from '@main/database/DatabaseMigration'
import type { SeriesCompleteness, MediaItem } from '@main/types/database'

describe('TV Show Deduplication & Invariants (TOT-BUG-03)', () => {
  let db: Awaited<ReturnType<typeof setupTestDb>>
  const parser = getFileNameParser()

  beforeEach(async () => {
    db = await setupTestDb()
  })

  afterEach(() => {
    cleanupTestDb()
  })

  describe('FileNameParser normalization', () => {
    it('identifies and ignores season and extra folders', () => {
      const seasonFolders = [
        'Season 1', 'Season 01', 'Season 10',
        'S1', 'S02', 'Staffel 1', 'Staffel 03',
        'Saison 2', 'Temporada 1', 'Series 1',
        'Specials', 'Extras', 'Featurettes', 'Behind the Scenes'
      ]

      for (const folder of seasonFolders) {
        expect(parser.isSeasonOrExtrasFolder(folder)).toBe(true)
      }

      const showFolders = [
        'Breaking Bad (2008)',
        'Severance (2022)',
        'The Last of Us',
        'Shogun'
      ]

      for (const folder of showFolders) {
        expect(parser.isSeasonOrExtrasFolder(folder)).toBe(false)
      }
    })

    it('strips release tags, codecs, and scene group suffixes', () => {
      const raw1 = 'Breaking.Bad.S01.1080p.BluRay.x265-GROUP'
      const raw2 = 'Severance.2022.2160p.WEB-DL.DDP5.1.Atmos.DV.HEVC-FLUX'
      const raw3 = 'Shogun (2024) [1080p BluRay Remux AV1 Opus]'

      expect(parser.stripReleaseTags(raw1)).toBe('Breaking Bad')
      expect(parser.stripReleaseTags(raw2)).toBe('Severance 2022')
      expect(parser.stripReleaseTags(raw3)).toBe('Shogun (2024)')

      expect(parser.cleanSeriesTitleAndYear(raw1)).toEqual({ title: 'Breaking Bad', year: undefined })
      expect(parser.cleanSeriesTitleAndYear(raw2)).toEqual({ title: 'Severance', year: 2022 })
      expect(parser.cleanSeriesTitleAndYear(raw3)).toEqual({ title: 'Shogun', year: 2024 })
    })

    it('derives identical canonical keys for different season folder paths', () => {
      const pathS1 = '/tv/Breaking Bad (2008)/Season 1/S01E01.mkv'
      const pathS2 = '/tv/Breaking Bad (2008)/Season 02/S02E01.mkv'
      const pathBare = '/tv/Breaking Bad (2008)/S03E01.mkv'

      const titleS1 = parser.extractSeriesTitleFromPath(pathS1)
      const titleS2 = parser.extractSeriesTitleFromPath(pathS2)
      const titleBare = parser.extractSeriesTitleFromPath(pathBare)

      expect(titleS1).toBe('Breaking Bad')
      expect(titleS2).toBe('Breaking Bad')
      expect(titleBare).toBe('Breaking Bad')

      const keyS1 = deriveSeriesIdentityKey({ sourceId: 'src1', libraryId: 'lib1', folderRelativePath: titleS1 })
      const keyS2 = deriveSeriesIdentityKey({ sourceId: 'src1', libraryId: 'lib1', folderRelativePath: titleS2 })
      const keyBare = deriveSeriesIdentityKey({ sourceId: 'src1', libraryId: 'lib1', folderRelativePath: titleBare })

      expect(keyS1).toBe('unresolved:src1:lib1:breaking-bad')
      expect(keyS2).toBe('unresolved:src1:lib1:breaking-bad')
      expect(keyBare).toBe('unresolved:src1:lib1:breaking-bad')
    })
  })

  describe('TVShowRepository deduplication on upsert', () => {
    it('merges show updates when matching by tmdb_id without creating duplicate rows', async () => {
      // 1. Initial insert with unresolved key
      const id1 = await db.tvShows.upsertCompleteness({
        series_title: 'Breaking Bad',
        source_id: 'src1',
        library_id: 'lib1',
        total_seasons: 5,
        total_episodes: 62,
        owned_seasons: 1,
        owned_episodes: 7,
        completeness_percentage: 11.29,
        missing_seasons: '[]',
        missing_episodes: '[]',
        tmdb_id: '1396',
        tvdb_id: '81189',
      } as SeriesCompleteness)

      // 2. Second upsert from a scan with a slightly different title or season folder info
      const id2 = await db.tvShows.upsertCompleteness({
        series_title: 'Breaking Bad (2008)',
        source_id: 'src1',
        library_id: 'lib1',
        total_seasons: 5,
        total_episodes: 62,
        owned_seasons: 5,
        owned_episodes: 62,
        completeness_percentage: 100,
        missing_seasons: '[]',
        missing_episodes: '[]',
        tmdb_id: '1396',
        tvdb_id: '81189',
      } as SeriesCompleteness)

      expect(id2).toBe(id1)

      const all = await db.tvShows.getAllCompleteness('src1', 'lib1')
      expect(all.length).toBe(1)
      expect(all[0].id).toBe(id1)
      expect(all[0].owned_episodes).toBe(62)
      expect(all[0].completeness_percentage).toBe(100)
    })
  })

  describe('Database migration duplicate merging', () => {
    it('merges duplicate series completeness rows and repoints media items', async () => {
      const client = db.db

      // Drop unique indexes temporarily to insert legacy duplicate rows
      await client.execute('DROP INDEX IF EXISTS idx_series_completeness_unique')
      await client.execute('DROP INDEX IF EXISTS idx_series_completeness_tvdb')
      await client.execute('DROP INDEX IF EXISTS idx_series_completeness_tmdb')

      // Insert duplicate row 1 (legacy without tmdb_id)
      await client.execute({
        sql: `INSERT INTO series_completeness (series_title, series_identity_key, source_id, library_id, total_seasons, total_episodes, owned_seasons, owned_episodes, missing_seasons, missing_episodes, completeness_percentage, created_at, updated_at)
              VALUES ('Severance', 'unresolved:src1:lib1:severance', 'src1', 'lib1', 1, 9, 1, 4, '[]', '[]', 44.4, datetime('now'), datetime('now'))`
      })

      // Insert duplicate row 2 (with tmdb_id)
      await client.execute({
        sql: `INSERT INTO series_completeness (series_title, series_identity_key, source_id, library_id, total_seasons, total_episodes, owned_seasons, owned_episodes, missing_seasons, missing_episodes, completeness_percentage, tmdb_id, tvdb_id, created_at, updated_at)
              VALUES ('Severance (2022)', 'tmdb:115981', 'src1', 'lib1', 1, 9, 1, 9, '[]', '[]', 100.0, '115981', '371980', datetime('now'), datetime('now'))`
      })

      // Insert episode items
      await db.media.upsertItem({
        source_id: 'src1',
        source_type: 'plex',
        library_id: 'lib1',
        plex_id: 'sev-s01e01',
        title: 'Good News About Hell',
        series_title: 'Severance',
        series_identity_key: 'unresolved:src1:lib1:severance',
        season_number: 1,
        episode_number: 1,
        type: 'episode',
        file_path: '/tv/Severance/S01E01.mkv',
        file_size: 1500000,
        duration: 3400,
        resolution: '4k',
        width: 3840,
        height: 2160,
        video_codec: 'hevc',
        video_bitrate: 15000,
        audio_codec: 'eac3',
        audio_channels: 6,
        audio_bitrate: 640,
      } as MediaItem)

      await db.media.upsertItem({
        source_id: 'src1',
        source_type: 'plex',
        library_id: 'lib1',
        plex_id: 'sev-s01e02',
        title: 'Half Loop',
        series_title: 'Severance (2022)',
        series_identity_key: 'tmdb:115981',
        season_number: 1,
        episode_number: 2,
        type: 'episode',
        file_path: '/tv/Severance (2022)/S01E02.mkv',
        file_size: 1500000,
        duration: 3200,
        resolution: '4k',
        width: 3840,
        height: 2160,
        video_codec: 'hevc',
        video_bitrate: 15000,
        audio_codec: 'eac3',
        audio_channels: 6,
        audio_bitrate: 640,
      } as MediaItem)

      // Run migration
      await mergeDuplicateSeriesCompleteness(client)

      // Check resulting series completeness records
      const remaining = await db.tvShows.getAllCompleteness('src1', 'lib1')
      expect(remaining.length).toBe(1)
      expect(remaining[0].series_identity_key).toBe('tmdb:115981')
      expect(remaining[0].tmdb_id).toBe('115981')
      expect(remaining[0].tvdb_id).toBe('371980')

      // Check media items repointed
      const epRes = await client.execute("SELECT series_identity_key, series_title FROM media_items WHERE type = 'episode'")
      const items = epRes.rows as unknown as Array<{ series_identity_key: string; series_title: string }>
      expect(items.length).toBe(2)
      for (const item of items) {
        expect(item.series_identity_key).toBe('tmdb:115981')
      }
    })
  })
})
