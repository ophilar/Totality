/**
 * IdUtils
 * 
 * Shared utilities for generating unique identifiers for media sources and providers.
 */

import { ProviderType } from '@main/types/database'

/**
 * Generate a unique source identifier based on the provider type.
 * 
 * Format: [type]_[timestamp]_[random]
 */
export function generateSourceId(type: ProviderType): string {
  return `${type}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}
