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
import { TranscodingHardwareCard } from '@/components/settings/TranscodingHardwareCard'
import { useToast } from '@/contexts/ToastContext'


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
  const { addToast } = useToast()
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

  // OMDb state
  const [omdbApiKey, setOmdbApiKey] = useState('')
  const [showOmdbKey, setShowOmdbKey] = useState(false)
  const [omdbStatus, setOmdbStatus] = useState<'idle' | 'testing' | 'valid' | 'invalid'>('idle')
  const [originalOmdb, setOriginalOmdb] = useState('')

  // TVDB state
  const [tvdbApiKey, setTvdbApiKey] = useState('')
  const [tvdbPin, setTvdbPin] = useState('')
  const [showTvdbKey, setShowTvdbKey] = useState(false)
  const [showTvdbPin, setShowTvdbPin] = useState(false)
  const [tvdbStatus, setTvdbStatus] = useState<'idle' | 'testing' | 'valid' | 'invalid'>('idle')
  const [originalTvdbApiKey, setOriginalTvdbApiKey] = useState('')
  const [originalTvdbPin, setOriginalTvdbPin] = useState('')

  const [sonarrUrl, setSonarrUrl] = useState('')
  const [sonarrKey, setSonarrKey] = useState('')
  const [radarrUrl, setRadarrUrl] = useState('')
  const [radarrKey, setRadarrKey] = useState('')
  const [originalSonarrUrl, setOriginalSonarrUrl] = useState('')
  const [originalSonarrKey, setOriginalSonarrKey] = useState('')
  const [originalRadarrUrl, setOriginalRadarrUrl] = useState('')
  const [originalRadarrKey, setOriginalRadarrKey] = useState('')
  const [arrStatus, setArrStatus] = useState<'idle' | 'testing' | 'valid' | 'invalid'>('idle')
  const [metadataProviderPreferences, setMetadataProviderPreferences] = useState('{"enabled":["tmdb","anilist","omdb","tvmaze","tvdb","musicbrainz"],"order":["tmdb","anilist","omdb","tvmaze","tvdb","musicbrainz"]}')
  const [originalMetadataProviderPreferences, setOriginalMetadataProviderPreferences] = useState('')
  const metadataProviders = ['tmdb', 'anilist', 'omdb', 'tvmaze', 'tvdb', 'musicbrainz']
  const metadataProviderLabels: Record<string, string> = { tmdb: 'TMDB', anilist: 'AniList', omdb: 'OMDb', tvmaze: 'TVmaze', tvdb: 'TVDB', musicbrainz: 'MusicBrainz' }
  const readProviderPreferences = () => {
    try {
      const parsed = JSON.parse(metadataProviderPreferences)
      return {
        enabled: metadataProviders.filter(id => parsed.enabled?.includes(id)),
        order: metadataProviders.filter(id => parsed.order?.includes(id)).concat(metadataProviders.filter(id => !parsed.order?.includes(id)))
      }
    } catch {
      return { enabled: metadataProviders, order: metadataProviders }
    }
  }
  const writeProviderPreferences = (enabled: string[], order: string[]) => setMetadataProviderPreferences(JSON.stringify({ enabled, order }))

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
  const omdbId = useId()
  const tvdbId = useId()
  const tvdbPinId = useId()
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
    const omdbChanged = omdbApiKey !== originalOmdb
    const tvdbChanged = tvdbApiKey !== originalTvdbApiKey || tvdbPin !== originalTvdbPin
    const arrChanged = sonarrUrl !== originalSonarrUrl || sonarrKey !== originalSonarrKey || radarrUrl !== originalRadarrUrl || radarrKey !== originalRadarrKey
    setHasChanges(tmdbChanged || nfsChanged || geminiChanged || musicbrainzChanged || omdbChanged || tvdbChanged || arrChanged || metadataProviderPreferences !== originalMetadataProviderPreferences)
  }, [tmdbApiKey, originalTmdb, nfsMappings, originalNfsMappings, geminiApiKey, originalGemini, geminiModel, originalGeminiModel, musicbrainzBaseUrl, originalMusicbrainzBaseUrl, omdbApiKey, originalOmdb, tvdbApiKey, originalTvdbApiKey, tvdbPin, originalTvdbPin, sonarrUrl, sonarrKey, radarrUrl, radarrKey, originalSonarrUrl, originalSonarrKey, originalRadarrUrl, originalRadarrKey, metadataProviderPreferences, originalMetadataProviderPreferences])

  useEffect(() => {
    const cleanup = window.electronAPI.onFFprobeInstallProgress?.((progress: unknown) => {
      setInstallProgress(progress as { stage: string; percent: number })
    })
    return () => cleanup?.()
  }, [])

  const loadSettings = async () => {
    setIsLoading(true)
    try {
      const [allSettings, ffAvailable, ffBundled, ffVersion, nfsMaps] = await Promise.all([
        window.electronAPI.getAllSettings(),
        window.electronAPI.ffprobeIsAvailable(),
        window.electronAPI.ffprobeIsBundled(),
        window.electronAPI.ffprobeGetVersion().catch(() => null),
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

      const omdb = allSettings.omdb_api_key || ''
      setOmdbApiKey(omdb)
      setOriginalOmdb(omdb)
      if (omdb) {
        setOmdbStatus('valid')
      }

      const tvdb = allSettings.tvdb_api_key || ''
      const tvdbPinValue = allSettings.tvdb_pin || ''
      setTvdbApiKey(tvdb)
      setOriginalTvdbApiKey(tvdb)
      setTvdbPin(tvdbPinValue)
      setOriginalTvdbPin(tvdbPinValue)
      if (tvdb) setTvdbStatus('valid')
      setSonarrUrl(allSettings.sonarr_url || '')
      setSonarrKey(allSettings.sonarr_api_key || '')
      setRadarrUrl(allSettings.radarr_url || '')
      setRadarrKey(allSettings.radarr_api_key || '')
      const providerPreferences = allSettings.metadata_provider_preferences || metadataProviderPreferences
      setMetadataProviderPreferences(providerPreferences)
      setOriginalMetadataProviderPreferences(providerPreferences)
      setOriginalSonarrUrl(allSettings.sonarr_url || '')
      setOriginalSonarrKey(allSettings.sonarr_api_key || '')
      setOriginalRadarrUrl(allSettings.radarr_url || '')
      setOriginalRadarrKey(allSettings.radarr_api_key || '')

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
        window.electronAPI.setSetting('omdb_api_key', omdbApiKey),
        window.electronAPI.setSetting('tvdb_api_key', tvdbApiKey),
        window.electronAPI.setSetting('tvdb_pin', tvdbPin),
        window.electronAPI.setSetting('sonarr_url', sonarrUrl),
        window.electronAPI.setSetting('sonarr_api_key', sonarrKey),
        window.electronAPI.setSetting('radarr_url', radarrUrl),
        window.electronAPI.setSetting('radarr_api_key', radarrKey),
        window.electronAPI.setSetting('metadata_provider_preferences', metadataProviderPreferences),
      ])
      setOriginalTmdb(tmdbApiKey)
      setOriginalNfsMappings({ ...nfsMappings })
      setOriginalGemini(geminiApiKey)
      setOriginalGeminiModel(geminiModel)
      setOriginalMusicbrainzBaseUrl(musicbrainzBaseUrl)
      setOriginalOmdb(omdbApiKey)
      setOriginalTvdbApiKey(tvdbApiKey)
      setOriginalTvdbPin(tvdbPin)
      setOriginalSonarrUrl(sonarrUrl)
      setOriginalSonarrKey(sonarrKey)
      setOriginalRadarrUrl(radarrUrl)
      setOriginalRadarrKey(radarrKey)
      setOriginalMetadataProviderPreferences(metadataProviderPreferences)
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

  const handleTestOmdb = async () => {
    if (!omdbApiKey.trim()) return
    setOmdbStatus('testing')
    try {
      const response = await fetch(
        `https://www.omdbapi.com/?apikey=${omdbApiKey}&t=test`
      )
      const data = await response.json()
      setOmdbStatus(data.Response === 'True' || data.Error === 'Movie not found!' ? 'valid' : 'invalid')
    } catch {
      setOmdbStatus('invalid')
    }
  }

  const handleTestTvdb = async () => {
    if (!tvdbApiKey.trim()) return
    setTvdbStatus('testing')
    try {
      const response = await fetch('https://api4.thetvdb.com/v4/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ apikey: tvdbApiKey, pin: tvdbPin || undefined })
      })
      setTvdbStatus(response.ok ? 'valid' : 'invalid')
    } catch { setTvdbStatus('invalid') }
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
  const omdbConfigured = !!omdbApiKey.trim()
  const ffprobeStatus: 'configured' | 'partial' | 'not-configured' = ffprobeAvailable
    ? ffprobeEnabled
      ? 'configured'
      : 'partial'
    : 'not-configured'

  const nfsConfigured = Object.keys(nfsMappings).length > 0
  const geminiConfigured = !!geminiApiKey.trim() && aiEnabled

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
      <TranscodingHardwareCard />
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

      {/* OMDb Card */}
      <ServiceCard
        title="OMDb API"
        description="Movie and TV metadata for ratings and additional info"
        icon={<Film className="w-5 h-5" />}
        status={omdbConfigured ? 'configured' : 'not-configured'}
        statusText={omdbConfigured ? 'Configured' : 'Not configured'}
        expanded={expandedCards.has('omdb')}
        onToggle={() => toggleCard('omdb')}
      >
        <div className="space-y-3">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                id={omdbId}
                type={showOmdbKey ? 'text' : 'password'}
                value={omdbApiKey}
                onChange={(e) => {
                  setOmdbApiKey(e.target.value)
                  setOmdbStatus('idle')
                }}
                placeholder="Enter your OMDb API key"
                className="w-full px-3 py-2 pr-10 bg-background border border-border/30 rounded-md text-sm focus:outline-hidden focus:ring-2 focus:ring-primary"
              />
              <button
                type="button"
                onClick={() => setShowOmdbKey(!showOmdbKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
                aria-label={showOmdbKey ? 'Hide API key' : 'Show API key'}
              >
                {showOmdbKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <button
              onClick={handleTestOmdb}
              disabled={!omdbApiKey.trim() || omdbStatus === 'testing' || omdbStatus === 'valid'}
              className={`px-3 py-2 rounded-md transition-colors disabled:opacity-50 flex items-center gap-2 ${
                omdbStatus === 'valid' ? 'text-green-500' :
                omdbStatus === 'invalid' ? 'text-red-500 bg-red-500/10' :
                'text-sm bg-muted hover:bg-muted/80'
              }`}
              title={omdbStatus === 'valid' ? 'API key is valid' : omdbStatus === 'invalid' ? 'Invalid API key' : 'Test API key'}
            >
              {omdbStatus === 'testing' ? <Loader2 className="w-4 h-4 animate-spin" /> :
               omdbStatus === 'valid' ? <CheckCircle className="w-4 h-4" /> :
               omdbStatus === 'invalid' ? <><XCircle className="w-4 h-4" /><span className="text-xs">Invalid</span></> :
               <span className="text-sm">Test</span>}
            </button>
            {omdbApiKey.trim() && (
              <button
                onClick={() => {
                  setOmdbApiKey('')
                  setOmdbStatus('idle')
                }}
                className="px-3 py-2 text-sm text-muted-foreground hover:text-destructive rounded-md transition-colors"
                aria-label="Clear OMDb API key"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Get an API key from{' '}
            <button type="button" onClick={() => window.electronAPI.openExternal('http://www.omdbapi.com/apikey.aspx')} className="text-primary hover:underline">omdbapi.com</button>
          </p>
        </div>
      </ServiceCard>


      {/* TVDB Card */}
      <ServiceCard
        title="TheTVDB API"
        description="TV metadata and external IDs; requires an API key"
        icon={<Film className="w-5 h-5" />}
        status={tvdbApiKey ? (tvdbStatus === 'invalid' ? 'partial' : 'configured') : 'not-configured'}
        statusText={tvdbApiKey ? (tvdbStatus === 'invalid' ? 'Invalid credentials' : 'Configured') : 'Not configured'}
        expanded={expandedCards.has('tvdb')}
        onToggle={() => toggleCard('tvdb')}
      >
        <div className="space-y-3">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input id={tvdbId} type={showTvdbKey ? 'text' : 'password'} value={tvdbApiKey} onChange={(e) => { setTvdbApiKey(e.target.value); setTvdbStatus('idle') }} placeholder="Enter TheTVDB API key" className="w-full px-3 py-2 pr-10 bg-background border border-border/30 rounded-md text-sm focus:outline-hidden focus:ring-2 focus:ring-primary" />
              <button type="button" onClick={() => setShowTvdbKey(!showTvdbKey)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground" aria-label={showTvdbKey ? 'Hide API key' : 'Show API key'}>{showTvdbKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>
            </div>
            <button onClick={handleTestTvdb} disabled={!tvdbApiKey.trim() || tvdbStatus === 'testing'} className="px-3 py-2 rounded-md bg-muted hover:bg-muted/80 disabled:opacity-50">{tvdbStatus === 'testing' ? <Loader2 className="w-4 h-4 animate-spin" /> : tvdbStatus === 'valid' ? <CheckCircle className="w-4 h-4 text-green-500" /> : tvdbStatus === 'invalid' ? <XCircle className="w-4 h-4 text-red-500" /> : 'Test'}</button>
          </div>
          <div className="relative">
            <input id={tvdbPinId} type={showTvdbPin ? 'text' : 'password'} value={tvdbPin} onChange={(e) => setTvdbPin(e.target.value)} placeholder="Optional subscriber PIN" className="w-full px-3 py-2 pr-10 bg-background border border-border/30 rounded-md text-sm focus:outline-hidden focus:ring-2 focus:ring-primary" />
            <button type="button" onClick={() => setShowTvdbPin(!showTvdbPin)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground" aria-label={showTvdbPin ? 'Hide subscriber PIN' : 'Show subscriber PIN'}>{showTvdbPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>
          </div>
          <p className="text-xs text-muted-foreground">Metadata provided by TheTVDB. Attribution is required for API results.</p>
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
                      <span className="text-muted-foreground/50">ΓåÆ</span>
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

      <ServiceCard
        title="Sonarr / Radarr"
        description="Optional release search and import integration"
        icon={<Bot className="w-5 h-5" />}
        status={sonarrUrl || radarrUrl ? (arrStatus === 'invalid' ? 'partial' : 'configured') : 'not-configured'}
        statusText={sonarrUrl || radarrUrl ? 'Configured' : 'Not configured'}
        expanded={expandedCards.has('arr')}
        onToggle={() => toggleCard('arr')}
      >
        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div><label className="text-xs text-muted-foreground">Sonarr URL</label><input value={sonarrUrl} onChange={(e) => setSonarrUrl(e.target.value)} placeholder="http://localhost:8989" className="w-full px-3 py-2 bg-background border border-border/30 rounded-md text-sm" /></div>
            <div><label className="text-xs text-muted-foreground">Sonarr API key</label><input type="password" value={sonarrKey} onChange={(e) => setSonarrKey(e.target.value)} className="w-full px-3 py-2 bg-background border border-border/30 rounded-md text-sm" /></div>
            <div><label className="text-xs text-muted-foreground">Radarr URL</label><input value={radarrUrl} onChange={(e) => setRadarrUrl(e.target.value)} placeholder="http://localhost:7878" className="w-full px-3 py-2 bg-background border border-border/30 rounded-md text-sm" /></div>
            <div><label className="text-xs text-muted-foreground">Radarr API key</label><input type="password" value={radarrKey} onChange={(e) => setRadarrKey(e.target.value)} className="w-full px-3 py-2 bg-background border border-border/30 rounded-md text-sm" /></div>
          </div>
          <div className="flex gap-2">
            <button 
              disabled={!sonarrUrl || !sonarrKey || arrStatus === 'testing'} 
              onClick={async () => { 
                setArrStatus('testing')
                try {
                  const result = await window.electronAPI.arrTestConnection('sonarr', { baseUrl: sonarrUrl, apiKey: sonarrKey })
                  setArrStatus(result.success ? 'valid' : 'invalid')
                  if (result.success) {
                    addToast({
                      type: 'success',
                      title: 'Sonarr Connected',
                      message: `Successfully reached Sonarr${result.version ? ` (v${result.version})` : ''}!`
                    })
                  } else {
                    addToast({
                      type: 'error',
                      title: 'Sonarr Connection Failed',
                      message: result.error || 'Check that Sonarr is running and API key is correct.'
                    })
                  }
                } catch (err: unknown) {
                  setArrStatus('invalid')
                  addToast({
                    type: 'error',
                    title: 'Sonarr Error',
                    message: err instanceof Error ? err.message : String(err)
                  })
                }
              }} 
              className="px-3 py-2 text-sm bg-muted hover:bg-muted/80 rounded-md disabled:opacity-50 transition-colors cursor-pointer"
            >
              {arrStatus === 'testing' ? 'Testing Sonarr...' : 'Test Sonarr'}
            </button>
            <button 
              disabled={!radarrUrl || !radarrKey || arrStatus === 'testing'} 
              onClick={async () => { 
                setArrStatus('testing')
                try {
                  const result = await window.electronAPI.arrTestConnection('radarr', { baseUrl: radarrUrl, apiKey: radarrKey })
                  setArrStatus(result.success ? 'valid' : 'invalid')
                  if (result.success) {
                    addToast({
                      type: 'success',
                      title: 'Radarr Connected',
                      message: `Successfully reached Radarr${result.version ? ` (v${result.version})` : ''}!`
                    })
                  } else {
                    addToast({
                      type: 'error',
                      title: 'Radarr Connection Failed',
                      message: result.error || 'Check that Radarr is running and API key is correct.'
                    })
                  }
                } catch (err: unknown) {
                  setArrStatus('invalid')
                  addToast({
                    type: 'error',
                    title: 'Radarr Error',
                    message: err instanceof Error ? err.message : String(err)
                  })
                }
              }} 
              className="px-3 py-2 text-sm bg-muted hover:bg-muted/80 rounded-md disabled:opacity-50 transition-colors cursor-pointer"
            >
              {arrStatus === 'testing' ? 'Testing Radarr...' : 'Test Radarr'}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">Search commands require explicit confirmation from the media action menu. Totality does not choose indexers or releases.</p>
        </div>
      </ServiceCard>

      <ServiceCard
        title="Metadata providers"
        description="Choose enabled providers and their fusion priority"
        icon={<Network className="w-5 h-5" />}
        status="configured"
        statusText="Fusion enabled"
        expanded={expandedCards.has('metadata-providers')}
        onToggle={() => toggleCard('metadata-providers')}
      >
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">All enabled providers contribute to metadata fusion. Order controls conflicting field precedence.</p>
          {(() => {
            const preferences = readProviderPreferences()
            return preferences.order.map((id, index) => (
              <div key={id} className="flex items-center gap-2 rounded-md border border-border/30 px-3 py-2">
                <input type="checkbox" checked={preferences.enabled.includes(id)} onChange={(e) => writeProviderPreferences(e.target.checked ? [...preferences.enabled, id] : preferences.enabled.filter(provider => provider !== id), preferences.order)} aria-label={`Enable ${metadataProviderLabels[id]}`} />
                <span className="flex-1 text-sm">{metadataProviderLabels[id]}</span>
                <button type="button" disabled={index === 0} onClick={() => { const order = [...preferences.order]; [order[index - 1], order[index]] = [order[index], order[index - 1]]; writeProviderPreferences(preferences.enabled, order) }} className="px-2 py-1 text-xs rounded bg-muted disabled:opacity-40" aria-label={`Move ${metadataProviderLabels[id]} up`}>Γåæ</button>
                <button type="button" disabled={index === preferences.order.length - 1} onClick={() => { const order = [...preferences.order]; [order[index], order[index + 1]] = [order[index + 1], order[index]]; writeProviderPreferences(preferences.enabled, order) }} className="px-2 py-1 text-xs rounded bg-muted disabled:opacity-40" aria-label={`Move ${metadataProviderLabels[id]} down`}>Γåô</button>
              </div>
            ))
          })()}
          <p className="text-xs text-muted-foreground">TMDB, TVDB, and OMDb use API credentials. AniList, TVmaze, and MusicBrainz do not require an API key.</p>
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
