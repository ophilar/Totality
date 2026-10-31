import { describe, it, expect, vi } from 'vitest'

// Mock all heavy dependencies of LocalFolderProvider module
vi.mock('fs', () => ({
  default: { existsSync: vi.fn(), statSync: vi.fn() },
  existsSync: vi.fn(),
  statSync: vi.fn(),
}))
vi.mock('fs/promises', () => ({
  default: { readdir: vi.fn(), stat: vi.fn() },
  readdir: vi.fn(),
  stat: vi.fn(),
}))
vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp') },
}))
vi.mock('../../src/main/database/getDatabase', () => ({
  getDatabase: vi.fn(() => ({})),
}))
vi.mock('../../src/main/services/QualityAnalyzer', () => ({
  getQualityAnalyzer: vi.fn(() => ({})),
}))
vi.mock('../../src/main/services/MediaFileAnalyzer', () => ({
  getMediaFileAnalyzer: vi.fn(() => ({})),
}))
vi.mock('../../src/main/services/FileNameParser', () => ({
  getFileNameParser: vi.fn(() => ({})),
}))
vi.mock('../../src/main/services/TMDBService', () => ({
  getTMDBService: vi.fn(() => ({})),
}))
vi.mock('../../src/main/services/LoggingService', () => ({
  getLoggingService: vi.fn(() => ({ verbose: vi.fn() })),
}))
vi.mock('../../src/main/services/MusicBrainzService', () => ({
  getMusicBrainzService: vi.fn(() => ({})),
}))
vi.mock('../../src/main/services/GeminiService', () => ({
  getGeminiService: vi.fn(() => ({})),
}))
vi.mock('../../src/main/services/MediaNormalizer', () => ({
  normalizeVideoCodec: vi.fn((c: string) => c),
  normalizeResolution: vi.fn(() => '1080p'),
  normalizeAudioCodec: vi.fn((c: string) => c),
}))

import { isExtrasContent, readFfprobeBatchSize } from '@main/providers/local/LocalFolderProvider'

describe('isExtrasContent', () => {
  it('detects sample files', () => {
    expect(isExtrasContent('sample.mkv')).toBe(true)
    expect(isExtrasContent('Movie.Sample.mkv')).toBe(true)
  })

  it('detects featurettes', () => {
    expect(isExtrasContent('featurette-making.mkv')).toBe(true)
    expect(isExtrasContent('Featurettes.mkv')).toBe(true)
  })

  it('detects behind the scenes', () => {
    expect(isExtrasContent('behind-the-scenes.mkv')).toBe(true)
    expect(isExtrasContent('Behind The Scenes.mkv')).toBe(true)
  })

  it('detects deleted scenes', () => {
    expect(isExtrasContent('deleted-scenes.mkv')).toBe(true)
    expect(isExtrasContent('Deleted Scene.mkv')).toBe(true)
  })

  it('detects gag reel', () => {
    expect(isExtrasContent('gag reel.mkv')).toBe(true)
  })

  it('detects bloopers', () => {
    expect(isExtrasContent('bloopers.mkv')).toBe(true)
    expect(isExtrasContent('Blooper.mkv')).toBe(true)
  })

  it('detects making of', () => {
    expect(isExtrasContent('making of.mkv')).toBe(true)
    expect(isExtrasContent('Making_Of.mkv')).toBe(true)
  })

  it('detects trailers', () => {
    expect(isExtrasContent('trailer.mkv')).toBe(true)
    expect(isExtrasContent('Official Teaser.mkv')).toBe(true)
  })

  it('detects commentary', () => {
    expect(isExtrasContent('commentary.mkv')).toBe(true)
  })

  it('detects bonus content', () => {
    expect(isExtrasContent('bonus content.mkv')).toBe(true)
    expect(isExtrasContent('bonus.mkv')).toBe(true)
  })

  it('detects BTS', () => {
    expect(isExtrasContent('BTS.mkv')).toBe(true)
  })

  it('detects outtakes', () => {
    expect(isExtrasContent('outtakes.mkv')).toBe(true)
  })

  it('detects numbered scenes', () => {
    expect(isExtrasContent('scene-2.mkv')).toBe(true)
  })

  it('detects alternate endings', () => {
    expect(isExtrasContent('alternate ending.mkv')).toBe(true)
  })

  it('detects extended cuts', () => {
    expect(isExtrasContent('extended cut.mkv')).toBe(true)
    expect(isExtrasContent('extended scene.mkv')).toBe(true)
  })

  it('does NOT flag normal movie titles', () => {
    expect(isExtrasContent('The.Matrix.1999.1080p.BluRay.mkv')).toBe(false)
    expect(isExtrasContent('Inception.2010.4K.mkv')).toBe(false)
    expect(isExtrasContent('Interstellar.mkv')).toBe(false)
  })

  it('is case insensitive', () => {
    expect(isExtrasContent('FEATURETTE.MKV')).toBe(true)
    expect(isExtrasContent('BEHIND THE SCENES.MKV')).toBe(true)
  })
})

describe('ffprobe batch-size validation', () => {
  it('uses the documented default only for absent settings', () => {
    expect(readFfprobeBatchSize(null, 25)).toBe(25)
    expect(readFfprobeBatchSize('', 50)).toBe(50)
    expect(readFfprobeBatchSize('8', 25)).toBe(8)
    expect(readFfprobeBatchSize('128', 25)).toBe(128)
  })

  it.each(['0', '-1', 'NaN', '1.5', '3junk', '129', 'Infinity'])(
    'rejects a non-advancing or invalid setting %s', value => {
      expect(() => readFfprobeBatchSize(value, 25)).toThrow('ffprobe_batch_size')
    },
  )
})
