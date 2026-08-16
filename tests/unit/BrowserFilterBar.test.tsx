// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { BrowserFilterBar } from '@/components/library/browser/BrowserFilterBar'

describe('BrowserFilterBar Collection Controls', () => {
  const defaultProps = {
    view: 'movies',
    musicViewMode: 'albums' as const,
    setMusicViewMode: vi.fn(),
    activeSourceId: null,
    activeLibraryId: null,
    setActiveLibraryId: vi.fn(),
    currentTypeLibraries: [],
    isUnlocked: false,
    setIsUnlocked: vi.fn(),
    setShowPinModal: vi.fn(),
    tierFilter: 'all' as const,
    setTierFilter: vi.fn(),
    qualityFilter: 'all' as const,
    setQualityFilter: vi.fn(),
    slimDown: false,
    setSlimDown: vi.fn(),
    collectionsOnly: false,
    setCollectionsOnly: vi.fn(),
    groupByCollections: true,
    setGroupByCollections: vi.fn(),
    hasCollections: true,
    gridScale: 5,
    setGridScale: vi.fn(),
    viewType: 'grid' as const,
    setViewType: vi.fn(),
    selectedShow: null,
  }

  it('renders Group Collections and Collections Only buttons when hasCollections is true', () => {
    render(<BrowserFilterBar {...defaultProps} />)
    expect(screen.getByText('Group Collections')).toBeTruthy()
    expect(screen.getByText('Collections Only')).toBeTruthy()
  })

  it('does not render collection buttons when hasCollections is false', () => {
    render(<BrowserFilterBar {...defaultProps} hasCollections={false} />)
    expect(screen.queryByText('Group Collections')).toBeNull()
    expect(screen.queryByText('Collections Only')).toBeNull()
  })

  it('calls setGroupByCollections when clicking Group Collections', () => {
    const setGroupByCollections = vi.fn()
    render(
      <BrowserFilterBar
        {...defaultProps}
        groupByCollections={true}
        setGroupByCollections={setGroupByCollections}
      />
    )

    const groupBtn = screen.getByText('Group Collections')
    fireEvent.click(groupBtn)
    expect(setGroupByCollections).toHaveBeenCalledWith(false)
  })

  it('disables collectionsOnly when user disables groupByCollections', () => {
    const setGroupByCollections = vi.fn()
    const setCollectionsOnly = vi.fn()
    render(
      <BrowserFilterBar
        {...defaultProps}
        groupByCollections={true}
        setGroupByCollections={setGroupByCollections}
        collectionsOnly={true}
        setCollectionsOnly={setCollectionsOnly}
      />
    )

    const groupBtn = screen.getByText('Group Collections')
    fireEvent.click(groupBtn)
    expect(setGroupByCollections).toHaveBeenCalledWith(false)
    expect(setCollectionsOnly).toHaveBeenCalledWith(false)
  })

  it('calls setCollectionsOnly when clicking Collections Only', () => {
    const setCollectionsOnly = vi.fn()
    render(
      <BrowserFilterBar
        {...defaultProps}
        collectionsOnly={false}
        setCollectionsOnly={setCollectionsOnly}
      />
    )

    const collBtn = screen.getByText('Collections Only')
    fireEvent.click(collBtn)
    expect(setCollectionsOnly).toHaveBeenCalledWith(true)
  })

  it('automatically enables groupByCollections when user enables Collections Only', () => {
    const setGroupByCollections = vi.fn()
    const setCollectionsOnly = vi.fn()
    render(
      <BrowserFilterBar
        {...defaultProps}
        groupByCollections={false}
        setGroupByCollections={setGroupByCollections}
        collectionsOnly={false}
        setCollectionsOnly={setCollectionsOnly}
      />
    )

    const collBtn = screen.getByText('Collections Only')
    fireEvent.click(collBtn)
    expect(setCollectionsOnly).toHaveBeenCalledWith(true)
    expect(setGroupByCollections).toHaveBeenCalledWith(true)
  })
})
