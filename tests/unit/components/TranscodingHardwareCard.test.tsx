/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent, act, cleanup } from '@testing-library/react'
import React from 'react'
import { TranscodingHardwareCard } from '@/components/settings/TranscodingHardwareCard'
import type { TranscodingCapabilities } from '@main/services/TranscodingCapabilities'

describe('TranscodingHardwareCard', () => {
  const mockCapabilities: TranscodingCapabilities = {
    ffmpeg: true,
    detectedAt: '2025-01-01T00:00:00.000Z',
    gpus: [
      { id: 'gpu-1', name: 'GeForce RTX 3080', vendor: 'NVIDIA' },
      { id: 'gpu-2', name: 'Arc A770', vendor: 'Intel' }
    ],
    selectedGpuId: 'gpu-1',
    vendors: ['NVIDIA', 'Intel', 'Software'],
    encoders: ['nvenc_av1', 'nvenc_h265', 'qsv_av1', 'qsv_h265', 'svt_av1', 'x265', 'libx264'],
    verifiedEncoders: ['nvenc_av1', 'nvenc_h265'],
    probeFailures: [],
    engines: ['ffmpeg']
  }

  const mockGetCapabilities = vi.fn()
  const mockRefreshCapabilities = vi.fn()
  const mockSetSelectedGpu = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()

    Object.assign(window, {
      electronAPI: {
        getCapabilities: mockGetCapabilities,
        refreshCapabilities: mockRefreshCapabilities,
        setSelectedGpu: mockSetSelectedGpu
      }
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('renders initial loading state and loads capabilities on mount', async () => {
    mockGetCapabilities.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(mockCapabilities), 50))
    )

    render(<TranscodingHardwareCard />)

    expect(screen.getByText('Detecting verified encoders...')).toBeTruthy()

    await waitFor(() => {
      expect(mockGetCapabilities).toHaveBeenCalledTimes(1)
    })

    await waitFor(() => {
      expect(screen.getByText('GeForce RTX 3080 (NVIDIA)')).toBeTruthy()
    })

    expect(screen.getByText('Engines:')).toBeTruthy()
    expect(screen.getByText('ffmpeg')).toBeTruthy()
    expect(screen.getByText('Encoders:')).toBeTruthy()
    expect(screen.getByText('nvenc_av1, nvenc_h265, qsv_av1, qsv_h265, svt_av1, x265, libx264')).toBeTruthy()
  })

  it('allows changing GPU selection', async () => {
    mockGetCapabilities.mockResolvedValue(mockCapabilities)
    const updatedCapabilities: TranscodingCapabilities = {
      ...mockCapabilities,
      selectedGpuId: 'gpu-2'
    }
    mockSetSelectedGpu.mockResolvedValue(updatedCapabilities)

    render(<TranscodingHardwareCard />)

    await waitFor(() => {
      expect(screen.getByRole('combobox')).toBeTruthy()
    })

    const select = screen.getByRole('combobox') as HTMLSelectElement
    expect(select.value).toBe('gpu-1')

    await act(async () => {
      fireEvent.change(select, { target: { value: 'gpu-2' } })
    })

    expect(mockSetSelectedGpu).toHaveBeenCalledWith('gpu-2')

    await waitFor(() => {
      expect(select.value).toBe('gpu-2')
    })
  })

  it('handles selecting software CPU encoding', async () => {
    mockGetCapabilities.mockResolvedValue(mockCapabilities)
    const updatedCapabilities: TranscodingCapabilities = {
      ...mockCapabilities,
      selectedGpuId: null
    }
    mockSetSelectedGpu.mockResolvedValue(updatedCapabilities)

    render(<TranscodingHardwareCard />)

    await waitFor(() => {
      expect(screen.getByRole('combobox')).toBeTruthy()
    })

    const select = screen.getByRole('combobox') as HTMLSelectElement

    await act(async () => {
      fireEvent.change(select, { target: { value: '' } })
    })

    expect(mockSetSelectedGpu).toHaveBeenCalledWith(null)

    await waitFor(() => {
      expect(select.value).toBe('')
    })
  })

  it('refreshes hardware capabilities when refresh button is clicked', async () => {
    mockGetCapabilities.mockResolvedValue(mockCapabilities)
    const refreshedCapabilities: TranscodingCapabilities = {
      ...mockCapabilities,
      detectedAt: '2025-01-01T01:00:00.000Z'
    }
    mockRefreshCapabilities.mockResolvedValue(refreshedCapabilities)

    render(<TranscodingHardwareCard />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Refresh hardware capabilities' })).toBeTruthy()
    })

    const refreshButton = screen.getByRole('button', { name: 'Refresh hardware capabilities' })

    await act(async () => {
      fireEvent.click(refreshButton)
    })

    expect(mockRefreshCapabilities).toHaveBeenCalledTimes(1)
  })

  it('displays error message when getCapabilities fails on load', async () => {
    mockGetCapabilities.mockRejectedValue(new Error('Failed to detect hardware'))

    render(<TranscodingHardwareCard />)

    await waitFor(() => {
      expect(screen.getByText('Failed to detect hardware')).toBeTruthy()
    })
  })

  it('displays error message when selectGpu fails', async () => {
    mockGetCapabilities.mockResolvedValue(mockCapabilities)
    mockSetSelectedGpu.mockRejectedValue(new Error('Failed to set GPU'))

    render(<TranscodingHardwareCard />)

    await waitFor(() => {
      expect(screen.getByRole('combobox')).toBeTruthy()
    })

    const select = screen.getByRole('combobox')

    await act(async () => {
      fireEvent.change(select, { target: { value: 'gpu-2' } })
    })

    await waitFor(() => {
      expect(screen.getByText('Failed to set GPU')).toBeTruthy()
    })
  })
})
