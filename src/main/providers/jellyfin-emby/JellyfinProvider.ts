/**
 * JellyfinProvider
 *
 * Implements the MediaProvider interface for Jellyfin Media Server.
 * Extends JellyfinEmbyBase since Jellyfin forked from Emby and shares a similar API.
 */

import { JellyfinEmbyBase } from '@main/providers/jellyfin-emby/JellyfinEmbyBase'
import type { SourceConfig } from '@main/providers/base/MediaProvider'
import { ProviderType } from '@main/types/database'
import { app } from 'electron'

export class JellyfinProvider extends JellyfinEmbyBase {
  readonly providerType = ProviderType.Jellyfin
  // Jellyfin uses standard Authorization header (X-Emby-Authorization is for Emby)
  protected authHeaderName = 'Authorization'
  protected clientName = 'Totality'
  protected clientVersion = app?.getVersion?.() || '0.0.0'

  constructor(config: SourceConfig) {
    super(config)
  }
}
