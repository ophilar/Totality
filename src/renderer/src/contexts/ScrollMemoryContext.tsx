import React, { createContext, useContext, useState, useCallback } from 'react'

interface ScrollMemoryContextType {
  saveScrollState: (key: string, state: any) => void
  getScrollState: (key: string) => any | undefined
  clearScrollState: (key: string) => void
}

const ScrollMemoryContext = createContext<ScrollMemoryContextType | undefined>(undefined)

export function ScrollMemoryProvider({ children }: { children: React.ReactNode }) {
  const [scrollMap] = useState<Map<string, any>>(new Map())

  const saveScrollState = useCallback((key: string, state: any) => {
    scrollMap.set(key, state)
  }, [scrollMap])

  const getScrollState = useCallback((key: string) => {
    return scrollMap.get(key)
  }, [scrollMap])

  const clearScrollState = useCallback((key: string) => {
    scrollMap.delete(key)
  }, [scrollMap])

  return (
    <ScrollMemoryContext.Provider value={{ saveScrollState, getScrollState, clearScrollState }}>
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
