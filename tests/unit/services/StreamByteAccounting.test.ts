import { describe, expect, it } from 'vitest'
import { parsePacketByteOutput, StreamByteAccumulator, sumStreamBytes } from '@main/services/transcoding/StreamByteAccounting'

describe('StreamByteAccounting', () => {
  it('sums packet sizes by stream index without using container bytes', () => {
    const packets = parsePacketByteOutput('packet|stream_index=0|size=100\npacket|stream_index=1|size=40\npacket|stream_index=0|size=25\npacket|stream_index=2|size=N/A\n')

    expect(sumStreamBytes(packets, 0)).toBe(125)
    expect(sumStreamBytes(packets, 1)).toBe(40)
    expect(sumStreamBytes(packets, 2)).toBeNull()
  })

  it('rejects malformed packet rows instead of treating them as zero bytes', () => {
    expect(() => parsePacketByteOutput('packet|stream_index=0|size=not-a-number\n')).toThrow(/packet byte/i)
  })

  it('aggregates streamed output across chunk boundaries without retaining packet rows', () => {
    const accumulator = new StreamByteAccumulator()
    accumulator.write('packet|stream_index=1|size=40\r')
    accumulator.write('\npacket|size=25|stream_index=1\npacket|stream_index=2|size=N/')
    accumulator.write('A\n')
    accumulator.write('packet|stream_index=3|size=7|\n')

    expect(accumulator.finish()).toEqual({ 1: 65, 3: 7 })
  })

  it('rejects stream totals outside the safe integer range', () => {
    const accumulator = new StreamByteAccumulator()

    expect(() => accumulator.write(`packet|stream_index=0|size=${Number.MAX_SAFE_INTEGER}\npacket|stream_index=0|size=1\n`)).toThrow(/safe integer range/i)
  })

  it('ignores FFprobe section delimiters and side-data fields while retaining named packet fields', () => {
    const packets = parsePacketByteOutput('packet|stream_index=1|size=8|side_data|side_data_type=Skip Samples|\n')
    expect(packets).toEqual([{ streamIndex: 1, bytes: 8 }])
  })

  it('keeps packet byte evidence incomplete when FFprobe does not report size', () => {
    const accumulator = new StreamByteAccumulator()
    accumulator.write('packet|stream_index=0|pts=1|\npacket|stream_index=0|size=20|\n')
    expect(accumulator.finish()).toEqual({})
  })

  it('rejects a packet without a valid stream index', () => {
    expect(() => parsePacketByteOutput('packet|size=8|\n')).toThrow(/stream_index/)
  })
})
