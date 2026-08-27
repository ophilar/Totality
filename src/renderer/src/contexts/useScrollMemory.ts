import { useContext } from 'react'
import { ScrollMemoryContext } from './ScrollMemoryContextStore'

export function useScrollMemory() {
  const context = useContext(ScrollMemoryContext)
  if (context === undefined) throw new Error('useScrollMemory must be used within a ScrollMemoryProvider')
  return context
}
