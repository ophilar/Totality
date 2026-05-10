/**
 * LoggingService - Centralized logging with buffer and export
 */

import { BrowserWindow, app } from 'electron'
import { safeSend } from '@main/ipc/utils/safeSend'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import * as crypto from 'crypto'
import { APP_CONFIG } from '@main/config'

export type LogLevel = 'verbose' | 'debug' | 'info' | 'warn' | 'error'

export interface SourceInfo {
  displayName: string
  sourceType: string
  serverVersion: string | null
}

export interface DiagnosticInfo {
  ffprobe: { available: boolean; version: string | null; bundled: boolean }
  database: { path: string; sizeMB: number }
  libraries: { sourceName: string; sourceType: string; itemCount: number }[]
  monitoring: { enabled: boolean }
}

export interface LogEntry {
  id: string
  timestamp: string
  level: LogLevel
  source: string
  message: string
  details?: string
}

const MAX_INFO_ENTRIES = APP_CONFIG.logging.maxInfoEntries
const MAX_IMPORTANT_ENTRIES = APP_CONFIG.logging.maxImportantEntries

type DatabaseGetter = () => any

export class LoggingService {
  private infoLogs: LogEntry[] = []
  private importantLogs: LogEntry[] = []
  private mainWindow: BrowserWindow | null = null
  private sessionId = `${Date.now()}-${crypto.randomBytes(9).toString('base64url').slice(0, 9)}`
  private startedAt = new Date()
  private verboseEnabled = false
  private homeDir = os.homedir()
  private dbGetter: DatabaseGetter | null = null
  private originalConsole: {
    log: typeof console.log
    warn: typeof console.warn
    error: typeof console.error
    info: typeof console.info
    debug: typeof console.debug
  }

  private fileLoggingEnabled = false
  private fileLoggingMinLevel: LogLevel = 'info'
  private logRetentionDays = 7
  private logDir = ''
  private writeBuffer: string[] = []
  private flushTimer: NodeJS.Timeout | null = null
  private isWriting = false
  private currentLogDate = ''

  private static readonly LEVEL_PRIORITY: Record<LogLevel, number> = {
    verbose: 0, debug: 1, info: 2, warn: 3, error: 4,
  }
  private static readonly FLUSH_INTERVAL_MS = APP_CONFIG.logging.flushIntervalMs
  private static readonly FLUSH_BUFFER_SIZE = APP_CONFIG.logging.flushBufferSize

  constructor() {
    this.originalConsole = {
      log: console.log.bind(console),
      warn: console.warn.bind(console),
      error: console.error.bind(console),
      info: console.info.bind(console),
      debug: console.debug.bind(console),
    }
  }

  private sanitize(text: any): string {
    if (typeof text !== 'string') return String(text)
    let result = text
    if (this.homeDir) {
      const escaped = this.homeDir.replace(/[\\]/g, '\\\\')
      result = result
        .replace(new RegExp(escaped, 'gi'), '~')
        .replace(new RegExp(this.homeDir.replace(/\\/g, '/'), 'gi'), '~')
    }

    // Redact common sensitive patterns
    result = result.replace(/X-Plex-Token=[^&\s"']+/gi, 'X-Plex-Token=***')
    result = result.replace(/([?&]token=)[^&\s"']+/gi, '$1***')
    result = result.replace(/ENC:[A-Za-z0-9+/=]{8,}/g, 'ENC:***')

    // Handle Authorization headers (Basic/Bearer)
    result = result.replace(/(Authorization:\s*)(Basic|Bearer)\s+[A-Za-z0-9._~+/-]+=*/gi, '$1$2 ***')

    // Handle generic key-value secrets in URLs, JSON, or logs
    // Catches: api_key=..., "password": "...", Pw: ..., etc.
    const secretKeys = 'api[_-]?key|apikey|api[_-]?token|access[_-]?token|secret|password|pass|pw|X-Emby-Token'
    const secretRegex = new RegExp(
      `(${secretKeys})([\\s"']*[:=][\\s"']*)[^"&\\s'\\r\\n]{4,}`,
      'gi'
    )
    result = result.replace(secretRegex, '$1$2***')

    return result
  }

  initialize(): void {
    this.interceptConsole()
    this.addEntry('info', '[LoggingService]', 'Logging service initialized')
  }

  setDatabaseGetter(getter: DatabaseGetter): void {
    this.dbGetter = getter
  }

  setMainWindow(window: BrowserWindow | null): void {
    this.mainWindow = window
  }

  private interceptConsole(): void {
    console.log = (...args: unknown[]) => { this.originalConsole.log(...args); this.captureLog('info', args) }
    console.warn = (...args: unknown[]) => { this.originalConsole.warn(...args); this.captureLog('warn', args) }
    console.error = (...args: unknown[]) => { this.originalConsole.error(...args); this.captureLog('error', args) }
    console.info = (...args: unknown[]) => { this.originalConsole.info(...args); this.captureLog('info', args) }
    console.debug = (...args: unknown[]) => { this.originalConsole.debug(...args); this.captureLog('debug', args) }
  }

  private captureLog(level: LogLevel, args: unknown[]): void {
    const message = String(args[0] || '')
    const sourceMatch = message.match(/^\[([^\]]+)\]/)
    const source = sourceMatch ? sourceMatch[0] : '[App]'
    const cleanMessage = sourceMatch ? message.slice(sourceMatch[0].length).trim() : message
    const details = args.length > 1 ? this.formatDetails(args.slice(1)) : undefined
    this.addEntry(level, source, cleanMessage, details)
  }

  private formatDetails(args: unknown[]): string | undefined {
    if (args.length === 0) return undefined
    return args.map((arg) => {
      if (arg instanceof Error) return `${arg.name}: ${arg.message}\n${arg.stack || 'No stack trace'}`
      try { return typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg) } catch { return String(arg) }
    }).join('\n\n')
  }

  private addEntry(level: LogLevel, source: string, message: unknown, details?: string): void {
    const formattedMessage = typeof message === 'string' ? message : String(message)
    const entry: LogEntry = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date().toISOString(),
      level, source,
      message: this.sanitize(formattedMessage),
      details: details ? this.sanitize(details) : undefined,
    }

    if (level === 'warn' || level === 'error') {
      this.importantLogs.push(entry)
      if (this.importantLogs.length > MAX_IMPORTANT_ENTRIES) this.importantLogs = this.importantLogs.slice(-MAX_IMPORTANT_ENTRIES)
    } else {
      this.infoLogs.push(entry)
      if (this.infoLogs.length > MAX_INFO_ENTRIES) this.infoLogs = this.infoLogs.slice(-MAX_INFO_ENTRIES)
    }

    if (this.mainWindow) safeSend(this.mainWindow, 'logs:new', entry)
    this.appendToFileBuffer(entry)
  }

  private get logs(): LogEntry[] {
    return [...this.infoLogs, ...this.importantLogs].sort((a, b) => a.timestamp.localeCompare(b.timestamp))
  }

  getLogs(limit?: number): LogEntry[] {
    return limit ? this.logs.slice(-limit) : [...this.logs]
  }

  clearLogs(): void {
    this.infoLogs = []
    this.importantLogs = []
    this.addEntry('info', '[LoggingService]', 'Logs cleared')
  }

  async setVerboseLogging(enabled: boolean): Promise<void> {
    this.verboseEnabled = enabled
    this.addEntry('info', '[LoggingService]', `Verbose logging ${enabled ? 'enabled' : 'disabled'}`)
    if (this.dbGetter) {
      await this.dbGetter().config.setSetting('verbose_logging_enabled', String(enabled))
    }
  }

  isVerboseEnabled(): boolean { return this.verboseEnabled }

  debug(s: string, m: unknown, ...d: unknown[]): void { this.addEntry('debug', s, m, this.formatDetails(d)) }
  verbose(s: string, m: unknown, ...d: unknown[]): void { if (this.verboseEnabled) this.addEntry('verbose', s, m, this.formatDetails(d)) }
  info(s: string, m: unknown, ...d: unknown[]): void { this.addEntry('info', s, m, this.formatDetails(d)) }
  warn(s: string, m: unknown, ...d: unknown[]): void { this.addEntry('warn', s, m, this.formatDetails(d)) }
  error(s: string, m: unknown, ...d: unknown[]): void { this.addEntry('error', s, m, this.formatDetails(d)) }

  getSessionInfo() { return { sessionId: this.sessionId, startedAt: this.startedAt.toISOString(), uptimeMs: Date.now() - this.startedAt.getTime() } }

  async exportLogs(filePath: string, sourceInfo?: SourceInfo[], diagnostics?: DiagnosticInfo): Promise<void> {
    const exportData = {
      exportedAt: new Date().toISOString(),
      ...this.getSessionInfo(),
      appVersion: app.getVersion(),
      platform: process.platform,
      connectedSources: sourceInfo || [],
      diagnostics: diagnostics || null,
      logs: this.logs,
    }
    await fs.writeFile(filePath, JSON.stringify(exportData, null, 2), 'utf-8')
  }

  async initializeFileLogging(): Promise<void> {
    try {
      this.logDir = path.join(app.getPath('userData'), 'logs')
      await this.loadFileLoggingSettings()
      if (!this.fileLoggingEnabled) return
      await fs.mkdir(this.logDir, { recursive: true })
      this.rotateLogFiles().catch(() => {})
      this.flushTimer = setInterval(() => this.flushBuffer(), LoggingService.FLUSH_INTERVAL_MS)
    } catch (err) {
      this.originalConsole.error('[LoggingService] Failed to initialize file logging:', err)
      this.fileLoggingEnabled = false
    }
  }

  private async loadFileLoggingSettings(): Promise<void> {
    if (!this.dbGetter) return
    const db = this.dbGetter()
    const enabled = await db.config.getSetting('file_logging_enabled')
    const minLevel = await db.config.getSetting('file_logging_min_level')
    const retention = await db.config.getSetting('log_retention_days')
    const verbose = await db.config.getSetting('verbose_logging_enabled')

    if (enabled !== null) this.fileLoggingEnabled = enabled !== 'false'
    if (minLevel && minLevel in LoggingService.LEVEL_PRIORITY) this.fileLoggingMinLevel = minLevel as LogLevel
    if (retention) this.logRetentionDays = parseInt(retention, 10) || 7
    if (verbose === 'true') this.verboseEnabled = true
  }

  private appendToFileBuffer(entry: LogEntry): void {
    if (!this.fileLoggingEnabled || !this.logDir) return
    if (LoggingService.LEVEL_PRIORITY[entry.level] < LoggingService.LEVEL_PRIORITY[this.fileLoggingMinLevel]) return
    let line = `${entry.timestamp} [${entry.level.toUpperCase().padEnd(7)}] ${entry.source} ${entry.message}`
    if (entry.details) line += `\n  ${entry.details.replace(/\n/g, '\n  ')}`
    this.writeBuffer.push(line + '\n')
    if (this.writeBuffer.length >= LoggingService.FLUSH_BUFFER_SIZE) this.flushBuffer()
  }

  private async flushBuffer(): Promise<void> {
    if (this.writeBuffer.length === 0 || this.isWriting) return
    this.isWriting = true
    const lines = this.writeBuffer.splice(0)
    try {
      const today = new Date().toISOString().split('T')[0]
      const logFile = path.join(this.logDir, `totality-${today}.log`)
      if (today !== this.currentLogDate) { this.currentLogDate = today; this.rotateLogFiles().catch(() => {}) }
      await fs.appendFile(logFile, lines.join(''), 'utf-8')
    } catch (err) {
      this.originalConsole.error('[LoggingService] Failed to write log file:', err)
    } finally { this.isWriting = false }
  }

  private async rotateLogFiles(): Promise<void> {
    try {
      const files = await fs.readdir(this.logDir)
      const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - this.logRetentionDays)
      for (const file of files) {
        if (!file.startsWith('totality-') || !file.endsWith('.log')) continue
        const fileDate = new Date(file.replace('totality-', '').replace('.log', '') + 'T00:00:00Z')
        if (!isNaN(fileDate.getTime()) && fileDate < cutoff) await fs.unlink(path.join(this.logDir, file))
      }
    } catch (err) { this.originalConsole.error('[LoggingService] Failed to rotate log files:', err) }
  }

  async shutdown(): Promise<void> {
    if (this.flushTimer) { clearInterval(this.flushTimer); this.flushTimer = null }
    await this.flushBuffer()
  }

  async updateFileLoggingSettings(settings: { enabled?: boolean, minLevel?: LogLevel, retentionDays?: number }): Promise<void> {
    if (settings.enabled !== undefined) this.fileLoggingEnabled = settings.enabled
    if (settings.minLevel !== undefined) this.fileLoggingMinLevel = settings.minLevel
    if (settings.retentionDays !== undefined) this.logRetentionDays = settings.retentionDays
    if (this.dbGetter) {
      const db = this.dbGetter()
      if (settings.enabled !== undefined) await db.config.setSetting('file_logging_enabled', String(settings.enabled))
      if (settings.minLevel !== undefined) await db.config.setSetting('file_logging_min_level', settings.minLevel)
      if (settings.retentionDays !== undefined) await db.config.setSetting('log_retention_days', String(settings.retentionDays))
    }
  }

  getFileLoggingSettings() { return { enabled: this.fileLoggingEnabled, minLevel: this.fileLoggingMinLevel, retentionDays: this.logRetentionDays } }
}

let loggingService: LoggingService | null = null
export function getLoggingService(): LoggingService {
  if (!loggingService) loggingService = new LoggingService()
  return loggingService
}
