import { useContext } from 'react'
import { SourceContext } from './SourceContextStore'

export function useSources() {
  const context = useContext(SourceContext)
  if (context === undefined) throw new Error('useSources must be used within a SourceProvider')
  return context
}

export function useSource(sourceId: string) {
  const { sources } = useSources()
  return sources.find(source => source.source_id === sourceId)
}
