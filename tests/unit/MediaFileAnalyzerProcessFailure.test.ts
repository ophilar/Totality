import { describe, expect, it, vi } from 'vitest'

vi.unmock('child_process')

import { MediaFileAnalyzer } from '@main/services/MediaFileAnalyzer'

type AnalyzerProcessState = {
  ffprobePath: string | null
  ffprobeChecked: boolean
}

describe('MediaFileAnalyzer process failures', () => {
  it.skipIf(process.platform === 'win32')('propagates a real nonzero FFprobe process exit', async () => {
    const analyzer = new MediaFileAnalyzer()
    const state = analyzer as unknown as AnalyzerProcessState
    state.ffprobePath = '/usr/bin/false'
    state.ffprobeChecked = true

    await expect(analyzer.deepAnalyzeFile('/tmp/nonexistent-media-file.mkv', { scanBitrate: true }))
      .rejects.toThrow('FFprobe exited with code 1')
  })
})
