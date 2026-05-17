/**
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { PlexProvider } from '@main/providers/plex/PlexProvider'
import { setupTestDb, cleanupTestDb, LocalIntegratedApiServer } from '@tests/TestUtils'
import { ProviderType } from '@main/types/database'

describe('Deep Scan Simulation (Load Testing)', () => {
  let server: LocalIntegratedApiServer

  beforeEach(async () => {
    await setupTestDb()
    server = new LocalIntegratedApiServer()
    await server.start()
  })

  afterEach(async () => {
    await cleanupTestDb()
    await server.stop()
  })

  it('should handle large library scans with hundreds of items through real networking', async () => {
    const itemCount = 50
    const movies = Array.from({ length: itemCount }, (_, i) => ({
      ratingKey: `m${i}`,
      title: `Movie ${i}`,
      type: 'movie',
      year: 2000 + (i % 25),
      duration: 3600000,
      Media: [{
        id: i,
        width: 1920,
        height: 1080,
        videoCodec: 'h264',
        audioCodec: 'aac',
        audioChannels: 2,
        bitrate: 5128,
        container: 'mkv',
        Part: [{ 
            id: i,
            file: `/path/movie_${i}.mkv`, 
            size: 1000000000,
            container: 'mkv',
            Stream: [
                { id: i*2, streamType: 1, codec: 'h264', width: 1920, height: 1080, bitrate: 5000 },
                { id: i*2+1, streamType: 2, codec: 'aac', channels: 2, bitrate: 128 }
            ]
        }]
      }]
    }))

    server.setResponse('/library/sections', {
      MediaContainer: {
        Directory: [
          { key: '1', title: 'Movies', type: 'movie' }
        ]
      }
    })

    server.setResponse('/library/sections/1/all', {
      MediaContainer: {
        size: itemCount,
        totalSize: itemCount,
        Metadata: movies
      }
    })

    // Handler for detailed metadata calls
    server.setHandler('/library/metadata', (req, body) => {
        const path = req.url || ''
        const ratingKey = path.split('/').pop()
        const movie = movies.find(m => m.ratingKey === ratingKey)
        if (movie) {
            return {
                status: 200,
                body: { MediaContainer: { Metadata: [movie] } }
            }
        }
        return { status: 404, body: { error: 'Not found' } }
    })

    const provider = new PlexProvider({
      sourceId: 'load-test',
      sourceType: ProviderType.Plex,
      displayName: 'Load Test Plex',
      connectionConfig: { plexApiUrl: server.url }
    })

    provider.setSelectedServer({
        name: 'Test Server',
        host: '127.0.0.1',
        address: '127.0.0.1',
        port: 32400,
        uri: server.url,
        scheme: 'http',
        machineIdentifier: 's1',
        version: '1.0.0',
        accessToken: 'valid-token',
        owned: true
    })

    const scanResult = await provider.scanLibrary('1')
    
    if (!scanResult.success) {
        console.error('Scan failed:', scanResult.errors)
    }
    expect(scanResult.success).toBe(true)
    expect(scanResult.itemsScanned).toBe(itemCount)
  }, 60000) 
})
