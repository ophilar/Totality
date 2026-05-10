import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { PlexProvider } from '@main/providers/plex/PlexProvider'
import { setupTestDb, cleanupTestDb } from '@tests/TestUtils'
import * as http from 'node:http'
import { AddressInfo } from 'node:net'
import { ProviderType } from '@main/types/database'

describe('Plex Authentication (Real Logic)', () => {
  let server: http.Server
  let serverUrl: string
  let lastRequestBody: any = null

  beforeEach(async () => {
    await setupTestDb()
    
    // Setup a local "Plex API" server
    server = http.createServer((req, res) => {
      let body = ''
      req.on('data', chunk => { body += chunk })
      req.on('end', () => {
        if (body) {
          try { lastRequestBody = JSON.parse(body) } catch { lastRequestBody = body }
        }
        
        res.setHeader('Content-Type', 'application/json')
        if (req.url?.includes('/pins') && req.method === 'POST') {
          res.end(JSON.stringify({ id: 12345, code: 'TEST-CODE' }))
        } else if (req.url?.includes('/pins/12345') && req.method === 'GET') {
          res.end(JSON.stringify({ id: 12345, authToken: 'valid-plex-token' }))
        } else {
          res.statusCode = 404
          res.end()
        }
      })
    })

    await new Promise<void>(resolve => {
      server.listen(0, '127.0.0.1', () => {
        const port = (server.address() as AddressInfo).port
        serverUrl = `http://127.0.0.1:${port}`
        resolve()
      })
    })
  })

  afterEach(async () => {
    await cleanupTestDb()
    await new Promise(resolve => server.close(resolve))
  })

  it('should generate a correctly encoded Auth URL with hashbang', () => {
    const provider = new PlexProvider({
      sourceId: 'test',
      sourceType: ProviderType.Plex,
      displayName: 'Test',
      connectionConfig: {}
    })
    
    const url = provider.getAuthUrl(12345, 'TEST-CODE')
    
    // Verify 2026 Standards
    expect(url).toContain('https://app.plex.tv/auth/#!?')
    expect(url).toContain('context%5Bdevice%5D%5Bproduct%5D=Totality') // Encoded brackets
    expect(url).toContain('code=TEST-CODE')
  })

  it('should successfully request and poll for a PIN using local server', async () => {
    const provider = new PlexProvider({
      sourceId: 'test',
      sourceType: ProviderType.Plex,
      displayName: 'Test',
      connectionConfig: {
        plexApiUrl: serverUrl // Inject our local server URL
      }
    })

    // Step 1: Request PIN
    const pin = await provider.requestAuthPin()
    expect(pin.id).toBe(12345)
    expect(pin.code).toBe('TEST-CODE')

    // Step 2: Poll for Token
    const token = await provider.checkAuthPin(pin.id)
    expect(token).toBe('valid-plex-token')
  })
})
