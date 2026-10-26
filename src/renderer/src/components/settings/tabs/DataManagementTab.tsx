/**
 * DataManagementTab - Settings tab for database and export management
 *
 * Features:
 * - Database location display
 * - Working document CSV export
 * - Full database backup/restore
 * - Database reset (danger zone)
 */

import { useState, useEffect } from 'react'
import { Loader2, FolderOpen, Download, Upload, Trash2, AlertTriangle, FileSpreadsheet, X, Database, RefreshCw, HardDrive } from 'lucide-react'
import { Toggle } from '../../ui/Toggle'
import { Button, Card } from '../../ui'

interface CSVExportOptions {
  includeUpgrades: boolean
  includeMissingMovies: boolean
  includeMissingEpisodes: boolean
  includeMissingAlbums: boolean
  includeMusicUpgrades: boolean
}

export function DataManagementTab() {
  const [dbPath, setDbPath] = useState<string>('')
  const [isLoading, setIsLoading] = useState(true)
  const [isExporting, setIsExporting] = useState(false)
  const [isExportingCSV, setIsExportingCSV] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [isResetting, setIsResetting] = useState(false)
  const [showResetConfirm, setShowResetConfirm] = useState(false)
  const [isResettingLibrary, setIsResettingLibrary] = useState(false)
  const [showLibraryResetConfirm, setShowLibraryResetConfirm] = useState(false)
  const [showCSVExportModal, setShowCSVExportModal] = useState(false)
  useEffect(() => {
    if (!showCSVExportModal) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setShowCSVExportModal(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [showCSVExportModal])
  const [csvOptions, setCSVOptions] = useState<CSVExportOptions>({
    includeUpgrades: true,
    includeMissingMovies: true,
    includeMissingEpisodes: true,
    includeMissingAlbums: true,
    includeMusicUpgrades: true,
  })
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [storageData, setStorageData] = useState<{
    totalSize: number; totalItems: number
    byCodec: Array<{ codec: string; count: number; size: number }>
    byTier: Array<{ tier: string; count: number; size: number }>
    codecMigration: { h264Count: number; modernCount: number; totalCount: number }
    music?: { totalSize: number; totalTracks: number; byCodec: Array<{ codec: string; count: number; size: number }>; byTier: Array<{ tier: string; count: number; size: number }> }
    versionStats?: { itemsWithVersions: number; totalVersions: number; redundantSize: number; redundantCount: number }
  } | null>(null)
  const [duplicates, setDuplicates] = useState<Array<{
    tmdb_id: string; title: string; year: number | null
    copies: Array<{ id: number; source_type: string; resolution: string | null; video_codec: string | null; file_size: number | null; overall_score: number | null }>
  }>>([])

  useEffect(() => {
    loadDbPath()
  }, [])

  const loadDbPath = async () => {
    setIsLoading(true)
    try {
      const path = await window.electronAPI.dbGetPath()
      setDbPath(path)
    } catch (error) {
      console.error('Failed to load database path:', error)
      setDbPath('Unable to load path')
    } finally {
      setIsLoading(false)
    }
  }

  const handleExport = async () => {
    setIsExporting(true)
    setMessage(null)
    try {
      const result = await window.electronAPI.dbExport()
      if (result.cancelled) {
        // User cancelled, no message needed
      } else if (result.success) {
        setMessage({ type: 'success', text: `Database exported to: ${result.path}` })
      }
    } catch (error: unknown) {
      setMessage({ type: 'error', text: (error as Error).message || 'Failed to export database' })
    } finally {
      setIsExporting(false)
    }
  }

  const handleExportCSV = async () => {
    // Check if at least one option is selected
    if (!csvOptions.includeUpgrades && !csvOptions.includeMissingMovies &&
        !csvOptions.includeMissingEpisodes && !csvOptions.includeMissingAlbums &&
        !csvOptions.includeMusicUpgrades) {
      setMessage({ type: 'error', text: 'Please select at least one section to export' })
      return
    }

    setIsExportingCSV(true)
    setMessage(null)
    try {
      const result = await window.electronAPI.dbExportCSV(csvOptions)
      if (result.cancelled) {
        // User cancelled, no message needed
      } else if (result.success) {
        setMessage({ type: 'success', text: `Working document exported to: ${result.path}` })
        setShowCSVExportModal(false)
      }
    } catch (error: unknown) {
      setMessage({ type: 'error', text: (error as Error).message || 'Failed to export CSV' })
    } finally {
      setIsExportingCSV(false)
    }
  }

  const handleImport = async () => {
    setIsImporting(true)
    setMessage(null)
    try {
      const result = await window.electronAPI.dbImport()
      if (result.cancelled) {
        // User cancelled, no message needed
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

  const handleResetLibraryData = async () => {
    setIsResettingLibrary(true)
    setMessage(null)
    try {
      await window.electronAPI.dbResetLibraryData()
      setMessage({ type: 'success', text: 'Library data cleared. Settings, exclusions, and wishlist preserved. Please restart the app.' })
      setShowLibraryResetConfirm(false)
    } catch (error: unknown) {
      setMessage({ type: 'error', text: (error as Error).message || 'Failed to reset library data' })
    } finally {
      setIsResettingLibrary(false)
    }
  }

  const loadStorageAnalytics = async () => {
    try {
      const [analytics, dups] = await Promise.all([
        window.electronAPI.getStorageAnalytics(),
        window.electronAPI.getDuplicateMedia(),
      ])
      setStorageData(analytics)
      setDuplicates(dups)
    } catch (error) {
      console.error('Failed to load storage analytics:', error)
    }
  }

  // Load storage analytics on mount
  useEffect(() => {
    loadStorageAnalytics()
  }, [])

  const formatSize = (bytes: number): string => {
    if (bytes === 0) return '0 B'
    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(1024))
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
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
        <h3 className="text-label font-medium text-foreground">Database</h3>

        <Card variant="muted" padding="none">
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-3 min-w-0">
              <Database className="w-5 h-5 text-muted-foreground shrink-0" />
              <div className="min-w-0">
                <span className="text-label text-foreground">Database Location</span>
                <p className="text-caption text-muted-foreground truncate">{dbPath}</p>
              </div>
            </div>
            <Button
              variant="primary"
              size="sm"
              icon={<FolderOpen className="w-3.5 h-3.5" />}
              onClick={() => window.electronAPI.dbOpenFolder()}
            >
              Open Folder
            </Button>
          </div>
        </Card>
      </div>

      {/* Storage Analytics */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <HardDrive className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-label font-medium text-foreground">Storage Analytics</h3>
        </div>

        <Card variant="muted" className="space-y-4">
          {!storageData ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
              <>
                {/* Summary */}
                <div className="flex items-center gap-6 text-label">
                  <div>
                    <span className="text-muted-foreground">Total Size:</span>{' '}
                    <span className="font-medium">{formatSize(storageData.totalSize)}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Items:</span>{' '}
                    <span className="font-medium">{storageData.totalItems.toLocaleString()}</span>
                  </div>
                </div>

                {/* By Codec */}
                {storageData.byCodec.length > 0 && (
                  <div className="space-y-1">
                    <h4 className="text-caption font-medium text-muted-foreground">By Codec</h4>
                    <div className="space-y-1">
                      {storageData.byCodec.map(c => (
                        <div key={c.codec} className="flex items-center justify-between text-caption">
                          <span className="font-mono">{c.codec || 'Unknown'}</span>
                          <span className="text-muted-foreground">{c.count} items · {formatSize(c.size)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* By Quality Tier */}
                {storageData.byTier.length > 0 && (
                  <div className="space-y-1">
                    <h4 className="text-caption font-medium text-muted-foreground">By Quality Tier</h4>
                    <div className="space-y-1">
                      {storageData.byTier.map(t => (
                        <div key={t.tier} className="flex items-center justify-between text-caption">
                          <span>{t.tier}</span>
                          <span className="text-muted-foreground">{t.count} items · {formatSize(t.size)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Multi-Version Storage */}
                {storageData.versionStats && storageData.versionStats.itemsWithVersions > 0 && (
                  <div className="space-y-1">
                    <h4 className="text-caption font-medium text-muted-foreground">Multi-Version Items</h4>
                    <div className="space-y-1 text-caption">
                      <div className="flex items-center justify-between">
                        <span>Items with multiple versions</span>
                        <span className="text-muted-foreground">{storageData.versionStats.itemsWithVersions} items · {storageData.versionStats.totalVersions} versions</span>
                      </div>
                      {storageData.versionStats.redundantCount > 0 && (
                        <div className="flex items-center justify-between">
                          <span>Non-best versions</span>
                          <span className="text-muted-foreground">{storageData.versionStats.redundantCount} versions · {formatSize(storageData.versionStats.redundantSize)}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Music Storage */}
                {storageData.music && storageData.music.totalTracks > 0 && (
                  <div className="space-y-2 pt-2 border-t border-border/30">
                    <div className="flex items-center gap-6 text-label">
                      <div>
                        <span className="text-muted-foreground">Music:</span>{' '}
                        <span className="font-medium">{formatSize(storageData.music.totalSize)}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Tracks:</span>{' '}
                        <span className="font-medium">{storageData.music.totalTracks.toLocaleString()}</span>
                      </div>
                    </div>

                    {storageData.music.byCodec.length > 0 && (
                      <div className="space-y-1">
                        <h4 className="text-caption font-medium text-muted-foreground">Audio Codecs</h4>
                        <div className="space-y-1">
                          {storageData.music.byCodec.map(c => (
                            <div key={c.codec} className="flex items-center justify-between text-caption">
                              <span className="font-mono">{c.codec || 'Unknown'}</span>
                              <span className="text-muted-foreground">{c.count} tracks · {formatSize(c.size)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {storageData.music.byTier.length > 0 && (
                      <div className="space-y-1">
                        <h4 className="text-caption font-medium text-muted-foreground">Audio Quality</h4>
                        <div className="space-y-1">
                          {storageData.music.byTier.map(t => (
                            <div key={t.tier} className="flex items-center justify-between text-caption">
                              <span>{t.tier}</span>
                              <span className="text-muted-foreground">{t.count} tracks · {formatSize(t.size)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Duplicates */}
                {duplicates.length > 0 && (
                  <div className="space-y-1">
                    <h4 className="text-caption font-medium text-muted-foreground">Duplicate Movies ({duplicates.length})</h4>
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {duplicates.map(dup => (
                        <div key={dup.tmdb_id} className="text-caption border border-border/30 rounded p-2">
                          <div className="font-medium">{dup.title}{dup.year ? ` (${dup.year})` : ''}</div>
                          <div className="mt-1 space-y-0.5">
                            {dup.copies.map((copy, i) => (
                              <div key={i} className="flex items-center gap-2 text-muted-foreground">
                                <span className="capitalize">{copy.source_type}</span>
                                <span>{copy.resolution || '?'}</span>
                                <span className="font-mono">{copy.video_codec || '?'}</span>
                                {copy.file_size && <span>{formatSize(copy.file_size)}</span>}
                                {copy.overall_score != null && <span>Score: {Math.round(copy.overall_score)}</span>}
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </Card>
      </div>

      {/* Auto-Hide Rules — moved to Library tab */}

      {/* Export Options */}
      <div className="space-y-2">
        <h3 className="text-label font-medium text-foreground">Export Options</h3>

        <Card variant="muted" padding="none" className="divide-y divide-border/30">
          {/* Working Document */}
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-3">
              <FileSpreadsheet className="w-5 h-5 text-muted-foreground" />
              <div>
                <span className="text-label text-foreground">Working Document</span>
                <p className="text-caption text-muted-foreground">
                  CSV with upgrade candidates and missing items
                </p>
              </div>
            </div>
            <Button
              variant="primary"
              size="sm"
              icon={<Download className="w-3.5 h-3.5" />}
              onClick={() => setShowCSVExportModal(true)}
            >
              Export
            </Button>
          </div>

          {/* Full Backup */}
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-3">
              <FolderOpen className="w-5 h-5 text-muted-foreground" />
              <div>
                <span className="text-label text-foreground">Full Backup</span>
                <p className="text-caption text-muted-foreground">
                  Complete database backup (JSON)
                </p>
              </div>
            </div>
            <Button
              variant="primary"
              size="sm"
              icon={isExporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
              onClick={handleExport}
              disabled={isExporting}
            >
              Export
            </Button>
          </div>
        </Card>
      </div>

      {/* Import Options */}
      <div className="space-y-2">
        <h3 className="text-label font-medium text-foreground">Import</h3>

        <Card variant="muted" padding="none">
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-3">
              <Upload className="w-5 h-5 text-muted-foreground" />
              <div>
                <span className="text-label text-foreground">Restore Backup</span>
                <p className="text-caption text-muted-foreground">
                  Import a previously exported database
                </p>
              </div>
            </div>
            <Button
              variant="primary"
              size="sm"
              icon={isImporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
              onClick={handleImport}
              disabled={isImporting}
            >
              Import
            </Button>
          </div>
        </Card>
      </div>

      {/* Reset Options */}
      <div className="space-y-2">
        <h3 className="text-label font-medium text-foreground">Reset</h3>

        {/* Reset Library Data (preserves settings) */}
        <Card variant="muted" padding="none">
          {showLibraryResetConfirm ? (
            <div className="p-4 space-y-4">
              <div className="flex items-start gap-3">
                <RefreshCw className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />
                <div>
                  <p className="text-label font-medium text-foreground">
                    Reset library data?
                  </p>
                  <p className="text-caption text-muted-foreground mt-1">
                    This will clear all scanned media, quality scores, and completeness data. Your settings, API keys, sources, exclusions, and wishlist will be preserved.
                  </p>
                </div>
              </div>
              <div className="flex gap-3 justify-end">
                <Button
                  variant="tertiary"
                  size="sm"
                  onClick={() => setShowLibraryResetConfirm(false)}
                  disabled={isResettingLibrary}
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  icon={isResettingLibrary ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                  onClick={handleResetLibraryData}
                  disabled={isResettingLibrary}
                >
                  Yes, Reset Library Data
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-3">
                <RefreshCw className="w-5 h-5 text-muted-foreground" />
                <div>
                  <span className="text-label text-foreground">Reset Library Data</span>
                  <p className="text-caption text-muted-foreground">
                    Clear scanned media and start fresh. Keeps settings, exclusions, and wishlist.
                  </p>
                </div>
              </div>
              <Button
                variant="primary"
                size="sm"
                icon={<RefreshCw className="w-3.5 h-3.5" />}
                onClick={() => setShowLibraryResetConfirm(true)}
              >
                Reset
              </Button>
            </div>
          )}
        </Card>

        <Card variant="muted" padding="none">
          {showResetConfirm ? (
            <div className="p-4 space-y-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />
                <div>
                  <p className="text-label font-medium text-foreground">
                    Are you sure you want to reset the database?
                  </p>
                  <p className="text-caption text-muted-foreground mt-1">
                    This will permanently delete all your scanned media, quality scores, completeness data, and settings. This action cannot be undone.
                  </p>
                </div>
              </div>
              <div className="flex gap-3 justify-end">
                <Button
                  variant="tertiary"
                  size="sm"
                  onClick={() => setShowResetConfirm(false)}
                  disabled={isResetting}
                >
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  icon={isResetting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                  onClick={handleReset}
                  disabled={isResetting}
                >
                  Yes, Reset Database
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-3">
                <Trash2 className="w-5 h-5 text-muted-foreground" />
                <div>
                  <span className="text-label text-foreground">Reset Database</span>
                  <p className="text-caption text-muted-foreground">
                    Delete all data and start fresh
                  </p>
                </div>
              </div>
              <Button
                variant="danger-secondary"
                size="sm"
                icon={<Trash2 className="w-3.5 h-3.5" />}
                onClick={() => setShowResetConfirm(true)}
              >
                Reset
              </Button>
            </div>
          )}
        </Card>
      </div>

      {/* Status message */}
      {message && (
        <div
          className={`p-3 rounded-lg text-caption ${
            message.type === 'success'
              ? 'bg-green-500/10 border border-green-500/30 text-green-400'
              : 'bg-red-500/10 border border-red-500/30 text-red-400'
          }`}
        >
          {message.text}
        </div>
      )}

      {/* CSV Export Modal */}
      {showCSVExportModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowCSVExportModal(false)}>
          <div className="bg-background border border-border rounded-lg shadow-xl w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
            {/* Modal Header */}
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h2 className="text-body font-medium">Export Working Document</h2>
              <button
                onClick={() => setShowCSVExportModal(false)}
                className="p-1 hover:bg-muted rounded transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-4 space-y-3">
              <p className="text-caption text-muted-foreground">
                Select what to include in the CSV export:
              </p>

              <Card variant="muted" padding="none" className="divide-y divide-border/30">
                {/* Upgrade Candidates */}
                <div className="flex items-center justify-between px-4 py-2.5">
                  <div>
                    <span className="text-label text-foreground">Upgrade Candidates</span>
                    <p className="text-caption text-muted-foreground">
                      Movies and episodes that need quality upgrades
                    </p>
                  </div>
                  <Toggle
                    checked={csvOptions.includeUpgrades}
                    onChange={() => toggleCSVOption('includeUpgrades')}
                  />
                </div>

                {/* Missing Movies */}
                <div className="flex items-center justify-between px-4 py-2.5">
                  <div>
                    <span className="text-label text-foreground">Missing Movies</span>
                    <p className="text-caption text-muted-foreground">
                      Movies missing from incomplete collections
                    </p>
                  </div>
                  <Toggle
                    checked={csvOptions.includeMissingMovies}
                    onChange={() => toggleCSVOption('includeMissingMovies')}
                  />
                </div>

                {/* Missing Episodes */}
                <div className="flex items-center justify-between px-4 py-2.5">
                  <div>
                    <span className="text-label text-foreground">Missing TV Episodes</span>
                    <p className="text-caption text-muted-foreground">
                      Episodes missing from incomplete TV series
                    </p>
                  </div>
                  <Toggle
                    checked={csvOptions.includeMissingEpisodes}
                    onChange={() => toggleCSVOption('includeMissingEpisodes')}
                  />
                </div>

                {/* Missing Albums */}
                <div className="flex items-center justify-between px-4 py-2.5">
                  <div>
                    <span className="text-label text-foreground">Missing Albums</span>
                    <p className="text-caption text-muted-foreground">
                      Albums missing from artist discographies
                    </p>
                  </div>
                  <Toggle
                    checked={csvOptions.includeMissingAlbums}
                    onChange={() => toggleCSVOption('includeMissingAlbums')}
                  />
                </div>

                {/* Music Quality Upgrades */}
                <div className="flex items-center justify-between px-4 py-2.5">
                  <div>
                    <span className="text-label text-foreground">Music Quality Upgrades</span>
                    <p className="text-caption text-muted-foreground">
                      Albums that could benefit from higher quality versions
                    </p>
                  </div>
                  <Toggle
                    checked={csvOptions.includeMusicUpgrades}
                    onChange={() => toggleCSVOption('includeMusicUpgrades')}
                  />
                </div>
              </Card>
            </div>

            {/* Modal Footer */}
            <div className="flex gap-3 justify-end p-4 border-t border-border">
              <Button
                variant="tertiary"
                size="sm"
                onClick={() => setShowCSVExportModal(false)}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                icon={isExportingCSV ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                onClick={handleExportCSV}
                disabled={isExportingCSV}
              >
                Export CSV
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
