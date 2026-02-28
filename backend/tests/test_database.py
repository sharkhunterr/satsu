"""Tests for database.py — schema creation, CRUD, cascade delete."""

import os
import json
import asyncio
import tempfile
import pytest
import aiosqlite

# Set test data dir before importing
os.environ["SATSU_DATA_DIR"] = tempfile.mkdtemp()

from database import get_db, init_db, DB_PATH

@pytest.fixture(autouse=True)
async def fresh_db():
    """Create a fresh database for each test."""
    os.environ["SATSU_DATA_DIR"] = tempfile.mkdtemp()
    # Reimport to pick up new path
    import database
    database.DB_PATH = os.path.join(os.environ["SATSU_DATA_DIR"], "satsu.db")
    await init_db()
    yield

@pytest.mark.asyncio
class TestSchemaCreation:
    async def test_tables_exist(self):
        db = await get_db()
        try:
            cursor = await db.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
            tables = [row[0] for row in await cursor.fetchall()]
            assert "devices" in tables
            assert "batches" in tables
            assert "pages" in tables
            assert "logs" in tables
            assert "profiles" in tables
        finally:
            await db.close()

    async def test_default_profiles_seeded(self):
        db = await get_db()
        try:
            cursor = await db.execute("SELECT COUNT(*) FROM profiles")
            count = (await cursor.fetchone())[0]
            assert count == 5
        finally:
            await db.close()

@pytest.mark.asyncio
class TestDeviceCRUD:
    async def test_insert_device(self):
        db = await get_db()
        try:
            await db.execute(
                "INSERT INTO devices (mac, ip, last_seen, created_at) VALUES (?, ?, ?, ?)",
                ("AA:BB:CC:DD:EE:FF", "192.168.1.10", "2025-01-01T00:00:00Z", "2025-01-01T00:00:00Z"),
            )
            await db.commit()
            cursor = await db.execute("SELECT * FROM devices WHERE mac = ?", ("AA:BB:CC:DD:EE:FF",))
            row = await cursor.fetchone()
            assert row["ip"] == "192.168.1.10"
        finally:
            await db.close()

@pytest.mark.asyncio
class TestCascadeDelete:
    async def test_delete_batch_cascades_to_pages(self):
        db = await get_db()
        try:
            await db.execute(
                "INSERT INTO batches (id, source_type, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                ("test1234", "file_upload", "pending", "2025-01-01", "2025-01-01"),
            )
            await db.execute(
                "INSERT INTO pages (batch_id, page_index, status, original_path, created_at) VALUES (?, ?, ?, ?, ?)",
                ("test1234", 0, "pending", "scans/test1234/0.jpg", "2025-01-01"),
            )
            await db.commit()

            await db.execute("DELETE FROM batches WHERE id = ?", ("test1234",))
            await db.commit()

            cursor = await db.execute("SELECT COUNT(*) FROM pages WHERE batch_id = ?", ("test1234",))
            count = (await cursor.fetchone())[0]
            assert count == 0
        finally:
            await db.close()
