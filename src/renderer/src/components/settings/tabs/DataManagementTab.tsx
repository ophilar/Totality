/**
 * DataManagementTab - Settings tab for database and export management
 *
 * Features:
 * - Database location display
 * - Working document CSV export
 * - Full database backup/restore
 * - Database reset (danger zone)
 */

import { useState, useEffect, useRef } from 'react'
import { Loader2, FolderOpen, Download, Upload, Trash2, AlertTriangle, FileSpreadsheet, X, Database, RefreshCw } from 'lucide-react'

interface CSVExportOptions {
  includeUpgrades: boolean
  includeMissingMovies: boolean
  includeMissingEpisodes: boolean
  includeMissingAlbums: boolean
}

// Toggle switch component (matching MonitoringTab)
function Toggle({
  checked,
  onChange,
  disabled = false,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-hidden focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background ${
        disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
      } ${checked ? 'bg-primary' : 'bg-muted'}`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-background shadow-md ring-1 ring-border/50 transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  )
}

export function DataManagementTab() {
  const [dbPath, setDbPath] = useState<string>('')
  const [isLoading, setIsLoading] = useState(true)
  const [isExporting, setIsExporting] = useState(false)
  const [isExportingCSV, setIsExportingCSV] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [isResetting, setIsResetting] = useState(false)
  const [showResetConfirm, setShowResetConfirm] = useState(false)
  const [showCSVExportModal, setShowCSVExportModal] = useState(false)
  const [csvOptions, setCSVOptions] = useState<CSVExportOptions>({
    includeUpgrades: true,
    includeMissingMovies: true,
    includeMissingEpisodes: true,
    includeMissingAlbums: true,
  })
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null)
  const [activeOperation, setActiveOperation] = useState<{ requestId: string; label: string; state: 'running' | 'cancelling' | 'committing' } | null>(null)
  const activeOperationRef = useRef<typeof activeOperation>(null)

  const startOperation = (label: string) => {
    const operation = { requestId: crypto.randomUUID(), label, state: 'running' as const }
    activeOperationRef.current = operation
    setActiveOperation(operation)
    return operation.requestId
  }

  const finishOperation = (requestId: string) => {
    if (activeOperationRef.current?.requestId !== requestId) return
    activeOperationRef.current = null
    setActiveOperation(null)
  }

  const cancelOperation = async () => {
    const operation = activeOperationRef.current
    if (!operation || operation.state !== 'running') return
    activeOperationRef.current = { ...operation, state: 'cancelling' }
    setActiveOperation(activeOperationRef.current)
    const result = await window.electronAPI.dbCancelOperation(operation.requestId)
    if (result.status === 'committing') {
      activeOperationRef.current = { ...operation, state: 'committing' }
      setActiveOperation(activeOperationRef.current)
    }
  }

  const closeCSVExport = () => {
    if (activeOperationRef.current?.label === 'CSV export' && activeOperationRef.current.state === 'running') void cancelOperation()
    setShowCSVExportModal(false)
  }

  useEffect(() => () => {
    const operation = activeOperationRef.current
    if (operation) void window.electronAPI.dbCancelOperation(operation.requestId)
  }, [])

  useEffect(() => {
    queueMicrotask(() => {
      void Promise.resolve().then(() => window.electronAPI.dbGetPath()).then(setDbPath).catch((error: unknown) => {
        window.electronAPI.log.error('[DataManagementTab]', 'Failed to load database path:', error)
        setDbPath('Unable to load path')
      }).finally(() => setIsLoading(false))
    })
  }, [])

  const handleExport = async () => {
    const requestId = startOperation('Database export')
    setIsExporting(true)
    setMessage(null)
    try {
      const result = await window.electronAPI.dbExport(requestId)
      if (result.cancelled) {
        if (activeOperationRef.current?.state === 'cancelling') setMessage({ type: 'info', text: 'Export cancelled; temporary output removed.' })
      } else if (result.success) {
        setMessage({ type: 'success', text: `Database exported to: ${result.path}` })
      }
    } catch (error: unknown) {
      setMessage({ type: 'error', text: (error as Error).message || 'Failed to export database' })
    } finally {
      finishOperation(requestId)
      setIsExporting(false)
    }
  }

  const handleExportCSV = async () => {
    // Check if at least one option is selected
    if (!csvOptions.includeUpgrades && !csvOptions.includeMissingMovies &&
        !csvOptions.includeMissingEpisodes && !csvOptions.includeMissingAlbums) {
      setMessage({ type: 'error', text: 'Please select at least one section to export' })
      return
    }

    const requestId = startOperation('CSV export')
    setIsExportingCSV(true)
    setMessage(null)
    try {
      const result = await window.electronAPI.dbExportCSV(csvOptions, requestId)
      if (result.cancelled) {
        if (activeOperationRef.current?.state === 'cancelling') setMessage({ type: 'info', text: 'CSV export cancelled; temporary output removed.' })
      } else if (result.success) {
        setMessage({ type: 'success', text: `Working document exported to: ${result.path}` })
        setShowCSVExportModal(false)
      }
    } catch (error: unknown) {
      setMessage({ type: 'error', text: (error as Error).message || 'Failed to export CSV' })
    } finally {
      finishOperation(requestId)
      setIsExportingCSV(false)
    }
  }

  const handleImport = async () => {
    const requestId = startOperation('Database import')
    setIsImporting(true)
    setMessage(null)
    try {
      const result = await window.electronAPI.dbImport(requestId)
      if (result.cancelled) {
        if (activeOperationRef.current?.state === 'cancelling') setMessage({ type: 'info', text: 'Import cancelled before commit; no records were changed.' })
      } else if (result.success) {
        const errorText = result.errors && result.errors.length > 0
          ? ` (${result.errors.length} warnings)`
          : ''
        setMessage({
          type: 'success',
          text: `Imported ${result.imported} records successfully${errorText}. Please restart the app.`
        })
      }
    } catch (error: unknown) {
      setMessage({ type: 'error', text: (error as Error).message || 'Failed to import database' })
    } finally {
      finishOperation(requestId)
      setIsImporting(false)
    }
  }

  const handleReset = async () => {
    setIsResetting(true)
    setMessage(null)
    try {
      await window.electronAPI.dbReset()
      setMessage({ type: 'success', text: 'Database reset successfully. Please restart the app.' })
      setShowResetConfirm(false)
    } catch (error: unknown) {
      setMessage({ type: 'error', text: (error as Error).message || 'Failed to reset database' })
    } finally {
      setIsResetting(false)
    }
  }

  const toggleCSVOption = (key: keyof CSVExportOptions) => {
    setCSVOptions(prev => ({ ...prev, [key]: !prev[key] }))
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="p-6 space-y-5 overflow-y-auto">
      {/* Database Location Section */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-foreground">Database</h3>

        <div className="bg-muted/30 rounded-lg border border-border/40">
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-3 min-w-0">
              <Database className="w-5 h-5 text-muted-foreground shrink-0" />
              <div className="min-w-0">
                <span className="text-sm text-foreground">Database Location</span>
                <p className="text-xs text-muted-foreground truncate">{dbPath}</p>
              </div>
            </div>
            <button
              onClick={() => window.electronAPI.dbOpenFolder()}
              className="flex items-center gap-2 px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
            >
              <FolderOpen className="w-3.5 h-3.5" />
              Open Folder
            </button>
          </div>
        </div>
      </div>

      {/* Export Options */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-foreground">Export Options</h3>

        <div className="bg-muted/30 rounded-lg border border-border/40 divide-y divide-border/30">
          {/* Working Document */}
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-3">
              <FileSpreadsheet className="w-5 h-5 text-muted-foreground" />
              <div>
                <span className="text-sm text-foreground">Working Document</span>
                <p className="text-xs text-muted-foreground">
                  CSV with upgrade candidates and missing items
                </p>
              </div>
            </div>
            <button
              onClick={() => setShowCSVExportModal(true)}
              disabled={Boolean(activeOperation)}
              className="flex items-center gap-2 px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              Export
            </button>
          </div>

          {/* Full Backup */}
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-3">
              <FolderOpen className="w-5 h-5 text-muted-foreground" />
              <div>
                <span className="text-sm text-foreground">Full Backup</span>
                <p className="text-xs text-muted-foreground">
                  Complete database backup (JSON)
                </p>
              </div>
            </div>
            <button
              onClick={handleExport}
              disabled={Boolean(activeOperation)}
              className="flex items-center gap-2 px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {isExporting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Download className="w-3.5 h-3.5" />
              )}
              Export
            </button>
          </div>
        </div>
      </div>

      {/* Import Options */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-foreground">Import</h3>

        <div className="bg-muted/30 rounded-lg border border-border/40">
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-3">
              <Upload className="w-5 h-5 text-muted-foreground" />
              <div>
                <span className="text-sm text-foreground">Restore Backup</span>
                <p className="text-xs text-muted-foreground">
                  Import a previously exported database
                </p>
              </div>
            </div>
            <button
              onClick={handleImport}
              disabled={Boolean(activeOperation)}
              className="flex items-center gap-2 px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {isImporting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Upload className="w-3.5 h-3.5" />
              )}
              Import
            </button>
          </div>
        </div>
      </div>

      {/* Reset Database */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-foreground">Reset</h3>

        <div className="bg-muted/30 rounded-lg border border-border/40">
          {showResetConfirm ? (
            <div className="p-4 space-y-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-foreground">
                    Are you sure you want to reset the database?
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    This will permanently delete all your scanned media, quality scores, completeness data, and settings. This action cannot be undone.
                  </p>
                </div>
              </div>
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => setShowResetConfirm(false)}
                  disabled={isResetting}
                  className="px-3 py-1.5 text-xs hover:bg-muted rounded-md transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleReset}
                  disabled={isResetting}
                  className="flex items-center gap-2 px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {isResetting ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="w-3.5 h-3.5" />
                  )}
                  Yes, Reset Database
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-3">
                <Trash2 className="w-5 h-5 text-muted-foreground" />
                <div>
                  <span className="text-sm text-foreground">Reset Database</span>
                  <p className="text-xs text-muted-foreground">
                    Delete all data and start fresh
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowResetConfirm(true)}
                className="flex items-center gap-2 px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Reset
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Status message */}
      {activeOperation && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs" role="status">
          <span>{activeOperation.state === 'cancelling' ? `Cancelling ${activeOperation.label.toLowerCase()}…` : activeOperation.state === 'committing' ? `Finishing ${activeOperation.label.toLowerCase()}; its commit has started.` : `${activeOperation.label} in progress`}</span>
          {activeOperation.state === 'running' && <button onClick={() => void cancelOperation()} className="shrink-0 underline underline-offset-2">Cancel</button>}
        </div>
      )}

      {message && (
        <div
          className={`p-3 rounded-lg text-xs ${
          message.type === 'success'
            ? 'bg-green-500/10 border border-green-500/30 text-green-400'
            : message.type === 'info'
              ? 'bg-muted border border-border text-muted-foreground'
              : 'bg-red-500/10 border border-red-500/30 text-red-400'
          }`}
        >
          {message.text}
        </div>
      )}

      {/* CSV Export Modal */}
      {showCSVExportModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-background border border-border rounded-lg shadow-xl w-full max-w-md mx-4">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h2 className="text-base font-medium">Export Working Document</h2>
              <button
                onClick={closeCSVExport}
                disabled={activeOperation?.state === 'committing'}
                className="p-1 hover:bg-muted rounded transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-4 space-y-3">
              <p className="text-xs text-muted-foreground">
                Select what to include in the CSV export:
              </p>

              <div className="bg-muted/30 rounded-lg border border-border/40 divide-y divide-border/30">
                {/* Upgrade Candidates */}
                <div className="flex items-center justify-between px-4 py-2.5">
                  <div>
                    <span className="text-sm text-foreground">Upgrade Candidates</span>
                    <p className="text-xs text-muted-foreground">
                      Movies and episodes that need quality upgrades
                    </p>
                  </div>
                  <Toggle
                    checked={csvOptions.includeUpgrades}
                    onChange={() => toggleCSVOption('includeUpgrades')}
                    disabled={Boolean(activeOperation)}
                  />
                </div>

                {/* Missing Movies */}
                <div className="flex items-center justify-between px-4 py-2.5">
                  <div>
                    <span className="text-sm text-foreground">Missing Movies</span>
                    <p className="text-xs text-muted-foreground">
                      Movies missing from incomplete collections
                    </p>
                  </div>
                  <Toggle
                    checked={csvOptions.includeMissingMovies}
                    onChange={() => toggleCSVOption('includeMissingMovies')}
                    disabled={Boolean(activeOperation)}
                  />
                </div>

                {/* Missing Episodes */}
                <div className="flex items-center justify-between px-4 py-2.5">
                  <div>
                    <span className="text-sm text-foreground">Missing TV Episodes</span>
                    <p className="text-xs text-muted-foreground">
                      Episodes missing from incomplete TV series
                    </p>
                  </div>
                  <Toggle
                    checked={csvOptions.includeMissingEpisodes}
                    onChange={() => toggleCSVOption('includeMissingEpisodes')}
                    disabled={Boolean(activeOperation)}
                  />
                </div>

                {/* Missing Albums */}
                <div className="flex items-center justify-between px-4 py-2.5">
                  <div>
                    <span className="text-sm text-foreground">Missing Albums</span>
                    <p className="text-xs text-muted-foreground">
                      Albums missing from artist discographies
                    </p>
                  </div>
                  <Toggle
                    checked={csvOptions.includeMissingAlbums}
                    onChange={() => toggleCSVOption('includeMissingAlbums')}
                    disabled={Boolean(activeOperation)}
                  />
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex gap-3 justify-end p-4 border-t border-border">
              <button
                onClick={closeCSVExport}
                disabled={activeOperation?.state === 'cancelling' || activeOperation?.state === 'committing'}
                className="px-3 py-1.5 text-xs hover:bg-muted rounded-md transition-colors"
              >
                {activeOperation?.label === 'CSV export' ? activeOperation.state === 'running' ? 'Cancel export' : activeOperation.state === 'cancelling' ? 'Cancelling…' : 'Finishing…' : 'Cancel'}
              </button>
              <button
                onClick={handleExportCSV}
                disabled={Boolean(activeOperation)}
                className="flex items-center gap-2 px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {isExportingCSV ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Download className="w-3.5 h-3.5" />
                )}
                Export CSV
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
