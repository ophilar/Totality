import { ipcRenderer } from 'electron'

export const wishlistApi = {
  // ============================================================================
  // WISHLIST / SHOPPING LIST
  // ============================================================================

  // Wishlist CRUD
  wishlistAdd: (item: unknown) => ipcRenderer.invoke('wishlist:add', item),
  wishlistUpdate: (id: number, updates: unknown) => ipcRenderer.invoke('wishlist:update', id, updates),
  wishlistRemove: (id: number) => ipcRenderer.invoke('wishlist:remove', id),
  wishlistGetAll: (filters?: unknown) => ipcRenderer.invoke('wishlist:getAll', filters),
  wishlistList: (filters?: unknown) => ipcRenderer.invoke('wishlist:list', filters),
  wishlistCount: (filters?: unknown) => ipcRenderer.invoke('wishlist:count', filters),
  wishlistGetById: (id: number) => ipcRenderer.invoke('wishlist:getById', id),
  wishlistGetCount: () => ipcRenderer.invoke('wishlist:getCount'),
  wishlistCheckExists: (tmdbId?: string, musicbrainzId?: string, mediaItemId?: number) =>
    ipcRenderer.invoke('wishlist:checkExists', tmdbId, musicbrainzId, mediaItemId),
  wishlistAddBulk: (items: unknown[]) => ipcRenderer.invoke('wishlist:addBulk', items),
  wishlistGetCountsByReason: () => ipcRenderer.invoke('wishlist:getCountsByReason'),

  // Store Search
  wishlistGetStoreLinks: (item: unknown) => ipcRenderer.invoke('wishlist:getStoreLinks', item),
  wishlistOpenStoreLink: (url: string) => ipcRenderer.invoke('wishlist:openStoreLink', url),
  wishlistSetRegion: (region: string) => ipcRenderer.invoke('wishlist:setRegion', region),
  wishlistGetRegion: () => ipcRenderer.invoke('wishlist:getRegion'),
  wishlistExportCsv: () => ipcRenderer.invoke('wishlist:exportCsv'),
}

export interface WishlistAPI {
  // ============================================================================
  // WISHLIST / SHOPPING LIST
  // ============================================================================

  // Wishlist CRUD
  wishlistAdd: (item: {
    media_type: 'movie' | 'episode' | 'season' | 'album' | 'track'
    title: string
    subtitle?: string
    year?: number
    reason?: 'missing' | 'upgrade'
    tmdb_id?: string
    imdb_id?: string
    musicbrainz_id?: string
    series_title?: string
    season_number?: number
    episode_number?: number
    collection_name?: string
    artist_name?: string
    album_title?: string
    poster_url?: string
    priority?: 1 | 2 | 3 | 4 | 5
    notes?: string
    current_quality_tier?: string
    current_quality_level?: string
    current_resolution?: string
    current_video_codec?: string
    current_audio_codec?: string
    media_item_id?: number
  }) => Promise<number>
  wishlistUpdate: (id: number, updates: {
    priority?: 1 | 2 | 3 | 4 | 5
    notes?: string
    poster_url?: string
    status?: 'active' | 'completed'
  }) => Promise<{ success: boolean }>
  wishlistRemove: (id: number) => Promise<{ success: boolean }>
  wishlistGetAll: (filters?: unknown) => Promise<any[]>
  wishlistList: (filters?: unknown) => Promise<any[]>
  wishlistCount: (filters?: unknown) => Promise<number>
  wishlistGetById: (id: number) => Promise<any | null>
  wishlistGetCount: () => Promise<number>
  wishlistGetCountsByReason: () => Promise<{ missing: number; upgrade: number; active: number; completed: number; total: number }>
  wishlistCheckExists: (tmdbId?: string, musicbrainzId?: string, mediaItemId?: number) => Promise<boolean>
  wishlistAddBulk: (items: Array<{
    media_type: 'movie' | 'episode' | 'season' | 'album' | 'track'
    title: string
    subtitle?: string
    year?: number
    tmdb_id?: string
    imdb_id?: string
    musicbrainz_id?: string
    series_title?: string
    season_number?: number
    episode_number?: number
    collection_name?: string
    artist_name?: string
    album_title?: string
    poster_url?: string
    priority?: 1 | 2 | 3 | 4 | 5
    notes?: string
  }>) => Promise<{ success: boolean; added: number }>

  // Store Search
  wishlistGetStoreLinks: (item: {
    media_type: 'movie' | 'episode' | 'season' | 'album' | 'track'
    title: string
    year?: number
    series_title?: string
    season_number?: number
    artist_name?: string
    album_title?: string
  }) => Promise<Array<{
    name: string
    url: string
    icon: string
    category: 'aggregator' | 'digital' | 'physical'
  }>>
  wishlistOpenStoreLink: (url: string) => Promise<{ success: boolean }>
  wishlistSetRegion: (region: 'us' | 'uk' | 'de' | 'fr' | 'ca' | 'au') => Promise<{ success: boolean }>
  wishlistGetRegion: () => Promise<'us' | 'uk' | 'de' | 'fr' | 'ca' | 'au'>
  wishlistExportCsv: () => Promise<{ success: boolean; path?: string; count?: number; cancelled?: boolean }>
}
