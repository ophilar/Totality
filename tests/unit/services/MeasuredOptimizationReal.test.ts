import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as fs from 'node:fs/promises'
import { watch } from 'node:fs'
import * as path from 'node:path'
import { setupTestDb, cleanupTestDb } from '@tests/TestUtils'
import { ChildProcessMeasurementRunner, MeasuredOptimizationService } from '@main/services/MeasuredOptimizationService'
import { getMediaFileAnalyzer } from '@main/services/MediaFileAnalyzer'
import { SoftwareCommandBuilder } from '@main/services/transcoding/SoftwareCommandBuilder'
import { buildTargetTranscodePlan } from '@main/services/transcoding/TargetTranscodePlan'
import { getTaskQueueService } from '@main/services/TaskQueueService'
import { TranscodingService } from '@main/services/TranscodingService'
import type { TranscodeOptions } from '@main/services/TranscodingService'

describe('real episode sample encoding and measurement', () => {
  let directory: string
  let db: Awaited<ReturnType<typeof setupTestDb>>
  const runner = new ChildProcessMeasurementRunner()
  beforeEach(async () => { db = await setupTestDb(); directory = await fs.mkdtemp(path.resolve('tests/tmp/measure-real-')) })
  afterEach(async () => { await fs.rm(directory, { recursive: true, force: true }); cleanupTestDb() })
  it.each(['failure', 'cancellation'] as const)('cleans owned references and partial samples after real %s', async mode => {
    const analyzer = getMediaFileAnalyzer()
    expect(await analyzer.isFFmpegAvailable()).toBe(true)
    const binary = analyzer.getFFmpegPath()!
    const inputPath = path.join(directory, 'source.mkv'), outputDirectory = path.join(directory, 'samples')
    await runner.run(binary, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=24', '-t', '3', '-c:v', 'ffv1', inputPath])
    await fs.mkdir(outputDirectory)
    await fs.writeFile(path.join(outputDirectory, 'unrelated.txt'), 'preserved')
    const controller = new AbortController()
    const watcher = mode === 'cancellation' ? watch(outputDirectory, (_event, filename) => { if (filename?.toString() === 'reference-0.mkv') controller.abort() }) : undefined
    try {
      const measurement = new MeasuredOptimizationService().measure({ inputPath, outputDirectory, durationMs: 3000, signal: controller.signal, referenceInputArgs: ['-init_hw_device', 'vulkan=target', '-filter_hw_device', 'target'], referenceFilter: 'format=yuv420p,hwupload,libplacebo=w=160:h=90:format=yuv420p,hwdownload,format=yuv420p', candidates: [{ encoder: 'x265', preset: 'medium', quality: 20, outputBytes: 0, vmafMean: 0, vmafP5: 0, cambiMean: 0, ffmpegArgs: ['-y', '-i', '<input>', '-c:v', mode === 'failure' ? 'encoder-that-does-not-exist' : 'libx265', '<output>'] }] })
      if (mode === 'failure') await expect(measurement).rejects.toThrow('Unknown encoder')
      else await expect(measurement).rejects.toMatchObject({ name: 'AbortError' })
    } finally { watcher?.close() }
    expect(await fs.readdir(outputDirectory)).toEqual(['unrelated.txt'])
    expect(await fs.readFile(path.join(outputDirectory, 'unrelated.txt'), 'utf8')).toBe('preserved')
    await expect(fs.access(inputPath)).resolves.toBeUndefined()
  }, 30000)
  it('encodes three bounded clips with x265 and SVT-AV1, executes CAMBI and preserves cadence', async () => {
    const inputPath = path.join(directory, 'source.mkv')
    expect(await getMediaFileAnalyzer().isFFmpegAvailable()).toBe(true)
    const binary = getMediaFileAnalyzer().getFFmpegPath()!
    await runner.run(binary, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '6', '-c:v', 'ffv1', '-c:a', 'pcm_s16le', '-metadata:s:a:0', 'language=eng', inputPath])
    const analysis = await getMediaFileAnalyzer().analyzeFile(inputPath)
    const profile = await db.playbackTargetProfiles.get('builtin:plex-webos-4-lg-b8')
    expect(profile).toBeTruthy()
    expect(await db.playbackTargetProfiles.list()).toContainEqual(profile)
    for (const [targetCodec, encoder, preset] of [['hevc', 'x265', 'medium'], ['av1', 'svt_av1', '8']] as const) {
      const supportedProfile = { ...profile!, definition: { ...profile!.definition, video: { ...profile!.definition.video, codecs: [targetCodec], profiles: ['Main'], bitDepths: [8] } } }
      const options: TranscodeOptions = { targetCodec, encoder, preset, crf: 20, useGpu: false, targetContainer: 'mkv', targetHdrFormat: 'SDR', targetAudioCodec: 'aac' }
      options.targetConversion = buildTargetTranscodePlan(analysis, supportedProfile, options)
      const highBitrateProfile = { ...supportedProfile, definition: { ...supportedProfile.definition, video: { ...supportedProfile.definition.video, levels: [51] } } }
      const highBitratePlan = buildTargetTranscodePlan(analysis, highBitrateProfile, { ...options, maxOutputBytes: 1000000000 })
      expect(highBitratePlan.maximumVideoBitrate).toBe(40000000)
      const highBitrateArgs = new SoftwareCommandBuilder().buildFFmpegArgs('<input>', '<output>', { ...options, targetConversion: highBitratePlan }, analysis)
      expect(highBitrateArgs[highBitrateArgs.indexOf('-bufsize') + 1]).toBe('40000000')
      const ffmpegArgs = new SoftwareCommandBuilder().buildFFmpegArgs('<input>', '<output>', options, analysis)
      const result = await new MeasuredOptimizationService().measure({ inputPath, outputDirectory: path.join(directory, encoder), durationMs: analysis.duration!, referenceFilter: options.targetConversion.videoFilter, candidates: [{ encoder, preset, quality: 20, outputBytes: 0, vmafMean: 0, vmafP5: 0, cambiMean: 0, ffmpegArgs }] })
      expect(result.cambiAvailable).toBe(true)
      const candidate = result.candidates[0]
      expect(candidate.samplePaths).toHaveLength(3)
      expect(candidate.vmafMean).toBeGreaterThan(85)
      for (const sample of candidate.samplePaths!) {
        const output = await getMediaFileAnalyzer().analyzeFile(sample)
        expect(output.duration).toBeLessThanOrEqual(2100)
        expect(output.video?.frameRate).toBe(24)
        expect(output.audioTracks[0].codec).toBe('aac')
        expect(output.audioTracks[0].channels).toBe(analysis.audioTracks[0].channels)
        await runner.run(binary, ['-v', 'error', '-xerror', '-i', sample, '-f', 'null', '-'])
      }
    }
  }, 120000)
  it('activates verified replacements, persists current analysis, and discovers quarantine after an extension change', async () => {
    const analyzer = getMediaFileAnalyzer()
    expect(await analyzer.isFFmpegAvailable()).toBe(true)
    const binary = analyzer.getFFmpegPath()!
    await db.sources.upsertSource({ source_id: 'local-acceptance', source_type: 'local', display_name: 'Disposable acceptance media', connection_config: JSON.stringify({ folderPath: directory }), is_enabled: 1 })
    const profile = await db.playbackTargetProfiles.get('builtin:plex-webos-4-lg-b8')
    const service = new TranscodingService()
    for (const outputMode of ['replace', 'quarantine-replace'] as const) {
      const inputPath = path.join(directory, `${outputMode}.avi`)
      await runner.run(binary, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '3', '-c:v', 'ffv1', '-c:a', 'pcm_s16le', '-metadata:s:a:0', 'language=eng', inputPath])
      const analysis = await analyzer.analyzeFile(inputPath)
      const mediaItemId = await db.media.upsertItem({ source_id: 'local-acceptance', source_type: 'local', plex_id: outputMode, title: outputMode, type: 'episode', series_title: 'Acceptance', series_identity_key: 'title:acceptance', library_id: 'acceptance', season_number: 1, episode_number: outputMode === 'replace' ? 1 : 2, file_path: inputPath, file_size: analysis.fileSize, duration: analysis.duration })
      const options: TranscodeOptions = { targetCodec: 'hevc', encoder: 'x265', preset: 'medium', crf: 20, useGpu: false, optimizationMode: 'transcode', qualityProfile: 'balanced', encoderPolicy: 'software', transcodingEngine: 'ffmpeg', outputMode, maxOutputBytes: analysis.fileSize! - 1, targetContainer: 'mkv', targetHdrFormat: 'SDR', targetAudioCodec: 'aac' }
      options.targetConversion = buildTargetTranscodePlan(analysis, profile!, options)
      expect(await service.transcode(mediaItemId, options)).toBe(true)
      const item = await db.media.getItemById(mediaItemId)
      expect(item!.file_path).toMatch(/\.mkv$/)
      const persisted = JSON.parse(item!.deep_analysis!)
      expect(persisted.filePath).toBe(item!.file_path)
      expect(persisted.audioTracks[0].codec).toBe('aac')
      expect(persisted.fileSize).toBeLessThan(analysis.fileSize!)
      await expect(fs.access(inputPath)).rejects.toThrow()
      const files = await service.listShowQuarantine('Acceptance', 'local-acceptance', 'title:acceptance', 'acceptance')
      expect(files.length).toBe(outputMode === 'replace' ? 0 : 1)
      if (outputMode === 'quarantine-replace') expect(files[0].path).toMatch(/\.avi$/)
      expect((await fs.readdir(directory)).filter(file => file.startsWith('.totality_tmp_'))).toHaveLength(0)
    }
  }, 120000)

  it('converts HDR10 and HLG samples to SDR through libplacebo and fully decodes the results', async () => {
    const analyzer = getMediaFileAnalyzer()
    expect(await analyzer.isFFmpegAvailable()).toBe(true)
    const binary = analyzer.getFFmpegPath()!
    const profile = await db.playbackTargetProfiles.get('builtin:plex-webos-4-lg-b8')
    for (const [format, transfer] of [['HDR10', 'smpte2084'], ['HLG', 'arib-std-b67']] as const) {
      const inputPath = path.join(directory, `${format}.mkv`)
      await runner.run(binary, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24', '-t', '3', '-c:v', 'libx265', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p10le', '-x265-params', `colorprim=bt2020:transfer=${transfer}:colormatrix=bt2020nc`, inputPath])
      const rawProbe = await runner.run(analyzer.getFFprobePath()!, ['-v', 'error', '-show_entries', 'stream=color_transfer,color_primaries', '-of', 'json', inputPath])
      expect(JSON.parse(rawProbe).streams[0]).toMatchObject({ color_transfer: transfer, color_primaries: 'bt2020' })
      const analysis = await analyzer.analyzeFile(inputPath)
      expect(analysis.video).toMatchObject({ colorTransfer: transfer, colorPrimaries: 'bt2020', hdrFormat: format })
      const options: TranscodeOptions = { targetCodec: 'hevc', encoder: 'x265', preset: 'medium', crf: 20, useGpu: false, targetContainer: 'mkv', targetHdrFormat: 'SDR' }
      options.targetConversion = buildTargetTranscodePlan(analysis, profile!, options)
      const outputPath = path.join(directory, `${format}-SDR.mkv`)
      const command = new SoftwareCommandBuilder().buildFFmpegArgs(inputPath, outputPath, options, analysis)
      await runner.run(binary, command)
      const output = await analyzer.analyzeFile(outputPath)
      expect(output.video!.colorTransfer).toBe('bt709')
      expect(output.video!.hdrFormat).toBe('SDR')
      expect(output.video!.frameRate).toBe(24)
      await runner.run(binary, ['-v', 'error', '-xerror', '-i', outputPath, '-f', 'null', '-'])
      const measured = await new MeasuredOptimizationService().measure({ inputPath, outputDirectory: path.join(directory, `${format}-measured`), durationMs: analysis.duration!, referenceFilter: options.targetConversion.videoFilter, referenceInputArgs: options.targetConversion.inputArgs, candidates: [{ encoder: 'x265', preset: 'medium', quality: 20, outputBytes: 0, vmafMean: 0, vmafP5: 0, cambiMean: 0, ffmpegArgs: new SoftwareCommandBuilder().buildFFmpegArgs('<input>', '<output>', options, analysis) }] })
      expect(measured.candidates[0].samplePaths).toHaveLength(3)
      expect(measured.candidates[0].vmafMean).toBeGreaterThan(85)
    }
  }, 120000)

  it('cancels a real encoder process, keeps the original active, and removes its owned output', async () => {
    const analyzer = getMediaFileAnalyzer()
    expect(await analyzer.isFFmpegAvailable()).toBe(true)
    const inputPath = path.join(directory, 'cancel.mkv')
    await runner.run(analyzer.getFFmpegPath()!, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=24', '-t', '3', '-c:v', 'ffv1', inputPath])
    const original = await fs.readFile(inputPath)
    const analysis = await analyzer.analyzeFile(inputPath)
    await db.sources.upsertSource({ source_id: 'cancel-source', source_type: 'local', display_name: 'Acceptance', connection_config: JSON.stringify({ folderPath: directory }), is_enabled: 1 })
    const id = await db.media.upsertItem({ source_id: 'cancel-source', source_type: 'local', plex_id: 'cancel', title: 'Cancel', type: 'episode', file_path: inputPath })
    const profile = await db.playbackTargetProfiles.get('builtin:plex-webos-4-lg-b8')
    const options: TranscodeOptions = { targetCodec: 'hevc', encoder: 'x265', preset: 'slower', crf: 20, useGpu: false, optimizationMode: 'transcode', qualityProfile: 'balanced', encoderPolicy: 'software', transcodingEngine: 'ffmpeg', outputMode: 'replace', maxOutputBytes: original.length - 1, targetContainer: 'mkv', targetHdrFormat: 'SDR' }
    options.targetConversion = buildTargetTranscodePlan(analysis, profile!, options)
    const service = new TranscodingService()
    let processStarted = false
    const observer = setInterval(() => {
      void fs.readdir(directory).then(files => {
        if (files.some(file => file.startsWith('.totality_tmp_'))) {
          processStarted = true
          service.cancelTranscode(id)
        }
      })
    }, 20)
    try {
      expect(await service.transcode(id, options)).toBe(false)
      expect(processStarted).toBe(true)
      expect(await fs.readFile(inputPath)).toEqual(original)
      expect(path.resolve((await db.media.getItemById(id))!.file_path!)).toBe(path.resolve(inputPath))
      expect((await fs.readdir(directory)).filter(file => file.startsWith('.totality_tmp_'))).toHaveLength(0)
    } finally {
      clearInterval(observer)
    }
  }, 120000)

  it('keeps the original active and removes owned output when the real encoder rejects a command', async () => {
    const analyzer = getMediaFileAnalyzer()
    expect(await analyzer.isFFmpegAvailable()).toBe(true)
    const inputPath = path.join(directory, 'failed-encode.mkv')
    await runner.run(analyzer.getFFmpegPath()!, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24', '-t', '3', '-c:v', 'ffv1', inputPath])
    const original = await fs.readFile(inputPath), analysis = await analyzer.analyzeFile(inputPath)
    await db.sources.upsertSource({ source_id: 'failure-source', source_type: 'local', display_name: 'Acceptance', connection_config: JSON.stringify({ folderPath: directory }), is_enabled: 1 })
    const id = await db.media.upsertItem({ source_id: 'failure-source', source_type: 'local', plex_id: 'failure', title: 'Failure', type: 'episode', file_path: inputPath })
    const profile = await db.playbackTargetProfiles.get('builtin:plex-webos-4-lg-b8')
    const options: TranscodeOptions = { targetCodec: 'hevc', encoder: 'x265', preset: 'medium', crf: 20, useGpu: false, optimizationMode: 'transcode', qualityProfile: 'balanced', encoderPolicy: 'software', transcodingEngine: 'ffmpeg', outputMode: 'replace', maxOutputBytes: original.length - 1, targetContainer: 'mkv', targetHdrFormat: 'SDR', customArgs: '-vf scale=1:1' }
    options.targetConversion = buildTargetTranscodePlan(analysis, profile!, options)
    await expect(new TranscodingService().transcode(id, options)).rejects.toThrow()
    expect(await fs.readFile(inputPath)).toEqual(original)
    expect(path.resolve((await db.media.getItemById(id))!.file_path!)).toBe(path.resolve(inputPath))
    expect((await fs.readdir(directory)).filter(file => file.startsWith('.totality_tmp_'))).toHaveLength(0)
  }, 120000)

  it('freezes a measured per-episode plan, requires playback approval, and scopes clearing by batch', async () => {
    const analyzer = getMediaFileAnalyzer()
    expect(await analyzer.isFFmpegAvailable()).toBe(true)
    const inputPath = path.join(directory, 'preflight.mkv')
    await runner.run(analyzer.getFFmpegPath()!, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24', '-t', '6', '-c:v', 'ffv1', inputPath])
    const analysis = await analyzer.analyzeFile(inputPath)
    await db.sources.upsertSource({ source_id: 'preflight-source', source_type: 'local', display_name: 'Acceptance', connection_config: JSON.stringify({ folderPath: directory }), is_enabled: 1 })
    const id = await db.media.upsertItem({ source_id: 'preflight-source', source_type: 'local', plex_id: 'episode', title: 'Episode', type: 'episode', series_title: 'Acceptance', series_identity_key: 'title:acceptance', library_id: 'acceptance', season_number: 1, episode_number: 1, file_path: inputPath })
    await db.media.updatePathAndStats(id, inputPath, analysis)
    const queue = getTaskQueueService()
    await queue.pause()
    const service = new TranscodingService()
    const plan = await service.preflightShowTranscode({ seriesTitle: 'Acceptance', sourceId: 'preflight-source', seriesIdentityKey: 'title:acceptance', libraryId: 'acceptance', options: { targetCodec: 'hevc', optimizationMode: 'transcode', qualityProfile: 'maximum_savings', encoderPolicy: 'software', useGpu: false, transcodingEngine: 'ffmpeg', outputMode: 'replace', maxOutputBytes: analysis.fileSize! - 1, targetProfileId: 'builtin:plex-webos-4-lg-b8', targetContainer: 'mkv', targetHdrFormat: 'SDR', targetAudioCodec: 'aac' } })
    expect(plan.episodes[0].reason).toBeUndefined()
    expect(plan.episodes[0].samplePaths).toHaveLength(3)
    expect(plan.episodes[0].decisionStatus).toBe('sample_required')
    await expect(service.queueShowTranscode(plan.preflightId)).rejects.toThrow('No episodes')
    await service.approveShowTranscode(plan.preflightId)
    const queued = await service.queueShowTranscode(plan.preflightId)
    const unrelated = await queue.addTask({ type: (await import('@main/types/database')).TaskType.Transcode, label: 'Unrelated show', batchId: 'unrelated' })
    const task = queue.getState().queue.find(task => task.mediaItemId === id)!
    expect(task.options?.queuePayload).toMatchObject({ params: plan.episodes[0].params, sourceSha256: plan.episodes[0].sourceSha256 })
    await queue.clearQueue(queued.batchId)
    expect(queue.getState().queue.map(task => task.id)).toEqual([unrelated])
    for (const sample of plan.episodes[0].samplePaths!) await expect(fs.access(sample)).rejects.toThrow()
    await queue.clearQueue('unrelated')
    expect(await fs.readFile(inputPath)).toHaveLength(analysis.fileSize!)
  }, 120000)

})
