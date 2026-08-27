import { createContext } from 'react'
import type { ScrollMemoryContextType } from './ScrollMemoryContext'

export const ScrollMemoryContext = createContext<ScrollMemoryContextType | undefined>(undefined)
