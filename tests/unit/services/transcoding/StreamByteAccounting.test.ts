import { describe, expect, it } from 'vitest'
import { StreamByteAccumulator } from '../../../../src/main/services/transcoding/StreamByteAccounting'

describe('StreamByteAccumulator', () => {
  it('keeps measured stream bytes when there is not enough data for bitrate analysis', () => {
    const accumulator = new StreamByteAccumulator(0)
    accumulator.write('packet|stream_index=0|size=100|duration_time=0.1\npacket|stream_index=0|size=120|duration_time=0.1\n')

    expect(accumulator.finishWithBitrate()).toEqual({ streamBytes: { 0: 220 } })
  })
})
