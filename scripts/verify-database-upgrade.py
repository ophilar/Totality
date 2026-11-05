"""Verify an on-disk upstream database upgrades in the real Totality Electron app."""

import os
import queue
import signal
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path


def launch_and_verify(schema_path: Path) -> None:
    schema_source = schema_path.read_text(encoding="utf-8")
    if schema_source.count("`") != 2:
        raise AssertionError("Unexpected upstream schema source format")
    schema = schema_source.split("`")[1]

    with tempfile.TemporaryDirectory(prefix="totality-upgrade-") as temp:
        profile = Path(temp)
        config_root = profile / "config"
        data_dir = config_root / "totality"
        data_dir.mkdir(parents=True)
        home = profile / "home"
        home.mkdir()
        db_path = data_dir / "totality-v2.db"

        with sqlite3.connect(db_path) as db:
            db.executescript(schema)
            db.execute(
                "INSERT INTO media_sources (source_id, source_type, display_name) VALUES (?, ?, ?)",
                ("upgrade-source", "plex", "Legacy Source"),
            )
            db.execute(
                """INSERT INTO media_items (
                    source_id, source_type, library_id, plex_id, title, type,
                    file_path, file_size, duration, resolution, width, height,
                    video_codec, video_bitrate, audio_codec, audio_channels, audio_bitrate
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                ("upgrade-source", "plex", "films", "legacy-film",
                 "Persisted Movie", "movie", "/legacy/movie.mkv", 12345,
                 7200, "1080p", 1920, 1080, "H264", 6000, "AAC", 2, 192),
            )
            db.execute(
                "INSERT INTO settings (key, value) VALUES (?, ?)",
                ("upgrade_integrity_sentinel", "retained"),
            )
            db.commit()

        env = os.environ.copy()
        env["HOME"] = str(home)
        env["XDG_CONFIG_HOME"] = str(config_root)
        command = [
            "xvfb-run", "-a",
            str(Path.cwd() / "node_modules/.bin/electron"),
            "--disable-dev-shm-usage",
            str(Path.cwd()),
        ]
        process = subprocess.Popen(
            command, env=env, text=True, stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT, start_new_session=True, bufsize=1,
        )
        events: queue.Queue[str] = queue.Queue()
        output: list[str] = []

        def collect_output() -> None:
            assert process.stdout is not None
            for line in process.stdout:
                events.put(line)

        threading.Thread(target=collect_output, daemon=True).start()
        migrated = False
        deadline = time.monotonic() + 90
        try:
            while time.monotonic() < deadline:
                try:
                    line = events.get(timeout=1)
                except queue.Empty:
                    if process.poll() is not None:
                        break
                    continue
                output.append(line)
                if "Database initialized successfully" in line:
                    migrated = True
                    break
        finally:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGTERM)
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait()
            while not events.empty():
                output.append(events.get_nowait())

        if not migrated:
            raise AssertionError(
                "Electron database upgrade did not complete:\n" + "".join(output[-80:])
            )

        with sqlite3.connect(db_path) as db:
            assert db.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
            assert db.execute("PRAGMA foreign_key_check").fetchall() == []
            assert db.execute(
                "SELECT value FROM settings WHERE key = 'upgrade_integrity_sentinel'"
            ).fetchone() == ("retained",)
            assert db.execute(
                "SELECT source_id, display_name FROM media_sources WHERE source_id = ?",
                ("upgrade-source",),
            ).fetchone() == ("upgrade-source", "Legacy Source")
            assert db.execute(
                "SELECT plex_id, title, file_path FROM media_items WHERE source_id = ?",
                ("upgrade-source",),
            ).fetchone() == ("legacy-film", "Persisted Movie", "/legacy/movie.mkv")
            assert db.execute(
                "SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?",
                ("idx_wishlist_items_status",),
            ).fetchone() == ("idx_wishlist_items_status",)

        print("Real Electron upgrade from upstream schema preserved data and SQLite integrity")


if __name__ == "__main__":
    launch_and_verify(Path(sys.argv[1]))
