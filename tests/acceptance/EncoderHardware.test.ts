import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { setupTestDb, cleanupTestDb } from '@tests/TestUtils'
import { ChildProcessMeasurementRunner, MeasuredOptimizationService } from '@main/services/MeasuredOptimizationService'
import { getMediaFileAnalyzer } from '@main/services/MediaFileAnalyzer'
import { TranscodingService, type TranscodeOptions } from '@main/services/TranscodingService'
import { buildTargetTranscodePlan } from '@main/services/transcoding/TargetTranscodePlan'

describe.skipIf(process.env.TOTALITY_HARDWARE_ACCEPTANCE !== '1')('opt-in real hardware encoding acceptance', () => {
  let directory: string
  let db: Awaited<ReturnType<typeof setupTestDb>>
  const runner = new ChildProcessMeasurementRunner()
  beforeEach(async () => { db = await setupTestDb(); directory = await fs.mkdtemp(path.resolve('tests/tmp/hardware-real-')) })
  afterEach(async () => { await fs.rm(directory, { recursive: true, force: true }); cleanupTestDb() })
  it('measures and decodes HEVC/AV1 clips using every runnable NVIDIA and Intel encoder', async () => {
    const service = new TranscodingService()
    const analyzer = getMediaFileAnalyzer()
    const capabilities = await service.getCapabilities()
    expect(capabilities.probeFailures).toEqual([])
    const inputPath = path.join(directory, 'source.mkv')
    await runner.run(analyzer.getFFmpegPath()!, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24', '-t', '6', '-c:v', 'ffv1', inputPath])
    const analysis = await analyzer.analyzeFile(inputPath)
    const profile = await db.playbackTargetProfiles.get('builtin:plex-webos-4-lg-b8')
    const verified = capabilities.verifiedEncoders.filter(encoder => /^(nvenc|qsv)_/.test(encoder))
    expect(verified.length).toBeGreaterThan(0)
    console.log('Runnable hardware encoders:', verified.join(', '))
    for (const encoder of verified) {
      const targetCodec = encoder.endsWith('av1') ? 'av1' : 'hevc'
      const vendor = encoder.startsWith('nvenc') ? 'NVIDIA' : 'Intel'
      const gpu = capabilities.gpus.find(gpu => gpu.vendor === vendor)!
      const supportedProfile = { ...profile!, definition: { ...profile!.definition, video: { ...profile!.definition.video, codecs: [targetCodec], profiles: ['Main'], bitDepths: [8] } } }
      const options: TranscodeOptions = { targetCodec, encoder, preset: vendor === 'NVIDIA' ? 'p6' : 'slow', crf: 20, useGpu: true, gpuId: gpu.id, qualityProfile: 'balanced', encoderPolicy: 'hardware', targetContainer: 'mkv', targetHdrFormat: 'SDR' }
      options.targetConversion = buildTargetTranscodePlan(analysis, supportedProfile, options)
      const params = await service.getTranscodeParameters(inputPath, options)
      const measured = await new MeasuredOptimizationService().measure({ inputPath, outputDirectory: path.join(directory, encoder), durationMs: analysis.duration!, referenceFilter: options.targetConversion.videoFilter, candidates: [{ encoder, preset: options.preset!, quality: 20, outputBytes: 0, vmafMean: 0, vmafP5: 0, cambiMean: 0, ffmpegArgs: params.ffmpegArgs! }] })
      expect(measured.candidates[0].samplePaths).toHaveLength(3)
      expect(measured.candidates[0].vmafMean).toBeGreaterThan(85)
      for (const sample of measured.candidates[0].samplePaths!) {
        const output = await analyzer.analyzeFile(sample)
        expect(output.video?.codec).toBe(targetCodec)
        expect(output.video?.frameRate).toBe(24)
        await runner.run(analyzer.getFFmpegPath()!, ['-v', 'error', '-xerror', '-i', sample, '-f', 'null', '-'])
      }
      console.log(`PASS: ${gpu.name}, ${encoder}, three measured clips and complete decoding`)
    }
  }, 120000)
})
