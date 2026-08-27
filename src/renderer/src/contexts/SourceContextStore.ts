import { createContext } from 'react'
import type { SourceContextType } from './SourceContext'

export const SourceContext = createContext<SourceContextType | undefined>(undefined)
