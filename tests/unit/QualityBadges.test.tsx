import { describe, expect, it } from 'vitest'
import { formatHdrLabel } from '@/components/library/QualityBadges'

describe('HDR quality labels', () => {
  it.each([
    ['HDR10', 'HDR10'],
    ['hdr10+', 'HDR10+'],
    ['HDR10Plus', 'HDR10+'],
    ['Dolby Vision', 'Dolby Vision'],
    ['dovi', 'Dolby Vision'],
    ['HLG', 'HLG'],
  ])('preserves the distinct %s tag', (input, expected) => {
    expect(formatHdrLabel(input)).toBe(expected)
  })

  it('does not display SDR/None as HDR', () => {
    expect(formatHdrLabel('SDR')).toBeUndefined()
    expect(formatHdrLabel('None')).toBeUndefined()
  })
})
