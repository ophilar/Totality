/**
 * MediaMonkeyFlow Component
 *
 * UI flow for adding a MediaMonkey 5 database as a media source.
 */

import { useState } from 'react'
import { useSources } from '@/contexts/SourceContext'
import { Music } from 'lucide-react'

interface MediaMonkeyFlowProps {
  onSuccess: () => void
  onBack: () => void
}

export function MediaMonkeyFlow({ onSuccess, onBack }: MediaMonkeyFlowProps) {
  const { refreshSources } = useSources()

  // State
  const [databasePath, setDatabasePath] = useState('')
  const [displayName, setDisplayName] = useState('MediaMonkey 5')
  const [error, setError] = useState<string | null>(null)
  const [isConnecting, setIsConnecting] = useState(false)
  const [isConnected, setIsConnected] = useState(false)

  const handleSelectFile = async () => {
    try {
      const result = await window.electronAPI.localSelectFile({
        title: 'Select MediaMonkey 5 Database',
        filters: [{ name: 'SQLite Database', extensions: ['db'] }],
        properties: ['openFile']
      })

      if (!result.cancelled && result.filePath) {
        setDatabasePath(result.filePath)
        setError(null)
        setIsConnected(false)
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to select file')
    }
  }

  const handleTestConnection = async () => {
    if (!databasePath) {
      setError('Please select a database file first')
      return
    }

    setIsConnecting(true)
    setError(null)

    try {
      const result = await window.electronAPI.mediamonkeyTestConnection({
        databasePath
      })

      if (result.success) {
        setIsConnected(true)
      } else {
        setError(result.error || 'Failed to connect to MediaMonkey database')
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Connection test failed')
    } finally {
      setIsConnecting(false)
    }
  }

  const handleAdd = async () => {
    if (!databasePath) {
      setError('Please select a database file first')
      return
    }

    setIsConnecting(true)
    setError(null)

    try {
      const result = await window.electronAPI.mediamonkeyAddSource({
        displayName: displayName.trim() || 'MediaMonkey 5',
        databasePath,
        isEnabled: true
      })

      await refreshSources()

      // Queue initial scan
      try {
        const sourceId = result.source_id
        const libraries = await window.electronAPI.sourcesGetLibraries(sourceId)
        
        for (const lib of libraries) {
          await window.electronAPI.taskQueueAddTask({
            type: 'music-scan',
            label: `Initial scan: ${displayName} (${lib.name})`,
            sourceId,
            libraryId: lib.id,
          })
        }
      } catch (err) {
        window.electronAPI.log.error('[MediaMonkeyFlow]', 'Failed to queue initial scan:', err)
      }

      onSuccess()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to add MediaMonkey source')
    } finally {
      setIsConnecting(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Back button */}
      <button
        onClick={onBack}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back
      </button>

      <div className="p-3 rounded-lg bg-primary/5 border border-primary/30 flex items-center gap-3">
        <Music className="w-5 h-5 text-primary" />
        <div className="flex-1">
          <h3 className="text-sm font-medium">MediaMonkey 5</h3>
          <p className="text-xs text-muted-foreground">
            Connect directly to your MM5 database file (mm5.db).
          </p>
        </div>
      </div>

      {/* Database File Selection */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">Database File (mm5.db)</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={databasePath}
            readOnly
            placeholder="C:\Users\...\AppData\Roaming\MediaMonkey5\mm5.db"
            className="flex-1 px-2.5 py-1.5 text-sm bg-muted border border-border rounded outline-hidden focus:ring-1 focus:ring-primary"
          />
          <button
            onClick={handleSelectFile}
            className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded hover:bg-primary/90 transition-colors"
          >
            Browse
          </button>
        </div>
      </div>

      {/* Display Name */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">Display Name</label>
        <input
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="MediaMonkey 5"
          className="w-full px-2.5 py-1.5 text-sm bg-muted border border-border rounded outline-hidden focus:ring-1 focus:ring-primary"
        />
      </div>

      {/* Error Message */}
      {error && (
        <div className="p-2 rounded bg-destructive/10 border border-destructive/20">
          <p className="text-xs text-destructive">{error}</p>
        </div>
      )}

      {/* Connection Test Result */}
      {isConnected && !error && (
        <div className="p-2 rounded bg-green-500/10 border border-green-500/20">
          <p className="text-xs text-green-500">Connected successfully!</p>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex gap-2 pt-2">
        {!isConnected ? (
          <button
            onClick={handleTestConnection}
            disabled={isConnecting || !databasePath}
            className="flex-1 py-2 text-sm font-medium bg-muted text-foreground rounded hover:bg-muted/80 disabled:opacity-50 transition-colors"
          >
            {isConnecting ? 'Connecting...' : 'Test Connection'}
          </button>
        ) : (
          <button
            onClick={handleAdd}
            disabled={isConnecting}
            className="flex-1 py-2 text-sm font-medium bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {isConnecting ? 'Adding...' : 'Add Source'}
          </button>
        )}
      </div>
    </div>
  )
}
