import { describe, expect, it } from 'vitest'
import { LanguageRemuxService } from '@main/services/LanguageRemuxService'

describe('LanguageRemuxService', () => {
  it('verifies retained audio streams by stable source signatures, not output indexes', async () => {
    const calls: string[][] = []
    const service = new LanguageRemuxService({
      run: async (args) => { calls.push(args) },
      probe: async (filePath) => filePath.includes('.tmp')
        ? {
            size: 10,
            duration: 100,
            streams: [
              { index: 0, codec_type: 'video' },
              { index: 1, codec_type: 'audio', codec_name: 'aac', channel_layout: 'stereo', tags: { language: 'eng', title: 'Main' } },
            ],
          }
        : {
            size: 20,
            duration: 100,
            streams: [
              { index: 0, codec_type: 'video' },
              { index: 4, codec_type: 'audio', codec_name: 'aac', channel_layout: 'stereo', tags: { language: 'eng', title: 'Main' } },
              { index: 5, codec_type: 'audio', codec_name: 'ac3', channel_layout: '5.1', tags: { language: 'deu', title: 'Dub' } },
            ],
          },
    })

    const result = await service.remux('C:/media/movie.mkv', {
      quarantineDirectory: 'C:/quarantine/1',
      retainedAudioIndexes: [4],
      sourceAudioStreams: [{ index: 4, codec_name: 'aac', channel_layout: 'stereo', tags: { language: 'eng', title: 'Main' } }],
      sourceFingerprint: { size: 20, mtimeMs: 1 },
      fingerprint: async () => ({ size: 20, mtimeMs: 1 }),
      fileOps: {
        mkdir: async () => undefined,
        rename: async () => undefined,
        remove: async () => undefined,
      },
    })

    expect(calls).toHaveLength(1)
    expect(result.verifiedProbe.streams.some(stream => stream.codec_type === 'audio')).toBe(true)
  })

  it('records audit logs on remux success', async () => {
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const testDir = path.join(process.cwd(), 'tests/tmp', `audit-test-${Date.now()}`)
    const auditDir = path.join(testDir, 'audit_logs')
    const sourceFile = path.join(testDir, 'video.mkv')
    const tmpFile = path.join(testDir, '.video.mkv.totality-remux.tmp')

    await fs.mkdir(testDir, { recursive: true })
    await fs.writeFile(sourceFile, 'dummy-video-data')

    const service = new LanguageRemuxService({
      run: async () => {
        await fs.writeFile(tmpFile, 'dummy-remuxed-output')
      },
      probe: async (filePath) => ({
        size: filePath.includes('.tmp') ? 10 : 20,
        duration: 100,
        streams: [
          { index: 0, codec_type: 'video' },
          { index: filePath.includes('.tmp') ? 1 : 4, codec_type: 'audio', codec_name: 'aac', channel_layout: 'stereo', tags: { language: 'eng' } },
        ],
      }),
    })

    await service.remux(sourceFile, {
      quarantineDirectory: path.join(testDir, 'quarantine'),
      auditLogDirectory: auditDir,
      retainedAudioIndexes: [4],
      sourceAudioStreams: [{ index: 4, codec_name: 'aac', channel_layout: 'stereo', tags: { language: 'eng' } }],
      sourceFingerprint: { size: 20, mtimeMs: 1 },
      fingerprint: async () => ({ size: 20, mtimeMs: 1 }),
      fileOps: {
        mkdir: async (dir) => { await fs.mkdir(dir, { recursive: true }) },
        rename: async (from, to) => { await fs.rename(from, to) },
        remove: async (target) => { await fs.rm(target, { force: true }) },
      },
    })

    const files = await fs.readdir(auditDir)
    expect(files.some(f => f.startsWith('optimization_audit_') && f.endsWith('.jsonl'))).toBe(true)

    const logContent = await fs.readFile(path.join(auditDir, files[0]), 'utf-8')
    const parsed = JSON.parse(logContent.trim().split('\n')[0])
    expect(parsed.action).toBe('language-remux')
    expect(parsed.status).toBe('succeeded')

    await fs.rm(testDir, { recursive: true, force: true })
  })

  it('fails fast when disk headroom is insufficient', async () => {
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const testDir = path.join(process.cwd(), 'tests/tmp', `headroom-test-${Date.now()}`)
    const sourceFile = path.join(testDir, 'huge.mkv')

    await fs.mkdir(testDir, { recursive: true })
    await fs.writeFile(sourceFile, Buffer.alloc(1024 * 1024))

    const mockStatfs = async () => ({
      bavail: 1,
      bsize: 512,
    })

    try {
      await expect(
        LanguageRemuxService.assertRecoverability(sourceFile, path.join(testDir, 'quarantine'), mockStatfs)
      ).rejects.toThrow('Insufficient disk headroom for quarantine')
    } finally {
      await fs.rm(testDir, { recursive: true, force: true })
    }
  })
})

