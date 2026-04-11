import { useState, useRef, useEffect } from 'react'
import { Lock, X, ArrowRight, ShieldCheck, AlertCircle } from 'lucide-react'
import { createPortal } from 'react-dom'

interface PinEntryModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
}

export function PinEntryModal({ isOpen, onClose, onSuccess }: PinEntryModalProps) {
  const [pin, setPin] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasPin, setHasPin] = useState<boolean | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isOpen) {
      // Check if a PIN is already set
      window.electronAPI.dbHasPin().then(setHasPin)
      
      // Focus input
      setTimeout(() => inputRef.current?.focus(), 100)
    } else {
      setPin('')
      setError(null)
    }
  }, [isOpen])

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (pin.length < 4) return

    setLoading(true)
    setError(null)

    try {
      if (hasPin === false) {
        // First time setting PIN
        await window.electronAPI.dbSetPin(pin)
        onSuccess()
      } else {
        // Verifying existing PIN
        const isValid = await window.electronAPI.dbVerifyPin(pin)
        if (isValid) {
          onSuccess()
        } else {
          setError('Invalid PIN. Please try again.')
          setPin('')
          inputRef.current?.focus()
        }
      }
    } catch (err) {
      setError('An error occurred. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (!isOpen) return null

  return createPortal(
    <div className="fixed inset-0 z-200 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-200">
      <div 
        className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="relative p-6 text-center border-b border-border/50">
          <button 
            onClick={onClose}
            className="absolute right-4 top-4 p-1 rounded-full hover:bg-muted text-muted-foreground transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
          
          <div className="mx-auto w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mb-4">
            <Lock className="w-6 h-6 text-primary" />
          </div>
          
          <h2 className="text-xl font-bold">
            {hasPin === false ? 'Set Security PIN' : 'Unlock Library'}
          </h2>
          <p className="text-sm text-muted-foreground mt-1 px-4">
            {hasPin === false 
              ? 'Create a PIN to protect your secret libraries and personal content.'
              : 'Enter your security PIN to view protected libraries.'}
          </p>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-8">
          <div className="space-y-6">
            <div className="relative">
              <input
                ref={inputRef}
                type="password"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={8}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="••••"
                className={`w-full text-center text-3xl tracking-[1em] py-4 bg-muted/30 border-2 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-primary transition-all ${
                  error ? 'border-destructive ring-destructive/20' : 'border-border'
                }`}
              />
              
              {error && (
                <div className="absolute -bottom-6 left-0 right-0 flex items-center justify-center gap-1.5 text-destructive text-xs animate-in slide-in-from-top-1">
                  <AlertCircle className="w-3.5 h-3.5" />
                  {error}
                </div>
              )}
            </div>

            <div className="flex flex-col gap-3 pt-2">
              <button
                type="submit"
                disabled={loading || pin.length < 4}
                className="w-full bg-primary text-primary-foreground py-3 rounded-xl font-bold flex items-center justify-center gap-2 hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <div className="w-5 h-5 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                ) : (
                  <>
                    {hasPin === false ? 'Save PIN' : 'Unlock'}
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
              
              <p className="text-[10px] text-center text-muted-foreground uppercase tracking-widest">
                <ShieldCheck className="w-3 h-3 inline mr-1 mb-0.5" /> Secure Session Lock
              </p>
            </div>
          </div>
        </form>
      </div>
    </div>,
    document.body
  )
}
