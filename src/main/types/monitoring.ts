/**
 * Types for Live Monitoring and Notification System
 */

import { ProviderType } from '@main/types/database'

// =============================================================================
// Monitoring Configuration
// =============================================================================

export interface MonitoringConfig {
  enabled: boolean
  startOnLaunch: boolean
  pauseDuringManualScan: boolean
  pollingIntervals: Record<ProviderType, number>
}

import { APP_CONFIG } from '@main/config'

export const DEFAULT_MONITORING_CONFIG: MonitoringConfig = {
  enabled: false,
  startOnLaunch: true,
  pauseDuringManualScan: true,
  pollingIntervals: {
    [ProviderType.Plex]: APP_CONFIG.monitoring.pollingIntervals.plex,
    [ProviderType.Jellyfin]: APP_CONFIG.monitoring.pollingIntervals.jellyfin,
    [ProviderType.Emby]: APP_CONFIG.monitoring.pollingIntervals.emby,
    [ProviderType.Kodi]: APP_CONFIG.monitoring.pollingIntervals.kodi,
    [ProviderType.KodiLocal]: APP_CONFIG.monitoring.pollingIntervals['kodi-local'],
    [ProviderType.KodiMySQL]: APP_CONFIG.monitoring.pollingIntervals['kodi-mysql'],
    [ProviderType.Local]: APP_CONFIG.monitoring.pollingIntervals.local,
    [ProviderType.MediaMonkey]: APP_CONFIG.monitoring.pollingIntervals.mediamonkey,
  },
}

export enum ChangeType {
  Added = 'added',
  Updated = 'updated',
  Removed = 'removed',
  Mixed = 'mixed'
}

export interface ChangedItem {
  id: string
  title: string
  type: 'movie' | 'episode' | 'album' | 'track' | 'artist'
  year?: number
  posterUrl?: string
  seriesTitle?: string
  artistName?: string
}

export interface SourceChangeEvent {
  sourceId: string
  sourceName: string
  sourceType: ProviderType
  libraryId: string
  libraryName: string
  changeType: ChangeType
  itemCount: number
  items: ChangedItem[]
  detectedAt: string
}

// =============================================================================
// Notifications
// =============================================================================

export enum NotificationType {
  SourceChange = 'source_change',
  ScanComplete = 'scan_complete',
  Error = 'error',
  Info = 'info'
}

export interface Notification {
  id?: number
  type: NotificationType
  title: string
  message: string
  sourceId?: string
  sourceName?: string
  itemCount?: number
  metadata?: Record<string, unknown>
  isRead: boolean
  createdAt: string
  readAt?: string
}

export interface NotificationBatch {
  notifications: Notification[]
  totalCount: number
  isSummary: boolean
  summaryMessage?: string
}

export interface NotificationConfig {
  batchWindowMs: number
  maxIndividualNotifications: number
  maxStoredNotifications: number
}

export const DEFAULT_NOTIFICATION_CONFIG: NotificationConfig = {
  batchWindowMs: APP_CONFIG.monitoring.batchWindowMs,
  maxIndividualNotifications: APP_CONFIG.monitoring.maxIndividualNotifications,
  maxStoredNotifications: APP_CONFIG.monitoring.maxStoredNotifications,
}

// =============================================================================
// Database Row Types
// =============================================================================

export interface NotificationRow {
  id: number
  type: NotificationType
  title: string
  message: string
  source_id: string | null
  source_name: string | null
  item_count: number
  metadata: string // JSON string
  is_read: number // 0 or 1
  created_at: string
  read_at: string | null
}

// =============================================================================
// IPC Types
// =============================================================================

export interface NotificationCountResult {
  total: number
  unread: number
}

export interface GetNotificationsOptions {
  limit?: number
  offset?: number
  type?: NotificationType
  unreadOnly?: boolean
}
