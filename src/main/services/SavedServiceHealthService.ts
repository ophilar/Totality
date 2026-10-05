import { EventEmitter } from 'node:events'
import { getDatabase } from '@main/database/BetterSQLiteService'
import { ArrIntegrationService } from '@main/services/ArrIntegrationService'
import { getMusicBrainzService } from '@main/services/MusicBrainzService'
import { MetadataRegistryService } from '@main/services/metadata/MetadataRegistryService'
import { getLoggingService } from '@main/services/LoggingService'
import type { ProviderHealthResult, SavedServiceHealth, SavedServiceHealthSnapshot, SavedServiceId, SavedServiceStatus } from '@shared/serviceHealth'

const SERVICE_IDS: SavedServiceId[] = ['omdb', 'tvdb', 'musicbrainz', 'sonarr', 'radarr']

function emptyHealth(service: SavedServiceId): SavedServiceHealth {
  return { service, status: 'not-configured', message: null, testedAt: null, revision: 0 }
}

function categorizeArrResult(result: Awaited<ReturnType<ArrIntegrationService['testConnection']>>): ProviderHealthResult {
  if (result.success) return { status: 'valid', message: null }
  const error = result.error ?? ''
  const statusCode = Number(error.match(/\((\d{3})\)/)?.[1])
  if (statusCode === 401) return { status: 'invalid-credential', message: 'The saved API key was rejected.' }
  if (statusCode === 403) return { status: 'permission-denied', message: 'The server denied access for this API key.' }
  if (statusCode === 429) return { status: 'rate-limited', message: 'The server rate limit was reached.' }
  if (/timed out/i.test(error)) return { status: 'timed-out', message: 'The server did not respond before the timeout.' }
  return { status: 'unavailable', message: 'The configured server could not be reached.' }
}

function categorizeProviderError(error: unknown): ProviderHealthResult {
  const status = error && typeof error === 'object' && 'status' in error
    ? Number((error as { status: unknown }).status)
    : undefined
  if (status === 401) return { status: 'invalid-credential', message: 'The saved credentials were rejected.' }
  if (status === 403) return { status: 'permission-denied', message: 'The provider denied access for this account.' }
  if (status === 429) return { status: 'rate-limited', message: 'The provider rate limit was reached.' }
  if (status === 503 || status === 502 || status === 504) return { status: 'unavailable', message: `The provider is temporarily unavailable (HTTP ${status}).` }
  if (error instanceof Error && /timed out/i.test(error.message)) return { status: 'timed-out', message: 'The provider did not respond before the timeout.' }
  return { status: 'unavailable', message: 'The provider could not be reached.' }
}

export class SavedServiceHealthService {
  readonly events = new EventEmitter()
  private snapshot = Object.fromEntries(SERVICE_IDS.map(id => [id, emptyHealth(id)])) as SavedServiceHealthSnapshot
  private readonly fingerprints = new Map<SavedServiceId, string>()
  private readonly controllers = new Map<SavedServiceId, AbortController>()
  private readonly checks = new Map<SavedServiceId, Promise<void>>()
  private revision = 0

  getSnapshot(): SavedServiceHealthSnapshot {
    return Object.fromEntries(SERVICE_IDS.map(id => [id, { ...this.snapshot[id] }])) as SavedServiceHealthSnapshot
  }

  async refreshSavedChecks(): Promise<void> {
    const settings = await getDatabase().config.getAllSettings()
    const checks = [
      this.run('omdb', settings.omdb_api_key ?? '', Boolean(settings.omdb_api_key), signal => MetadataRegistryService.getInstance().testSavedCredential('omdb', signal)),
      this.run('tvdb', JSON.stringify([settings.tvdb_api_key ?? '', settings.tvdb_pin ?? '']), Boolean(settings.tvdb_api_key), signal => MetadataRegistryService.getInstance().testSavedCredential('tvdb', signal)),
      this.run('musicbrainz', settings.musicbrainz_base_url ?? '', true, signal => this.checkMusicBrainz(signal)),
      this.runArr('sonarr', settings.sonarr_url, settings.sonarr_api_key),
      this.runArr('radarr', settings.radarr_url, settings.radarr_api_key),
    ]
    await Promise.all(checks)
  }

  async retry(service: SavedServiceId): Promise<void> {
    const settings = await getDatabase().config.getAllSettings()
    if (service === 'sonarr' || service === 'radarr') {
      const prefix = service
      await this.runArr(service, settings[`${prefix}_url`], settings[`${prefix}_api_key`], true)
      return
    }
    if (service === 'omdb') {
      await this.run(service, settings.omdb_api_key ?? '', Boolean(settings.omdb_api_key), signal => MetadataRegistryService.getInstance().testSavedCredential('omdb', signal), true)
      return
    }
    if (service === 'tvdb') {
      await this.run(service, JSON.stringify([settings.tvdb_api_key ?? '', settings.tvdb_pin ?? '']), Boolean(settings.tvdb_api_key), signal => MetadataRegistryService.getInstance().testSavedCredential('tvdb', signal), true)
      return
    }
    await this.run('musicbrainz', settings.musicbrainz_base_url ?? '', true, signal => this.checkMusicBrainz(signal), true)
  }

  private async runArr(service: 'sonarr' | 'radarr', baseUrl?: string, apiKey?: string, force = false): Promise<void> {
    const fingerprint = JSON.stringify([baseUrl ?? '', apiKey ?? ''])
    const configured = Boolean(baseUrl && apiKey)
    await this.run(service, fingerprint, configured, async signal => {
      const result = await new ArrIntegrationService({ baseUrl: baseUrl!, apiKey: apiKey! }).testConnection(signal)
      return categorizeArrResult(result)
    }, force)
  }

  private async checkMusicBrainz(signal: AbortSignal): Promise<ProviderHealthResult> {
    try {
      await getMusicBrainzService().testAvailability(signal)
      return { status: 'valid', message: 'MusicBrainz is reachable.' }
    } catch (error) {
      if (signal.aborted) throw error
      return categorizeProviderError(error)
    }
  }

  private async run(
    service: SavedServiceId,
    fingerprint: string,
    configured: boolean,
    check: (signal: AbortSignal) => Promise<ProviderHealthResult>,
    force = false,
  ): Promise<void> {
    if (!force && this.fingerprints.get(service) === fingerprint) {
      return this.checks.get(service) ?? Promise.resolve()
    }

    this.controllers.get(service)?.abort()
    this.fingerprints.set(service, fingerprint)
    if (!configured) {
      this.controllers.delete(service)
      this.checks.delete(service)
      this.publish(service, 'not-configured', null, null)
      return
    }

    const controller = new AbortController()
    this.controllers.set(service, controller)
    this.publish(service, 'checking', null, null)
    let operation!: Promise<void>
    operation = (async () => {
      try {
        const result = await check(controller.signal)
        if (this.controllers.get(service) !== controller) return
        this.publish(service, result.status, result.message, new Date().toISOString())
      } catch (error) {
        if (this.controllers.get(service) !== controller) return
        if (controller.signal.aborted) {
          return
        } else {
          const result = categorizeProviderError(error)
          this.publish(service, result.status, result.message, new Date().toISOString())
          getLoggingService().warn('[ServiceHealth]', `${service} health check ended as ${result.status}.`)
        }
      } finally {
        if (this.controllers.get(service) === controller) this.controllers.delete(service)
        if (this.checks.get(service) === operation) this.checks.delete(service)
      }
    })()
    this.checks.set(service, operation)
    return operation
  }

  private publish(service: SavedServiceId, status: SavedServiceStatus, message: string | null, testedAt: string | null): void {
    const state: SavedServiceHealth = { service, status, message, testedAt, revision: ++this.revision }
    this.snapshot = { ...this.snapshot, [service]: state }
    this.events.emit('changed', this.getSnapshot())
  }
}

let serviceHealthInstance: SavedServiceHealthService | null = null

export function getSavedServiceHealthService(): SavedServiceHealthService {
  return serviceHealthInstance ??= new SavedServiceHealthService()
}
