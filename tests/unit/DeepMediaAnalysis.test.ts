import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getMediaFileAnalyzer } from '@main/services/MediaFileAnalyzer'
import { spawn } from 'child_process'
import { EventEmitter } from 'events'

vi.mock('child_process', () => ({
  spawn: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue('mock-user-data')
  }
}))

vi.mock('@main/services/LoggingService', () => ({
  getLoggingService: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn()
  })
}))

describe('MediaFileAnalyzer Deep Analysis', () => {
  const analyzer = getMediaFileAnalyzer()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('detects audio volume using ffmpeg volumedetect', async () => {
    const mockStderr = `
      [Parsed_volumedetect_0 @ 000001f3f7e5d800] n_samples: 480000
      [Parsed_volumedetect_0 @ 000001f3f7e5d800] max_volume: -3.2 dB
      [Parsed_volumedetect_0 @ 000001f3f7e5d800] mean_volume: -21.5 dB
    `

    // Mock spawn for ffmpeg -version and then volumedetect
    ;(spawn as any).mockImplementation((path: string, args: string[]) => {
      const ee = new EventEmitter() as any
      ee.stdout = new EventEmitter()
      ee.stderr = new EventEmitter()
      
      if (args.includes('-version')) {
        process.nextTick(() => ee.emit('close', 0))
      } else if (args.includes('volumedetect')) {
        process.nextTick(() => {
          ee.stderr.emit('data', Buffer.from(mockStderr))
          ee.emit('close', 0)
        })
      }
      return ee
    })

    const result = await analyzer.deepAnalyzeFile('test.mkv', { detectVolume: true })
    
    expect(result.success).toBe(true)
    expect(result.audioTracks![0].peakVolumeDB).toBe(-3.2)
    expect(result.audioTracks![0].meanVolumeDB).toBe(-21.5)
  })

  it('analyzes bitrate variance using ffprobe packet scan', async () => {
    // Simulate compact output for packets: size|duration_time
    // Need at least 0.5s for the window to trigger
    const mockStdout = []
    for (let i = 0; i < 20; i++) {
      mockStdout.push(`${100000 + (i % 5) * 10000}|0.04`) // 20 * 0.04 = 0.8s
    }
    const mockStdoutStr = mockStdout.join('\n')

    ;(spawn as any).mockImplementation((path: string, args: string[]) => {
      const ee = new EventEmitter() as any
      ee.stdout = new EventEmitter()
      ee.stderr = new EventEmitter()
      
      if (args.includes('-version')) {
        process.nextTick(() => ee.emit('close', 0))
      } else if (args.includes('packet=size,duration_time')) {
        process.nextTick(() => {
          ee.stdout.emit('data', Buffer.from(mockStdoutStr))
          ee.emit('close', 0)
        })
      }
      return ee
    })

    const result = await analyzer.deepAnalyzeFile('test.mkv', { scanBitrate: true })
    
    expect(result.success).toBe(true)
    expect(result.deepAnalysis?.avgBitrate).toBeGreaterThan(0)
    expect(result.deepAnalysis?.peakBitrate).toBeGreaterThan(0)
    expect(result.deepAnalysis?.bitrateVariance).toBeDefined()
  })

  it('handles FFmpeg failure loudly', async () => {
    ;(spawn as any).mockImplementation((path: string, args: string[]) => {
      const ee = new EventEmitter() as any
      ee.stdout = new EventEmitter()
      ee.stderr = new EventEmitter()
      
      if (args.includes('-version')) {
        process.nextTick(() => ee.emit('close', 0))
      } else {
        process.nextTick(() => ee.emit('close', 1)) // Failure
      }
      return ee
    })

    await expect(analyzer.deepAnalyzeFile('test.mkv', { detectVolume: true }))
      .rejects.toThrow('FFmpeg exited with code 1')
  })
})
