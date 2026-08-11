import { describe, it, expect, vi } from 'vitest'
import { BaseRepository } from '@main/database/repositories/BaseRepository'

class TestRepo extends BaseRepository<any> {
  constructor() {
    super({} as any, 'test', {} as any, {} as any)
  }
  public async testChunking<T, R>(
    items: T[],
    batchSize: number,
    fn: (chunk: T[]) => Promise<R[]>
  ): Promise<R[]> {
    return this.processInChunks(items, batchSize, fn)
  }
}

describe('BaseRepository processInChunks', () => {
  it('processes items in specified chunk sizes and combines results', async () => {
    const repo = new TestRepo()
    const items = [1, 2, 3, 4, 5]
    const fn = vi.fn().mockImplementation(async (chunk: number[]) => chunk.map((n) => n * 2))

    const result = await repo.testChunking(items, 2, fn)
    expect(result).toEqual([2, 4, 6, 8, 10])
    expect(fn).toHaveBeenCalledTimes(3)
    expect(fn).toHaveBeenNthCalledWith(1, [1, 2])
    expect(fn).toHaveBeenNthCalledWith(2, [3, 4])
    expect(fn).toHaveBeenNthCalledWith(3, [5])
  })

  it('handles empty input arrays', async () => {
    const repo = new TestRepo()
    const fn = vi.fn()
    const result = await repo.testChunking([], 2, fn)
    expect(result).toEqual([])
    expect(fn).not.toHaveBeenCalled()
  })
})
