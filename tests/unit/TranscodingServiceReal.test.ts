import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { getTranscodingService, TranscodingService, resetTranscodingServiceForTesting } from '@main/services/TranscodingService'
import { getMediaFileAnalyzer } from '@main/services/MediaFileAnalyzer'
import { setupTestDb, cleanupTestDb, setupRealIntegratedBridge } from '@tests/TestUtils'
import { registerTranscodingHandlers } from '@main/ipc/transcoding'
import fs from 'node:fs'
import path from 'node:path'

describe('TranscodingService (No Mocks)', () => {
  let db: Awaited<ReturnType<typeof setupTestDb>>
  let service: TranscodingService
  let handlers: Map<string, Function>

  beforeEach(async () => {
    // Manually mock window for the bridge
    Object.assign(globalThis, { window: {} })
    
    resetTranscodingServiceForTesting()

    db = await setupTestDb()
    
    service = new TranscodingService({ advise: async () => ({ text: JSON.stringify({ summary: 'Fixture parameters', videoCodec: 'svt_av1', crf: 25, preset: 'fast', expectedSizeReduction: '50%', warnings: [] }) }) })
    getTranscodingService().setParameterAdvisorForTesting({ advise: async () => ({ text: JSON.stringify({ summary: 'Optimized for AV1', videoCodec: 'svt_av1', crf: 25, preset: 'fast', expectedSizeReduction: '50%', warnings: [] }) }) })
    service.setAvailabilityOverride({ handbrake: true, ffmpeg: true })
  })

  afterEach(() => {
    cleanupTestDb()
  })

  it('should check tool availability', async () => {
    const availability = await service.checkAvailability()
    expect(availability.handbrake).toBe(true)

  })

  it('should generate transcoding parameters through the production advisor port', async () => {
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
    expect(params.summary).toBe('Fixture parameters')
  })

  describe('Transcoding IPC Integration', () => {
    beforeEach(() => {
      const bridge = setupRealIntegratedBridge()
      handlers = bridge.handlers
      registerTranscodingHandlers()
    })

    it('should correctly expose availability via IPC', async () => {
      const handler = handlers.get('transcoding:checkAvailability')!
      const availability = await handler({})
      expect(availability.handbrake).toBe(true)
    })

    it('should generate parameters via IPC call', async () => {
      const handler = handlers.get('transcoding:getParameters')!
      const filePath = path.join(process.cwd(), 'tests/tmp/transcoding-real-video.mkv')
      fs.writeFileSync(filePath, 'fixture')
      await db.sources.upsertSource({ source_id: 'src1', source_type: 'local', display_name: 'Test source', connection_config: JSON.stringify({ folderPath: path.dirname(filePath) }), is_enabled: 1 })
      await db.media.upsertItem({ id: 1, source_id: 'src1', plex_id: 'p2', title: 'Video', type: 'movie', file_path: filePath, file_size: 7 })
      
      const persistedItem = await db.media.getItemById(1)
      const authorizedPath = persistedItem?.file_path
      getMediaFileAnalyzer().setAnalysisOverride(authorizedPath!, {
        success: true, filePath: authorizedPath!,
        video: { codec: 'h264', width: 1920, height: 1080, bitrate: 5000 },
        audioTracks: [], subtitleTracks: []
      })

      const params = await handler({}, 1, { targetCodec: 'av1' })
      expect(params.summary).toBe("Optimized for AV1")
    })
  })
})
