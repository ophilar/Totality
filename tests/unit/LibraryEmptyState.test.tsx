/**
 * @vitest-environment jsdom
 */
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { LibraryEmptyState } from '@/components/library/browser/LibraryEmptyState'
import { Film } from 'lucide-react'

describe('LibraryEmptyState', () => {
  it('renders empty message when not scanning', () => {
    render(
      <LibraryEmptyState
        isScanning={false}
        totalCount={0}
        icon={Film}
        title="No movies found"
        description="Scan a movie library to start"
      />
    )
    expect(screen.getByText('No movies found')).toBeDefined()
    expect(screen.getByText('Scan a movie library to start')).toBeDefined()
  })

  it('renders scan progress when scanning', () => {
    render(
      <LibraryEmptyState
        isScanning={true}
        scanProgress={{ phase: 'fetching', currentItem: 'Inception' }}
        totalCount={5}
        icon={Film}
        title="No movies found"
        description="Scan a movie library to start"
      />
    )
    expect(screen.getByText('Scan in Progress')).toBeDefined()
    expect(screen.getByText('Inception')).toBeDefined()
  })
})
