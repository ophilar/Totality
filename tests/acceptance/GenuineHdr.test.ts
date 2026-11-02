import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { setupTestDb, cleanupTestDb } from '@tests/TestUtils'
import { ChildProcessMeasurementRunner, MeasuredOptimizationService } from '@main/services/MeasuredOptimizationService'
import { getMediaFileAnalyzer } from '@main/services/MediaFileAnalyzer'
import { TranscodingService, type TranscodeOptions } from '@main/services/TranscodingService'
import { buildTargetTranscodePlan } from '@main/services/transcoding/TargetTranscodePlan'

describe.skipIf(!process.env.TOTALITY_HDR_FIXTURES)('opt-in genuine HDR clip acceptance', () => {
  let directory: string
  let db: Awaited<ReturnType<typeof setupTestDb>>
  const runner = new ChildProcessMeasurementRunner()
  beforeEach(async () => { db = await setupTestDb(); directory = await fs.mkdtemp(path.resolve('tests/tmp/genuine-hdr-')) })
  afterEach(async () => { await fs.rm(directory, { recursive: true, force: true }); cleanupTestDb() })
  it.each(['DV8.mkv', 'HDR10.mkv', 'HLG.mkv'].flatMap(fixture => (['SDR', 'HDR10'] as const).map(targetHdrFormat => ({ fixture, targetHdrFormat }))))('measures $fixture -> $targetHdrFormat with NVENC HEVC', async ({ fixture, targetHdrFormat }) => {
    const service = new TranscodingService(), analyzer = getMediaFileAnalyzer()
    const capabilities = await service.getCapabilities()
    expect(capabilities.verifiedEncoders).toContain('nvenc_h265')
    const gpu = capabilities.gpus.find(gpu => gpu.vendor === 'NVIDIA')!
    const profile = await db.playbackTargetProfiles.get('builtin:plex-webos-4-lg-b8')
      const inputPath = path.join(process.env.TOTALITY_HDR_FIXTURES!, fixture)
      const analysis = await analyzer.analyzeFile(inputPath)
      if (fixture === 'DV8.mkv') expect(analysis.video).toMatchObject({ hdrFormat: 'Dolby Vision', dolbyVisionProfile: 8 })
      if (fixture === 'HLG.mkv') expect(analysis.video?.hdrFormat).toBe('HLG')
      if (fixture === 'HDR10.mkv') expect(['HDR10', 'HDR10+']).toContain(analysis.video?.hdrFormat)
        const options: TranscodeOptions = { targetCodec: 'hevc', encoder: 'nvenc_h265', preset: 'p6', crf: 18, useGpu: true, gpuId: gpu.id, qualityProfile: 'balanced', encoderPolicy: 'hardware', targetContainer: 'mkv', targetHdrFormat }
        options.targetConversion = buildTargetTranscodePlan(analysis, profile!, options)
        const params = await service.getTranscodeParameters(inputPath, options)
        const measured = await new MeasuredOptimizationService().measure({ inputPath, outputDirectory: path.join(directory, `${fixture}-${targetHdrFormat}`), durationMs: analysis.duration!, referenceFilter: options.targetConversion.videoFilter, referenceInputArgs: options.targetConversion.inputArgs, candidates: [{ encoder: 'nvenc_h265', preset: 'p6', quality: 18, outputBytes: 0, vmafMean: 0, vmafP5: 0, cambiMean: 0, ffmpegArgs: params.ffmpegArgs! }] })
        const result = measured.candidates[0]
        expect(result.samplePaths).toHaveLength(3)
        expect(result.vmafMean).toBeGreaterThan(85)
        for (const sample of result.samplePaths!) {
          const output = await analyzer.analyzeFile(sample)
          expect(output.video?.hdrFormat).toBe(targetHdrFormat)
          expect(output.video?.frameRate).toBe(analysis.video!.frameRate)
          await runner.run(analyzer.getFFmpegPath()!, ['-v', 'error', '-xerror', '-i', sample, '-f', 'null', '-'])
        }
        console.log(`PASS: genuine ${analysis.video!.hdrFormat}, DV profile ${analysis.video!.dolbyVisionProfile ?? 'not applicable'} -> ${targetHdrFormat}, NVENC HEVC, VMAF ${result.vmafMean.toFixed(2)}`)
  }, 300000)
})
