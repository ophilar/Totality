import { createContext } from 'react'
import type { LibraryContextType } from './LibraryContext'

export const LibraryContext = createContext<LibraryContextType | undefined>(undefined)
