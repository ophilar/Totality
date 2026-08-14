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
    const { result } = renderHook(() => usePaginatedData({
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
})
