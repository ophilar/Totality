import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

vi.unmock('child_process')

import { MediaFileAnalyzer } from '@main/services/MediaFileAnalyzer'

let fixtureDirectory: string
let audioFixture: string
let videoFixture: string

beforeAll(() => {
  fixtureDirectory = mkdtempSync(path.join(os.tmpdir(), 'totality-deep-analysis-'))
  audioFixture = path.join(fixtureDirectory, 'volume.wav')
  videoFixture = path.join(fixtureDirectory, 'bitrate.mkv')

  execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' })
  execFileSync('ffprobe', ['-version'], { stdio: 'ignore' })
  execFileSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=1',
    '-af', 'volume=4', '-c:a', 'pcm_s16le', audioFixture,
  ], { stdio: 'ignore' })
  execFileSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=64x64:rate=25:duration=2',
    '-c:v', 'mpeg4', '-q:v', '5', '-an', videoFixture,
  ], { stdio: 'ignore' })
}, 30_000)

afterAll(() => {
  rmSync(fixtureDirectory, { recursive: true, force: true })
})

describe('MediaFileAnalyzer deep analysis with system FFmpeg tools', () => {
  it('detects volume from an encoded audio fixture', async () => {
    const result = await new MediaFileAnalyzer().deepAnalyzeFile(audioFixture, { detectVolume: true })
    const audio = result.audioTracks?.[0]

    expect(result.success).toBe(true)
    expect(audio?.peakVolumeDB).toBeGreaterThan(-8)
    expect(audio?.peakVolumeDB).toBeLessThan(-4)
    expect(audio?.meanVolumeDB).toBeGreaterThan(-11)
    expect(audio?.meanVolumeDB).toBeLessThan(-7)
  })

  it('calculates bitrate variance from encoded video packets', async () => {
    const result = await new MediaFileAnalyzer().deepAnalyzeFile(videoFixture, { scanBitrate: true })

    expect(result.success).toBe(true)
    expect(result.deepAnalysis?.avgBitrate).toBeGreaterThan(0)
    expect(result.deepAnalysis?.peakBitrate).toBeGreaterThan(0)
    expect(result.deepAnalysis?.bitrateVariance).toBeGreaterThanOrEqual(0)
  })

  it('propagates FFmpeg failure for a missing media file', async () => {
    const missingFile = path.join(fixtureDirectory, 'missing.wav')

    await expect(new MediaFileAnalyzer().deepAnalyzeFile(missingFile, { detectVolume: true }))
      .rejects.toThrow(/FFmpeg exited with code [1-9]\d*/)
  })
})
