export interface MovieSearchResult { id: number; title: string; year?: number | null; poster_url?: string | null; needs_upgrade: boolean; type: 'movie' }
export interface TVSearchResult { id: string; title: string; poster_url?: string | null; type: 'tv' }
export interface EpisodeSearchResult { id: number; title: string; series_title?: string | null; series_identity_key?: string | null; source_id?: string | null; library_id?: string | null; season_number?: number | null; episode_number?: number | null; thumb_url?: string | null; needs_upgrade: boolean; type: 'episode' }
export interface ArtistSearchResult { id: number; title: string; thumb_url?: string | null; type: 'artist' }
export interface AlbumSearchResult { id: number; title: string; subtitle: string; year?: number | null; thumb_url?: string | null; needs_upgrade: boolean; type: 'album' }
export interface TrackSearchResult { id: number; title: string; album_id: number; album_title?: string | null; artist_name?: string | null; thumb_url?: string | null; needs_upgrade: boolean; type: 'track' }
export interface GlobalSearchResults { movies: MovieSearchResult[]; tvShows: TVSearchResult[]; episodes: EpisodeSearchResult[]; artists: ArtistSearchResult[]; albums: AlbumSearchResult[]; tracks: TrackSearchResult[] }
