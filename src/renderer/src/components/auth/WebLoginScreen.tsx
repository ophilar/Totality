/**
 * WebLoginScreen
 *
 * PIN authentication screen shown when accessing via web browser.
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { Lock, AlertCircle } from 'lucide-react'
import { Button } from '../ui/Button'

interface WebLoginScreenProps {
  onAuthenticated: () => void
  authenticate: (pin: string) => Promise<string>
  logoSrc?: string
}

export function WebLoginScreen({ onAuthenticated, authenticate, logoSrc }: WebLoginScreenProps) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    if (!pin.trim() || loading) return

    setLoading(true)
    setError(null)

    try {
      await authenticate(pin)
      onAuthenticated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed')
      setPin('')
      inputRef.current?.focus()
    } finally {
      setLoading(false)
    }
  }, [pin, loading, authenticate, onAuthenticated])

  return (
    <div className="min-h-screen flex items-center justify-center bg-background text-foreground">
      <div className="w-full max-w-xs mx-auto px-6">
        {/* Logo */}
        <div className="text-center mb-8">
          {logoSrc ? (
            <img src={logoSrc} alt="Totality" className="h-20 mx-auto mb-4" />
          ) : (
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
              <Lock className="w-6 h-6 text-foreground" />
            </div>
          )}
          <p className="text-label text-muted-foreground">Enter PIN to access</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            ref={inputRef}
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="PIN"
            className="w-full px-4 py-3 h-12 text-center text-title tracking-widest bg-background border border-border/30 rounded-lg text-foreground placeholder:tracking-normal placeholder:text-label placeholder:text-muted-foreground focus:outline-hidden focus:ring-2 focus:ring-primary transition-colors"
            autoComplete="off"
            disabled={loading}
          />

          {error && (
            <div className="flex items-center justify-center gap-2 text-label text-destructive">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <Button
            type="submit"
            disabled={!pin.trim() || loading}
            loading={loading}
            size="lg"
            className="w-full"
          >
            {loading ? 'Verifying...' : 'Unlock'}
          </Button>
        </form>
      </div>
    </div>
  )
}
