/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { GridStateSnapshot, StateSnapshot } from 'react-virtuoso'
import { ScrollMemoryProvider, useScrollMemory } from '@/contexts/ScrollMemoryContext'

const listState: StateSnapshot = { ranges: [{ startIndex: 0, endIndex: 2 }], offsetFromTop: 12, viewportHeight: 400 }
const gridState: GridStateSnapshot = { item: 3, offsetFromTop: 24 }

function Probe(): ReactNode {
  const memory = useScrollMemory()
  memory.saveListScrollState('shared', listState)
  const list = memory.getListScrollState('shared')
  const grid = memory.getGridScrollState('shared')
  memory.saveGridScrollState('shared', gridState)
  return <output>{`${list?.offsetFromTop ?? 'none'}:${memory.getListScrollState('shared')?.offsetFromTop ?? 'none'}:${grid?.offsetFromTop ?? 'none'}:${memory.getGridScrollState('shared')?.offsetFromTop ?? 'none'}`}</output>
}

describe('scroll memory snapshot contracts', () => {
  it('does not restore a list snapshot as a grid snapshot', () => {
    render(
      <ScrollMemoryProvider>
        <Probe />
      </ScrollMemoryProvider>,
    )
    expect(screen.getByRole('status').textContent).toBe('12:none:none:24')
  })
})
