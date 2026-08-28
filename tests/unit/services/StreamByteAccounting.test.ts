import { describe, expect, it } from 'vitest'
import { parsePacketByteOutput, sumStreamBytes } from '@main/services/transcoding/StreamByteAccounting'

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
})
