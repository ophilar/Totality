import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import { getTranscodingService, TranscodingService, resetTranscodingServiceForTesting } from '@main/services/TranscodingService'
import { getGeminiService, resetGeminiServiceForTesting } from '@main/services/GeminiService'
import { getMediaFileAnalyzer } from '@main/services/MediaFileAnalyzer'
import { setupTestDb, cleanupTestDb, setupRealIntegratedBridge } from '@tests/TestUtils'
import { registerTranscodingHandlers } from '@main/ipc/transcoding'
import http from 'node:http'

describe('TranscodingService (No Mocks)', () => {
  let db: any
  let service: TranscodingService
  let server: http.Server
  let serverPort: number
  let handlers: Map<string, Function>

  beforeAll(async () => {
    // Manually mock window for the bridge
    (global as any).window = {}
    
    // Setup local Gemini mock server
    server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                summary: "Optimized for AV1",
                handbrakeArgs: ["--encoder", "svt_av1", "--quality", "25"],
                expectedSizeReduction: "50%",
                warnings: []
              })
            }]
          }
        }]
      }))
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
    delete (global as any).window
    return new Promise<void>((resolve) => {
      server.close(() => resolve())
    })
  })

  beforeEach(async () => {
    resetGeminiServiceForTesting()
    resetTranscodingServiceForTesting()

    db = await setupTestDb()
    
    // Redirect Gemini traffic to local mock server
    const originalFetch = globalThis.fetch
    vi.stubGlobal('fetch', async (url: any, init: any) => {
      const urlStr = url.toString()
      try {
        const u = new URL(urlStr)
        if (u.hostname === 'generativelanguage.googleapis.com' || u.hostname === 'googlegenerativeai.com') {
          const mockUrl = `http://127.0.0.1:${serverPort}${u.pathname}${u.search}`
          return originalFetch(mockUrl, init)
        }
      } catch (e) {}
      return originalFetch(url, init)
    })

    await db.config.setSetting('gemini_api_key', 'AIzaSyB-TEST-KEY-1234567890-ABCDEF')
    await db.config.setSetting('ai_enabled', 'true')
    
    await getGeminiService().initialize()

    service = getTranscodingService()
    service.setAvailabilityOverride({ handbrake: true, ffmpeg: true })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    cleanupTestDb()
  })

  it('should check tool availability', async () => {
    const availability = await service.checkAvailability()
    expect(availability.handbrake).toBe(true)
    expect(availability.ffmpeg).toBe(true)
  })

  it('should generate transcoding parameters via Gemini', async () => {
    const analyzer = getMediaFileAnalyzer()
    const filePath = '/path/to/video.mkv'
    
    analyzer.setAnalysisOverride(filePath, {
      success: true,
      filePath,
      video: { codec: 'h264', width: 1920, height: 1080, bitrate: 10000 },
      audioTracks: [{ codec: 'ac3', channels: 6, bitrate: 640, index: 0 }],
      subtitleTracks: []
    })

    const params = await service.getTranscodeParameters(filePath, { targetCodec: 'av1' })
    expect(params.summary).toBe("Optimized for AV1")
  })

  describe('Transcoding IPC Integration', () => {
    beforeEach(() => {
      const bridge = setupRealIntegratedBridge()
      handlers = bridge.handlers
      registerTranscodingHandlers()
    })

    it('should correctly expose availability via IPC', async () => {
      const handler = handlers.get('transcoding:checkAvailability')!
      const availability = await handler({} as any)
      expect(availability.handbrake).toBe(true)
    })

    it('should generate parameters via IPC call', async () => {
      const handler = handlers.get('transcoding:getParameters')!
      const filePath = '/path/to/vid2.mkv'
      
      getMediaFileAnalyzer().setAnalysisOverride(filePath, {
        success: true, filePath,
        video: { codec: 'h264', width: 1920, height: 1080, bitrate: 5000 },
        audioTracks: [], subtitleTracks: []
      })

      const params = await handler({} as any, filePath, { targetCodec: 'av1' })
      expect(params.summary).toBe("Optimized for AV1")
    })
  })
})
