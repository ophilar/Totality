#!/usr/bin/env python3
"""
Regression test suite for TV Show Deduplication (TOT-BUG-03) & Single-Identity Invariants.

Tests:
1. Path normalization & release tag stripping (Season folders, quality tags, codecs, group names).
2. Database uniqueness constraint enforcement (UNIQUE series_identity_key, tvdb_id, tmdb_id).
3. Migration & deduplication cluster resolution.
"""

import re
import sqlite3
import unittest


def clean_series_title_and_year(raw_title: str) -> dict:
    if not raw_title:
        return {"title": "", "year": None}

    # Normalize separators
    working = re.sub(r"[._]", " ", raw_title).strip()

    # Match Year in parentheses: "Show Name (2022)"
    paren_match = re.search(r"^(.*?)\s*\((\d{4})\)\s*$", working)
    if paren_match:
        return {"title": paren_match.group(1).strip(), "year": int(paren_match.group(2))}

    # Match bare Year at end or followed by tags: "Show Name 2022 1080p..."
    bare_match = re.search(r"^(.*?)\s+((?:19|20)\d{2})(?:\s+.*)?$", working, re.IGNORECASE)
    if bare_match:
        return {"title": bare_match.group(1).strip(), "year": int(bare_match.group(2))}

    return {"title": working.strip(), "year": None}


def strip_release_tags(raw: str) -> str:
    if not raw:
        return ""
    cleaned = raw

    # Bracketed / Parenthesized tags
    cleaned = re.sub(r"\[[^\]]*\]|\((?!(?:19|20)\d{2}\))[^)]*\)", " ", cleaned)

    # Resolution & Source
    cleaned = re.sub(
        r"\b(?:2160p|4k|uhd|1080p|1080i|720p|576p|480p|remux|bluray|blu-ray|bdrip|brrip|web-dl|webdl|webrip|web|hdtv|dvdrip|dvd)\b",
        " ",
        cleaned,
        flags=re.IGNORECASE,
    )

    # Codecs & Profiles
    cleaned = re.sub(
        r"\b(?:x265|h265|hevc|x264|h264|avc|av1|xvid|divx|10bit|8bit|hdr10\+|hdr10|hdr|dv|dolby\s*vision|sdr)\b",
        " ",
        cleaned,
        flags=re.IGNORECASE,
    )

    # Audio profiles
    cleaned = re.sub(
        r"\b(?:truehd|atmos|dts-hd\s*ma|dts-hd|dts|ddp5\.1|ddp|dd5\.1|ac3|eac3|aac2\.0|aac|flac|mp3|lossless)\b",
        " ",
        cleaned,
        flags=re.IGNORECASE,
    )

    # Trailing scene release group tags (e.g. -NTb, -FLUX, -GECKOS)
    cleaned = re.sub(r"-[A-Za-z0-9_]+$", " ", cleaned)

    # Separator cleanup
    cleaned = re.sub(r"[._]", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()

    return cleaned


def is_season_or_extras_folder(segment: str) -> bool:
    if not segment:
        return False
    trimmed = segment.strip()
    patterns = [
        r"^(?:season|staffel|saison|temporada|series)\s*\d+$",
        r"^s\d+$",
        r"^(?:specials|extras|featurettes|bonus|deleted\s*scenes|behind\s*the\s*scenes)$",
    ]
    for pat in patterns:
        if re.match(pat, trimmed, re.IGNORECASE):
            return True
    return False


def normalize_series_title(title: str) -> str:
    cleaned = strip_release_tags(title)
    cleaned = re.sub(r"[._\-\s]+", " ", cleaned).strip().lower()
    return cleaned


class TestTVShowDeduplication(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(":memory:")
        self.conn.row_factory = sqlite3.Row
        self.cursor = self.conn.cursor()

        # Build schema
        self.cursor.executescript("""
            CREATE TABLE series_completeness (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                series_title TEXT NOT NULL,
                series_identity_key TEXT,
                source_id TEXT NOT NULL DEFAULT '',
                library_id TEXT NOT NULL DEFAULT '',
                total_seasons INTEGER NOT NULL DEFAULT 0,
                total_episodes INTEGER NOT NULL DEFAULT 0,
                owned_seasons INTEGER NOT NULL DEFAULT 0,
                owned_episodes INTEGER NOT NULL DEFAULT 0,
                missing_seasons TEXT NOT NULL DEFAULT '[]',
                missing_episodes TEXT NOT NULL DEFAULT '[]',
                completeness_percentage REAL NOT NULL DEFAULT 0,
                tmdb_id TEXT,
                tvdb_id TEXT,
                poster_url TEXT,
                backdrop_url TEXT,
                status TEXT,
                user_fixed_match INTEGER DEFAULT 0,
                efficiency_score INTEGER DEFAULT 0,
                storage_debt_bytes INTEGER DEFAULT 0,
                total_size INTEGER DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE media_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source_id TEXT NOT NULL,
                library_id TEXT,
                title TEXT NOT NULL,
                type TEXT NOT NULL,
                series_title TEXT,
                series_identity_key TEXT,
                series_tmdb_id TEXT,
                season_number INTEGER,
                episode_number INTEGER,
                file_path TEXT NOT NULL,
                file_size INTEGER NOT NULL DEFAULT 0,
                storage_debt_bytes INTEGER DEFAULT 0,
                efficiency_score INTEGER DEFAULT 0
            );

            CREATE UNIQUE INDEX idx_series_completeness_unique ON series_completeness(series_identity_key, source_id, library_id);
            CREATE UNIQUE INDEX idx_series_completeness_tvdb ON series_completeness(source_id, library_id, tvdb_id) WHERE tvdb_id IS NOT NULL AND tvdb_id != '';
            CREATE UNIQUE INDEX idx_series_completeness_tmdb ON series_completeness(source_id, library_id, tmdb_id) WHERE tmdb_id IS NOT NULL AND tmdb_id != '';
        """)
        self.conn.commit()

    def tearDown(self):
        self.conn.close()

    def test_season_folder_filtering(self):
        """Verify season and extra folders are recognized and rejected as series names."""
        season_folders = [
            "Season 1", "Season 02", "season 10",
            "S01", "S2", "Staffel 1", "Staffel 03",
            "Saison 2", "Temporada 1", "Series 1",
            "Specials", "Extras", "Featurettes", "Behind the Scenes"
        ]
        for folder in season_folders:
            self.assertTrue(is_season_or_extras_folder(folder), f"Failed to identify season folder: {folder}")

        show_folders = [
            "Breaking Bad (2008)",
            "Game of Thrones",
            "Severance (2022)",
            "The Last of Us",
            "Stranger Things S01-S04"
        ]
        for folder in show_folders:
            self.assertFalse(is_season_or_extras_folder(folder), f"False positive for show folder: {folder}")

    def test_release_tag_stripping(self):
        """Verify tags, resolutions, and scene groups are stripped cleanly from folder names."""
        test_cases = [
            ("Breaking.Bad.S01.1080p.BluRay.x265-GROUP", "Breaking Bad"),
            ("Severance.2022.2160p.WEB-DL.DDP5.1.Atmos.DV.HEVC-FLUX", "Severance 2022"),
            ("The.Last.of.Us.S01.720p.HDTV.x264-NTb", "The Last of Us"),
            ("Shogun (2024) [1080p BluRay Remux AV1 Opus]", "Shogun (2024)"),
        ]
        for raw, expected in test_cases:
            cleaned = strip_release_tags(raw)
            # Remove any residual season markers
            cleaned = re.sub(r"\bS\d+(-S\d+)?\b", "", cleaned, flags=re.IGNORECASE).strip()
            cleaned = re.sub(r"\s+", " ", cleaned)
            self.assertEqual(cleaned, expected, f"Failed release tag stripping for: {raw}")

    def test_title_and_year_extraction(self):
        """Verify parenthesized and bare years are parsed accurately."""
        self.assertEqual(clean_series_title_and_year("Breaking Bad (2008)"), {"title": "Breaking Bad", "year": 2008})
        self.assertEqual(clean_series_title_and_year("Severance 2022 1080p"), {"title": "Severance", "year": 2022})
        self.assertEqual(clean_series_title_and_year("Severance (2022)"), {"title": "Severance", "year": 2022})
        self.assertEqual(clean_series_title_and_year("The Last of Us"), {"title": "The Last of Us", "year": None})

    def test_db_uniqueness_constraints(self):
        """Verify SQLite raises IntegrityError on duplicate series_identity_key, tvdb_id, or tmdb_id."""
        # 1. Insert primary row
        self.cursor.execute("""
            INSERT INTO series_completeness (series_title, series_identity_key, source_id, library_id, tmdb_id, tvdb_id)
            VALUES ('Breaking Bad', 'tmdb:1396', 'src1', 'lib1', '1396', '81189')
        """)
        self.conn.commit()

        # 2. Attempt duplicate series_identity_key
        with self.assertRaises(sqlite3.IntegrityError):
            self.cursor.execute("""
                INSERT INTO series_completeness (series_title, series_identity_key, source_id, library_id)
                VALUES ('Breaking Bad Season 1', 'tmdb:1396', 'src1', 'lib1')
            """)

        # 3. Attempt duplicate tmdb_id with different key
        with self.assertRaises(sqlite3.IntegrityError):
            self.cursor.execute("""
                INSERT INTO series_completeness (series_title, series_identity_key, source_id, library_id, tmdb_id)
                VALUES ('Breaking Bad (2008)', 'unresolved:src1:lib1:breaking-bad', 'src1', 'lib1', '1396')
            """)

        # 4. Attempt duplicate tvdb_id with different key
        with self.assertRaises(sqlite3.IntegrityError):
            self.cursor.execute("""
                INSERT INTO series_completeness (series_title, series_identity_key, source_id, library_id, tvdb_id)
                VALUES ('Breaking Bad Extra', 'unresolved:src1:lib1:breaking-bad-extra', 'src1', 'lib1', '81189')
            """)

    def test_duplicate_merge_migration(self):
        """Simulate merging duplicate series completeness records and repointing media items."""
        # Temporarily drop unique index to simulate legacy database with duplicate rows
        self.cursor.execute("DROP INDEX idx_series_completeness_unique")
        self.cursor.execute("DROP INDEX idx_series_completeness_tmdb")
        self.cursor.execute("DROP INDEX idx_series_completeness_tvdb")

        # Insert duplicate rows for Breaking Bad
        self.cursor.execute("""
            INSERT INTO series_completeness (id, series_title, series_identity_key, source_id, library_id, tmdb_id, tvdb_id, owned_episodes, total_episodes)
            VALUES (1, 'Breaking Bad', 'tmdb:1396', 'src1', 'lib1', '1396', '81189', 20, 62)
        """)
        self.cursor.execute("""
            INSERT INTO series_completeness (id, series_title, series_identity_key, source_id, library_id, tmdb_id, tvdb_id, owned_episodes, total_episodes)
            VALUES (2, 'Breaking Bad (2008)', 'unresolved:src1:lib1:breaking-bad-2008', 'src1', 'lib1', NULL, NULL, 42, 62)
        """)

        # Insert media items linked to both records
        self.cursor.execute("""
            INSERT INTO media_items (source_id, library_id, title, type, series_title, series_identity_key, season_number, episode_number, file_path, file_size)
            VALUES ('src1', 'lib1', 'Pilot', 'episode', 'Breaking Bad', 'tmdb:1396', 1, 1, '/shows/Breaking Bad/S01E01.mkv', 1000000)
        """)
        self.cursor.execute("""
            INSERT INTO media_items (source_id, library_id, title, type, series_title, series_identity_key, season_number, episode_number, file_path, file_size)
            VALUES ('src1', 'lib1', 'Cat''s in the Bag...', 'episode', 'Breaking Bad (2008)', 'unresolved:src1:lib1:breaking-bad-2008', 1, 2, '/shows/Breaking Bad (2008)/S01E02.mkv', 1000000)
        """)
        self.conn.commit()

        # Run merge simulation logic
        canonical_key = "tmdb:1396"
        canonical_title = "Breaking Bad"
        primary_id = 1
        secondary_id = 2

        # 1. Repoint media items
        self.cursor.execute("""
            UPDATE media_items
            SET series_identity_key = ?, series_title = ?, series_tmdb_id = '1396'
            WHERE type = 'episode' AND source_id = 'src1' AND library_id = 'lib1'
        """, (canonical_key, canonical_title))

        # 2. Aggregate stats
        self.cursor.execute("""
            SELECT COUNT(DISTINCT season_number) as seasons, COUNT(*) as episodes, TOTAL(file_size) as total_size
            FROM media_items WHERE series_identity_key = ?
        """, (canonical_key,))
        stats = self.cursor.fetchone()

        # 3. Update primary row
        self.cursor.execute("""
            UPDATE series_completeness
            SET series_title = ?, series_identity_key = ?, owned_seasons = ?, owned_episodes = ?, total_size = ?
            WHERE id = ?
        """, (canonical_title, canonical_key, stats["seasons"], stats["episodes"], stats["total_size"], primary_id))

        # 4. Delete duplicate secondary row
        self.cursor.execute("DELETE FROM series_completeness WHERE id = ?", (secondary_id,))

        # 5. Re-create unique constraints
        self.cursor.execute("CREATE UNIQUE INDEX idx_series_completeness_unique ON series_completeness(series_identity_key, source_id, library_id)")
        self.cursor.execute("CREATE UNIQUE INDEX idx_series_completeness_tvdb ON series_completeness(source_id, library_id, tvdb_id) WHERE tvdb_id IS NOT NULL AND tvdb_id != ''")
        self.cursor.execute("CREATE UNIQUE INDEX idx_series_completeness_tmdb ON series_completeness(source_id, library_id, tmdb_id) WHERE tmdb_id IS NOT NULL AND tmdb_id != ''")
        self.conn.commit()

        # Verify exactly 1 series completeness record exists with 2 owned episodes
        self.cursor.execute("SELECT * FROM series_completeness WHERE source_id = 'src1' AND library_id = 'lib1'")
        remaining = self.cursor.fetchall()
        self.assertEqual(len(remaining), 1)
        self.assertEqual(remaining[0]["id"], primary_id)
        self.assertEqual(remaining[0]["series_title"], "Breaking Bad")
        self.assertEqual(remaining[0]["owned_episodes"], 2)

        # Verify all media items now reference the canonical series identity key
        self.cursor.execute("SELECT series_identity_key, series_title FROM media_items")
        episodes = self.cursor.fetchall()
        self.assertEqual(len(episodes), 2)
        for ep in episodes:
            self.assertEqual(ep["series_identity_key"], canonical_key)
            self.assertEqual(ep["series_title"], "Breaking Bad")


if __name__ == "__main__":
    unittest.main()
