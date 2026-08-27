import { createContext } from 'react'
import type { PanelContextType } from './PanelContext'

export const PanelContext = createContext<PanelContextType | undefined>(undefined)
