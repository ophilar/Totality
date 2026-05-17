/**
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { getSourceManager, resetSourceManagerForTesting } from '@main/services/SourceManager'
import { getLiveMonitoringService, resetLiveMonitoringServiceForTesting } from '@main/services/LiveMonitoringService'
import { GeminiAnalysisService } from '@main/services/GeminiAnalysisService'
import { DeduplicationService } from '@main/services/DeduplicationService'
import { getGeminiService } from '@main/services/GeminiService'
import { getDatabase } from '@main/database/BetterSQLiteService'
import { setupTestDb, cleanupTestDb, LocalIntegratedApiServer, createTempDir } from '@tests/TestUtils'
import { ProviderType, LibraryType } from '@main/types/database'
import fs from 'node:fs'
import path from 'node:path'

describe('Service Integration Blitz (No Mocks)', () => {
  let server: LocalIntegratedApiServer

  beforeEach(async () => {
    await setupTestDb()
    resetSourceManagerForTesting()
    resetLiveMonitoringServiceForTesting()
    server = new LocalIntegratedApiServer()
    await server.start()
  })

  afterEach(async () => {
    await cleanupTestDb()
    await server.stop()
    resetSourceManagerForTesting()
    resetLiveMonitoringServiceForTesting()
  })

  describe('SourceManager & Scanner Integration', () => {
    it('should coordinate a full Plex scan from SourceManager down to DB', async () => {
      const db = getDatabase()
      const manager = getSourceManager()
      
      server.setResponse('/library/sections', {
        MediaContainer: {
          Directory: [
            { key: '1', title: 'Movies', type: 'movie' }
          ]
        }
      })

      const movieMetadata = {
        ratingKey: 'm1',
        title: 'Integrated Movie',
        type: 'movie',
        year: 2024,
        Media: [{
          id: 1,
          width: 1920,
          height: 1080,
          videoCodec: 'h264',
          audioCodec: 'aac',
          audioChannels: 2,
          bitrate: 5128,
          container: 'mkv',
          Part: [{ 
              id: 1,
              file: '/data/movie.mkv', 
              size: 1000000,
              container: 'mkv',
              Stream: [
                  { id: 1, streamType: 1, codec: 'h264', width: 1920, height: 1080, bitrate: 5000 },
                  { id: 2, streamType: 2, codec: 'aac', channels: 2, bitrate: 128 }
              ]
          }]
        }]
      }

      server.setResponse('/library/sections/1/all', {
        MediaContainer: {
          size: 1,
          totalSize: 1,
          Metadata: [movieMetadata]
        }
      })

      server.setHandler('/library/metadata', (req) => {
          return {
              status: 200,
              body: { MediaContainer: { Metadata: [movieMetadata] } }
          }
      })

      await manager.initialize()

      await manager.addSource({
          sourceId: 'p1',
          sourceType: ProviderType.Plex,
          displayName: 'Test Plex',
          connectionConfig: { plexApiUrl: server.url, token: 'test-token' }
      })

      const provider = (manager as any).providers.get('p1')
      provider.setSelectedServer({
          machineIdentifier: 's1',
          uri: server.url,
          accessToken: 'test-token'
      })

      await db.sources.setLibrariesEnabled('p1', [{ id: '1', name: 'Movies', type: LibraryType.Movie, enabled: true }])

      const result = await manager.scanLibrary('p1', '1')
      expect(result.success).toBe(true)

      const items = await db.media.getItems({ sourceId: 'p1' })
      expect(items).toHaveLength(1)
      expect(items[0].title).toBe('Integrated Movie')
    })
  })

  describe('LiveMonitoringService Integration', () => {
    it('should detect file changes in a local folder and trigger DB updates', async () => {
        const db = getDatabase()
        const manager = getSourceManager()
        const monitor = getLiveMonitoringService()
        const temp = createTempDir('monitor-test')
        
        const movieFile = path.join(temp.path, 'New Movie (2024).mkv')

        await db.config.setSetting('monitoring_enabled', 'true')
        await db.config.setSetting('monitoring_start_on_launch', 'true')

        await db.sources.upsertSource({
            source_id: 'l1',
            source_type: ProviderType.Local,
            display_name: 'Local Folder',
            connection_config: JSON.stringify({ folderPath: temp.path, mediaType: LibraryType.Movie }),
            is_enabled: 1
        })
        
        // Use 'movie' as the library ID to match LocalFolderProvider's default for Movie-only sources
        await db.sources.setLibrariesEnabled('l1', [{ id: 'movie', name: 'Movies', type: LibraryType.Movie, enabled: true }])

        await manager.initialize()
        await monitor.initialize()
        await monitor.start()

        // Give watcher time to start
        await new Promise(resolve => setTimeout(resolve, 2000))

        // 3. Add a file
        fs.writeFileSync(movieFile, 'fake movie content')
        
        // 4. Wait for scan (Debounce is 2s + scan time)
        let found = false
        for (let i = 0; i < 20; i++) {
            const items = await db.media.getItems({ sourceId: 'l1' })
            if (items.find(item => item.title === 'New Movie')) {
                found = true
                break
            }
            await new Promise(resolve => setTimeout(resolve, 1000))
        }

        if (!found) {
            const items = await db.media.getItems({ sourceId: 'l1' })
            console.log('Items in DB:', items.map(i => i.title))
        }

        expect(found).toBe(true)
        temp.cleanup()
    }, 30000)
  })

  describe('DeduplicationService Integration', () => {
    it('should detect and resolve duplicates using real items', async () => {
        const db = getDatabase()
        const service = new DeduplicationService(db)

        await db.sources.upsertSource({
            source_id: 's1', source_type: ProviderType.Local, display_name: 'L', connection_config: '{}', is_enabled: 1
        })

        const id1 = await db.media.upsertItem({
            source_id: 's1', plex_id: 'm1-f1', title: 'Fight Club', type: 'movie', file_path: 'f1.mkv', tmdb_id: '550'
        } as any)
        const id2 = await db.media.upsertItem({
            source_id: 's1', plex_id: 'm1-f2', title: 'Fight Club', type: 'movie', file_path: 'f2.mkv', tmdb_id: '550'
        } as any)

        const count = await service.scanForDuplicates()
        expect(count).toBe(1)

        const dups = await db.duplicates.getPendingDuplicates()
        expect(dups).toHaveLength(1)

        const success = await service.resolveDuplicate(dups[0].id!, id1, false)
        expect(success).toBe(true)

        const remaining = await db.duplicates.getPendingDuplicates()
        expect(remaining).toHaveLength(0)
    })
  })

  describe('GeminiAnalysisService Integration', () => {
    it('should fetch compression advice from simulated Gemini API', async () => {
        const db = getDatabase()
        
        await db.config.setSetting('ai_enabled', 'true')
        await db.config.setSetting('gemini_api_key', 'test-key')
        await db.config.setSetting('gemini_base_url', server.url)

        await getGeminiService().initialize()
        expect(getGeminiService().isConfigured()).toBe(true)

        const mediaId = await db.media.upsertItem({
            source_id: 's1', plex_id: 'm1', title: 'AI Test Movie', type: 'movie', file_path: 'ai.mkv'
        } as any)

        server.setHandler('/v1beta/models', (req) => {
            return {
                status: 200,
                body: {
                    candidates: [{
                        content: {
                            parts: [{ text: 'Optimal compression: use HEVC with CRF 20.' }]
                        }
                    }]
                }
            }
        })

        const service = new GeminiAnalysisService()
        const result = await service.getCompressionAdvice(mediaId)

        expect(result.text).toContain('Optimal compression')
    })
  })
})
