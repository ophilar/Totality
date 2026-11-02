import React from 'react'
import { LibraryProvider } from '../src/renderer/src/contexts/LibraryContext'
import { SourceProvider } from '../src/renderer/src/contexts/SourceContext'
import { ToastProvider } from '../src/renderer/src/contexts/ToastContext'
import { ThemeProvider } from '../src/renderer/src/contexts/ThemeContext'
import { WishlistProvider } from '../src/renderer/src/contexts/WishlistContext'
import { NavigationProvider } from '../src/renderer/src/contexts/NavigationContext'
import { ScrollMemoryProvider } from '../src/renderer/src/contexts/ScrollMemoryContext'

export const TestProviders = ({ children }: { children: React.ReactNode }) => (
  <ToastProvider>
    <ThemeProvider>
      <SourceProvider>
        <WishlistProvider>
          <NavigationProvider>
            <ScrollMemoryProvider>
              <LibraryProvider>
                {children}
              </LibraryProvider>
            </ScrollMemoryProvider>
          </NavigationProvider>
        </WishlistProvider>
      </SourceProvider>
    </ThemeProvider>
  </ToastProvider>
)
