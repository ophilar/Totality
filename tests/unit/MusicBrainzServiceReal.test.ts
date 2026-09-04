import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { MusicBrainzService, resetMusicBrainzServiceForTesting } from '@main/services/MusicBrainzService'
import { setupTestDb, cleanupTestDb } from '@tests/TestUtils'
import http from 'node:http'
import type { AddressInfo } from 'node:net'

describe('MusicBrainzService (No Mocks)', () => {
  let db: Awaited<ReturnType<typeof setupTestDb>>
  let service: MusicBrainzService
  let server: http.Server
  let serverPort: number

  beforeAll(async () => {
    // Setup local MusicBrainz mock server
    server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      const url = req.url || ''
      
      if (url.includes('/artist')) {
        if (url.includes('Radiohead')) {
          res.end(JSON.stringify({
            artists: [{ id: '10ad886a-ca4c-49dc-8a9d-e747d3fc2331', name: 'Radiohead', 'sort-name': 'Radiohead' }]
          }))
        } else if (url.includes('10ad886a-ca4c-49dc-8a9d-e747d3fc2331')) {          res.end(JSON.stringify({
            id: '10ad886a-ca4c-49dc-8a9d-e747d3fc2331',
            name: 'Radiohead',
            'sort-name': 'Radiohead',
            'release-groups': [
              { id: 'rg1', title: 'OK Computer', 'primary-type': 'Album', 'first-release-date': '1997-06-16' },
              { id: 'rg2', title: 'Kid A', 'primary-type': 'Album', 'first-release-date': '2000-10-02' }
            ]
          }))
        } else {
           res.end(JSON.stringify({ artists: [] }))
        }
      } else if (url.includes('/release-group')) {
         res.end(JSON.stringify({ 'release-groups': [] }))
      } else if (url.includes('/release')) {
         res.end(JSON.stringify({ releases: [] }))
      } else {
        res.end(JSON.stringify({ artists: [] }))
      }
    })

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const address = server.address()
        if (!address || typeof address === 'string') throw new Error('Test server did not expose an address')
        serverPort = (address as AddressInfo).port
        resolve()
      })
    })
  })

  afterAll(async () => {
    return new Promise<void>((resolve) => {
      server.close(() => resolve())
    })
  })

  beforeEach(async () => {
    resetMusicBrainzServiceForTesting()

    db = await setupTestDb()
    
    await db.config.setSetting('musicbrainz_base_url', `http://127.0.0.1:${serverPort}`)

    service = new MusicBrainzService()
    await service.initialize()
  })

  afterEach(() => {
    cleanupTestDb()
  })

  it('should search for an artist', async () => {
    const artists = await service.searchArtist('Radiohead')
    expect(artists).toHaveLength(1)
    expect(artists[0].name).toBe('Radiohead')
    expect(artists[0].id).toBe('10ad886a-ca4c-49dc-8a9d-e747d3fc2331')
  })

  it('should analyze artist completeness and find missing albums', async () => {
    // Only own OK Computer
    const completeness = await service.analyzeArtistCompleteness(
      'Radiohead',
      '10ad886a-ca4c-49dc-8a9d-e747d3fc2331',
      ['OK Computer'],
      []
    )

    expect(completeness.total_albums).toBe(2)
    expect(completeness.owned_albums).toBe(1)
    
    const missing = JSON.parse(completeness.missing_albums)
    expect(missing).toHaveLength(1)
    expect(missing[0].title).toBe('Kid A')
  })

  it('returns exact deferred counts when the five-error breaker trips during artists', async () => {
    for (let i = 0; i < 6; i++) {
      await db.music.upsertArtist({ source_id: 'src', source_type: 'local', provider_id: `a${i}`, name: `Artist ${i}` })
    }
    for (let i = 0; i < 4; i++) {
      await db.music.upsertAlbum({ source_id: 'src', source_type: 'local', provider_id: `al${i}`, artist_name: `Artist ${i}`, title: `Album ${i}` })
    }

    ;(service as any).analyzeArtistCompleteness = async () => { throw new Error('503 provider unavailable') }
    const result = await service.analyzeAllMusic(undefined, undefined, { skipRecentlyAnalyzed: false })

    expect(result.status).toBe('deferred')
    // Four artists already reached the breaker boundary; the current failed
    // item is included in the five recorded failures, leaving two artists and
    // all four albums deferred.
    expect(result.deferred).toBe(6)
    expect(result.artistsAnalyzed).toBe(0)
    expect(db.isInTransaction()).toBe(false)
  })

  it('counts only the remaining albums when the breaker trips during album analysis', async () => {
    const artistId = await db.music.upsertArtist({ source_id: 'src', source_type: 'local', provider_id: 'artist', name: 'Radiohead', musicbrainz_id: '10ad886a-ca4c-49dc-8a9d-e747d3fc2331' })
    for (let i = 0; i < 6; i++) {
      await db.music.upsertAlbum({ source_id: 'src', source_type: 'local', provider_id: `album${i}`, artist_id: artistId, artist_name: 'Radiohead', title: `Album ${i}` })
    }
    ;(service as any).analyzeAlbumTrackCompleteness = async () => { throw new Error('503 provider unavailable') }
    const result = await service.analyzeAllMusic(undefined, undefined, { skipRecentlyAnalyzed: false })
    expect(result.status).toBe('deferred')
    expect(result.deferred).toBe(2)
    expect(result.albumsAnalyzed).toBe(0)
    expect(db.isInTransaction()).toBe(false)
  })

  it('returns cancelled without leaving a transaction open', async () => {
    await db.music.upsertArtist({ source_id: 'src', source_type: 'local', provider_id: 'a1', name: 'Radiohead', musicbrainz_id: '10ad886a-ca4c-49dc-8a9d-e747d3fc2331' })
    await db.music.upsertArtist({ source_id: 'src', source_type: 'local', provider_id: 'a2', name: 'Radiohead 2', musicbrainz_id: '10ad886a-ca4c-49dc-8a9d-e747d3fc2331' })
    const original = service.analyzeArtistCompleteness.bind(service)
    let calls = 0
    ;(service as any).analyzeArtistCompleteness = async (...args: unknown[]) => {
      const value = await original(...args as Parameters<MusicBrainzService['analyzeArtistCompleteness']>)
      calls++
      if (calls === 1) service.cancel()
      return value
    }
    const result = await service.analyzeAllMusic(undefined, undefined, { skipRecentlyAnalyzed: false })
    expect(result.status).toBe('cancelled')
    expect(result.artistsAnalyzed).toBe(1)
    expect(db.isInTransaction()).toBe(false)
  })

  it('resets the consecutive-error counter after a successful response', async () => {
    for (let i = 0; i < 6; i++) {
      await db.music.upsertArtist({ source_id: 'src', source_type: 'local', provider_id: `reset${i}`, name: i === 1 ? 'Radiohead' : `Reset ${i}`, musicbrainz_id: i === 1 ? '10ad886a-ca4c-49dc-8a9d-e747d3fc2331' : `mbid-${i}` })
    }
    const original = service.analyzeArtistCompleteness.bind(service)
    let calls = 0
    ;(service as any).analyzeArtistCompleteness = async (...args: unknown[]) => {
      calls++
      if (calls !== 2) throw new Error('503 provider unavailable')
      return original(...args as Parameters<MusicBrainzService['analyzeArtistCompleteness']>)
    }
    const result = await service.analyzeAllMusic(undefined, undefined, { skipRecentlyAnalyzed: false })
    expect(result.status).toBe('partial')
    expect(result.artistsAnalyzed).toBe(1)
    expect(result.deferred).toBe(0)
  })

  it('distinguishes a database write failure from a provider failure', async () => {
    const artistId = await db.music.upsertArtist({ source_id: 'src', source_type: 'local', provider_id: 'db-failure', name: 'Radiohead', musicbrainz_id: '10ad886a-ca4c-49dc-8a9d-e747d3fc2331' })
    vi.spyOn(db.music, 'upsertArtistCompleteness').mockRejectedValueOnce(new Error('SQLite constraint failed for artist_completeness'))
    const result = await service.analyzeAllMusic(undefined, undefined, { skipRecentlyAnalyzed: false })
    expect(result.status).toBe('failed')
    expect(result.artistsAnalyzed).toBe(0)
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ item: 'Radiohead', kind: 'database' })
    ]))
    expect(artistId).toBeGreaterThan(0)
  })
})



