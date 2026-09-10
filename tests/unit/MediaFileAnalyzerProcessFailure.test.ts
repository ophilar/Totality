import { describe, expect, it, vi } from 'vitest'
import * as os from 'node:os'
import * as path from 'node:path'

vi.unmock('child_process')

import { MediaFileAnalyzer } from '@main/services/MediaFileAnalyzer'

describe('MediaFileAnalyzer process failures', () => {
  it('propagates a nonzero exit from the system FFprobe process', async () => {
    const analyzer = new MediaFileAnalyzer()
    expect(await analyzer.isAvailable()).toBe(true)

    const missingFile = path.join(os.tmpdir(), 'totality-media-analyzer-process-failure', 'missing.mkv')
    await expect(analyzer.deepAnalyzeFile(missingFile, { scanBitrate: true }))
      .rejects.toThrow(/FFprobe exited with code [1-9]\d*/)
  })
})
