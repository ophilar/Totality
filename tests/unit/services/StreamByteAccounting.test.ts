import { describe, expect, it } from 'vitest'
import { parsePacketByteOutput, StreamByteAccumulator, sumStreamBytes } from '@main/services/transcoding/StreamByteAccounting'

describe('StreamByteAccounting', () => {
  it('sums packet sizes by stream index without using container bytes', () => {
    const packets = parsePacketByteOutput('0,100\n1,40\n0,25\n2,N/A\n')

    expect(sumStreamBytes(packets, 0)).toBe(125)
    expect(sumStreamBytes(packets, 1)).toBe(40)
    expect(sumStreamBytes(packets, 2)).toBeNull()
  })

  it('rejects malformed packet rows instead of treating them as zero bytes', () => {
    expect(() => parsePacketByteOutput('0,not-a-number\n')).toThrow(/packet byte/i)
  })

  it('aggregates streamed output across chunk boundaries without retaining packet rows', () => {
    const accumulator = new StreamByteAccumulator()
    accumulator.write('1,40\r')
    accumulator.write('\n1,25\n2,N/')
    accumulator.write('A\n')
    accumulator.write('3,7')

    expect(accumulator.finish()).toEqual({ 1: 65, 3: 7 })
  })

  it('rejects stream totals outside the safe integer range', () => {
    const accumulator = new StreamByteAccumulator()

    expect(() => accumulator.write(`0,${Number.MAX_SAFE_INTEGER}\n0,1\n`)).toThrow(/safe integer range/i)
  })
})
