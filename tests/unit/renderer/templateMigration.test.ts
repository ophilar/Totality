import { describe, expect, it } from 'vitest'
import { readTemplates } from '../../../src/renderer/src/components/library/transcoding/templateMigration'

describe('saved optimization template migration', () => {
  it.each([
    ['lossless', 'transparent'],
    ['efficiency', 'maximum_savings'],
  ])('migrates the legacy %s quality profile', (legacy, current) => {
    const result = readTemplates([{ name: 'Legacy', options: { qualityProfile: legacy } }])

    expect(result.migrated).toBe(true)
    expect(result.templates[0].options).toEqual({ qualityProfile: current })
    expect(result.templates[0].error).toBeUndefined()
  })

  it('keeps unsupported settings visible and identifies the setting for correction', () => {
    const result = readTemplates([{ name: 'Unsupported', options: { targetCodec: 'h264' } }])

    expect(result.migrated).toBe(false)
    expect(result.templates[0].options).toEqual({ targetCodec: 'h264' })
    expect(result.templates[0].error).toContain('targetCodec')
  })
})
