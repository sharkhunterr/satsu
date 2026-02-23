"""Structured logging system — writes to SQLite logs table and broadcasts via WebSocket."""

import json
import time
from datetime import datetime, timezone


class AppLogger:
    """Structured logger that writes to SQLite and broadcasts to WebSocket."""

    def __init__(self, db_func, broadcast_func=None):
        self._get_db = db_func
        self._broadcast = broadcast_func
        self._min_level = "INFO"
        self._levels = {"DEBUG": 0, "INFO": 1, "WARNING": 2, "ERROR": 3, "CRITICAL": 4}

    def set_min_level(self, level: str) -> None:
        self._min_level = level.upper()

    async def log(
        self,
        level: str,
        category: str,
        message: str,
        source: str = "system",
        device_mac: str = None,
        details: dict = None,
    ) -> dict | None:
        """Write a structured log entry to the database and broadcast via WebSocket."""
        level = level.upper()
        if self._levels.get(level, 0) < self._levels.get(self._min_level, 0):
            return None

        timestamp_ms = int(time.time() * 1000)
        details_json = json.dumps(details or {})

        db = await self._get_db()
        try:
            cursor = await db.execute(
                """INSERT INTO logs (timestamp, level, category, source, device_mac, message, details)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (timestamp_ms, level, category, source, device_mac, message, details_json),
            )
            await db.commit()
            log_id = cursor.lastrowid
        finally:
            await db.close()

        entry = {
            "id": log_id,
            "timestamp": timestamp_ms,
            "level": level,
            "category": category,
            "source": source,
            "device_mac": device_mac,
            "message": message,
            "details": details or {},
        }

        # Broadcast to WebSocket
        if self._broadcast:
            try:
                await self._broadcast("log", entry)
            except Exception:
                pass  # Don't fail logging if broadcast fails

        return entry

    async def debug(self, category: str, message: str, **kwargs):
        return await self.log("DEBUG", category, message, **kwargs)

    async def info(self, category: str, message: str, **kwargs):
        return await self.log("INFO", category, message, **kwargs)

    async def warning(self, category: str, message: str, **kwargs):
        return await self.log("WARNING", category, message, **kwargs)

    async def error(self, category: str, message: str, **kwargs):
        return await self.log("ERROR", category, message, **kwargs)

    async def critical(self, category: str, message: str, **kwargs):
        return await self.log("CRITICAL", category, message, **kwargs)
