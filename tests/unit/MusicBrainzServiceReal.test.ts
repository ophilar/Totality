import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { MusicBrainzService, resetMusicBrainzServiceForTesting } from '../../src/main/services/MusicBrainzService'
import { getBetterSQLiteService, resetBetterSQLiteServiceForTesting } from '../../src/main/database/BetterSQLiteService'
import http from 'node:http'

describe('MusicBrainzService (No Mocks)', () => {
  let db: any
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
        const address = server.address() as any
        serverPort = address.port
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
    resetBetterSQLiteServiceForTesting()
    resetMusicBrainzServiceForTesting()

    process.env.TOTALITY_DB_PATH = ':memory:'
    process.env.NODE_ENV = 'test'

    db = getBetterSQLiteService()
    db.initialize()
    
    db.config.setSetting('musicbrainz_base_url', `http://127.0.0.1:${serverPort}`)

    service = new MusicBrainzService()
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
})
