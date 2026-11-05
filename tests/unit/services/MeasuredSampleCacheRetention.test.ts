import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pruneMeasuredSampleCache } from '@main/services/transcoding/MeasuredSampleCacheRetention'
import { APP_CONFIG } from '@main/config'

describe('measured-sample disk cache retention', () => {
  const roots: string[] = []
  const prefix = 'transcoding.measurement.'
  const now = Date.now()
  const old = new Date(now - 40 * 24 * 60 * 60 * 1000)
  const key = (char: string) => char.repeat(64)

  async function root() {
    const dir = await mkdtemp(join(tmpdir(), 'totality-sample-retention-'))
    roots.push(dir)
    return dir
  }
  async function sample(directory: string, name: string, age = old): Promise<string> {
    const dir = join(directory, name)
    await mkdir(dir)
    await writeFile(join(dir, 'sample.mkv'), 'sample bytes')
    await utimes(dir, age, age)
    return dir
  }
  afterEach(async () => {
    await Promise.all(roots.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
  })

  it('reclaims only old unreferenced completed and orphaned cache entries', async () => {
    const dir = await root()
    const evict = key('a'), orphan = key('b'), protectedKey = key('c'), incomplete = key('d'), newKey = key('e')
    for (const name of [evict, orphan, protectedKey, incomplete]) await sample(dir, name)
    await sample(dir, newKey, new Date(now))
    const records = Object.fromEntries([evict, protectedKey, incomplete, newKey].map(name =>
      [prefix + name, JSON.stringify({ cacheKey: name, complete: name !== incomplete })]))
    const deleteRecord = vi.fn(async (setting: string) => { delete records[setting] })
    const result = await pruneMeasuredSampleCache({
      root: dir, records, protectedKeys: new Set([protectedKey]), settingPrefix: prefix,
      deleteRecord, now, maxBytes: 1,
    })
    expect(result.removed).toBe(2)
    expect(result.reclaimedBytes).toBeGreaterThan(0)
    expect(deleteRecord).toHaveBeenCalledExactlyOnceWith(prefix + evict)
    expect((await readdir(dir)).sort()).toEqual([incomplete, protectedKey, newKey].sort())
    expect(await stat(join(dir, protectedKey))).toBeDefined()
  })

  it('never follows or deletes unrelated directories or symbolic links', async () => {
    const dir = await root()
    await sample(dir, 'user-made-directory')
    const records = {}
    const result = await pruneMeasuredSampleCache({
      root: dir, records, protectedKeys: new Set(), settingPrefix: prefix,
      deleteRecord: vi.fn(), now, maxBytes: 0,
    })
    expect(result.removed).toBe(0)
    expect(await readdir(dir)).toEqual(['user-made-directory'])
  })

  it('respects the centrally configured minimum retention age even above budget', async () => {
    const dir = await root()
    const recent = key('a')
    const minAge = APP_CONFIG.transcoding.measuredSampleCache.minEvictionAgeMs
    await sample(dir, recent, new Date(now - minAge + 1000))
    const record = { [prefix + recent]: JSON.stringify({ cacheKey: recent, complete: true }) }
    const result = await pruneMeasuredSampleCache({
      root: dir, records: record, protectedKeys: new Set(), settingPrefix: prefix,
      deleteRecord: vi.fn(), now, maxBytes: 0,
    })
    expect(result.removed).toBe(0)
    expect(await readdir(dir)).toContain(recent)
  })

  it('preserves active old cache entries even when over budget', async () => {
    const dir = await root()
    const active = key('f')
    await sample(dir, active)
    const result = await pruneMeasuredSampleCache({
      root: dir, records: { [prefix + active]: JSON.stringify({ cacheKey: active, complete: true }) },
      protectedKeys: new Set(), settingPrefix: prefix, deleteRecord: vi.fn(),
      isActive: candidate => candidate === active, now, maxBytes: 0,
    })
    expect(result.removed).toBe(0)
  })
})
