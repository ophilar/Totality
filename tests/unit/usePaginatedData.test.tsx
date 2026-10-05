/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { usePaginatedData } from '@/hooks/usePaginatedData'

describe('usePaginatedData', () => {
  it('does not query an inactive library section', async () => {
    const fetchFn = vi.fn(async () => [])
    const countFn = vi.fn(async () => 0)

    renderHook(() => usePaginatedData({
      fetchFn,
      countFn,
      pageSize: 50,
      initialFilters: {},
      activeSourceId: null,
      enabled: false,
    } as never))

    await waitFor(() => expect(fetchFn).not.toHaveBeenCalled())
    expect(countFn).not.toHaveBeenCalled()
  })

  it('does not reload when filters only add undefined values', async () => {
    const fetchFn = vi.fn(async () => [])
    const countFn = vi.fn(async () => 0)
    const { result } = renderHook(() => usePaginatedData<{ id: number }, { sortBy: string; searchQuery?: string }>({
      fetchFn,
      countFn,
      pageSize: 50,
      initialFilters: { sortBy: 'title' },
    }))

    await waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(1))
    act(() => result.current.setFilters({ sortBy: 'title', searchQuery: undefined }))

    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(countFn).toHaveBeenCalledTimes(1)
  })

  it('coalesces invalidations received during a request into one follow-up refresh', async () => {
    let resolveInitial!: (items: { id: number }[]) => void
    const fetchFn = vi.fn()
      .mockImplementationOnce(() => new Promise<{ id: number }[]>(resolve => { resolveInitial = resolve }))
      .mockResolvedValue([{ id: 1 }])
    const countFn = vi.fn(async () => 1)
    const { result } = renderHook(() => usePaginatedData<{ id: number }, Record<string, never>>({
      fetchFn,
      countFn,
      pageSize: 50,
      initialFilters: {},
    }))

    await waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(1))
    act(() => {
      result.current.refresh()
      result.current.refresh()
    })
    expect(fetchFn).toHaveBeenCalledTimes(1)

    await act(async () => { resolveInitial([{ id: 1 }]) })
    await waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(2))
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('waits for an obsolete source read before fetching the new source', async () => {
    let resolveOldSource!: (items: { id: string }[]) => void
    const fetchFn = vi.fn()
      .mockImplementationOnce(() => new Promise<{ id: string }[]>(resolve => { resolveOldSource = resolve }))
      .mockImplementation(async (filters: { sourceId?: string }) => [{ id: filters.sourceId ?? 'all' }])
    const countFn = vi.fn(async () => 1)
    const { result, rerender } = renderHook(
      ({ sourceId }: { sourceId: string }) => usePaginatedData<{ id: string }, Record<string, never>>({
        fetchFn,
        countFn,
        pageSize: 50,
        initialFilters: {},
        activeSourceId: sourceId,
      }),
      { initialProps: { sourceId: 'source-1' } },
    )

    await waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(1))
    rerender({ sourceId: 'source-2' })
    expect(fetchFn).toHaveBeenCalledTimes(1)

    await act(async () => { resolveOldSource([{ id: 'source-1-stale' }]) })
    await waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(2))
    expect(countFn).toHaveBeenCalledTimes(2)
    expect(fetchFn.mock.calls[1][0]).toMatchObject({ sourceId: 'source-2' })
    expect(result.current.items).toEqual([{ id: 'source-2' }])
  })

  it('discards a read when its section becomes inactive', async () => {
    let resolveRead!: (items: { id: number }[]) => void
    const fetchFn = vi.fn(() => new Promise<{ id: number }[]>(resolve => { resolveRead = resolve }))
    const countFn = vi.fn(async () => 1)
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => usePaginatedData<{ id: number }, Record<string, never>>({
        fetchFn,
        countFn,
        pageSize: 50,
        initialFilters: {},
        enabled,
      }),
      { initialProps: { enabled: true } },
    )

    await waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(1))
    rerender({ enabled: false })
    await act(async () => { resolveRead([{ id: 1 }]) })

    expect(result.current.items).toEqual([])
    expect(result.current.loading).toBe(false)
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })
})
