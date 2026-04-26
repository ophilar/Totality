import type { ConnectionTestResult } from '@main/types/ipc'
import type { LibraryType } from '@main/types/database'

export type { ConnectionTestResult, LibraryType }

// Type definitions for multi-source support
export interface MediaSourceResponse {
  id?: number
  source_id: string
  source_type: string
  display_name: string
  connection_config: string
  is_enabled: boolean
  last_connected_at?: string
  last_scan_at?: string
  created_at: string
  updated_at: string
}

export interface ServerInstanceResponse {
  id: string
  name: string
  address: string
  port: number
  version?: string
  isLocal?: boolean
  isOwned?: boolean
  protocol?: string
}

export interface MediaLibraryResponse {
  id: string
  name: string
  type: LibraryType
  collectionType?: string
  itemCount?: number
  scannedAt?: string
}

export interface ScanResultResponse {
  success: boolean
  itemsScanned: number
  itemsAdded: number
  itemsUpdated: number
  itemsRemoved: number
  errors: string[]
  durationMs: number
}

export interface DiscoveredServerResponse {
  id: string
  name: string
  address: string
  endpointAddress?: string
  localAddress?: string
}
