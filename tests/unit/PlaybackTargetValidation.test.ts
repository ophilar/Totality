import { describe, expect, it } from 'vitest'
import { playbackTargetProfileInputSchema } from '@shared/playbackTargetValidation'

const validProfile = {
  name: 'Living room',
  definition: {
    containers: ['mkv'],
    video: { codecs: ['h264'], profiles: ['high'], levels: [4.1], maxWidth: 1920, maxHeight: 1080, maxFrameRate: 60, bitDepths: [8] },
    hdr: { formats: [], fallbackRequired: false },
    audio: { codecs: ['aac'], maxChannels: 2, objectAudio: false, outputPath: 'device' },
    subtitles: { formats: [], embedded: false, external: false, burnIn: false },
    network: { sustainableBitrate: 100_000_000 },
  },
}

describe('playback target input contract', () => {
  it('permits empty HDR and subtitle support lists', () => {
    expect(playbackTargetProfileInputSchema.safeParse(validProfile).success).toBe(true)
  })

  it('rejects blank required tokens and non-positive capability limits', () => {
    const blankToken = structuredClone(validProfile)
    blankToken.definition.video.codecs = ['  ']
    expect(playbackTargetProfileInputSchema.safeParse(blankToken).success).toBe(false)

    const invalidLimit = structuredClone(validProfile)
    invalidLimit.definition.video.levels = [0]
    expect(playbackTargetProfileInputSchema.safeParse(invalidLimit).success).toBe(false)
  })
})
