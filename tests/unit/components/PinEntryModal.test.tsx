/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import React from 'react'
import { PinEntryModal } from '@/components/library/PinEntryModal'

describe('PinEntryModal', () => {
  const mockOnClose = vi.fn()
  const mockOnSuccess = vi.fn()

  beforeEach(() => {
    vi.resetAllMocks()
    window.electronAPI = {
      ...(window.electronAPI || {}),
      dbHasPin: vi.fn().mockResolvedValue(true),
      dbSetPin: vi.fn().mockResolvedValue(true),
      dbVerifyPin: vi.fn().mockResolvedValue(true),
    } as unknown as typeof window.electronAPI
  })

  afterEach(() => {
    cleanup()
  })

  it('does not render when isOpen is false', () => {
    const { container } = render(
      <PinEntryModal isOpen={false} onClose={mockOnClose} onSuccess={mockOnSuccess} />
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders Set Security PIN mode when dbHasPin resolves to false', async () => {
    vi.mocked(window.electronAPI.dbHasPin).mockResolvedValue(false)
    render(<PinEntryModal isOpen={true} onClose={mockOnClose} onSuccess={mockOnSuccess} />)

    await waitFor(() => {
      expect(screen.getByText('Set Security PIN')).toBeDefined()
    })
    expect(
      screen.getByText('Create a PIN to protect your secret libraries and personal content.')
    ).toBeDefined()
    expect(screen.getByRole('button', { name: /Save PIN/i })).toBeDefined()
  })

  it('renders Unlock Library mode when dbHasPin resolves to true', async () => {
    vi.mocked(window.electronAPI.dbHasPin).mockResolvedValue(true)
    render(<PinEntryModal isOpen={true} onClose={mockOnClose} onSuccess={mockOnSuccess} />)

    await waitFor(() => {
      expect(screen.getByText('Unlock Library')).toBeDefined()
    })
    expect(screen.getByText('Enter your security PIN to view protected libraries.')).toBeDefined()
    expect(screen.getByRole('button', { name: /Unlock/i })).toBeDefined()
  })

  it('filters non-numeric characters from input and disables submit when pin length is less than 4', async () => {
    render(<PinEntryModal isOpen={true} onClose={mockOnClose} onSuccess={mockOnSuccess} />)

    await waitFor(() => {
      expect(screen.getByPlaceholderText('••••')).toBeDefined()
    })

    const input = screen.getByPlaceholderText('••••') as HTMLInputElement
    const submitBtn = screen.getByRole('button', { name: /Unlock/i }) as HTMLButtonElement

    expect(submitBtn.disabled).toBe(true)

    fireEvent.change(input, { target: { value: '12abc3' } })
    expect(input.value).toBe('123')
    expect(submitBtn.disabled).toBe(true)

    fireEvent.change(input, { target: { value: '1234' } })
    expect(input.value).toBe('1234')
    expect(submitBtn.disabled).toBe(false)
  })

  it('handles first-time PIN setting successfully', async () => {
    vi.mocked(window.electronAPI.dbHasPin).mockResolvedValue(false)
    vi.mocked(window.electronAPI.dbSetPin).mockResolvedValue(true)

    render(<PinEntryModal isOpen={true} onClose={mockOnClose} onSuccess={mockOnSuccess} />)

    await waitFor(() => {
      expect(screen.getByText('Set Security PIN')).toBeDefined()
    })

    const input = screen.getByPlaceholderText('••••')
    fireEvent.change(input, { target: { value: '1234' } })

    const submitBtn = screen.getByRole('button', { name: /Save PIN/i })
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(window.electronAPI.dbSetPin).toHaveBeenCalledWith('1234')
      expect(mockOnSuccess).toHaveBeenCalledTimes(1)
    })
  })

  it('handles valid PIN verification successfully', async () => {
    vi.mocked(window.electronAPI.dbHasPin).mockResolvedValue(true)
    vi.mocked(window.electronAPI.dbVerifyPin).mockResolvedValue(true)

    render(<PinEntryModal isOpen={true} onClose={mockOnClose} onSuccess={mockOnSuccess} />)

    await waitFor(() => {
      expect(screen.getByText('Unlock Library')).toBeDefined()
    })

    const input = screen.getByPlaceholderText('••••')
    fireEvent.change(input, { target: { value: '5678' } })

    const submitBtn = screen.getByRole('button', { name: /Unlock/i })
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(window.electronAPI.dbVerifyPin).toHaveBeenCalledWith('5678')
      expect(mockOnSuccess).toHaveBeenCalledTimes(1)
    })
  })

  it('shows error message when PIN verification fails', async () => {
    vi.mocked(window.electronAPI.dbHasPin).mockResolvedValue(true)
    vi.mocked(window.electronAPI.dbVerifyPin).mockResolvedValue(false)

    render(<PinEntryModal isOpen={true} onClose={mockOnClose} onSuccess={mockOnSuccess} />)

    await waitFor(() => {
      expect(screen.getByText('Unlock Library')).toBeDefined()
    })

    const input = screen.getByPlaceholderText('••••') as HTMLInputElement
    fireEvent.change(input, { target: { value: '0000' } })

    const submitBtn = screen.getByRole('button', { name: /Unlock/i })
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(screen.getByText('Invalid PIN. Please try again.')).toBeDefined()
      expect(input.value).toBe('')
      expect(mockOnSuccess).not.toHaveBeenCalled()
    })
  })

  it('shows error message when electronAPI throws an exception', async () => {
    vi.mocked(window.electronAPI.dbHasPin).mockResolvedValue(true)
    vi.mocked(window.electronAPI.dbVerifyPin).mockRejectedValue(new Error('DB failure'))

    render(<PinEntryModal isOpen={true} onClose={mockOnClose} onSuccess={mockOnSuccess} />)

    await waitFor(() => {
      expect(screen.getByText('Unlock Library')).toBeDefined()
    })

    const input = screen.getByPlaceholderText('••••')
    fireEvent.change(input, { target: { value: '9999' } })

    const submitBtn = screen.getByRole('button', { name: /Unlock/i })
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(screen.getByText('An error occurred. Please try again.')).toBeDefined()
      expect(mockOnSuccess).not.toHaveBeenCalled()
    })
  })

  it('triggers onClose when close button is clicked', async () => {
    render(<PinEntryModal isOpen={true} onClose={mockOnClose} onSuccess={mockOnSuccess} />)

    await waitFor(() => {
      expect(screen.getByText('Unlock Library')).toBeDefined()
    })

    const closeBtn = screen.getByRole('button', { name: '' })
    fireEvent.click(closeBtn)

    expect(mockOnClose).toHaveBeenCalledTimes(1)
  })
})
