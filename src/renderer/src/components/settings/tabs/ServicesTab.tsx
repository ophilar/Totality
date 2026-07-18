import { useState, useEffect, useId } from 'react'
import {
  Eye,
  EyeOff,
  Save,
  Loader2,
  CheckCircle,
  XCircle,
  Trash2,
  Download,
  RefreshCw,
  Plus,
  ChevronDown,
  Film,
  Wrench,
  Network,
  Circle,
  Bot,
  Music,
} from 'lucide-react'

interface ServiceCardProps {
  title: string
  description: string
  icon: React.ReactNode
  status: 'configured' | 'partial' | 'not-configured'
  statusText: string
  expanded: boolean
  onToggle: () => void
  children: React.ReactNode
  enableToggle?: {
    enabled: boolean
    onToggle: () => void
    id: string
  }
}

function ServiceCard({
  title,
  description,
  icon,
  status,
  statusText,
  expanded,
  onToggle,
  children,
  enableToggle,
}: ServiceCardProps) {
  return (
    <div className="border border-border/40 rounded-lg overflow-hidden bg-card/30">
      <div className="flex items-center gap-3 p-4 hover:bg-muted/30 transition-colors">
        <button
          onClick={onToggle}
          className="flex items-center gap-3 flex-1 min-w-0 text-left"
        >
          {/* Status indicator */}
          <div className="shrink-0">
            {status === 'configured' ? (
              <CheckCircle className="w-5 h-5 text-green-500" />
            ) : status === 'partial' ? (
              <CheckCircle className="w-5 h-5 text-amber-500" />
            ) : (
              <Circle className="w-5 h-5 text-muted-foreground/50" />
            )}
          </div>

          {/* Icon */}
          <div className="shrink-0 text-muted-foreground">{icon}</div>

          {/* Title and status */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm">{title}</span>
              <span className="text-xs text-muted-foreground">{statusText}</span>
            </div>
            <p className="text-xs text-muted-foreground truncate">{description}</p>
          </div>

        </button>

        {/* Enable toggle */}
        {enableToggle && (
          <button
            id={enableToggle.id}
            role="switch"
            aria-checked={enableToggle.enabled}
            onClick={(e) => { e.stopPropagation(); enableToggle.onToggle() }}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-hidden focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background ${
              enableToggle.enabled ? 'bg-primary' : 'bg-muted-foreground/30'
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-background shadow-md ring-1 ring-border/50 transition duration-200 ease-in-out ${
                enableToggle.enabled ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        )}

        {/* Expand indicator */}
        <button onClick={onToggle} className="p-1 shrink-0">
          <ChevronDown
            className={`w-4 h-4 text-muted-foreground transition-transform duration-200 ${
              expanded ? 'rotate-180' : ''
            }`}
          />
        </button>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="px-4 pb-4 pt-2 border-t border-border/30 bg-muted/10">{children}</div>
      )}
    </div>
  )
}

export function ServicesTab() {
  // Expanded state
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set())

  // TMDB state
  const [tmdbApiKey, setTmdbApiKey] = useState('')
  const [showTmdbKey, setShowTmdbKey] = useState(false)
  const [tmdbStatus, setTmdbStatus] = useState<'idle' | 'testing' | 'valid' | 'invalid'>('idle')
  const [originalTmdb, setOriginalTmdb] = useState('')

  // MusicBrainz state
  const [musicbrainzBaseUrl, setMusicbrainzBaseUrl] = useState('')
  const [musicbrainzStatus, setMusicbrainzStatus] = useState<'idle' | 'testing' | 'valid' | 'invalid'>('idle')
  const [originalMusicbrainzBaseUrl, setOriginalMusicbrainzBaseUrl] = useState('')

  // FFprobe state
  const [ffprobeAvailable, setFfprobeAvailable] = useState<boolean | null>(null)
  const [ffprobeBundled, setFfprobeBundled] = useState(false)
  const [ffprobeVersion, setFfprobeVersion] = useState<string | null>(null)
  const [ffprobeEnabled, setFfprobeEnabled] = useState(false)
  const [isInstalling, setIsInstalling] = useState(false)
  const [isUninstalling, setIsUninstalling] = useState(false)
  const [installProgress, setInstallProgress] = useState<{ stage: string; percent: number } | null>(
    null
  )
  const [ffprobeError, setFfprobeError] = useState<string | null>(null)
  const [latestVersion, setLatestVersion] = useState<string | null>(null)
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const [checkingUpdate, setCheckingUpdate] = useState(false)

  // Handbrake state
  const [handbrakeAvailable, setHandbrakeAvailable] = useState<boolean | null>(null)
  const [handbrakeVersion, setHandbrakeVersion] = useState<string | null>(null)
  const [handbrakePath, setHandbrakePath] = useState<string>('')
  const [handbrakeEnabled, setHandbrakeEnabled] = useState(false)

  // NFS Mappings state
  const [nfsMappings, setNfsMappings] = useState<Record<string, string>>({})
  const [originalNfsMappings, setOriginalNfsMappings] = useState<Record<string, string>>({})
  const [newNfsPath, setNewNfsPath] = useState('')
  const [newLocalPath, setNewLocalPath] = useState('')
  const [testingMappings, setTestingMappings] = useState<Set<string>>(new Set())
  const [testResults, setTestResults] = useState<
    Record<
      string,
      {
        success: boolean
        error?: string
        folderCount?: number
        fileCount?: number
        message?: string
      }
    >
  >({})

  // Gemini AI state
  const [geminiApiKey, setGeminiApiKey] = useState('')
  const [showGeminiKey, setShowGeminiKey] = useState(false)
  const [geminiStatus, setGeminiStatus] = useState<'idle' | 'testing' | 'valid' | 'invalid'>('idle')
  const [geminiError, setGeminiError] = useState<string | null>(null)
  const [originalGemini, setOriginalGemini] = useState('')
  const [geminiModel, setGeminiModel] = useState('gemini-2.5-flash')
  const [originalGeminiModel, setOriginalGeminiModel] = useState('gemini-2.5-flash')
  const [availableModels, setAvailableModels] = useState<Array<{ name: string; displayName: string }>>([
    { name: 'gemini-2.5-flash', displayName: 'Gemini 2.5 Flash (Recommended)' },
    { name: 'gemini-2.5-pro', displayName: 'Gemini 2.5 Pro (Most capable)' }
  ])
  const [aiEnabled, setAiEnabled] = useState(true)

  // General state
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)

  const tmdbId = useId()
  const musicbrainzId = useId()
  const toggleId = useId()
  const geminiId = useId()
  const geminiModelId = useId()
  const aiToggleId = useId()

  const toggleCard = (card: string) => {
    setExpandedCards((prev) => {
      const next = new Set(prev)
      if (next.has(card)) {
        next.delete(card)
      } else {
        next.add(card)
      }
      return next
    })
  }

  useEffect(() => {
    loadSettings()
  }, [])

  useEffect(() => {
    const tmdbChanged = tmdbApiKey !== originalTmdb
    const nfsChanged = JSON.stringify(nfsMappings) !== JSON.stringify(originalNfsMappings)
    const geminiChanged = geminiApiKey !== originalGemini || geminiModel !== originalGeminiModel
    const musicbrainzChanged = musicbrainzBaseUrl !== originalMusicbrainzBaseUrl
    setHasChanges(tmdbChanged || nfsChanged || geminiChanged || musicbrainzChanged)
  }, [tmdbApiKey, originalTmdb, nfsMappings, originalNfsMappings, geminiApiKey, originalGemini, geminiModel, originalGeminiModel, musicbrainzBaseUrl, originalMusicbrainzBaseUrl])

  useEffect(() => {
    const cleanup = window.electronAPI.onFFprobeInstallProgress?.((progress: unknown) => {
      setInstallProgress(progress as { stage: string; percent: number })
    })
    return () => cleanup?.()
  }, [])

  const loadSettings = async () => {
    setIsLoading(true)
    try {
      const [allSettings, ffAvailable, ffBundled, ffVersion, transcodeAvail, hbVersion, nfsMaps] = await Promise.all([
        window.electronAPI.getAllSettings(),
        window.electronAPI.ffprobeIsAvailable(),
        window.electronAPI.ffprobeIsBundled(),
        window.electronAPI.ffprobeGetVersion().catch(() => null),
        window.electronAPI.checkAvailability(),
        window.electronAPI.handbrakeGetVersion().catch(() => null),
        window.electronAPI.getNfsMappings(),
      ])

      const tmdb = allSettings.tmdb_api_key || ''
      setTmdbApiKey(tmdb)
      setOriginalTmdb(tmdb)
      if (tmdb) {
        setTmdbStatus('valid')
      }

      const mbBaseUrl = allSettings.musicbrainz_base_url || 'https://musicbrainz.org/ws/2'
      setMusicbrainzBaseUrl(mbBaseUrl)
      setOriginalMusicbrainzBaseUrl(mbBaseUrl)
      if (mbBaseUrl) {
        setMusicbrainzStatus('valid')
      }

      const gemini = allSettings.gemini_api_key || ''
      setGeminiApiKey(gemini)
      setOriginalGemini(gemini)
      if (gemini) {
        setGeminiStatus('valid')
        const models = await window.electronAPI.aiGetAvailableModels().catch(() => [])
        if (models && models.length > 0) {
          setAvailableModels(models)
        }
      }
      const model = allSettings.gemini_model || 'gemini-2.5-flash'
      setGeminiModel(model)
      setOriginalGeminiModel(model)
      setAiEnabled(allSettings.ai_enabled !== 'false')

      setFfprobeAvailable(ffAvailable)
      setFfprobeBundled(ffBundled)
      setFfprobeVersion(ffVersion)
      setFfprobeEnabled(allSettings.ffprobe_enabled === 'true')

      setHandbrakeAvailable(transcodeAvail.handbrake)
      setHandbrakeVersion(hbVersion)
      setHandbrakePath(allSettings.handbrake_path || '')
      setHandbrakeEnabled(allSettings.handbrake_enabled !== 'false')

      setNfsMappings(nfsMaps || {})
      setOriginalNfsMappings(nfsMaps || {})
    } catch (error) {
      window.electronAPI.log.error('[ServicesTab]', 'Failed to load settings:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleTestTmdb = async () => {
    if (!tmdbApiKey.trim()) return
    setTmdbStatus('testing')
    try {
      const response = await fetch(
        `https://api.themoviedb.org/3/configuration?api_key=${tmdbApiKey}`
      )
      setTmdbStatus(response.ok ? 'valid' : 'invalid')
    } catch {
      setTmdbStatus('invalid')
    }
  }

  const handleTestGemini = async () => {
    if (!geminiApiKey.trim()) return
    setGeminiStatus('testing')
    setGeminiError(null)
    try {
      const result = await window.electronAPI.aiTestApiKey(geminiApiKey)
      if (result.success) {
        setGeminiStatus('valid')
        const models = await window.electronAPI.aiGetAvailableModels().catch(() => [])
        if (models && models.length > 0) {
          setAvailableModels(models)
        }
      } else {
        setGeminiStatus('invalid')
        setGeminiError(result.error || 'Invalid API key')
      }
    } catch {
      setGeminiStatus('invalid')
      setGeminiError('Failed to test API key')
    }
  }

  const handleSave = async () => {
    setIsSaving(true)
    try {
      await Promise.all([
        window.electronAPI.setSetting('tmdb_api_key', tmdbApiKey),
        window.electronAPI.setNfsMappings(nfsMappings),
        window.electronAPI.setSetting('gemini_api_key', geminiApiKey),
        window.electronAPI.setSetting('gemini_model', geminiModel),
        window.electronAPI.setSetting('musicbrainz_base_url', musicbrainzBaseUrl),
      ])
      setOriginalTmdb(tmdbApiKey)
      setOriginalNfsMappings({ ...nfsMappings })
      setOriginalGemini(geminiApiKey)
      setOriginalGeminiModel(geminiModel)
      setOriginalMusicbrainzBaseUrl(musicbrainzBaseUrl)
      setHasChanges(false)
    } catch (error) {
      window.electronAPI.log.error('[ServicesTab]', 'Failed to save settings:', error)
    } finally {
      setIsSaving(false)
    }
  }

  const handleTestMusicbrainz = async () => {
    if (!musicbrainzBaseUrl.trim()) return
    setMusicbrainzStatus('testing')
    try {
      const response = await fetch(
        `${musicbrainzBaseUrl}/artist?query=Beatles&limit=1`,
        { headers: { 'Accept': 'application/json' } }
      )
      setMusicbrainzStatus(response.ok ? 'valid' : 'invalid')
    } catch {
      setMusicbrainzStatus('invalid')
    }
  }

  const handleAddNfsMapping = () => {
    if (!newNfsPath.trim() || !newLocalPath.trim()) return
    setNfsMappings((prev) => ({
      ...prev,
      [newNfsPath.trim()]: newLocalPath.trim(),
    }))
    setNewNfsPath('')
    setNewLocalPath('')
  }

  const handleRemoveNfsMapping = (nfsPath: string) => {
    setNfsMappings((prev) => {
      const updated = { ...prev }
      delete updated[nfsPath]
      return updated
    })
    setTestResults((prev) => {
      const updated = { ...prev }
      delete updated[nfsPath]
      return updated
    })
  }

  const handleTestNfsMapping = async (nfsPath: string, localPath: string) => {
    setTestingMappings((prev) => new Set(prev).add(nfsPath))
    setTestResults((prev) => {
      const updated = { ...prev }
      delete updated[nfsPath]
      return updated
    })
    try {
      const result = await window.electronAPI.testNfsMapping(nfsPath, localPath)
      setTestResults((prev) => ({ ...prev, [nfsPath]: result }))
    } catch (err: unknown) {
      setTestResults((prev) => ({
        ...prev,
        [nfsPath]: { success: false, error: (err as Error).message || 'Test failed' },
      }))
    } finally {
      setTestingMappings((prev) => {
        const updated = new Set(prev)
        updated.delete(nfsPath)
        return updated
      })
    }
  }


  const handleToggleHandbrake = async () => {
    const newValue = !handbrakeEnabled
    setHandbrakeEnabled(newValue)
    try {
      await window.electronAPI.setSetting('handbrake_enabled', newValue ? 'true' : 'false')
    } catch (error) {
      window.electronAPI.log.error('[ServicesTab]', 'Failed to save Handbrake setting:', error)
      setHandbrakeEnabled(!newValue)
    }
  }

  const handleToggleFFprobe = async () => {
    const newValue = !ffprobeEnabled
    setFfprobeEnabled(newValue)
    try {
      await window.electronAPI.setSetting('ffprobe_enabled', newValue ? 'true' : 'false')
    } catch (error) {
      window.electronAPI.log.error('[ServicesTab]', 'Failed to save FFprobe setting:', error)
      setFfprobeEnabled(!newValue)
    }
  }


  const handleInstallFFprobe = async () => {
    setIsInstalling(true)
    setFfprobeError(null)
    setInstallProgress({ stage: 'Starting...', percent: 0 })
    try {
      await window.electronAPI.ffprobeInstall()
      setUpdateAvailable(false)
      setLatestVersion(null)
      await loadSettings()
    } catch (err: unknown) {
      setFfprobeError((err as Error).message || 'Failed to install FFprobe')
    } finally {
      setIsInstalling(false)
      setInstallProgress(null)
    }
  }

  const handleUninstallFFprobe = async () => {
    if (!confirm('Are you sure you want to uninstall FFprobe?')) return
    setIsUninstalling(true)
    setFfprobeError(null)
    try {
      await window.electronAPI.ffprobeUninstall()
      setUpdateAvailable(false)
      setLatestVersion(null)
      await loadSettings()
    } catch (err: unknown) {
      setFfprobeError((err as Error).message || 'Failed to uninstall FFprobe')
    } finally {
      setIsUninstalling(false)
    }
  }

  const handleCheckForUpdate = async () => {
    setCheckingUpdate(true)
    setFfprobeError(null)
    try {
      const result = await window.electronAPI.ffprobeCheckForUpdate()
      if (result.error) {
        setFfprobeError(result.error)
      } else {
        setLatestVersion(result.latestVersion)
        setUpdateAvailable(result.updateAvailable)
        if (result.currentVersion) {
          setFfprobeVersion(result.currentVersion)
        }
      }
    } catch (err: unknown) {
      setFfprobeError((err as Error).message || 'Failed to check for updates')
    } finally {
      setCheckingUpdate(false)
    }
  }

  // Status calculations
  const tmdbConfigured = !!tmdbApiKey.trim()
  const ffprobeStatus: 'configured' | 'partial' | 'not-configured' = ffprobeAvailable
    ? ffprobeEnabled
      ? 'configured'
      : 'partial'
    : 'not-configured'

  const handbrakeStatus: 'configured' | 'partial' | 'not-configured' = handbrakeAvailable
    ? handbrakeEnabled
      ? 'configured'
      : 'partial'
    : 'not-configured'

  const nfsConfigured = Object.keys(nfsMappings).length > 0
  const geminiConfigured = !!geminiApiKey.trim() && aiEnabled

  const handleSelectHandbrakePath = async () => {
    const result = await window.electronAPI.localSelectFile({
      title: 'Select HandBrake CLI Executable',
      properties: ['openFile'],
      filters: [{ name: 'Executables', extensions: ['exe', 'app', ''] }]
    })
    if (!result.cancelled && result.filePath) {
      setHandbrakePath(result.filePath)
      try {
        await window.electronAPI.setSetting('handbrake_path', result.filePath)
        await loadSettings() // Reload to verify availability
      } catch (error) {
        window.electronAPI.log.error('[ServicesTab]', 'Failed to save HandBrake setting:', error)
      }
    }
  }

  const getHandbrakeStatusText = () => {
    if (!handbrakeAvailable) return 'Not configured'
    if (!handbrakeEnabled) return 'Installed but disabled'
    return handbrakeVersion ? `${handbrakeVersion}` : 'Configured'
  }

  const getFFprobeStatusText = () => {
    if (!ffprobeAvailable) return 'Not installed'
    if (!ffprobeEnabled) return 'Installed but disabled'
    return ffprobeVersion ? `v${ffprobeVersion}` : 'Enabled'
  }

  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="p-6 space-y-5 overflow-y-auto">
      {/* Header */}
      <div className="mb-4">
        <p className="text-xs text-muted-foreground">
          Configure external services and tools used for metadata and media analysis.
        </p>
      </div>

      {/* TMDB Card */}
      <ServiceCard
        title="TMDB API"
        description="Movie and TV metadata for completeness analysis"
        icon={<Film className="w-5 h-5" />}
        status={tmdbConfigured ? 'configured' : 'not-configured'}
        statusText={tmdbConfigured ? 'Configured' : 'Not configured'}
        expanded={expandedCards.has('tmdb')}
        onToggle={() => toggleCard('tmdb')}
      >
        <div className="space-y-3">
          <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  id={tmdbId}
                  type={showTmdbKey ? 'text' : 'password'}
                  value={tmdbApiKey}
                  onChange={(e) => {
                    setTmdbApiKey(e.target.value)
                    setTmdbStatus('idle')
                  }}
                  placeholder="Enter your TMDB API key"
                  className="w-full px-3 py-2 pr-10 bg-background border border-border/30 rounded-md text-sm focus:outline-hidden focus:ring-2 focus:ring-primary"
                />
                <button
                  type="button"
                  onClick={() => setShowTmdbKey(!showTmdbKey)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
                  aria-label={showTmdbKey ? 'Hide API key' : 'Show API key'}
                >
                  {showTmdbKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <button
                onClick={handleTestTmdb}
                disabled={!tmdbApiKey.trim() || tmdbStatus === 'testing' || tmdbStatus === 'valid'}
                className={`px-3 py-2 rounded-md transition-colors disabled:opacity-50 flex items-center gap-2 ${
                  tmdbStatus === 'valid' ? 'text-green-500' :
                  tmdbStatus === 'invalid' ? 'text-red-500 bg-red-500/10' :
                  'text-sm bg-muted hover:bg-muted/80'
                }`}
                title={tmdbStatus === 'valid' ? 'API key is valid' : tmdbStatus === 'invalid' ? 'Invalid API key' : 'Test API key'}
              >
                {tmdbStatus === 'testing' ? <Loader2 className="w-4 h-4 animate-spin" /> :
                 tmdbStatus === 'valid' ? <CheckCircle className="w-4 h-4" /> :
                 tmdbStatus === 'invalid' ? <><XCircle className="w-4 h-4" /><span className="text-xs">Invalid</span></> :
                 <span className="text-sm">Test</span>}
              </button>
              {tmdbApiKey.trim() && (
                <button
                  onClick={() => {
                    setTmdbApiKey('')
                    setTmdbStatus('idle')
                  }}
                  className="px-3 py-2 text-sm text-muted-foreground hover:text-destructive rounded-md transition-colors"
                  aria-label="Clear TMDB API key"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          <p className="text-xs text-muted-foreground">
            Free API key from{' '}
            <button type="button" onClick={() => window.electronAPI.openExternal('https://www.themoviedb.org/settings/api')} className="text-primary hover:underline">themoviedb.org</button>
          </p>
        </div>
      </ServiceCard>


      {/* MusicBrainz Card */}
      <ServiceCard
        title="MusicBrainz API"
        description="Music metadata base URL for completeness analysis"
        icon={<Music className="w-5 h-5" />}
        status={musicbrainzBaseUrl ? 'configured' : 'not-configured'}
        statusText={musicbrainzBaseUrl ? 'Configured' : 'Not configured'}
        expanded={expandedCards.has('musicbrainz')}
        onToggle={() => toggleCard('musicbrainz')}
      >
        <div className="space-y-3">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                id={musicbrainzId}
                type="text"
                value={musicbrainzBaseUrl}
                onChange={(e) => {
                  setMusicbrainzBaseUrl(e.target.value)
                  setMusicbrainzStatus('idle')
                }}
                placeholder="Enter MusicBrainz API base URL"
                className="w-full px-3 py-2 pr-10 bg-background border border-border/30 rounded-md text-sm focus:outline-hidden focus:ring-2 focus:ring-primary"
              />
            </div>
            <button
              onClick={handleTestMusicbrainz}
              disabled={!musicbrainzBaseUrl.trim() || musicbrainzStatus === 'testing' || musicbrainzStatus === 'valid'}
              className={`px-3 py-2 rounded-md transition-colors disabled:opacity-50 flex items-center gap-2 ${
                musicbrainzStatus === 'valid' ? 'text-green-500' :
                musicbrainzStatus === 'invalid' ? 'text-red-500 bg-red-500/10' :
                'text-sm bg-muted hover:bg-muted/80'
              }`}
              title={musicbrainzStatus === 'valid' ? 'Base URL is valid' : musicbrainzStatus === 'invalid' ? 'Invalid Base URL' : 'Test Base URL'}
            >
              {musicbrainzStatus === 'testing' ? <Loader2 className="w-4 h-4 animate-spin" /> :
               musicbrainzStatus === 'valid' ? <CheckCircle className="w-4 h-4" /> :
               musicbrainzStatus === 'invalid' ? <><XCircle className="w-4 h-4" /><span className="text-xs">Invalid</span></> :
               <span className="text-sm">Test</span>}
            </button>
            {musicbrainzBaseUrl !== 'https://musicbrainz.org/ws/2' && (
              <button
                onClick={() => {
                  setMusicbrainzBaseUrl('https://musicbrainz.org/ws/2')
                  setMusicbrainzStatus('idle')
                }}
                className="px-3 py-2 text-sm text-muted-foreground hover:text-destructive rounded-md transition-colors"
                aria-label="Reset MusicBrainz API base URL"
                title="Reset to default URL"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Default endpoint:{' '}
            <button type="button" onClick={() => window.electronAPI.openExternal('https://musicbrainz.org')} className="text-primary hover:underline">musicbrainz.org</button>
          </p>
        </div>
      </ServiceCard>


      {/* HandBrake Card */}
      <ServiceCard
        title="HandBrake CLI"
        description="Used for AI-optimized video transcoding"
        icon={<Film className="w-5 h-5" />}
        status={handbrakeStatus}
        statusText={getHandbrakeStatusText()}
        expanded={expandedCards.has('handbrake')}
        onToggle={() => toggleCard('handbrake')}
        enableToggle={handbrakeAvailable ? { enabled: handbrakeEnabled, onToggle: handleToggleHandbrake, id: toggleId + '-hb' } : undefined}
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Executable Path</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={handbrakePath}
                onChange={(e) => setHandbrakePath(e.target.value)}
                onBlur={async () => {
                  await window.electronAPI.setSetting('handbrake_path', handbrakePath)
                  await loadSettings()
                }}
                placeholder="Leave empty to use system PATH"
                className="flex-1 px-3 py-1.5 text-sm bg-background border border-input rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <button
                onClick={handleSelectHandbrakePath}
                className="px-3 py-1.5 text-sm border border-input bg-background hover:bg-muted rounded-md transition-colors"
              >
                Browse...
              </button>
            </div>
            {!handbrakeAvailable && (
              <div className="text-xs text-muted-foreground mt-2">
                <p>HandBrakeCLI is not currently detected on your system. You can:</p>
                <ul className="list-disc list-inside mt-1 space-y-1">
                  <li>Download it from <button type="button" onClick={() => window.electronAPI.openExternal('https://handbrake.fr/downloads2.php')} className="text-primary hover:underline">handbrake.fr/downloads2.php</button></li>
                  <li>Extract the executable (HandBrakeCLI) to a standard path or specify its location above.</li>
                </ul>
              </div>
            )}
          </div>
        </div>
      </ServiceCard>

      {/* FFprobe Card */}
      <ServiceCard
        title="FFprobe"
        description="Extract codec, bitrate, and audio details from files"
        icon={<Wrench className="w-5 h-5" />}
        status={ffprobeStatus}
        statusText={getFFprobeStatusText()}
        expanded={expandedCards.has('ffprobe')}
        onToggle={() => toggleCard('ffprobe')}
        enableToggle={ffprobeAvailable ? { enabled: ffprobeEnabled, onToggle: handleToggleFFprobe, id: toggleId } : undefined}
      >
        <div className="space-y-3">

          {/* Installation controls */}
          <div className="flex items-center justify-between">
            {ffprobeVersion && (
              <span className="text-xs text-muted-foreground">v{ffprobeVersion}</span>
            )}
            {!ffprobeVersion && <span />}
            <div className="flex items-center gap-2">
              {ffprobeAvailable && (
                <button
                  onClick={handleCheckForUpdate}
                  disabled={checkingUpdate || isInstalling}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded transition-colors disabled:opacity-50 ${
                    latestVersion && !updateAvailable
                      ? 'text-green-500'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                  }`}
                  title="Check for updates"
                >
                  {checkingUpdate ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : latestVersion && !updateAvailable ? (
                    <CheckCircle className="w-3.5 h-3.5" />
                  ) : (
                    <RefreshCw className="w-3.5 h-3.5" />
                  )}
                  {checkingUpdate
                    ? 'Checking...'
                    : latestVersion && !updateAvailable
                      ? 'Up to date'
                      : 'Check for updates'}
                </button>
              )}
              {ffprobeAvailable && ffprobeBundled ? (
                <button
                  onClick={handleUninstallFFprobe}
                  disabled={isUninstalling || isInstalling}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded transition-colors disabled:opacity-50"
                >
                  {isUninstalling ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="w-3.5 h-3.5" />
                  )}
                  Uninstall
                </button>
              ) : ffprobeAvailable && !ffprobeBundled ? (
                <span className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-muted-foreground">
                  System installed
                </span>
              ) : (
                <button
                  onClick={handleInstallFFprobe}
                  disabled={isInstalling}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {isInstalling ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Download className="w-3.5 h-3.5" />
                  )}
                  Install (~80MB)
                </button>
              )}
            </div>
          </div>

          {/* Update Available */}
          {updateAvailable && latestVersion && (
            <div className="flex items-center justify-between p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
              <div className="flex items-center gap-2 text-amber-400">
                <RefreshCw className="w-4 h-4" />
                <span className="text-sm">Update available: v{latestVersion}</span>
              </div>
              <button
                onClick={handleInstallFFprobe}
                disabled={isInstalling}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-amber-500 text-black font-medium rounded hover:bg-amber-400 transition-colors disabled:opacity-50"
              >
                {isInstalling ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Download className="w-3.5 h-3.5" />
                )}
                Update
              </button>
            </div>
          )}

          {/* Install Progress */}
          {isInstalling && installProgress && (
            <div className="space-y-2">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{installProgress.stage}</span>
                <span>{installProgress.percent}%</span>
              </div>
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-300"
                  style={{ width: `${installProgress.percent}%` }}
                />
              </div>
            </div>
          )}


          {/* Error */}
          {ffprobeError && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-400">
              {ffprobeError}
            </div>
          )}

        </div>
      </ServiceCard>

      {/* Google Gemini AI Card */}
      <ServiceCard
        title="Google Gemini AI"
        description="Free AI-powered library insights, recommendations, and chat"
        icon={<Bot className="w-5 h-5" />}
        status={geminiConfigured ? 'configured' : 'not-configured'}
        statusText={geminiConfigured ? 'Configured' : 'Not configured'}
        expanded={expandedCards.has('gemini')}
        onToggle={() => toggleCard('gemini')}
        enableToggle={geminiApiKey.trim() ? {
          enabled: aiEnabled,
          onToggle: () => {
            const newValue = !aiEnabled
            setAiEnabled(newValue)
            window.electronAPI.setSetting('ai_enabled', String(newValue))
          },
          id: aiToggleId,
        } : undefined}
      >
        <div className="space-y-3">
          <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  id={geminiId}
                  type={showGeminiKey ? 'text' : 'password'}
                  value={geminiApiKey}
                  onChange={(e) => {
                    setGeminiApiKey(e.target.value)
                    setGeminiStatus('idle')
                    setGeminiError(null)
                  }}
                  placeholder="Enter your Gemini API key"
                  className="w-full px-3 py-2 pr-10 bg-background border border-border/30 rounded-md text-sm focus:outline-hidden focus:ring-2 focus:ring-primary"
                />
                <button
                  type="button"
                  onClick={() => setShowGeminiKey(!showGeminiKey)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
                  aria-label={showGeminiKey ? 'Hide API key' : 'Show API key'}
                >
                  {showGeminiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <button
                onClick={handleTestGemini}
                disabled={!geminiApiKey.trim() || geminiStatus === 'testing' || geminiStatus === 'valid'}
                className={`px-3 py-2 rounded-md transition-colors disabled:opacity-50 flex items-center gap-2 ${
                  geminiStatus === 'valid' ? 'text-green-500' :
                  geminiStatus === 'invalid' ? 'text-red-500 bg-red-500/10' :
                  'text-sm bg-muted hover:bg-muted/80'
                }`}
                title={geminiStatus === 'valid' ? 'API key is valid' : geminiStatus === 'invalid' ? (geminiError || 'Invalid API key') : 'Test API key'}
              >
                {geminiStatus === 'testing' ? <Loader2 className="w-4 h-4 animate-spin" /> :
                 geminiStatus === 'valid' ? <CheckCircle className="w-4 h-4" /> :
                 geminiStatus === 'invalid' ? <><XCircle className="w-4 h-4" /><span className="text-xs">Invalid</span></> :
                 <span className="text-sm">Test</span>}
              </button>
              {geminiApiKey.trim() && (
                <button
                  onClick={() => {
                    setGeminiApiKey('')
                    setGeminiStatus('idle')
                    setGeminiError(null)
                  }}
                  className="px-3 py-2 text-sm text-muted-foreground hover:text-destructive rounded-md transition-colors"
                  aria-label="Clear Gemini API key"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          <p className="text-xs text-muted-foreground">
            Free API key from{' '}
            <button type="button" onClick={() => window.electronAPI.openExternal('https://aistudio.google.com/apikey')} className="text-primary hover:underline">aistudio.google.com</button>
            {' '}(no credit card required)
          </p>

          <div className="space-y-2">
            <label htmlFor={geminiModelId} className="block text-xs font-medium text-muted-foreground">
              Model
            </label>
            <select
              id={geminiModelId}
              value={geminiModel}
              onChange={(e) => setGeminiModel(e.target.value)}
              className="w-full px-3 py-2 bg-background border border-border/30 rounded-md text-sm focus:outline-hidden focus:ring-2 focus:ring-primary"
            >
              {availableModels.map((m) => (
                <option key={m.name} value={m.name}>
                  {m.displayName}
                </option>
              ))}
            </select>
          </div>

        </div>
      </ServiceCard>

      {/* NFS Mappings Card */}
      <ServiceCard
        title="NFS Mount Mappings"
        description="Map Kodi NFS paths to local mount points"
        icon={<Network className="w-5 h-5" />}
        status={nfsConfigured ? 'configured' : 'not-configured'}
        statusText={
          nfsConfigured ? `${Object.keys(nfsMappings).length} mapping(s)` : 'No mappings'
        }
        expanded={expandedCards.has('nfs')}
        onToggle={() => toggleCard('nfs')}
      >
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Required for FFprobe to analyze files on NFS shares used by Kodi. Maps NFS URLs to local
            Windows paths.
          </p>

          {/* Existing Mappings */}
          {Object.keys(nfsMappings).length > 0 && (
            <div className="space-y-2">
              {Object.entries(nfsMappings).map(([nfsPath, localPath]) => {
                const isTesting = testingMappings.has(nfsPath)
                const testResult = testResults[nfsPath]
                return (
                  <div key={nfsPath} className="space-y-1">
                    <div className="flex items-center gap-2 p-2.5 bg-background/50 rounded-lg">
                      <code className="flex-1 text-xs truncate text-muted-foreground" title={nfsPath}>
                        nfs://{nfsPath}
                      </code>
                      <span className="text-muted-foreground/50">→</span>
                      <code className="flex-1 text-xs truncate" title={localPath}>
                        {localPath}
                      </code>
                      <button
                        onClick={() => handleTestNfsMapping(nfsPath, localPath)}
                        disabled={isTesting}
                        className="flex items-center gap-1 px-2 py-1 text-xs bg-muted hover:bg-muted/80 rounded transition-colors disabled:opacity-50"
                        title="Test mapping"
                      >
                        {isTesting ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <RefreshCw className="w-3 h-3" />
                        )}
                        Test
                      </button>
                      <button
                        onClick={() => handleRemoveNfsMapping(nfsPath)}
                        className="p-1 text-muted-foreground hover:text-destructive transition-colors"
                        title="Remove mapping"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    {testResult && (
                      <div
                        className={`flex items-center gap-2 px-2.5 py-1.5 text-xs rounded-lg ${
                          testResult.success
                            ? 'bg-green-500/10 text-green-500'
                            : 'bg-red-500/10 text-red-400'
                        }`}
                      >
                        {testResult.success ? (
                          <>
                            <CheckCircle className="w-3.5 h-3.5 shrink-0" />
                            <span>{testResult.message}</span>
                          </>
                        ) : (
                          <>
                            <XCircle className="w-3.5 h-3.5 shrink-0" />
                            <span>{testResult.error}</span>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* Add New Mapping */}
          <div className="space-y-2 p-3 bg-background/50 rounded-lg">
            <p className="text-xs font-medium text-muted-foreground">Add new mapping</p>
            <div className="flex items-end gap-2">
              <div className="flex-1 space-y-1">
                <label className="text-xs text-muted-foreground">NFS Path (without nfs://)</label>
                <input
                  type="text"
                  value={newNfsPath}
                  onChange={(e) => setNewNfsPath(e.target.value)}
                  placeholder="nas.local/media"
                  className="w-full px-3 py-2 bg-background border border-border/30 rounded-md text-sm focus:outline-hidden focus:ring-2 focus:ring-primary"
                />
              </div>
              <div className="flex-1 space-y-1">
                <label className="text-xs text-muted-foreground">Local Path</label>
                <input
                  type="text"
                  value={newLocalPath}
                  onChange={(e) => setNewLocalPath(e.target.value)}
                  placeholder="Z:\"
                  className="w-full px-3 py-2 bg-background border border-border/30 rounded-md text-sm focus:outline-hidden focus:ring-2 focus:ring-primary"
                />
              </div>
              <button
                onClick={handleAddNfsMapping}
                disabled={!newNfsPath.trim() || !newLocalPath.trim()}
                className="flex items-center gap-1 px-3 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                <Plus className="w-4 h-4" />
                Add
              </button>
            </div>
          </div>

          {Object.keys(nfsMappings).length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-2">
              No NFS mappings configured. Only needed if you use NFS shares with Kodi.
            </p>
          )}
        </div>
      </ServiceCard>

      {/* Save button */}
      {hasChanges && (
        <div className="flex justify-end pt-3">
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {isSaving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      )}
    </div>
  )
}
