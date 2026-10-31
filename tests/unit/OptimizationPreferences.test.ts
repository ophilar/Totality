import { describe, expect, it } from 'vitest'
import { normalizeOptimizationPreferences } from '../../src/renderer/src/components/library/transcoding/optimizationPreferences'

describe('optimization preferences', () => {
  it('normalizes shared settings without inventing choices', () => {
    expect(normalizeOptimizationPreferences({ targetProfileIds: ['living-room-tv'] })).toEqual({
      targetProfileId: '',
      targetProfileError: null,
      subtitleWhitelist: '',
      outputMode: '',
      outputModeError: null,
    })
  })

  it('preserves valid settings and reports stale saved choices', () => {
    expect(normalizeOptimizationPreferences({
      targetProfileIds: ['living-room-tv'],
      targetProfileId: 'removed-tv',
      subtitleWhitelist: 'eng, heb',
      outputMode: 'stale-mode',
    })).toEqual({
      targetProfileId: 'removed-tv',
      targetProfileError: 'Saved playback target is unavailable. Choose another target or no target.',
      subtitleWhitelist: 'eng, heb',
      outputMode: '',
      outputModeError: 'Saved output choice is unavailable. Choose another option.',
    })
    expect(normalizeOptimizationPreferences({ targetProfileIds: ['living-room-tv'], targetProfileId: 'living-room-tv', outputMode: 'copy' })).toMatchObject({
      targetProfileError: null,
      outputMode: 'copy',
      outputModeError: null,
    })
  })
})
