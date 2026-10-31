import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ValidatedFileAnalysisCache } from '@main/services/transcoding/ValidatedFileAnalysisCache'

describe('validated file analysis cache', () => {
  const directories: string[] = []
  const source = async () => {
    const directory = await mkdtemp(join(tmpdir(), 'totality-analysis-cache-'))
    directories.push(directory)
    const file = join(directory, 'video.mkv')
    await writeFile(file, 'original')
    return file
  }
  afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))) })

  it('coalesces concurrent lookups and reuses only unchanged files', async () => {
    const file = await source()
    const cache = new ValidatedFileAnalysisCache<{ success: boolean; count: number }>(2)
    let calls = 0
    const load = async () => ({ success: true, count: ++calls })
    const first = await Promise.all([cache.get(file, load), cache.get(file, load)])
    expect(first.map(item => item.count)).toEqual([1, 1])
    expect((await cache.get(file, load)).count).toBe(1)
    await writeFile(file, 'original but changed')
    expect((await cache.get(file, load)).count).toBe(2)
    expect(cache.size).toBe(1)
  })

  it('never caches failed analyses or failed loads', async () => {
    const file = await source()
    const cache = new ValidatedFileAnalysisCache<{ success: boolean }>()
    expect((await cache.get(file, async () => ({ success: false }))).success).toBe(false)
    expect(cache.size).toBe(0)
    await expect(cache.get(file, async () => { throw new Error('probe failed') })).rejects.toThrow('probe failed')
    expect(cache.size).toBe(0)
    expect((await cache.get(file, async () => ({ success: true }))).success).toBe(true)
  })

  it('bounds memory and rejects a source modified during the analysis', async () => {
    const a = await source(), b = await source()
    const cache = new ValidatedFileAnalysisCache<{ success: boolean }>(1)
    await expect(cache.get(a, async () => {
      await writeFile(a, 'modified during analysis')
      return { success: true }
    })).rejects.toThrow('changed during media analysis')
    expect(cache.size).toBe(0)
    await cache.get(a, async () => ({ success: true }))
    await cache.get(b, async () => ({ success: true }))
    expect(cache.size).toBe(1)
  })
})
