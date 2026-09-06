import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { QualityAnalyzer } from '@main/services/QualityAnalyzer'
import { resolveSelectedGpuId } from '@main/services/TranscodingCapabilities'
import type { MusicAlbum } from '@main/types/database'
import type { GpuInfo } from '@main/services/utils/GpuDetector'

describe('directive regressions', () => {
  it('keeps music quality unknown when no quality evidence exists', () => {
    const analyzer = new QualityAnalyzer()
    const album = {
      id: 1,
      source_id: 'source',
      source_type: 'local',
      provider_id: 'album',
      artist_name: 'Artist',
      title: 'Album',
    } as MusicAlbum

    const result = analyzer.analyzeMusicAlbum(album, [])

    expect(result.quality_tier).toBe('UNKNOWN')
    expect(result.tier_quality).toBe('UNKNOWN')
    expect(result.tier_score).toBeNull()
    expect(result.codec_score).toBeNull()
    expect(result.bitrate_score).toBeNull()
    expect(result.needs_upgrade).toBe(false)
  })

  it('does not fabricate a codec score when only music bitrate evidence exists', () => {
    const analyzer = new QualityAnalyzer()
    const album = {
      id: 1,
      source_id: 'source',
      source_type: 'local',
      provider_id: 'album',
      artist_name: 'Artist',
      title: 'Album',
      avg_audio_bitrate: 320,
    } as MusicAlbum

    const result = analyzer.analyzeMusicAlbum(album, [])

    expect(result.quality_tier).toBe('LOSSY_HIGH')
    expect(result.codec_score).toBeNull()
    expect(result.bitrate_score).toBe(95)
    expect(result.tier_score).toBe(95)
    expect(result.tier_quality).toBe('HIGH')
  })

  it('does not silently replace a stale persisted GPU selection', () => {
    const gpus: GpuInfo[] = [
      { id: 'nvidia-1', name: 'NVIDIA GPU', vendor: 'NVIDIA' },
      { id: 'intel-1', name: 'Intel GPU', vendor: 'Intel' },
    ]

    expect(resolveSelectedGpuId(gpus, 'missing-gpu')).toBeNull()
    expect(resolveSelectedGpuId(gpus, undefined)).toBe('nvidia-1')
    expect(resolveSelectedGpuId(gpus, null)).toBeNull()
  })

  it('keeps bootstrap failures fail-fast and observable', () => {
    const source = fs.readFileSync(path.resolve('src/main/index.ts'), 'utf8')
    const unhandledRejectionHandler = source.match(/process\.on\('unhandledRejection',[\s\S]*?\n\}\)/)?.[0] ?? ''

    expect(unhandledRejectionHandler).toContain('process.exit(1)')
    expect(source).not.toContain('fallback detection will remain available')
    expect(source).not.toContain('// Ignore errors during worker pool shutdown')
  })
})
