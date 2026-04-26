import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { getTranscodingService, TranscodingService, resetTranscodingServiceForTesting } from '../../src/main/services/TranscodingService'
import { getBetterSQLiteService, resetBetterSQLiteServiceForTesting } from '../../src/main/database/BetterSQLiteService'
import { resetGeminiServiceForTesting } from '../../src/main/services/GeminiService'
import { getMediaFileAnalyzer } from '../../src/main/services/MediaFileAnalyzer'
import http from 'node:http'

describe('TranscodingService (No Mocks)', () => {
  let db: any
  let service: TranscodingService
  let server: http.Server
  let serverPort: number

  beforeAll(async () => {
    // Setup local Gemini mock server
    server = http.createServer((req, res) => {
      // console.log(`[MOCK GEMINI] Request: ${req.method} ${req.url}`)
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
    return new Promise<void>((resolve) => {
      server.close(() => resolve())
    })
  })

  beforeEach(async () => {
    resetBetterSQLiteServiceForTesting()
    resetGeminiServiceForTesting()
    resetTranscodingServiceForTesting()

    process.env.TOTALITY_DB_PATH = ':memory:'
    process.env.NODE_ENV = 'test'

    db = getBetterSQLiteService()
    db.initialize()
    
    // Redirect Gemini traffic to local mock server
    const originalFetch = globalThis.fetch
    vi.stubGlobal('fetch', async (url: any, init: any) => {
      const urlStr = url.toString()
      try {
        const u = new URL(urlStr)
        // Securely check if the request is destined for Google's Gemini API
        if (u.hostname === 'generativelanguage.googleapis.com' || u.hostname === 'googlegenerativeai.com') {
          const mockUrl = `http://127.0.0.1:${serverPort}${u.pathname}${u.search}`
          return originalFetch(mockUrl, init)
        }
      } catch (e) {
        // Ignore parsing errors for non-URL strings
      }
      return originalFetch(url, init)
    })

    db.config.setSetting('gemini_api_key', 'AIzaSyB-TEST-KEY-1234567890-ABCDEF')
    db.config.setSetting('ai_enabled', 'true')

    service = getTranscodingService()
    service.setAvailabilityOverride({ handbrake: true, ffmpeg: true })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('should check tool availability', async () => {
    const availability = await service.checkAvailability()
    expect(availability.handbrake).toBe(true)
    expect(availability.ffmpeg).toBe(true)
    expect(availability.mkvtoolnix).toBe(false)
  })

  it('should generate transcoding parameters via Gemini', async () => {
    const analyzer = getMediaFileAnalyzer()
    const filePath = '/path/to/video.mkv'
    
    // Set analyzer override
    analyzer.setAnalysisOverride(filePath, {
      success: true,
      filePath,
      video: { codec: 'h264', width: 1920, height: 1080, bitrate: 10000 },
      audioTracks: [{ codec: 'ac3', channels: 6, bitrate: 640, index: 0 }],
      subtitleTracks: []
    })

    const params = await service.getTranscodeParameters(filePath, { targetCodec: 'av1' })
    
    expect(params.summary).toBe("Optimized for AV1")
    expect(params.handbrakeArgs).toContain("--encoder")
    expect(params.handbrakeArgs).toContain("svt_av1")
    expect(params.expectedSizeReduction).toBe("50%")
  })

  it('should fail parameters if Gemini is not configured', async () => {
    db.config.setSetting('ai_enabled', 'false')
    resetGeminiServiceForTesting() // Need to reset so it picks up the change
    
    const filePath = '/path/to/video.mkv'
    await expect(service.getTranscodeParameters(filePath)).rejects.toThrow('Gemini AI is not configured')
  })
})
