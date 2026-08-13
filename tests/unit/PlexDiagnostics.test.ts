import { describe, expect, it } from 'vitest'
import { MediaTransformer, IncompleteMetadataError } from '@main/providers/base/MediaTransformer'

describe('Plex incomplete metadata diagnostics', () => {
  it('reports token-free stream and part counts for rejected media', () => {
    const item = {
      ratingKey: '101045',
      type: 'episode',
      title: 'Example Episode',
      Media: [{ id: 1, Part: [{ id: 2, file: 'D:/media/example.mkv', Stream: [{ streamType: 1, codec: 'h264' }] }] }],
    } as never

    try {
      MediaTransformer.fromPlex(item, 'source-1', 'https://plex.example', 'secret-token')
      throw new Error('expected incomplete metadata')
    } catch (error) {
      expect(error).toBeInstanceOf(IncompleteMetadataError)
      const diagnostic = (error as IncompleteMetadataError).diagnostics
      expect(diagnostic).toMatchObject({ itemId: '101045', itemType: 'episode', title: 'Example Episode', mediaCandidates: 1, parts: 1, files: 1, videoStreams: 1, audioStreams: 0, reason: 'missing_audio_stream' })
      expect(JSON.stringify(diagnostic)).not.toContain('secret-token')
    }
  })
})
