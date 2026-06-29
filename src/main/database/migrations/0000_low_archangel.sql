CREATE TABLE `activity_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entry_type` text NOT NULL,
	`message` text NOT NULL,
	`task_id` text,
	`task_type` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `album_completeness` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`album_id` integer NOT NULL,
	`artist_name` text NOT NULL,
	`album_title` text NOT NULL,
	`musicbrainz_release_id` text,
	`musicbrainz_release_group_id` text,
	`total_tracks` integer NOT NULL,
	`owned_tracks` integer NOT NULL,
	`missing_tracks` text NOT NULL,
	`completeness_percentage` real NOT NULL,
	`efficiency_score` integer,
	`storage_debt_bytes` integer,
	`total_size` integer,
	`last_sync_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`album_id`) REFERENCES `music_albums`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `album_completeness_album_id_unique` ON `album_completeness` (`album_id`);--> statement-breakpoint
CREATE TABLE `artist_completeness` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`artist_name` text NOT NULL,
	`musicbrainz_id` text,
	`library_id` text NOT NULL,
	`total_albums` integer NOT NULL,
	`owned_albums` integer NOT NULL,
	`total_singles` integer NOT NULL,
	`owned_singles` integer NOT NULL,
	`total_eps` integer NOT NULL,
	`owned_eps` integer NOT NULL,
	`missing_albums` text NOT NULL,
	`missing_singles` text NOT NULL,
	`missing_eps` text NOT NULL,
	`completeness_percentage` real NOT NULL,
	`country` text,
	`active_years` text,
	`artist_type` text,
	`thumb_url` text,
	`efficiency_score` integer,
	`storage_debt_bytes` integer,
	`total_size` integer,
	`last_sync_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `artist_completeness_artist_name_unique` ON `artist_completeness` (`artist_name`);--> statement-breakpoint
CREATE TABLE `exclusions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`exclusion_type` text NOT NULL,
	`reference_id` integer,
	`reference_key` text,
	`parent_key` text,
	`title` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_exclusions_type_ref` ON `exclusions` (`exclusion_type`,`reference_id`);--> statement-breakpoint
CREATE INDEX `idx_exclusions_type_key` ON `exclusions` (`exclusion_type`,`reference_key`,`parent_key`);--> statement-breakpoint
CREATE TABLE `library_scans` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_id` text NOT NULL,
	`library_id` text NOT NULL,
	`library_name` text NOT NULL,
	`library_type` text NOT NULL,
	`last_scan_at` text,
	`items_scanned` integer,
	`is_enabled` integer NOT NULL,
	`is_protected` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_library_scans_unique` ON `library_scans` (`source_id`,`library_id`);--> statement-breakpoint
CREATE TABLE `media_item_collections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`media_item_id` integer NOT NULL,
	`collection_id` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`media_item_id`) REFERENCES `media_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`collection_id`) REFERENCES `movie_collections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_media_item_collections_unique` ON `media_item_collections` (`media_item_id`,`collection_id`);--> statement-breakpoint
CREATE TABLE `media_item_duplicates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_id` text NOT NULL,
	`external_id` text NOT NULL,
	`external_type` text NOT NULL,
	`media_item_ids` text NOT NULL,
	`status` text NOT NULL,
	`resolution_strategy` text,
	`resolved_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_media_item_duplicates_unique` ON `media_item_duplicates` (`source_id`,`external_id`,`external_type`);--> statement-breakpoint
CREATE TABLE `media_item_versions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`media_item_id` integer NOT NULL,
	`version_source` text NOT NULL,
	`edition` text,
	`label` text,
	`file_path` text NOT NULL,
	`file_size` integer NOT NULL,
	`duration` integer NOT NULL,
	`resolution` text NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`video_codec` text NOT NULL,
	`video_bitrate` integer NOT NULL,
	`audio_codec` text NOT NULL,
	`audio_channels` integer NOT NULL,
	`audio_bitrate` integer NOT NULL,
	`video_frame_rate` real,
	`color_bit_depth` integer,
	`hdr_format` text,
	`color_space` text,
	`video_profile` text,
	`video_level` integer,
	`audio_profile` text,
	`audio_sample_rate` integer,
	`has_object_audio` integer,
	`audio_tracks` text,
	`subtitle_tracks` text,
	`container` text,
	`file_mtime` integer,
	`quality_tier` text,
	`tier_quality` text,
	`tier_score` integer,
	`bitrate_tier_score` integer,
	`audio_tier_score` integer,
	`efficiency_score` integer,
	`storage_debt_bytes` integer,
	`original_language` text,
	`audio_language` text,
	`is_best` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`media_item_id`) REFERENCES `media_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_versions_media_item` ON `media_item_versions` (`media_item_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_versions_unique_file` ON `media_item_versions` (`media_item_id`,`file_path`);--> statement-breakpoint
CREATE TABLE `media_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_id` text NOT NULL,
	`source_type` text NOT NULL,
	`library_id` text,
	`plex_id` text NOT NULL,
	`title` text NOT NULL,
	`sort_title` text,
	`year` integer,
	`type` text NOT NULL,
	`series_title` text,
	`season_number` integer,
	`episode_number` integer,
	`file_path` text NOT NULL,
	`file_size` integer NOT NULL,
	`duration` integer NOT NULL,
	`resolution` text NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`video_codec` text NOT NULL,
	`video_bitrate` integer NOT NULL,
	`audio_codec` text NOT NULL,
	`audio_channels` integer NOT NULL,
	`audio_bitrate` integer NOT NULL,
	`video_frame_rate` real,
	`color_bit_depth` integer,
	`hdr_format` text,
	`color_space` text,
	`video_profile` text,
	`video_level` integer,
	`audio_profile` text,
	`audio_sample_rate` integer,
	`has_object_audio` integer,
	`audio_tracks` text,
	`subtitle_tracks` text,
	`container` text,
	`version_count` integer NOT NULL,
	`file_mtime` integer,
	`imdb_id` text,
	`tmdb_id` text,
	`series_tmdb_id` text,
	`original_language` text,
	`audio_language` text,
	`poster_url` text,
	`episode_thumb_url` text,
	`season_poster_url` text,
	`summary` text,
	`user_fixed_match` integer,
	`quality_tier` text,
	`tier_quality` text,
	`tier_score` integer,
	`bitrate_tier_score` integer,
	`audio_tier_score` integer,
	`efficiency_score` integer,
	`storage_debt_bytes` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_media_items_source_provider_id` ON `media_items` (`source_id`,`plex_id`);--> statement-breakpoint
CREATE INDEX `idx_media_items_type` ON `media_items` (`type`);--> statement-breakpoint
CREATE INDEX `idx_media_items_source` ON `media_items` (`source_id`);--> statement-breakpoint
CREATE INDEX `idx_media_items_library` ON `media_items` (`source_id`,`library_id`);--> statement-breakpoint
CREATE INDEX `idx_media_items_series` ON `media_items` (`series_title`);--> statement-breakpoint
CREATE TABLE `media_sources` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_id` text NOT NULL,
	`source_type` text NOT NULL,
	`display_name` text NOT NULL,
	`connection_config` text NOT NULL,
	`is_enabled` integer NOT NULL,
	`last_connected_at` text,
	`last_scan_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_sources_source_id_unique` ON `media_sources` (`source_id`);--> statement-breakpoint
CREATE TABLE `movie_collections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tmdb_collection_id` text NOT NULL,
	`collection_name` text NOT NULL,
	`source_id` text NOT NULL,
	`library_id` text NOT NULL,
	`total_movies` integer NOT NULL,
	`owned_movies` integer NOT NULL,
	`missing_movies` text NOT NULL,
	`owned_movie_ids` text NOT NULL,
	`completeness_percentage` real NOT NULL,
	`poster_url` text,
	`backdrop_url` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_movie_collections_unique` ON `movie_collections` (`tmdb_collection_id`,`source_id`,`library_id`);--> statement-breakpoint
CREATE TABLE `music_albums` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_id` text NOT NULL,
	`source_type` text NOT NULL,
	`library_id` text,
	`provider_id` text NOT NULL,
	`artist_id` integer,
	`artist_name` text NOT NULL,
	`title` text NOT NULL,
	`sort_title` text,
	`year` integer,
	`musicbrainz_id` text,
	`musicbrainz_release_group_id` text,
	`genres` text,
	`mood` text,
	`studio` text,
	`album_type` text,
	`track_count` integer,
	`total_duration` integer,
	`total_size` integer,
	`best_audio_codec` text,
	`best_audio_bitrate` integer,
	`best_sample_rate` integer,
	`best_bit_depth` integer,
	`avg_audio_bitrate` integer,
	`thumb_url` text,
	`art_url` text,
	`user_fixed_match` integer,
	`release_date` text,
	`added_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`artist_id`) REFERENCES `music_artists`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_music_albums_source_provider` ON `music_albums` (`source_id`,`provider_id`);--> statement-breakpoint
CREATE TABLE `music_artists` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_id` text NOT NULL,
	`source_type` text NOT NULL,
	`library_id` text,
	`provider_id` text NOT NULL,
	`name` text NOT NULL,
	`sort_name` text,
	`musicbrainz_id` text,
	`genres` text,
	`mood` text,
	`country` text,
	`biography` text,
	`thumb_url` text,
	`art_url` text,
	`user_fixed_match` integer,
	`album_count` integer,
	`track_count` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_music_artists_source_provider` ON `music_artists` (`source_id`,`provider_id`);--> statement-breakpoint
CREATE TABLE `music_quality_scores` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`album_id` integer NOT NULL,
	`quality_tier` text NOT NULL,
	`tier_quality` text NOT NULL,
	`tier_score` integer NOT NULL,
	`codec_score` integer NOT NULL,
	`bitrate_score` integer NOT NULL,
	`efficiency_score` integer,
	`storage_debt_bytes` integer,
	`needs_upgrade` integer NOT NULL,
	`issues` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`album_id`) REFERENCES `music_albums`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `music_quality_scores_album_id_unique` ON `music_quality_scores` (`album_id`);--> statement-breakpoint
CREATE TABLE `music_tracks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_id` text NOT NULL,
	`source_type` text NOT NULL,
	`library_id` text,
	`provider_id` text NOT NULL,
	`album_id` integer,
	`artist_id` integer,
	`album_name` text,
	`artist_name` text NOT NULL,
	`title` text NOT NULL,
	`track_number` integer,
	`disc_number` integer,
	`duration` integer,
	`file_path` text,
	`file_size` integer,
	`container` text,
	`file_mtime` integer,
	`audio_codec` text NOT NULL,
	`audio_bitrate` integer,
	`sample_rate` integer,
	`bit_depth` integer,
	`channels` integer,
	`is_lossless` integer,
	`is_hi_res` integer,
	`musicbrainz_id` text,
	`genres` text,
	`mood` text,
	`added_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`album_id`) REFERENCES `music_albums`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`artist_id`) REFERENCES `music_artists`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_music_tracks_source_provider` ON `music_tracks` (`source_id`,`provider_id`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`message` text NOT NULL,
	`reference_id` text,
	`source_id` text,
	`source_name` text,
	`item_count` integer,
	`metadata` text,
	`is_read` integer NOT NULL,
	`created_at` text NOT NULL,
	`read_at` text
);
--> statement-breakpoint
CREATE TABLE `quality_scores` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`media_item_id` integer NOT NULL,
	`quality_tier` text NOT NULL,
	`tier_quality` text NOT NULL,
	`tier_score` integer NOT NULL,
	`bitrate_tier_score` integer NOT NULL,
	`audio_tier_score` integer NOT NULL,
	`overall_score` integer NOT NULL,
	`resolution_score` integer NOT NULL,
	`bitrate_score` integer NOT NULL,
	`audio_score` integer NOT NULL,
	`efficiency_score` integer,
	`storage_debt_bytes` integer,
	`is_low_quality` integer NOT NULL,
	`needs_upgrade` integer NOT NULL,
	`issues` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`media_item_id`) REFERENCES `media_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `quality_scores_media_item_id_unique` ON `quality_scores` (`media_item_id`);--> statement-breakpoint
CREATE TABLE `series_completeness` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`series_title` text NOT NULL,
	`source_id` text NOT NULL,
	`library_id` text NOT NULL,
	`total_seasons` integer NOT NULL,
	`total_episodes` integer NOT NULL,
	`owned_seasons` integer NOT NULL,
	`owned_episodes` integer NOT NULL,
	`missing_seasons` text NOT NULL,
	`missing_episodes` text NOT NULL,
	`completeness_percentage` real NOT NULL,
	`tmdb_id` text,
	`poster_url` text,
	`backdrop_url` text,
	`status` text,
	`user_fixed_match` integer,
	`efficiency_score` integer,
	`storage_debt_bytes` integer,
	`total_size` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_series_completeness_unique` ON `series_completeness` (`series_title`,`source_id`,`library_id`);--> statement-breakpoint
CREATE TABLE `settings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `settings_key_unique` ON `settings` (`key`);--> statement-breakpoint
CREATE TABLE `task_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`task_id` text NOT NULL,
	`type` text NOT NULL,
	`label` text NOT NULL,
	`source_id` text,
	`library_id` text,
	`status` text NOT NULL,
	`error` text,
	`result` text,
	`created_at` text NOT NULL,
	`started_at` text,
	`completed_at` text,
	`duration_ms` integer,
	`recorded_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `wishlist_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`media_type` text NOT NULL,
	`title` text NOT NULL,
	`subtitle` text,
	`year` integer,
	`reason` text NOT NULL,
	`tmdb_id` text,
	`imdb_id` text,
	`musicbrainz_id` text,
	`series_title` text,
	`season_number` integer,
	`episode_number` integer,
	`collection_name` text,
	`artist_name` text,
	`album_title` text,
	`poster_url` text,
	`priority` integer NOT NULL,
	`notes` text,
	`status` text NOT NULL,
	`completed_at` text,
	`current_quality_tier` text,
	`current_quality_level` text,
	`current_resolution` text,
	`current_video_codec` text,
	`current_audio_codec` text,
	`media_item_id` integer,
	`added_at` text NOT NULL,
	`updated_at` text NOT NULL
);
