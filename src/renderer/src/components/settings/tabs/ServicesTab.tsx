import { useState, useEffect, useId, useCallback, useRef } from 'react'
import {
  Eye,
  EyeOff,
  Save,
  Loader2,
  CheckCircle,
  XCircle,
  Trash2,
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
import type { SavedServiceHealthSnapshot, SavedServiceId } from '@shared/serviceHealth'


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

function savedHealthText(snapshot: SavedServiceHealthSnapshot | null, service: SavedServiceId): string {
  const health = snapshot?.[service]
  if (!health || health.status === 'not-configured') return 'Not configured'
  if (health.status === 'checking') return 'Checking saved configuration…'
  const status = health.status === 'valid' ? 'Available' : health.status.replace(/-/g, ' ')
  const testedAt = health.testedAt ? ` · Checked ${new Date(health.testedAt).toLocaleTimeString()}` : ''
  return `${status}${testedAt}${health.message ? ` · ${health.message}` : ''}`
}

function savedHealthLabel(snapshot: SavedServiceHealthSnapshot | null, service: SavedServiceId, configured: boolean): string {
  if (!configured) return 'Not configured'
  const status = snapshot?.[service].status
  if (!status || status === 'not-configured') return 'Saved · not tested'
  if (status === 'checking') return 'Checking'
  if (status === 'valid') return 'Available'
  if (status === 'invalid-credential') return 'Invalid credentials'
  if (status === 'permission-denied') return 'Permission denied'
  return status.replace(/-/g, ' ')
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
  const [tmdbStatus, setTmdbStatus] = useState<'idle' | 'saved-unverified' | 'testing' | 'valid' | 'invalid' | 'unavailable' | 'timed-out' | 'cancelled'>('idle')
  const [originalTmdb, setOriginalTmdb] = useState('')
  const tmdbTestRequestId = useRef<string | null>(null)
  const [tmdbTestedAt, setTmdbTestedAt] = useState<string | null>(null)

  useEffect(() => {
    if (tmdbApiKey !== originalTmdb) return
    let active = true
    let revision = -1
    const apply = (state: Awaited<ReturnType<typeof window.electronAPI.tmdbGetValidationState>>) => {
      if (!active || state.revision < revision || tmdbTestRequestId.current) return
      revision = state.revision
      setTmdbStatus(state.status)
      setTmdbTestedAt(state.testedAt)
    }
    const unsubscribe = window.electronAPI.onTmdbValidationChanged(apply)
    void window.electronAPI.tmdbGetValidationState().then(apply).catch(error => {
      if (active) addToast({ type: 'error', title: 'Unable to load TMDB validation status', message: String(error) })
    })
    return () => { active = false; unsubscribe() }
  }, [tmdbApiKey, originalTmdb, addToast])

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
  const [savedProviderHealth, setSavedProviderHealth] = useState<SavedServiceHealthSnapshot | null>(null)
  const arrStatus = savedProviderHealth?.sonarr.status === 'checking' || savedProviderHealth?.radarr.status === 'checking'
    ? 'testing'
    : [savedProviderHealth?.sonarr.status, savedProviderHealth?.radarr.status].some(status => status && !['not-configured', 'valid'].includes(status))
      ? 'invalid'
      : [savedProviderHealth?.sonarr.status, savedProviderHealth?.radarr.status].some(status => status === 'valid')
        ? 'valid'
        : 'idle'
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
  const [ffprobeVersion, setFfprobeVersion] = useState<string | null>(null)
  const [ffprobeEnabled, setFfprobeEnabled] = useState(false)

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
  const [geminiStatus, setGeminiStatus] = useState<'idle' | 'saved-unverified' | 'testing' | 'valid' | 'invalid' | 'unavailable' | 'rate-limited' | 'timed-out' | 'cancelled'>('idle')
  const [geminiTestedAt, setGeminiTestedAt] = useState<string | null>(null)
  const [geminiModelAvailable, setGeminiModelAvailable] = useState<boolean | null>(null)
  const [geminiError, setGeminiError] = useState<string | null>(null)
  const [originalGemini, setOriginalGemini] = useState('')
  const [geminiModel, setGeminiModel] = useState('gemini-2.5-flash')
  const [originalGeminiModel, setOriginalGeminiModel] = useState('gemini-2.5-flash')
  const [availableModels, setAvailableModels] = useState<Array<{ name: string; displayName: string }>>([])
  const [aiEnabled, setAiEnabled] = useState(true)

  // General state
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)
  const [isSavingTmdb, setIsSavingTmdb] = useState(false)

  const tmdbId = useId()
  const musicbrainzId = useId()
  const omdbId = useId()
  const tvdbId = useId()
  const tvdbPinId = useId()
  const toggleId = useId()
  const geminiId = useId()
  const geminiModelId = useId()
  const aiToggleId = useId()

  useEffect(() => {
    if (geminiApiKey !== originalGemini || geminiModel !== originalGeminiModel) return
    let active = true
    let revision = -1
    const apply = (state: Awaited<ReturnType<typeof window.electronAPI.aiGetValidationState>>) => {
      if (!active || state.revision < revision) return
      revision = state.revision
      setGeminiStatus(state.status)
      setGeminiTestedAt(state.testedAt)
      setGeminiModelAvailable(state.modelAvailable)
    }
    const unsubscribe = window.electronAPI.onAiValidationChanged(apply)
    void window.electronAPI.aiGetValidationState().then(apply).catch(error => {
      if (active) setGeminiError(error instanceof Error ? error.message : String(error))
    })
    return () => { active = false; unsubscribe() }
  }, [geminiApiKey, originalGemini, geminiModel, originalGeminiModel])

  useEffect(() => {
    let active = true
    const revisions = new Map<SavedServiceId, number>()
    const apply = (incoming: SavedServiceHealthSnapshot) => {
      if (!active) return
      setSavedProviderHealth(previous => {
        const next = { ...(previous ?? incoming) }
        for (const service of ['omdb', 'tvdb', 'musicbrainz', 'sonarr', 'radarr'] as const) {
          if (incoming[service].revision < (revisions.get(service) ?? -1)) continue
          revisions.set(service, incoming[service].revision)
          next[service] = incoming[service]
        }
        return next
      })
      const uiStatus = (service: SavedServiceId) => {
        const status = incoming[service].status
        return status === 'checking' ? 'testing' : status === 'valid' ? 'valid' : status === 'not-configured' ? 'idle' : 'invalid'
      }
      setOmdbStatus(uiStatus('omdb'))
      setTvdbStatus(uiStatus('tvdb'))
      setMusicbrainzStatus(uiStatus('musicbrainz'))
    }
    const unsubscribe = window.electronAPI.onSavedServiceHealthChanged(apply)
    void window.electronAPI.getSavedServiceHealth().then(apply).catch(error => {
      if (active) addToast({ type: 'error', title: 'Unable to load provider health', message: String(error) })
    })
    return () => { active = false; unsubscribe() }
  }, [addToast])

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
    const nfsChanged = JSON.stringify(nfsMappings) !== JSON.stringify(originalNfsMappings)
    const geminiChanged = geminiApiKey !== originalGemini || geminiModel !== originalGeminiModel
    const musicbrainzChanged = musicbrainzBaseUrl !== originalMusicbrainzBaseUrl
    const omdbChanged = omdbApiKey !== originalOmdb
    const tvdbChanged = tvdbApiKey !== originalTvdbApiKey || tvdbPin !== originalTvdbPin
    const arrChanged = sonarrUrl !== originalSonarrUrl || sonarrKey !== originalSonarrKey || radarrUrl !== originalRadarrUrl || radarrKey !== originalRadarrKey
    setHasChanges(nfsChanged || geminiChanged || musicbrainzChanged || omdbChanged || tvdbChanged || arrChanged || metadataProviderPreferences !== originalMetadataProviderPreferences)
  }, [tmdbApiKey, originalTmdb, nfsMappings, originalNfsMappings, geminiApiKey, originalGemini, geminiModel, originalGeminiModel, musicbrainzBaseUrl, originalMusicbrainzBaseUrl, omdbApiKey, originalOmdb, tvdbApiKey, originalTvdbApiKey, tvdbPin, originalTvdbPin, sonarrUrl, sonarrKey, radarrUrl, radarrKey, originalSonarrUrl, originalSonarrKey, originalRadarrUrl, originalRadarrKey, metadataProviderPreferences, originalMetadataProviderPreferences])

  const loadSettings = useCallback(async () => {
    setIsLoading(true)
    try {
      const [allSettings, ffAvailable, ffVersion, nfsMaps] = await Promise.all([
        window.electronAPI.getAllSettings(),
        window.electronAPI.ffprobeIsAvailable(),
        window.electronAPI.ffprobeGetVersion().catch(() => null),
        window.electronAPI.getNfsMappings(),
      ])

      const tmdb = allSettings.tmdb_api_key || ''
      setTmdbApiKey(tmdb)
      setOriginalTmdb(tmdb)

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
      setGeminiStatus(gemini ? 'saved-unverified' : 'idle')
      const model = allSettings.gemini_model || 'gemini-2.5-flash'
      setGeminiModel(model)
      setOriginalGeminiModel(model)
      setAiEnabled(allSettings.ai_enabled !== 'false')

      setFfprobeAvailable(ffAvailable)
      setFfprobeVersion(ffVersion)
      setFfprobeEnabled(allSettings.ffprobe_enabled !== 'false' && ffAvailable)

      setNfsMappings(nfsMaps || {})
      setOriginalNfsMappings(nfsMaps || {})
    } catch (error) {
      window.electronAPI.log.error('[ServicesTab]', 'Failed to load settings:', error)
    } finally {
      setIsLoading(false)
    }
  }, [metadataProviderPreferences])

  useEffect(() => {
    void loadSettings()
  }, [loadSettings])

  useEffect(() => () => {
    const requestId = tmdbTestRequestId.current
    if (requestId) void window.electronAPI.tmdbCancelApiKeyTest(requestId)
  }, [])

  const cancelTmdbTest = async () => {
    const requestId = tmdbTestRequestId.current
    if (!requestId) return
    await window.electronAPI.tmdbCancelApiKeyTest(requestId)
    setTmdbStatus('cancelled')
    tmdbTestRequestId.current = null
  }

  const handleTestTmdb = async () => {
    if (!tmdbApiKey.trim() || tmdbTestRequestId.current) return
    const requestId = crypto.randomUUID()
    tmdbTestRequestId.current = requestId
    setTmdbStatus('testing')
    try {
      const result = await window.electronAPI.tmdbTestApiKey(tmdbApiKey.trim(), requestId)
      if (tmdbTestRequestId.current !== requestId) return
      setTmdbStatus(result === 'invalid-credential' ? 'invalid' : result)
      setTmdbTestedAt(new Date().toISOString())
    } catch (error) {
      if (tmdbTestRequestId.current !== requestId) return
      if (error instanceof Error && /timed out/i.test(error.message)) setTmdbStatus('timed-out')
      else if (error instanceof Error && error.name === 'AbortError') setTmdbStatus('cancelled')
      else setTmdbStatus('unavailable')
    } finally {
      if (tmdbTestRequestId.current === requestId) tmdbTestRequestId.current = null
    }
  }

  const handleSaveTmdb = async () => {
    const value = tmdbApiKey.trim()
    if (value === originalTmdb.trim() || isSavingTmdb) return

    setIsSavingTmdb(true)
    try {
      await cancelTmdbTest()
      await window.electronAPI.setSetting('tmdb_api_key', value)
      setTmdbApiKey(value)
      setOriginalTmdb(value)
      setTmdbStatus(value ? 'testing' : 'idle')
      setTmdbTestedAt(null)
      addToast({ type: 'success', title: 'TMDB API key saved' })
    } catch (error) {
      window.electronAPI.log.error('[ServicesTab]', 'Failed to save TMDB API key:', error)
      addToast({ type: 'error', title: 'TMDB API key was not saved', message: error instanceof Error ? error.message : String(error) })
    } finally {
      setIsSavingTmdb(false)
    }
  }

  const handleCancelTmdbEdit = async () => {
    await cancelTmdbTest()
    setTmdbApiKey(originalTmdb)
    setTmdbStatus(originalTmdb ? 'saved-unverified' : 'idle')
  }

  const handleTestGemini = async () => {
    if (!geminiApiKey.trim()) return
    setGeminiStatus('testing')
    setGeminiError(null)
    try {
      const result = await window.electronAPI.aiTestApiKey(geminiApiKey)
      if (result.success) {
        setGeminiStatus('valid')
        setGeminiTestedAt(new Date().toISOString())
        const models = await window.electronAPI.aiGetAvailableModels().catch(() => [])
        if (models && models.length > 0) {
          setAvailableModels(models)
        }
      } else {
        setGeminiStatus(/invalid api key/i.test(result.error || '') ? 'invalid' : 'unavailable')
        setGeminiError(result.error || 'Invalid API key')
      }
    } catch {
      setGeminiStatus('unavailable')
      setGeminiError('Failed to test API key')
    }
  }

  const handleSave = async () => {
    setIsSaving(true)
    try {
      await Promise.all([
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
      void window.electronAPI.refreshSavedServiceHealth().catch(error => {
        window.electronAPI.log.error('[ServicesTab]', 'Unable to refresh saved provider health:', error)
      })
      addToast({ type: 'success', title: 'Settings saved' })
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

  const handleSavedHealthAction = async (service: SavedServiceId) => {
    try {
      await window.electronAPI.retrySavedServiceHealth(service)
    } catch (error) {
      addToast({ type: 'error', title: `Unable to check ${service}`, message: error instanceof Error ? error.message : String(error) })
    }
  }

  const handleTestMusicbrainz = () => handleSavedHealthAction('musicbrainz')
  const handleTestOmdb = () => handleSavedHealthAction('omdb')
  const handleTestTvdb = () => handleSavedHealthAction('tvdb')

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
    if (!ffprobeAvailable) return 'Not found on PATH'
    if (!ffprobeEnabled) return 'Available but disabled'
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
        status={tmdbStatus === 'valid' ? 'configured' : tmdbConfigured ? 'partial' : 'not-configured'}
        statusText={tmdbStatus === 'valid' ? 'Verified' : tmdbStatus === 'testing' ? 'Testing key…' : tmdbStatus === 'invalid' ? 'Invalid key' : tmdbStatus === 'unavailable' || tmdbStatus === 'timed-out' ? 'Service unavailable · key status unknown' : tmdbConfigured ? 'Saved · not tested' : 'Not configured'}
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
                    if (tmdbTestRequestId.current) void cancelTmdbTest()
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
                disabled={!tmdbApiKey.trim() || tmdbStatus === 'testing'}
                className={`px-3 py-2 rounded-md transition-colors disabled:opacity-50 flex items-center gap-2 ${
                  tmdbStatus === 'valid' ? 'text-green-500' :
                  tmdbStatus === 'invalid' ? 'text-red-500 bg-red-500/10' :
                  'text-sm bg-muted hover:bg-muted/80'
                }`}
                title="Test API key"
              >
                {tmdbStatus === 'testing' ? <Loader2 className="w-4 h-4 animate-spin" /> :
                 tmdbStatus === 'valid' ? <CheckCircle className="w-4 h-4" /> :
                 tmdbStatus === 'invalid' ? <><XCircle className="w-4 h-4" /><span className="text-xs">Invalid</span></> :
                 <span className="text-sm">Test</span>}
              </button>
              {tmdbStatus === 'testing' && tmdbTestRequestId.current && <button type="button" onClick={() => void cancelTmdbTest()} className="rounded-md border border-border px-3 py-2 text-sm">Cancel</button>}
              {tmdbApiKey.trim() && (
                <button
                  onClick={() => {
                    if (tmdbTestRequestId.current) void cancelTmdbTest()
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
          <p role="status" className="text-xs text-muted-foreground">
            {tmdbStatus === 'saved-unverified' ? 'Saved · Not tested' :
              tmdbStatus === 'valid' ? 'Key accepted by TMDB' :
              tmdbStatus === 'invalid' ? 'TMDB rejected this key' :
              tmdbStatus === 'unavailable' ? 'TMDB is unavailable; key status is unknown' :
              tmdbStatus === 'timed-out' ? 'TMDB test timed out; key status is unknown' :
              tmdbStatus === 'cancelled' ? 'Test cancelled' :
              tmdbStatus === 'testing' ? 'Testing key…' : 'Not tested'}
          </p>
          {tmdbTestedAt && <p className="text-xs text-muted-foreground">Last tested: {new Date(tmdbTestedAt).toLocaleString()}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => void handleCancelTmdbEdit()} disabled={tmdbApiKey === originalTmdb || isSavingTmdb} className="rounded-md border border-border px-3 py-2 text-sm disabled:opacity-50">Cancel edits</button>
            <button type="button" onClick={() => void handleSaveTmdb()} disabled={tmdbApiKey.trim() === originalTmdb.trim() || isSavingTmdb} className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50">{isSavingTmdb ? 'Saving…' : 'Save key'}</button>
          </div>
        </div>
      </ServiceCard>

      {/* OMDb Card */}
      <ServiceCard
        title="OMDb API"
        description="Movie and TV metadata for ratings and additional info"
        icon={<Film className="w-5 h-5" />}
        status={!omdbConfigured ? 'not-configured' : savedProviderHealth?.omdb.status && !['checking', 'valid', 'not-configured'].includes(savedProviderHealth.omdb.status) ? 'partial' : 'configured'}
        statusText={savedHealthLabel(savedProviderHealth, 'omdb', omdbConfigured)}
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
              disabled={!originalOmdb.trim() || omdbApiKey !== originalOmdb || omdbStatus === 'testing'}
              className={`px-3 py-2 rounded-md transition-colors disabled:opacity-50 flex items-center gap-2 ${
                omdbStatus === 'valid' ? 'text-green-500' :
                omdbStatus === 'invalid' ? 'text-red-500 bg-red-500/10' :
                'text-sm bg-muted hover:bg-muted/80'
              }`}
              title={savedHealthText(savedProviderHealth, 'omdb')}
            >
              {omdbStatus === 'testing' ? <><Loader2 className="w-4 h-4 animate-spin" /><span className="text-xs">Checking…</span></> :
               omdbStatus === 'valid' ? <CheckCircle className="w-4 h-4" /> :
               omdbStatus === 'invalid' ? <><XCircle className="w-4 h-4" /><span className="text-xs">Invalid</span></> :
               <span className="text-sm">Retry</span>}
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
          <p className="text-xs text-muted-foreground">{savedHealthText(savedProviderHealth, 'omdb')}</p>
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
        status={!tvdbApiKey ? 'not-configured' : savedProviderHealth?.tvdb.status && !['checking', 'valid', 'not-configured'].includes(savedProviderHealth.tvdb.status) ? 'partial' : 'configured'}
        statusText={savedHealthLabel(savedProviderHealth, 'tvdb', Boolean(tvdbApiKey))}
        expanded={expandedCards.has('tvdb')}
        onToggle={() => toggleCard('tvdb')}
      >
        <div className="space-y-3">
          <div className="flex gap-2">
            <div className="relative flex-1">
            <input id={tvdbId} type={showTvdbKey ? 'text' : 'password'} value={tvdbApiKey} onChange={(e) => setTvdbApiKey(e.target.value)} placeholder="Enter TheTVDB API key" className="w-full px-3 py-2 pr-10 bg-background border border-border/30 rounded-md text-sm focus:outline-hidden focus:ring-2 focus:ring-primary" />
              <button type="button" onClick={() => setShowTvdbKey(!showTvdbKey)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground" aria-label={showTvdbKey ? 'Hide API key' : 'Show API key'}>{showTvdbKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>
            </div>
            <button onClick={handleTestTvdb} disabled={!originalTvdbApiKey.trim() || tvdbApiKey !== originalTvdbApiKey || tvdbPin !== originalTvdbPin || tvdbStatus === 'testing'} className="px-3 py-2 rounded-md bg-muted hover:bg-muted/80 disabled:opacity-50">{tvdbStatus === 'testing' ? <><Loader2 className="mr-1 inline h-4 w-4 animate-spin" />Checking…</> : tvdbStatus === 'valid' ? <CheckCircle className="w-4 h-4 text-green-500" /> : tvdbStatus === 'invalid' ? <><XCircle className="mr-1 inline h-4 w-4 text-red-500" />Retry</> : 'Retry'}</button>
          </div>
          <div className="relative">
            <input id={tvdbPinId} type={showTvdbPin ? 'text' : 'password'} value={tvdbPin} onChange={(e) => setTvdbPin(e.target.value)} placeholder="Optional subscriber PIN" className="w-full px-3 py-2 pr-10 bg-background border border-border/30 rounded-md text-sm focus:outline-hidden focus:ring-2 focus:ring-primary" />
            <button type="button" onClick={() => setShowTvdbPin(!showTvdbPin)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground" aria-label={showTvdbPin ? 'Hide subscriber PIN' : 'Show subscriber PIN'}>{showTvdbPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>
          </div>
          <p className="text-xs text-muted-foreground">Metadata provided by TheTVDB. Attribution is required for API results.</p>
          <p className="text-xs text-muted-foreground">{savedHealthText(savedProviderHealth, 'tvdb')}</p>
        </div>
      </ServiceCard>


      {/* MusicBrainz Card */}
      <ServiceCard
        title="MusicBrainz API"
        description="Music metadata base URL for completeness analysis"
        icon={<Music className="w-5 h-5" />}
        status={!musicbrainzBaseUrl ? 'not-configured' : savedProviderHealth?.musicbrainz.status && !['checking', 'valid', 'not-configured'].includes(savedProviderHealth.musicbrainz.status) ? 'partial' : 'configured'}
        statusText={savedHealthLabel(savedProviderHealth, 'musicbrainz', Boolean(musicbrainzBaseUrl))}
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
                onChange={(e) => setMusicbrainzBaseUrl(e.target.value)}
                placeholder="Enter MusicBrainz API base URL"
                className="w-full px-3 py-2 pr-10 bg-background border border-border/30 rounded-md text-sm focus:outline-hidden focus:ring-2 focus:ring-primary"
              />
            </div>
            <button
              onClick={handleTestMusicbrainz}
              disabled={!originalMusicbrainzBaseUrl.trim() || musicbrainzBaseUrl !== originalMusicbrainzBaseUrl || musicbrainzStatus === 'testing'}
              className={`px-3 py-2 rounded-md transition-colors disabled:opacity-50 flex items-center gap-2 ${
                musicbrainzStatus === 'valid' ? 'text-green-500' :
                musicbrainzStatus === 'invalid' ? 'text-red-500 bg-red-500/10' :
                'text-sm bg-muted hover:bg-muted/80'
              }`}
              title={savedHealthText(savedProviderHealth, 'musicbrainz')}
            >
              {musicbrainzStatus === 'testing' ? <><Loader2 className="w-4 h-4 animate-spin" /><span className="text-xs">Checking…</span></> :
               musicbrainzStatus === 'valid' ? <CheckCircle className="w-4 h-4" /> :
               musicbrainzStatus === 'invalid' ? <><XCircle className="w-4 h-4" /><span className="text-xs">Invalid</span></> :
               <span className="text-sm">Retry</span>}
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
          <p className="text-xs text-muted-foreground">{savedHealthText(savedProviderHealth, 'musicbrainz')}</p>
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
          {ffprobeAvailable ? (
            <div className="flex items-center justify-between p-3 bg-background/50 rounded-lg">
              <div>
                <p className="text-sm font-medium">System FFprobe available</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Totality invokes <code>ffprobe</code> through the process PATH. Installation and updates are owned by the operating system.
                </p>
              </div>
              {ffprobeVersion && <span className="text-xs text-muted-foreground">v{ffprobeVersion}</span>}
            </div>
          ) : (
            <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
              <p className="text-sm font-medium text-amber-500">FFprobe not found on PATH</p>
              <p className="text-xs text-muted-foreground mt-1">
                Install FFmpeg with your operating system package manager and restart Totality. Totality does not download or manage its own FFmpeg/FFprobe copy.
              </p>
            </div>
          )}
        </div>
      </ServiceCard>

      {/* Google Gemini AI Card */}
      <ServiceCard
        title="Google Gemini AI"
        description="Free AI-powered library insights, recommendations, and chat"
        icon={<Bot className="w-5 h-5" />}
        status={geminiStatus === 'valid' ? 'configured' : geminiConfigured ? 'partial' : 'not-configured'}
        statusText={geminiStatus === 'valid' ? 'Credential verified' : geminiStatus === 'testing' ? 'Checking access…' : geminiStatus === 'invalid' ? 'Invalid credential' : geminiStatus === 'rate-limited' ? 'Rate limited' : geminiStatus === 'unavailable' || geminiStatus === 'timed-out' ? 'Service unavailable' : geminiConfigured ? 'Saved · not tested' : 'Not configured'}
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
                disabled={!geminiApiKey.trim() || geminiStatus === 'testing'}
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
          <p role="status" className="text-xs text-muted-foreground">
            {geminiStatus === 'testing' ? 'Checking saved credential and selected model…' :
             geminiStatus === 'valid' ? geminiModelAvailable ? 'Credential accepted · selected model available' : 'Credential accepted · selected model unavailable' :
             geminiStatus === 'invalid' ? (geminiError || 'Gemini rejected this credential') :
             geminiStatus === 'rate-limited' ? 'Gemini is rate limited; credential status is unknown' :
             geminiStatus === 'unavailable' ? 'Gemini is unavailable; credential status is unknown' :
             geminiStatus === 'timed-out' ? 'Gemini check timed out; credential status is unknown' :
             geminiStatus === 'cancelled' ? 'Credential check cancelled' :
             geminiStatus === 'saved-unverified' ? 'Saved · Not tested' : 'Not tested'}
          </p>
          {geminiTestedAt && <p className="text-xs text-muted-foreground">Last checked: {new Date(geminiTestedAt).toLocaleString()}</p>}

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
              {!availableModels.some(model => model.name === geminiModel) && <option value={geminiModel}>{geminiModel} · availability not confirmed</option>}
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
              disabled={!originalSonarrUrl || !originalSonarrKey || sonarrUrl !== originalSonarrUrl || sonarrKey !== originalSonarrKey || savedProviderHealth?.sonarr.status === 'checking'}
              onClick={() => handleSavedHealthAction('sonarr')}
              className="px-3 py-2 text-sm bg-muted hover:bg-muted/80 rounded-md disabled:opacity-50 transition-colors cursor-pointer"
            >
              {savedProviderHealth?.sonarr.status === 'checking' ? 'Checking Sonarr…' : 'Retry Sonarr'}
            </button>
            <button
              disabled={!originalRadarrUrl || !originalRadarrKey || radarrUrl !== originalRadarrUrl || radarrKey !== originalRadarrKey || savedProviderHealth?.radarr.status === 'checking'}
              onClick={() => handleSavedHealthAction('radarr')}
              className="px-3 py-2 text-sm bg-muted hover:bg-muted/80 rounded-md disabled:opacity-50 transition-colors cursor-pointer"
            >
              {savedProviderHealth?.radarr.status === 'checking' ? 'Checking Radarr…' : 'Retry Radarr'}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">Sonarr: {savedHealthText(savedProviderHealth, 'sonarr')}</p>
          <p className="text-xs text-muted-foreground">Radarr: {savedHealthText(savedProviderHealth, 'radarr')}</p>
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
