import { describe, expect, it, vi } from 'vitest'
import { OperationFileHasher } from '@main/services/transcoding/OperationFileHasher'

describe('per-operation hash scheduling', () => {
  it('shares a digest by identity and never exceeds the disk-read limit', async () => {
    let active = 0
    let maximum = 0
    const digest = vi.fn(async (path: string) => {
      active++
      maximum = Math.max(maximum, active)
      await new Promise(resolve => setTimeout(resolve, 5))
      active--
      return `hash:${path}`
    })
    const hasher = new OperationFileHasher(digest, 2)
    const found = await Promise.all(['a', 'a', 'b', 'c', 'd', 'd'].map(path => hasher.hash(path)))
    expect(found).toEqual(['hash:a', 'hash:a', 'hash:b', 'hash:c', 'hash:d', 'hash:d'])
    expect(digest).toHaveBeenCalledTimes(4)
    expect(maximum).toBeLessThanOrEqual(2)
    expect(maximum).toBe(2)
    await hasher.hash('a')
    expect(digest).toHaveBeenCalledTimes(4)
    const otherOperation = new OperationFileHasher(digest, 2)
    await otherOperation.hash('a')
    expect(digest).toHaveBeenCalledTimes(5)
  })

  it('uses complete caller identity for reuse, and retries failed digests', async () => {
    const digest = vi.fn()
      .mockRejectedValueOnce(new Error('disk read failed'))
      .mockResolvedValueOnce('digest-A')
      .mockResolvedValueOnce('digest-B')
    const hasher = new OperationFileHasher(digest, 1)
    await expect(hasher.hash('/movie', 'first-identity')).rejects.toThrow('disk read failed')
    expect(await hasher.hash('/movie', 'first-identity')).toBe('digest-A')
    expect(await hasher.hash('/movie', 'new-identity')).toBe('digest-B')
    expect(digest).toHaveBeenCalledTimes(3)
  })

  it('rejects nonpositive and nonintegral concurrency', () => {
    expect(() => new OperationFileHasher(async () => '', 0)).toThrow()
    expect(() => new OperationFileHasher(async () => '', 1.5)).toThrow()
  })
})
