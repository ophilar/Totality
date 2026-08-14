import { describe, expect, it } from 'vitest'
import { MediaTransformer, IncompleteMetadataError } from '@main/providers/base/MediaTransformer'

describe('Plex incomplete metadata diagnostics', () => {
  it('reports token-free stream and part counts for rejected media', () => {
    const item = {
      ratingKey: '101045',
      type: 'episode',
      title: 'Example Episode',
      Media: [{ id: 1, Part: [{ id: 2, file: 'D:/media/example.mkv', Stream: [] }] }],
    } as never

    try {
      MediaTransformer.fromPlex(item, 'source-1', 'https://plex.example', 'secret-token')
      throw new Error('expected incomplete metadata')
    } catch (error) {
      expect(error).toBeInstanceOf(IncompleteMetadataError)
      const diagnostic = (error as IncompleteMetadataError).diagnostics
      expect(diagnostic).toMatchObject({ itemId: '101045', itemType: 'episode', title: 'Example Episode', mediaCandidates: 1, parts: 1, files: 1, videoStreams: 0, reason: 'missing_video_stream' })
      expect(JSON.stringify(diagnostic)).not.toContain('secret-token')
    }
  })

  it('successfully transforms silent video media without audio streams', () => {
    const item = {
      ratingKey: '101046',
      type: 'movie',
      title: 'Georges Méliès 1899 Silent Film',
      year: 1899,
      Media: [{
        id: 1,
        videoCodec: 'h264',
        width: 1920,
        height: 1080,
        Part: [{
          id: 2,
          file: 'D:/media/Georges Melies (1899).mkv',
          size: 500000000,
          Stream: [{ streamType: 1, codec: 'h264', width: 1920, height: 1080, frameRate: 24, bitDepth: 8 }],
        }],
      }],
    } as never

    const result = MediaTransformer.fromPlex(item, 'source-1', 'https://plex.example', 'token')
    expect(result.mediaItem.title).toBe('Georges Méliès 1899 Silent Film')
    expect(result.versions.length).toBe(1)
    expect(result.versions[0].audio_codec).toBe('None')
    expect(result.versions[0].audio_bitrate).toBeUndefined()
  })
})


