const fs = require('fs');

function fixFile(file, edits) {
  if (!fs.existsSync(file)) return;
  let content = fs.readFileSync(file, 'utf8');
  for (const [from, to] of edits) {
    if (typeof from === 'string') {
      content = content.split(from).join(to);
    } else {
      content = content.replace(from, to);
    }
  }
  fs.writeFileSync(file, content);
}

// 1. GeminiAnalysisService.ts
fixFile('src/main/services/GeminiAnalysisService.ts', [
  ['lowQualityItems.map((item: Record<string, unknown>)', 'lowQualityItems.map((item: any)'],
  ['lowItems.map((item: Record<string, unknown>)', 'lowItems.map((item: any)'],
  ['mediumItems.map((item: Record<string, unknown>)', 'mediumItems.map((item: any)'],
  ['wishlistItems.map((item: Record<string, unknown>)', 'wishlistItems.map((item: any)'],
  ['compact({', 'compact({'] // force save
]);

// 2. GeminiTools.ts
fixFile('src/main/services/GeminiTools.ts', [
  ['items.map((item: Record<string, unknown>)', 'items.map((item: any)'],
  ['albums.slice(0, 5).map((a: Record<string, unknown>)', 'albums.slice(0, 5).map((a: any)'],
  ['db.getMusicAlbumsByArtistName(artistName, limit) as Record<string, unknown>[]', 'db.getMusicAlbumsByArtistName(artistName, limit) as any'],
  ['db.getMusicAlbums(filters) as Record<string, unknown>[]', 'db.getMusicAlbums(filters) as any'],
  ['db.getMusicAlbums({ limit: 10000 }) as Record<string, unknown>[]', 'db.getMusicAlbums({ limit: 10000 }) as any'],
  ['db.getMusicTracks({ albumId: album.id as number, limit: 200 }) as Record<string, unknown>[]', 'db.getMusicTracks({ albumId: album.id as number, limit: 200 }) as any'],
  ["toolString(input, 'sort_by') || 'title'", "toolString(input, 'sort_by') as any || 'title'"],
  ["toolString(input, 'media_type') || undefined", "toolString(input, 'media_type') as any || undefined"]
]);

// 3. QualityAnalyzer.ts
fixFile('src/main/services/QualityAnalyzer.ts', [
  ['this.calculateResolutionScore(mediaItem.height)', 'this.calculateResolutionScore(mediaItem.height || 0)'],
  ['this.calculateBitrateScore(mediaItem.video_bitrate, mediaItem.height)', 'this.calculateBitrateScore(mediaItem.video_bitrate || 0, mediaItem.height || 0)'],
  ['this.getCodecEfficiency(mediaItem.video_codec)', 'this.getCodecEfficiency(mediaItem.video_codec || "")'],
  ['mediaItem.video_bitrate > 0', '(mediaItem.video_bitrate || 0) > 0'],
  ['this.formatBitrate(mediaItem.video_bitrate)', 'this.formatBitrate(mediaItem.video_bitrate || 0)'],
  ['mediaItem.height >= 2160', '(mediaItem.height || 0) >= 2160'],
  ['mediaItem.height >= 1080', '(mediaItem.height || 0) >= 1080'],
  ['mediaItem.height < 1080', '(mediaItem.height || 0) < 1080'],
  ['return {\n      media_item_id:', 'return {\n      efficiency_score: 0,\n      storage_debt_bytes: 0,\n      media_item_id:'],
  ['this.scoreQuality(mediaItem)', 'this.scoreQuality(mediaItem as any)'],
  ['this.scoreQuality(version)', 'this.scoreQuality(version as any)']
]);

// 4. MediaConverter.ts
fixFile('src/main/services/MediaConverter.ts', [
  ['return audioStreams.map((stream, index) => ({', 'return audioStreams.map((stream, index) => ({\n      title: stream.title || undefined,'],
  ['return subtitleStreams.map((stream, index) => ({', 'return subtitleStreams.map((stream, index) => ({\n      title: stream.title || undefined,']
]);

// 5. KodiMySQLProvider.ts
fixFile('src/main/providers/kodi/KodiMySQLProvider.ts', [
  ['this.mysqlConfig.videoDatabaseName', 'this.mysqlConfig!.videoDatabaseName'],
  ['this.mysqlConfig.musicDatabaseName', 'this.mysqlConfig!.musicDatabaseName'],
  ['connectionService.testConnection(this.mysqlConfig)', 'connectionService.testConnection(this.mysqlConfig!)'],
  ['connectionService.createPool(this.mysqlConfig)', 'connectionService.createPool(this.mysqlConfig!)'],
  ['videoDatabaseName: cc.videoDatabaseName,', 'videoDatabaseName: cc.videoDatabaseName || undefined,'],
  ['musicDatabaseName: cc.musicDatabaseName,', 'musicDatabaseName: cc.musicDatabaseName || undefined,'],
  ['ssl: cc.ssl,', 'ssl: cc.ssl || false,'],
  ['connectionTimeout: cc.connectionTimeout,', 'connectionTimeout: cc.connectionTimeout || 10000,'],
  ['ssl: credentials.ssl,', 'ssl: credentials.ssl || false,']
]);

// 6. SourceManager.ts
fixFile('src/main/services/SourceManager.ts', [
  ['targetFiles: filePaths.filter(Boolean) as string[],', 'targetFiles: (filePaths || []).filter(Boolean) as string[],'],
  ['onProgress(source.source_id, source.display_name, progress)', 'onProgress(source.source_id, source.display_name, progress as any)']
]);

// 7. TaskQueueService.ts
fixFile('src/main/services/TaskQueueService.ts', [
  ['currentItem: p.currentItem,', 'currentItem: p.currentItem || undefined,'],
  ['manager.scanLibrary(task.sourceId, task.libraryId, onProgress)', 'manager.scanLibrary(task.sourceId, task.libraryId, onProgress as any)'],
  ['plexProvider.scanMusicLibrary(task.libraryId, onProgress)', 'plexProvider.scanMusicLibrary(task.libraryId, onProgress as any)'],
  ['localProvider.scanLibrary(task.libraryId, { onProgress })', 'localProvider.scanLibrary(task.libraryId, { onProgress: onProgress as any })']
]);

// 8. KodiLocalProvider & LocalFolderProvider array fixes
fixFile('src/main/providers/kodi/KodiLocalProvider.ts', [
  ['targetFiles as string[]', '(targetFiles || []).filter(Boolean) as string[]']
]);
fixFile('src/main/providers/local/LocalFolderProvider.ts', [
  ['targetFiles as string[]', '(targetFiles || []).filter(Boolean) as string[]'],
  ['!scannedFilePaths.has(item.file_path)', '!scannedFilePaths.has(item.file_path || "")']
]);

// 9. SeriesCompletenessService.ts
fixFile('src/main/services/SeriesCompletenessService.ts', [
  ['ep: { season_number?: number; episode_number?: number }', 'ep: any']
]);

// 10. MovieCollectionService.ts
fixFile('src/main/services/MovieCollectionService.ts', [
  ['tmdb.searchMovie(movie.title, movie.year)', 'tmdb.searchMovie(movie.title, movie.year || undefined)']
]);
