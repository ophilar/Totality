
import React from 'react'

interface BrowserAlphabetNavProps {
  alphabetFilter: string | null
  scrollToLetter: (letter: string | null) => void
}

export const BrowserAlphabetNav: React.FC<BrowserAlphabetNavProps> = ({
  alphabetFilter,
  scrollToLetter
}) => {
  return (
    <div className="absolute right-3 top-0 bottom-0 flex flex-col items-center justify-between py-2" role="group" aria-label="Filter by letter">
      <button
        onClick={() => scrollToLetter(null)}
        className={`w-5 h-5 flex items-center justify-center text-[10px] font-medium transition-colors ${
          alphabetFilter === null ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
        }`}
        title="Show all"
      >
        All
      </button>
      <button
        onClick={() => scrollToLetter('#')}
        className={`w-5 h-5 flex items-center justify-center text-[10px] font-medium transition-colors ${
          alphabetFilter === '#' ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
        }`}
        title="Numbers and special characters"
      >
        #
      </button>
      {Array.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ').map((letter) => (
        <button
          key={letter}
          onClick={() => scrollToLetter(letter)}
          className={`w-5 h-5 flex items-center justify-center text-[10px] font-medium transition-colors ${
            alphabetFilter === letter ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {letter}
        </button>
      ))}
    </div>
  )
}
