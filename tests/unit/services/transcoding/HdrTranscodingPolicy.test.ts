import { describe, expect, it } from 'vitest'
import type { FileAnalysisResult } from '@main/services/MediaFileAnalyzer'
import { buildHdrMetadataArgs, validateHdrTranscode } from '@main/services/transcoding/HdrTranscodingPolicy'

function analysis(hdrFormat: string): FileAnalysisResult {
  return { video: { hdrFormat, colorSpace: 'bt2020nc', colorPrimaries: 'bt2020', colorTransfer: '' } } as FileAnalysisResult
}

describe('HDR transcode policy', () => {
  it('preserves HLG transfer metadata during encoding', () => {
    expect(validateHdrTranscode(analysis('HLG'), { optimizationMode: 'transcode' })).toBeUndefined()
    expect(buildHdrMetadataArgs(analysis('HLG'), { optimizationMode: 'transcode' })).toEqual([
      '-colorspace', 'bt2020nc', '-color_primaries', 'bt2020', '-color_trc', 'arib-std-b67'
    ])
  })

  it.each(['Dolby Vision', 'HDR10+'])('rejects %s encoding without an explicit conversion', hdrFormat => {
    expect(() => validateHdrTranscode(analysis(hdrFormat), { optimizationMode: 'transcode' })).toThrow('transcoding is not supported')
  })
})
