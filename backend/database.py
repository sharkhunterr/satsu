"""SQLite WAL database layer with async access via aiosqlite."""

import os
import aiosqlite
from config import get_data_dir

DB_PATH = os.path.join(get_data_dir(), "espscancam.db")

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS devices (
    mac           TEXT PRIMARY KEY,
    name          TEXT,
    ip            TEXT NOT NULL,
    firmware      TEXT,
    max_pages     INTEGER DEFAULT 10,
    resolution    TEXT DEFAULT 'UXGA',
    config        TEXT DEFAULT '{}',
    total_scans   INTEGER DEFAULT 0,
    last_seen     TEXT NOT NULL,
    created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS batches (
    id                    TEXT PRIMARY KEY,
    device_mac            TEXT,
    source_type           TEXT NOT NULL,
    page_count            INTEGER DEFAULT 0,
    status                TEXT NOT NULL DEFAULT 'pending',
    error                 TEXT,
    profile               TEXT DEFAULT 'default',
    export_info           TEXT DEFAULT '{}',
    file_size             INTEGER DEFAULT 0,
    processing_duration_ms INTEGER DEFAULT 0,
    created_at            TEXT NOT NULL,
    updated_at            TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pages (
    batch_id             TEXT NOT NULL,
    page_index           INTEGER NOT NULL,
    status               TEXT NOT NULL DEFAULT 'pending',
    original_path        TEXT NOT NULL,
    processed_path       TEXT,
    processing_details   TEXT DEFAULT '{}',
    file_size_original   INTEGER DEFAULT 0,
    file_size_processed  INTEGER DEFAULT 0,
    created_at           TEXT NOT NULL,
    PRIMARY KEY (batch_id, page_index),
    FOREIGN KEY (batch_id) REFERENCES batches(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS logs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp   INTEGER NOT NULL,
    level       TEXT NOT NULL,
    category    TEXT NOT NULL,
    source      TEXT NOT NULL,
    device_mac  TEXT,
    message     TEXT NOT NULL,
    details     TEXT DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS profiles (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    options     TEXT NOT NULL,
    is_default  INTEGER DEFAULT 0,
    created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_logs_level ON logs(level);
CREATE INDEX IF NOT EXISTS idx_logs_category ON logs(category);
CREATE INDEX IF NOT EXISTS idx_logs_device_mac ON logs(device_mac);
CREATE INDEX IF NOT EXISTS idx_logs_source ON logs(source);
CREATE INDEX IF NOT EXISTS idx_batches_status ON batches(status);
CREATE INDEX IF NOT EXISTS idx_batches_created ON batches(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_batches_device ON batches(device_mac);
"""

DEFAULT_PROFILES = [
    {
        "id": "default",
        "name": "Document Standard",
        "options": {
            "auto_crop": {"enabled": True, "sensitivity": 50},
            "deskew": {"enabled": True, "max_angle": 15},
            "denoise": {"enabled": True, "strength": 10},
            "clahe": {"enabled": True, "clip_limit": 2.0, "grid_size": 8},
            "sharpen": {"enabled": True, "amount": 1.5},
            "white_balance": {"enabled": True},
            "bw_mode": {"enabled": False, "method": "adaptive", "block_size": 11, "constant": 2},
            "output": {"format": "pdf", "quality": 85, "dpi": 300},
        },
        "is_default": 1,
    },
    {
        "id": "document-bw",
        "name": "Document B&W",
        "options": {
            "auto_crop": {"enabled": True, "sensitivity": 50},
            "deskew": {"enabled": True, "max_angle": 15},
            "denoise": {"enabled": True, "strength": 10},
            "clahe": {"enabled": True, "clip_limit": 2.0, "grid_size": 8},
            "sharpen": {"enabled": True, "amount": 1.5},
            "white_balance": {"enabled": True},
            "bw_mode": {"enabled": True, "method": "adaptive", "block_size": 11, "constant": 2},
            "output": {"format": "pdf", "quality": 85, "dpi": 300},
        },
        "is_default": 0,
    },
    {
        "id": "photo-color",
        "name": "Photo / Color",
        "options": {
            "auto_crop": {"enabled": True, "sensitivity": 50},
            "deskew": {"enabled": False, "max_angle": 15},
            "denoise": {"enabled": True, "strength": 5},
            "clahe": {"enabled": True, "clip_limit": 1.5, "grid_size": 8},
            "sharpen": {"enabled": True, "amount": 1.0},
            "white_balance": {"enabled": True},
            "bw_mode": {"enabled": False, "method": "adaptive", "block_size": 11, "constant": 2},
            "output": {"format": "jpeg", "quality": 95, "dpi": 300},
        },
        "is_default": 0,
    },
    {
        "id": "receipt",
        "name": "Receipt",
        "options": {
            "auto_crop": {"enabled": True, "sensitivity": 60},
            "deskew": {"enabled": True, "max_angle": 15},
            "denoise": {"enabled": True, "strength": 15},
            "clahe": {"enabled": True, "clip_limit": 4.0, "grid_size": 8},
            "sharpen": {"enabled": True, "amount": 2.0},
            "white_balance": {"enabled": False},
            "bw_mode": {"enabled": True, "method": "adaptive", "block_size": 15, "constant": 4},
            "output": {"format": "pdf", "quality": 85, "dpi": 300},
        },
        "is_default": 0,
    },
    {
        "id": "quick",
        "name": "Quick",
        "options": {
            "auto_crop": {"enabled": True, "sensitivity": 50},
            "deskew": {"enabled": False, "max_angle": 15},
            "denoise": {"enabled": False, "strength": 10},
            "clahe": {"enabled": False, "clip_limit": 2.0, "grid_size": 8},
            "sharpen": {"enabled": False, "amount": 1.5},
            "white_balance": {"enabled": False},
            "bw_mode": {"enabled": False, "method": "adaptive", "block_size": 11, "constant": 2},
            "output": {"format": "pdf", "quality": 85, "dpi": 300},
        },
        "is_default": 0,
    },
]


async def get_db() -> aiosqlite.Connection:
    """Get a database connection with WAL mode and pragmas."""
    db = await aiosqlite.connect(DB_PATH)
    db.row_factory = aiosqlite.Row
    await db.execute("PRAGMA journal_mode=WAL")
    await db.execute("PRAGMA busy_timeout=5000")
    await db.execute("PRAGMA foreign_keys=ON")
    await db.execute("PRAGMA synchronous=NORMAL")
    await db.execute("PRAGMA temp_store=MEMORY")
    await db.execute("PRAGMA cache_size=-8000")  # 8MB
    return db


async def init_db() -> None:
    """Initialize database schema and seed default profiles."""
    db = await get_db()
    try:
        await db.executescript(SCHEMA_SQL)

        # Migration: add device_info column if missing
        cursor = await db.execute("PRAGMA table_info(batches)")
        columns = {row[1] for row in await cursor.fetchall()}
        if "device_info" not in columns:
            await db.execute("ALTER TABLE batches ADD COLUMN device_info TEXT DEFAULT ''")
            await db.commit()

        # Migration: add crop_info column to pages if missing
        cursor = await db.execute("PRAGMA table_info(pages)")
        page_columns = {row[1] for row in await cursor.fetchall()}
        if "crop_info" not in page_columns:
            await db.execute("ALTER TABLE pages ADD COLUMN crop_info TEXT DEFAULT ''")
            await db.commit()

        # Seed default profiles if none exist
        cursor = await db.execute("SELECT COUNT(*) FROM profiles")
        row = await cursor.fetchone()
        if row[0] == 0:
            import json
            from datetime import datetime, timezone
            now = datetime.now(timezone.utc).isoformat()
            for profile in DEFAULT_PROFILES:
                await db.execute(
                    "INSERT INTO profiles (id, name, options, is_default, created_at) VALUES (?, ?, ?, ?, ?)",
                    (profile["id"], profile["name"], json.dumps(profile["options"]),
                     profile["is_default"], now),
                )
        await db.commit()
    finally:
        await db.close()
