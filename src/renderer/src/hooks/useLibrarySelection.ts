import { useState } from 'react'

interface LibraryIdentity {
  id: string
}

export function useLibrarySelection<TLibrary extends LibraryIdentity>(libraries: readonly TLibrary[]) {
  const [selectedLibraries, setSelectedLibraries] = useState<Set<string>>(new Set())

  const handleToggleLibrary = (libraryId: string) => {
    setSelectedLibraries(previous => {
      const next = new Set(previous)
      if (next.has(libraryId)) {
        next.delete(libraryId)
      } else {
        next.add(libraryId)
      }
      return next
    })
  }

  const handleSelectAll = () => {
    setSelectedLibraries(new Set(libraries.map(library => library.id)))
  }

  const handleDeselectAll = () => {
    setSelectedLibraries(new Set())
  }

  return {
    selectedLibraries,
    setSelectedLibraries,
    handleToggleLibrary,
    handleSelectAll,
    handleDeselectAll,
  }
}
