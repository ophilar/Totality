export interface JellyfinAuthResponse {
  User: { Id: string; Name: string; ServerId: string }
  AccessToken: string
  ServerId: string
}

export interface JellyfinLibrary {
  Id: string
  Name: string
  CollectionType?: string
  ItemCount?: number
  ItemId?: string
}

export interface JellyfinMediaItem {
  Id: string
  Name: string
  Type: string
  ProductionYear?: number
  SeriesName?: string
  ParentIndexNumber?: number
  IndexNumber?: number
  Path?: string
  Overview?: string
  MediaSources?: JellyfinMediaSource[]
  ProviderIds?: { Imdb?: string; Tmdb?: string }
  ImageTags?: { Primary?: string; Thumb?: string; Screenshot?: string }
  SeriesId?: string
  SeasonId?: string
  SeriesPrimaryImageTag?: string
  ParentPrimaryImageTag?: string
  ParentPrimaryImageItemId?: string
  ParentThumbItemId?: string
  ParentThumbImageTag?: string
  ParentBackdropItemId?: string
  ParentBackdropImageTags?: string[]
  SeriesProviderIds?: { Imdb?: string; Tmdb?: string }
  DateCreated?: string
  PremiereDate?: string
  SortName?: string
  _seriesSortName?: string
}

export interface JellyfinMediaSource {
  Id: string
  Path?: string
  Size?: number
  Container?: string
  RunTimeTicks?: number
  Bitrate?: number
  MediaStreams?: JellyfinMediaStream[]
}

export interface JellyfinMediaStream {
  Type: 'Video' | 'Audio' | 'Subtitle'
  Index: number
  Codec?: string
  CodecTag?: string
  Language?: string
  Title?: string
  DisplayTitle?: string
  IsDefault?: boolean
  Width?: number
  Height?: number
  BitRate?: number
  RealFrameRate?: number
  BitDepth?: number
  VideoRange?: string
  ColorSpace?: string
  Profile?: string
  Level?: number
  Channels?: number
  SampleRate?: number
  ChannelLayout?: string
  IsForced?: boolean
}

export interface JellyfinMusicArtist { Id: string; Name: string; Overview?: string; ProviderIds?: Record<string, string>; ImageTags?: { Primary?: string; Thumb?: string }; Genres?: string[]; SortName?: string }
export interface JellyfinMusicAlbum { Id: string; Name: string; AlbumArtists?: Array<{ Id: string; Name: string }>; AlbumArtist?: string; Artists?: string[]; ProductionYear?: number; ProviderIds?: Record<string, string>; ImageTags?: { Primary?: string; Thumb?: string }; Genres?: string[]; ChildCount?: number; RunTimeTicks?: number; SortName?: string }
export interface JellyfinMusicTrack { Id: string; Name: string; AlbumId?: string; Album?: string; AlbumArtist?: string; Artists?: string[]; ArtistItems?: Array<{ Id: string; Name: string }>; IndexNumber?: number; ParentIndexNumber?: number; RunTimeTicks?: number; MediaSources?: JellyfinMediaSource[]; Path?: string; ProviderIds?: Record<string, string>; ImageTags?: { Primary?: string }; PrimaryImageTag?: string; Moods?: string[]; Tags?: string[] }
