import { LibraryType } from '@main/types/database'
import type { AnalysisScope } from '@shared/analysisScope'

export interface AnalysisLibraryScope {
  sourceId: string
  libraryId: string
  libraryType: LibraryType
}

export interface AnalysisStageDefinition {
  name: 'quality' | 'series-completeness' | 'collection-completeness' | 'music-quality' | 'music-completeness' | 'artist-completeness' | 'owned-album-completeness'
  sourceId?: string
  libraryId?: string
  mediaItemId?: number
  artistId?: number
  albumId?: number
  collectionId?: number
  series?: { title: string; seriesIdentityKey: string }
}

export function planAnalysisStages(scope: AnalysisScope, libraries: AnalysisLibraryScope[] = []): AnalysisStageDefinition[] {
  const stages: AnalysisStageDefinition[] = []
  const addLibraryStages = ({ sourceId, libraryId, libraryType }: AnalysisLibraryScope): void => {
    if (libraryType !== LibraryType.Music) stages.push({ name: 'quality', sourceId, libraryId })
    if (libraryType === LibraryType.Show || libraryType === LibraryType.Mixed) stages.push({ name: 'series-completeness', sourceId, libraryId })
    if (libraryType === LibraryType.Movie || libraryType === LibraryType.Mixed) stages.push({ name: 'collection-completeness', sourceId, libraryId })
    if (libraryType === LibraryType.Music || libraryType === LibraryType.Mixed) {
      stages.push({ name: 'music-quality', sourceId, libraryId }, { name: 'music-completeness', sourceId, libraryId })
    }
  }

  switch (scope.kind) {
    case 'item': stages.push({ name: 'quality', mediaItemId: scope.mediaId }); break
    case 'show': stages.push(
      { name: 'quality', sourceId: scope.sourceId, libraryId: scope.libraryId, series: { title: scope.title, seriesIdentityKey: scope.seriesIdentityKey } },
      { name: 'series-completeness', sourceId: scope.sourceId, libraryId: scope.libraryId, series: { title: scope.title, seriesIdentityKey: scope.seriesIdentityKey } },
    ); break
    case 'collection': stages.push({ name: 'quality', collectionId: scope.collectionId }, { name: 'collection-completeness', collectionId: scope.collectionId }); break
    case 'album': stages.push({ name: 'music-quality', albumId: scope.albumId }, { name: 'music-completeness', albumId: scope.albumId }); break
    case 'artist': stages.push(
      { name: 'music-quality', artistId: scope.artistId },
      { name: 'artist-completeness', artistId: scope.artistId },
      { name: 'owned-album-completeness', artistId: scope.artistId },
    ); break
    case 'library':
    case 'all-libraries': libraries.forEach(addLibraryStages); break
  }
  return stages
}
