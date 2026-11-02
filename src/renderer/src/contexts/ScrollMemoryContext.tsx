import React, { createContext, useContext, useState, useCallback } from 'react'
import type { StateSnapshot, GridStateSnapshot } from 'react-virtuoso'

type ScrollState = StateSnapshot | GridStateSnapshot

interface ScrollMemoryContextType {
  saveListScrollState: (key: string, state: StateSnapshot) => void
  getListScrollState: (key: string) => StateSnapshot | undefined
  saveGridScrollState: (key: string, state: GridStateSnapshot) => void
  getGridScrollState: (key: string) => GridStateSnapshot | undefined
  clearScrollState: (key: string) => void
}

const ScrollMemoryContext = createContext<ScrollMemoryContextType | undefined>(undefined)

export function ScrollMemoryProvider({ children }: { children: React.ReactNode }) {
  const [scrollMap] = useState<Map<string, ScrollState>>(new Map())

  const saveListScrollState = useCallback((key: string, state: StateSnapshot) => {
    scrollMap.set(key, state)
  }, [scrollMap])

  const getListScrollState = useCallback((key: string) => {
    const state = scrollMap.get(key)
    return state && 'ranges' in state ? state : undefined
  }, [scrollMap])

  const saveGridScrollState = useCallback((key: string, state: GridStateSnapshot) => {
    scrollMap.set(key, state)
  }, [scrollMap])

  const getGridScrollState = useCallback((key: string) => {
    const state = scrollMap.get(key)
    return state && 'item' in state ? state : undefined
  }, [scrollMap])

  const clearScrollState = useCallback((key: string) => {
    scrollMap.delete(key)
  }, [scrollMap])

  return (
    <ScrollMemoryContext.Provider value={{ saveListScrollState, getListScrollState, saveGridScrollState, getGridScrollState, clearScrollState }}>
      {children}
    </ScrollMemoryContext.Provider>
  )
}

export function useScrollMemory() {
  const context = useContext(ScrollMemoryContext)
  if (context === undefined) {
    throw new Error('useScrollMemory must be used within a ScrollMemoryProvider')
  }
  return context
}
