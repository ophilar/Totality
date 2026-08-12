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
})
