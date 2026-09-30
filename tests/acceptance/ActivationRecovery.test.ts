import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { setupTestDb, cleanupTestDb } from '@tests/TestUtils'
import { ChildProcessMeasurementRunner } from '@main/services/MeasuredOptimizationService'
import { getMediaFileAnalyzer } from '@main/services/MediaFileAnalyzer'
import { TranscodingService } from '@main/services/TranscodingService'

describe('real activation recovery after placement before the next journal write', () => {
  let directory: string
  let db: Awaited<ReturnType<typeof setupTestDb>>
  beforeEach(async () => {
    db = await setupTestDb()
    directory = await fs.mkdtemp(path.resolve('tests/tmp/activation-recovery-'))
  })
  afterEach(async () => { await fs.rm(directory, { recursive: true, force: true }); cleanupTestDb() })

  it.each(['replace', 'quarantine-replace'] as const)('completes %s with active analysis and disk accounting', async mode => {
    const analyzer = getMediaFileAnalyzer(), runner = new ChildProcessMeasurementRunner()
    expect(await analyzer.isFFmpegAvailable()).toBe(true)
    const inputPath = path.join(directory, 'source.mkv'), targetPath = path.join(directory, 'source.mp4'), tempPath = path.join(directory, 'owned.tmp.mp4'), quarantinePath = path.join(directory, 'owned.original.mkv')
    await runner.run(analyzer.getFFmpegPath()!, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24', '-t', '1', '-c:v', 'ffv1', inputPath])
    await runner.run(analyzer.getFFmpegPath()!, ['-y', '-v', 'error', '-i', inputPath, '-c:v', 'libx264', '-crf', '24', targetPath])
    const source = await analyzer.analyzeFile(inputPath), output = await analyzer.analyzeFile(targetPath)
    expect(source.success && output.success).toBe(true)
    await runner.run(analyzer.getFFmpegPath()!, ['-v', 'error', '-xerror', '-i', targetPath, '-f', 'null', '-'])
    await db.sources.upsertSource({ source_id: 'owned-source', source_type: 'local', display_name: 'Recovery acceptance', connection_config: JSON.stringify({ folderPath: directory }), is_enabled: 1 })
    const mediaItemId = await db.media.upsertItem({ source_id: 'owned-source', source_type: 'local', plex_id: 'owned-episode', title: 'Recovery episode', type: 'episode', file_path: inputPath })
    const stat = await fs.stat(inputPath), now = new Date().toISOString()
    await db.mediaRemuxJobs.create({ mediaItemId, operationKind: 'transcode', status: 'verified', sourcePath: inputPath, sourceSize: stat.size, sourceMtimeMs: stat.mtimeMs, sourceSha256: createHash('sha256').update(await fs.readFile(inputPath)).digest('hex'), decisionSnapshot: JSON.stringify({ mode }), streamSignatures: '[]', quarantinePath, createdAt: now, updatedAt: now })
    await fs.rename(inputPath, quarantinePath)
    await db.config.setSetting(`transcoding.activation.${mediaItemId}`, JSON.stringify({ mediaItemId, phase: 'prepared', inputPath, tempPath, targetPath, quarantinePath, mode, outputStats: output }))

    await new TranscodingService().checkAvailability()

    expect((await db.media.getItemById(mediaItemId))?.file_path).toBe(targetPath.replace(/\\/g, '/'))
    const job = await db.mediaRemuxJobs.getLatest(mediaItemId)
    expect(job?.status).toBe('promoted')
    expect(JSON.parse(job!.outputAnalysis!)).toMatchObject({ filePath: targetPath, encodedReductionBytes: stat.size - output.fileSize!, retainedOriginalBytes: mode === 'replace' ? 0 : stat.size, physicallyReclaimedBytes: mode === 'replace' ? stat.size - output.fileSize! : -output.fileSize! })
    expect(await db.config.getSetting(`transcoding.activation.${mediaItemId}`)).toBeNull()
    expect((await fs.readdir(directory)).includes(path.basename(quarantinePath))).toBe(mode === 'quarantine-replace')
  })
})
