import { describe, expect, it } from 'vitest'
import type { ShowTranscodePreflight } from '../../../src/renderer/src/components/library/transcoding/types'
import { buildSampleApprovalGroups } from '../../../src/renderer/src/components/library/tv/sampleApprovalGroups'

function plan(overrides: Partial<ShowTranscodePreflight['episodes'][number]>): ShowTranscodePreflight['episodes'][number] {
  return {
    mediaItemId: 1,
    label: 'Episode 1',
    compatible: true,
    hdrFormat: 'SDR',
    sourceSize: 1000,
    sourceMtimeMs: 1,
    operations: ['video_transcode'],
    decisionStatus: 'sample_required',
    samplePaths: ['sample.mkv'],
    sampleHashes: ['hash-a'],
    ...overrides,
  }
}

describe('buildSampleApprovalGroups', () => {
  it('groups projected episodes with their measured representative when sample hashes match', () => {
    const episodes = [
      plan({ mediaItemId: 10, label: 'S01E01', samplingRole: 'measured' }),
      plan({ mediaItemId: 11, label: 'S01E02', samplingRole: 'projected', sampleRepresentativeMediaItemId: 10, sampleRepresentativeLabel: 'S01E01', estimatedSavingsBytes: 200 }),
      plan({ mediaItemId: 12, label: 'S01E03', samplingRole: 'projected', sampleRepresentativeMediaItemId: 10, sampleRepresentativeLabel: 'S01E01', estimatedSavingsBytes: 300 }),
    ]

    const groups = buildSampleApprovalGroups({ episodes } as ShowTranscodePreflight)

    expect(groups).toHaveLength(1)
    expect(groups[0].representativeMediaItemId).toBe(10)
    expect(groups[0].representativeLabel).toBe('S01E01')
    expect(groups[0].episodes.map(item => item.mediaItemId)).toEqual([10, 11, 12])
  })

  it('splits acknowledgments when a representative or sample hash changes and ignores blocked plans', () => {
    const episodes = [
      plan({ mediaItemId: 10 }),
      plan({ mediaItemId: 11, sampleRepresentativeMediaItemId: 10, sampleHashes: ['changed-hash'] }),
      plan({ mediaItemId: 12, compatible: false, sampleRepresentativeMediaItemId: 10 }),
    ]

    expect(buildSampleApprovalGroups({ episodes } as ShowTranscodePreflight)).toHaveLength(2)
  })
})
