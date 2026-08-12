/**
 * @vitest-environment jsdom
 */
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ActionMenu, MenuItem } from '@/components/ui/ActionMenu'

describe('ActionMenu', () => {
  it('renders trigger button, toggles menu on click, renders items list, and executes onClick', async () => {
    const handleClick1 = vi.fn()
    const handleClick2 = vi.fn()
    const items: MenuItem[] = [
      { id: 'opt1', label: 'Option 1', onClick: handleClick1 },
      { id: 'opt2', label: 'Option 2', onClick: handleClick2 }
    ]

    render(<ActionMenu items={items} menuPosition="left" />)

    // 1. Verify trigger button rendering
    const trigger = screen.getByRole('button')
    expect(trigger).toBeDefined()

    // Initially menu list is closed
    expect(screen.queryByText('Option 1')).toBeNull()
    expect(screen.queryByText('Option 2')).toBeNull()

    // 2. Click toggling - open
    fireEvent.click(trigger)

    // 3. Item list rendering
    expect(screen.getByText('Option 1')).toBeDefined()
    expect(screen.getByText('Option 2')).toBeDefined()

    // 4. onClick execution
    fireEvent.click(screen.getByText('Option 1'))
    expect(handleClick1).toHaveBeenCalledTimes(1)
    expect(handleClick2).not.toHaveBeenCalled()

    // Click menu item should close menu
    expect(screen.queryByText('Option 1')).toBeNull()
  })

  it('renders isWorking spinner state and prevents toggling menu', () => {
    const items: MenuItem[] = [{ id: 'opt1', label: 'Option 1', onClick: vi.fn() }]

    const { container } = render(<ActionMenu items={items} isWorking={true} />)
    const trigger = screen.getByRole('button')
    expect(trigger).toBeDefined()
    expect(container.querySelector('.animate-spin')).not.toBeNull()

    fireEvent.click(trigger)
    expect(screen.queryByText('Option 1')).toBeNull()
  })
})
