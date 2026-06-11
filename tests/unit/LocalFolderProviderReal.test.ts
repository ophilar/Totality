import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { LocalFolderProvider } from '@main/providers/local/LocalFolderProvider'
import { LibraryType } from '@main/types/database'
import { setupTestDb, cleanupTestDb, createTempDir } from '@tests/TestUtils'
import { getMediaFileAnalyzer } from '@main/services/MediaFileAnalyzer'
import { PathUtils } from '@main/services/utils/PathUtils'

// Mock TMDB so we don't hit real API
vi.mock('../../src/main/services/TMDBService', () => ({
  getTMDBService: () => ({
    searchMovie: vi.fn().mockImplementation(async (title) => {
      const id = title.includes('Stay') ? 111 : title.includes('Delete') ? 222 : 123
      return { results: [{ id, title, release_date: '2020-01-01' }] }
    }),
    searchMovieWithFallbacks: vi.fn().mockImplementation(async (title) => {
      const id = title.includes('Stay') ? 111 : title.includes('Delete') ? 222 : 123
      return { tmdbId: id, title, year: 2020 }
    }),
    getMovieDetails: vi.fn().mockResolvedValue({ id: 123, title: 'Test Movie' }),
    buildImageUrl: vi.fn().mockReturnValue('http://image.url'),
  }),
}))

// Mock MusicBrainzService
vi.mock('../../src/main/services/MusicBrainzService', () => ({
  getMusicBrainzService: () => ({
    searchArtist: vi.fn().mockResolvedValue([{ name: 'Test Artist', id: 'artist-id' }]),
    getArtistDetails: vi.fn().mockResolvedValue({ name: 'Test Artist' }),
  }),
}))

describe('LocalFolderProvider Integration (Real FS)', () => {
  let db: any
  let provider: LocalFolderProvider
  let tempDir: { path: string; cleanup: () => void }
  const sourceId = 'test-local'

  beforeEach(async () => {
    db = await setupTestDb()
    tempDir = createTempDir('local-provider-test')
    
    // Setup real analyzer but mock ffprobe call
    const analyzer = getMediaFileAnalyzer()
    vi.spyOn(analyzer as any, 'runFFprobe').mockImplementation(async (filePath: string) => {
      return {
        format: { format_name: 'matroska', size: '1000', duration: '7200' },
        streams: [
          { codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080, avg_frame_rate: '24/1' },
          { codec_type: 'audio', codec_name: 'aac', channels: 2 }
        ]
      }
    })
    vi.spyOn(analyzer, 'isAvailable').mockResolvedValue(true)
    vi.spyOn(analyzer, 'analyzeFilesParallel').mockImplementation(async (filePaths, onProgress) => {
      const results = new Map()
      for (let i = 0; i < filePaths.length; i++) {
        const filePath = filePaths[i]
        onProgress?.(i + 1, filePaths.length, path.basename(filePath))
        results.set(filePath, await analyzer.analyzeFile(filePath))
      }
      return results
    })

    // Correctly initialize with SourceConfig object
    provider = new LocalFolderProvider({
      sourceId,
      sourceType: 'local',
      displayName: 'Local Movies',
      connectionConfig: { folderPath: tempDir.path }
    })

    // Setup source in DB
    await db.sources.upsertSource({
      source_id: sourceId,
      source_type: 'local',
      display_name: 'Local Movies',
      connection_config: '{}',
      is_enabled: 1,
    })
    
    // Enable library
    await db.sources.setLibrariesEnabled(sourceId, [{ id: 'movie', name: 'Movies', type: LibraryType.Movie, enabled: true }])
    
    // Set TMDB key so lookup logic proceeds
    await db.config.setSetting('tmdb_api_key', 'fake-key')
  })

  afterEach(() => {
    tempDir.cleanup()
    cleanupTestDb()
  })

  it('should detect and save a movie from a real file', async () => {
    const movieFile = path.join(tempDir.path, 'Movie (2020).mkv')
    fs.writeFileSync(movieFile, 'fake video content')

    const result = await provider.scanLibrary('movie')
    
    if (result.errors.length > 0) {
      console.error('Scan Errors:', result.errors)
    }
    
    expect(result.success).toBe(true)
    expect(result.itemsAdded + result.itemsUpdated).toBe(1)

    const items = await db.media.getItems({ sourceId })
    expect(items).toHaveLength(1)

    expect(items[0].year).toBe(2020)
    expect(items[0].file_path).toBe(PathUtils.toDatabasePath(movieFile))
    expect(items[0].resolution).toBe('1080p') // From real MediaNormalizer
  })

  it('should merge new versions during incremental scan', async () => {
    const file1 = path.join(tempDir.path, 'Movie (2020) - 1080p.mkv')
    fs.writeFileSync(file1, 'content 1')

    // 1. Initial scan
    await provider.scanLibrary('movie')
    const items1 = await db.media.getItems({ sourceId })
    expect(items1).toHaveLength(1)
    expect(items1[0].version_count).toBe(1)

    // 2. Add second version
    const file2 = path.join(tempDir.path, 'Movie (2020) - 4K.mkv')
    fs.writeFileSync(file2, 'content 2')
    
    // Simulate incremental scan
    const result = await provider.scanLibrary('movie', { sinceTimestamp: new Date(Date.now() - 10000) })
    
    if (result.errors.length > 0) {
      console.error('Incremental Scan Errors:', result.errors)
    }

    expect(result.itemsUpdated).toBe(1)
    
    const items2 = await db.media.getItems({ sourceId })
    expect(items2).toHaveLength(1)
    expect(items2[0].version_count).toBe(2)
    
    const versions = await db.media.getItemVersions(items2[0].id)
    expect(versions).toHaveLength(2)
  })

  it('should reconcile deletions', async () => {
    const file1 = path.join(tempDir.path, 'To Stay (2020).mkv')
    const file2 = path.join(tempDir.path, 'To Delete (2020).mkv')
    fs.writeFileSync(file1, 'stay')
    fs.writeFileSync(file2, 'delete')

    // Initial scan
    const res1 = await provider.scanLibrary('movie')
    expect(res1.itemsAdded + res1.itemsUpdated).toBe(2)
    expect(await db.media.getItems({ sourceId })).toHaveLength(2)

    // Delete file2 and rescan
    fs.unlinkSync(file2)
    
    const result = await provider.scanLibrary('movie')
    expect(result.itemsRemoved).toBe(1)
    
    const items = await db.media.getItems({ sourceId })
    expect(items).toHaveLength(1)
    expect(items[0].file_path).toBe(PathUtils.toDatabasePath(file1))
  })

  it('should scan music library', async () => {
    // Setup music folder structure: Artist/Album/Track.mp3
    const artistDir = path.join(tempDir.path, 'Music', 'Test Artist')
    const albumDir = path.join(artistDir, 'Test Album')
    fs.mkdirSync(albumDir, { recursive: true })
    
    const trackFile = path.join(albumDir, '01 - Test Track.mp3')
    fs.writeFileSync(trackFile, 'mp3 content')

    // Update source config to support music library
    await db.sources.setLibrariesEnabled(sourceId, [
      { id: 'movie', name: 'Movies', type: LibraryType.Movie, enabled: true },
      { id: 'music', name: 'Music', type: LibraryType.Music, enabled: true }
    ])

    const result = await provider.scanLibrary('music')
    expect(result.success).toBe(true)
    
    const tracks = await db.music.getMusicTracks({ sourceId })
    expect(tracks).toHaveLength(1)
    expect(tracks[0].title).toBe('Test Track')
    expect(tracks[0].artist_name).toBe('Test Artist')
    expect(tracks[0].album_name).toBe('Test Album')
  })

  it('should scan tv show library', async () => {
    // Setup TV folder structure: Show/Season X/Episode.mkv
    const showDir = path.join(tempDir.path, 'TV', 'Test Show')
    const seasonDir = path.join(showDir, 'Season 1')
    fs.mkdirSync(seasonDir, { recursive: true })
    
    const epFile = path.join(seasonDir, 'Test Show - S01E01.mkv')
    fs.writeFileSync(epFile, 'video content')

    // Update source config
    await db.sources.setLibrariesEnabled(sourceId, [
      { id: 'show', name: 'TV Shows', type: LibraryType.Show, enabled: true }
    ])

    const result = await provider.scanLibrary('show')
    expect(result.success).toBe(true)
    
    const items = await db.media.getItems({ sourceId, type: 'episode' })
    expect(items).toHaveLength(1)
    expect(items[0].series_title).toBe('Test Show')
    expect(items[0].season_number).toBe(1)
    expect(items[0].episode_number).toBe(1)
  })

  it('should skip extras/featurettes', async () => {
    const movieFile = path.join(tempDir.path, 'Movie (2020).mkv')
    const extrasFile = path.join(tempDir.path, 'Movie-trailer.mkv')
    fs.writeFileSync(movieFile, 'movie')
    fs.writeFileSync(extrasFile, 'trailer')

    const result = await provider.scanLibrary('movie')
    expect(result.itemsAdded + result.itemsUpdated).toBe(1)
    
    const items = await db.media.getItems({ sourceId })
    expect(items).toHaveLength(1)
    expect(items[0].file_path).toBe(PathUtils.toDatabasePath(movieFile))
  })

  it('should skip short files (samples)', async () => {
    // Mock MediaFileAnalyzer to return short duration for one file
    const { getMediaFileAnalyzer } = await import('../../src/main/services/MediaFileAnalyzer')
    const analyzer = getMediaFileAnalyzer()
    
    vi.spyOn(analyzer, 'analyzeFilesParallel').mockResolvedValue(new Map([
      [path.join(tempDir.path, 'Short.mkv'), { success: true, duration: 30, video: { width: 1920, height: 1080, codec: 'h264' } } as any],
      [path.join(tempDir.path, 'Long.mkv'), { success: true, duration: 7200, video: { width: 1920, height: 1080, codec: 'h264' } } as any]
    ]))

    fs.writeFileSync(path.join(tempDir.path, 'Short.mkv'), 'short')
    fs.writeFileSync(path.join(tempDir.path, 'Long.mkv'), 'long')

    const result = await provider.scanLibrary('movie')
    expect(result.itemsAdded + result.itemsUpdated).toBe(1)
    
    const items = await db.media.getItems({ sourceId })
    expect(items).toHaveLength(1)
    expect(items[0].file_path).toContain('Long.mkv')
  })
})



