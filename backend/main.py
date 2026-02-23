"""ESPScanCam — FastAPI application with WebSocket, all API routes, and static serving."""

import json
import os
import time
import uuid
import base64
import shutil
import asyncio
from pathlib import Path
from datetime import datetime, timezone
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request, UploadFile, File, Form, Query, HTTPException, Header, BackgroundTasks
from fastapi.responses import FileResponse, StreamingResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import ValidationError

import database
from database import get_db, init_db
from config import load_config, save_config, get_data_dir, DEFAULT_CONFIG
from logger import AppLogger
from models import (
    DeviceRegister, DeviceUpdate, DeviceConfigPush, DeviceResponse,
    BatchCreate, BatchResponse, PageResponse, BatchListResponse, BulkActionRequest,
    ProfileCreate, ProfileResponse,
    SettingsSectionUpdate, StorageTestRequest,
    LogEntry, LogListResponse,
    StatsResponse, ErrorResponse, ErrorDetail,
)

# ---------------------------------------------------------------------------
# WebSocket Connection Manager
# ---------------------------------------------------------------------------

class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, event: str, data: dict):
        message = {"event": event, "data": data, "timestamp": int(time.time() * 1000)}
        dead = []
        for conn in self.active_connections:
            try:
                await conn.send_json(message)
            except Exception:
                dead.append(conn)
        for conn in dead:
            self.disconnect(conn)


manager = ConnectionManager()
app_config = {}
app_logger: AppLogger = None

# ---------------------------------------------------------------------------
# Lifespan
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    global app_config, app_logger
    get_data_dir()
    await init_db()
    app_config = load_config()
    app_logger = AppLogger(get_db, manager.broadcast)
    app_logger.set_min_level(app_config.get("logs", {}).get("min_level", "INFO"))

    await app_logger.info("system", "ESPScanCam server started")

    # Start background tasks
    offline_task = asyncio.create_task(_device_offline_checker())
    retention_task = asyncio.create_task(_log_retention_cleanup())

    yield

    offline_task.cancel()
    try:
        await offline_task
    except asyncio.CancelledError:
        pass

    retention_task.cancel()
    try:
        await retention_task
    except asyncio.CancelledError:
        pass

app = FastAPI(title="ESPScanCam", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def _short_uuid() -> str:
    return uuid.uuid4().hex[:8]


def _ts_ms() -> int:
    return int(time.time() * 1000)


async def _check_api_key(x_api_key: str | None = None):
    """Validate API key if enabled in config."""
    if app_config.get("general", {}).get("api_key_enabled"):
        expected = app_config["general"].get("api_key", "")
        if not x_api_key or x_api_key != expected:
            raise HTTPException(status_code=403, detail="Invalid or missing API key")


def _parse_cursor(cursor: str | None) -> dict | None:
    if not cursor:
        return None
    try:
        return json.loads(base64.b64decode(cursor))
    except Exception:
        return None


def _encode_cursor(data: dict) -> str:
    return base64.b64encode(json.dumps(data).encode()).decode()


async def _get_device_name(db, mac: str) -> str | None:
    cursor = await db.execute("SELECT name FROM devices WHERE mac = ?", (mac,))
    row = await cursor.fetchone()
    return row["name"] if row else None


# ---------------------------------------------------------------------------
# Background: Device offline checker
# ---------------------------------------------------------------------------

async def _device_offline_checker():
    """Periodically check for devices that haven't sent heartbeat in 180s."""
    while True:
        await asyncio.sleep(60)
        try:
            threshold = datetime.fromtimestamp(
                time.time() - 180, tz=timezone.utc
            ).isoformat(timespec="milliseconds")
            db = await get_db()
            try:
                cursor = await db.execute(
                    "SELECT mac, name FROM devices WHERE last_seen < ? AND last_seen != ''",
                    (threshold,),
                )
                offline_devices = await cursor.fetchall()
                for dev in offline_devices:
                    await manager.broadcast("device_offline", {
                        "mac": dev["mac"],
                        "name": dev["name"],
                    })
            finally:
                await db.close()
        except Exception:
            pass


async def _log_retention_cleanup():
    """Daily cleanup of logs older than configured retention days."""
    while True:
        await asyncio.sleep(86400)  # 24 hours
        try:
            retention_days = app_config.get("logs", {}).get("retention_days", 30)
            if retention_days <= 0:
                continue
            auto_cleanup = app_config.get("logs", {}).get("auto_cleanup", True)
            if not auto_cleanup:
                continue

            cutoff_ms = int((time.time() - retention_days * 86400) * 1000)
            db = await get_db()
            try:
                cursor = await db.execute(
                    "SELECT COUNT(*) FROM logs WHERE timestamp < ?", (cutoff_ms,)
                )
                count = (await cursor.fetchone())[0]
                if count > 0:
                    await db.execute("DELETE FROM logs WHERE timestamp < ?", (cutoff_ms,))
                    await db.commit()
                    await app_logger.info("system", f"Log retention cleanup: deleted {count} logs older than {retention_days} days")
            finally:
                await db.close()
        except Exception:
            pass


# ---------------------------------------------------------------------------
# WebSocket endpoint
# ---------------------------------------------------------------------------

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            # Keep connection alive, handle client messages if needed
            data = await websocket.receive_text()
            # Client can send ping/pong or commands in the future
    except WebSocketDisconnect:
        manager.disconnect(websocket)


# ---------------------------------------------------------------------------
# Device endpoints
# ---------------------------------------------------------------------------

@app.post("/api/device/register")
async def device_register(body: DeviceRegister, x_api_key: str | None = Header(None)):
    await _check_api_key(x_api_key)
    now = _now_iso()
    db = await get_db()
    try:
        cursor = await db.execute("SELECT * FROM devices WHERE mac = ?", (body.mac,))
        existing = await cursor.fetchone()

        pending_config = None
        if existing:
            await db.execute(
                """UPDATE devices SET ip=?, firmware=?, resolution=?, max_pages=?, last_seen=?
                   WHERE mac=?""",
                (body.ip, body.firmware, body.resolution, body.max_pages, now, body.mac),
            )
            config = json.loads(existing["config"])
            if config.get("_pending"):
                pending_config = config.pop("_pending")
                await db.execute(
                    "UPDATE devices SET config=? WHERE mac=?",
                    (json.dumps(config), body.mac),
                )
        else:
            await db.execute(
                """INSERT INTO devices (mac, ip, firmware, resolution, max_pages, last_seen, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (body.mac, body.ip, body.firmware, body.resolution, body.max_pages, now, now),
            )
        await db.commit()

        cursor = await db.execute("SELECT * FROM devices WHERE mac = ?", (body.mac,))
        device = await cursor.fetchone()
    finally:
        await db.close()

    result = dict(device)
    result["config"] = json.loads(result["config"])
    result["is_online"] = True
    if pending_config:
        result["pending_config"] = pending_config

    await manager.broadcast("device_online", {
        "mac": body.mac, "name": result.get("name"), "ip": body.ip,
    })

    if not existing:
        await app_logger.info("device", f"Device {body.mac} registered",
                              source=f"device:{body.mac}", device_mac=body.mac)

    return result


@app.get("/api/devices")
async def devices_list():
    db = await get_db()
    try:
        cursor = await db.execute("SELECT * FROM devices ORDER BY last_seen DESC")
        rows = await cursor.fetchall()
    finally:
        await db.close()

    threshold = datetime.fromtimestamp(
        time.time() - 180, tz=timezone.utc
    ).isoformat(timespec="milliseconds")

    devices = []
    for row in rows:
        d = dict(row)
        d["config"] = json.loads(d["config"])
        d["is_online"] = d["last_seen"] >= threshold
        devices.append(d)
    return devices


@app.put("/api/devices/{mac}")
async def device_update(mac: str, body: DeviceUpdate):
    db = await get_db()
    try:
        cursor = await db.execute("SELECT * FROM devices WHERE mac = ?", (mac,))
        device = await cursor.fetchone()
        if not device:
            raise HTTPException(404, "Device not found")

        updates = []
        params = []
        if body.name is not None:
            updates.append("name=?")
            params.append(body.name)
        if body.config is not None:
            existing_config = json.loads(device["config"])
            existing_config.update(body.config)
            updates.append("config=?")
            params.append(json.dumps(existing_config))

        if updates:
            params.append(mac)
            await db.execute(f"UPDATE devices SET {', '.join(updates)} WHERE mac=?", params)
            await db.commit()

        cursor = await db.execute("SELECT * FROM devices WHERE mac = ?", (mac,))
        device = await cursor.fetchone()
    finally:
        await db.close()

    result = dict(device)
    result["config"] = json.loads(result["config"])
    return result


@app.delete("/api/devices/{mac}")
async def device_delete(mac: str):
    db = await get_db()
    try:
        cursor = await db.execute("SELECT * FROM devices WHERE mac = ?", (mac,))
        device = await cursor.fetchone()
        if not device:
            raise HTTPException(404, "Device not found")
        await db.execute("DELETE FROM devices WHERE mac = ?", (mac,))
        await db.commit()
    finally:
        await db.close()

    await manager.broadcast("device_offline", {"mac": mac, "name": device["name"]})
    await app_logger.info("device", f"Device {mac} deleted",
                          source=f"device:{mac}", device_mac=mac)
    return {"status": "deleted"}


@app.post("/api/devices/{mac}/config")
async def device_config_push(mac: str, body: DeviceConfigPush):
    db = await get_db()
    try:
        cursor = await db.execute("SELECT config FROM devices WHERE mac = ?", (mac,))
        device = await cursor.fetchone()
        if not device:
            raise HTTPException(404, "Device not found")

        config = json.loads(device["config"])
        pending = body.model_dump(exclude_none=True)
        config["_pending"] = pending
        await db.execute("UPDATE devices SET config=? WHERE mac=?", (json.dumps(config), mac))
        await db.commit()
    finally:
        await db.close()

    return {"status": "config_queued", "pending": pending}


# ---------------------------------------------------------------------------
# Scan endpoints
# ---------------------------------------------------------------------------

@app.post("/api/scan/batch", status_code=201)
async def scan_batch_create(body: BatchCreate, x_api_key: str | None = Header(None)):
    await _check_api_key(x_api_key)
    batch_id = _short_uuid()
    now = _now_iso()
    db = await get_db()
    try:
        await db.execute(
            """INSERT INTO batches (id, device_mac, source_type, profile, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (batch_id, body.device_mac, body.source_type, body.profile, now, now),
        )
        await db.commit()
    finally:
        await db.close()

    await manager.broadcast("batch_created", {
        "batch_id": batch_id, "source_type": body.source_type,
        "device_mac": body.device_mac,
    })
    await app_logger.info("capture", f"Batch {batch_id} created",
                          source=f"batch:{batch_id}", device_mac=body.device_mac)

    return {"id": batch_id, "status": "pending", "source_type": body.source_type,
            "device_mac": body.device_mac, "profile": body.profile,
            "page_count": 0, "created_at": now, "updated_at": now}


@app.post("/api/scan/upload/{batch_id}/{page_index}")
async def scan_upload_page(batch_id: str, page_index: int, request: Request,
                           x_api_key: str | None = Header(None),
                           x_device_mac: str | None = Header(None)):
    await _check_api_key(x_api_key)

    db = await get_db()
    try:
        cursor = await db.execute("SELECT * FROM batches WHERE id = ?", (batch_id,))
        batch = await cursor.fetchone()
        if not batch:
            raise HTTPException(404, "Batch not found")

        # Save image
        data_dir = get_data_dir()
        scan_dir = os.path.join(data_dir, "scans", batch_id, "original")
        os.makedirs(scan_dir, exist_ok=True)
        file_path = os.path.join(scan_dir, f"{page_index}.jpg")
        relative_path = f"scans/{batch_id}/original/{page_index}.jpg"

        body = await request.body()
        with open(file_path, "wb") as f:
            f.write(body)

        now = _now_iso()
        file_size = len(body)

        await db.execute(
            """INSERT OR REPLACE INTO pages (batch_id, page_index, status, original_path,
               file_size_original, created_at) VALUES (?, ?, 'uploaded', ?, ?, ?)""",
            (batch_id, page_index, relative_path, file_size, now),
        )

        # Update batch
        await db.execute(
            """UPDATE batches SET page_count = (SELECT COUNT(*) FROM pages WHERE batch_id = ?),
               status = 'uploading', updated_at = ? WHERE id = ?""",
            (batch_id, now, batch_id),
        )
        await db.commit()
    finally:
        await db.close()

    await manager.broadcast("page_uploaded", {
        "batch_id": batch_id, "page_index": page_index,
    })

    return {"batch_id": batch_id, "page_index": page_index, "status": "uploaded",
            "file_size": file_size}


@app.post("/api/scan/process/{batch_id}", status_code=202)
async def scan_process(batch_id: str, background_tasks: BackgroundTasks,
                       body: dict = None):
    profile = (body or {}).get("profile")

    db = await get_db()
    try:
        cursor = await db.execute("SELECT * FROM batches WHERE id = ?", (batch_id,))
        batch = await cursor.fetchone()
        if not batch:
            raise HTTPException(404, "Batch not found")
    finally:
        await db.close()

    background_tasks.add_task(_process_batch, batch_id, profile)
    return {"status": "processing", "batch_id": batch_id}


async def _process_batch(batch_id: str, profile_override: str = None):
    """Background task: process all pages in a batch."""
    from scanner import process_page, get_profile_options

    start_time = time.time()
    db = await get_db()
    try:
        # Get profile
        profile_name = profile_override
        if not profile_name:
            cursor = await db.execute("SELECT profile FROM batches WHERE id = ?", (batch_id,))
            row = await cursor.fetchone()
            profile_name = row["profile"] if row else "default"

        profile_options = await get_profile_options(db, profile_name)

        # Update status
        await db.execute(
            "UPDATE batches SET status='processing', updated_at=? WHERE id=?",
            (_now_iso(), batch_id),
        )
        await db.commit()

        cursor = await db.execute(
            "SELECT * FROM pages WHERE batch_id = ? ORDER BY page_index", (batch_id,),
        )
        pages = await cursor.fetchall()
        page_count = len(pages)

        await manager.broadcast("processing_started", {
            "batch_id": batch_id, "page_count": page_count, "profile": profile_name,
        })
        await app_logger.info("processing", f"Processing batch {batch_id} ({page_count} pages)",
                              source=f"batch:{batch_id}")

        total_size = 0
        all_ok = True

        for page in pages:
            page_index = page["page_index"]
            original_path = os.path.join(get_data_dir(), page["original_path"])

            await db.execute(
                "UPDATE pages SET status='processing' WHERE batch_id=? AND page_index=?",
                (batch_id, page_index),
            )
            await db.commit()

            try:
                processed_path, details, processed_size = await process_page(
                    original_path, batch_id, page_index, profile_options,
                    lambda step, step_idx, total_steps: manager.broadcast(
                        "processing_page", {
                            "batch_id": batch_id, "page_index": page_index,
                            "step": step, "step_index": step_idx, "total_steps": total_steps,
                        }
                    ),
                )

                relative_processed = processed_path.replace(get_data_dir() + "/", "")
                await db.execute(
                    """UPDATE pages SET status='processed', processed_path=?,
                       processing_details=?, file_size_processed=?
                       WHERE batch_id=? AND page_index=?""",
                    (relative_processed, json.dumps(details), processed_size,
                     batch_id, page_index),
                )
                await db.commit()
                total_size += processed_size

                await manager.broadcast("page_processed", {
                    "batch_id": batch_id, "page_index": page_index,
                    "duration_ms": int(details.get("total_ms", 0)),
                })

            except Exception as e:
                all_ok = False
                await db.execute(
                    "UPDATE pages SET status='error' WHERE batch_id=? AND page_index=?",
                    (batch_id, page_index),
                )
                await db.commit()
                await manager.broadcast("processing_error", {
                    "batch_id": batch_id, "page_index": page_index, "error": str(e),
                })
                await app_logger.error("processing", f"Error processing page {page_index}: {e}",
                                       source=f"batch:{batch_id}",
                                       details={"page_index": page_index, "error": str(e)})

        duration_ms = int((time.time() - start_time) * 1000)
        final_status = "completed" if all_ok else "error"

        await db.execute(
            """UPDATE batches SET status=?, file_size=?, processing_duration_ms=?,
               updated_at=? WHERE id=?""",
            (final_status, total_size, duration_ms, _now_iso(), batch_id),
        )
        await db.commit()

        await manager.broadcast("processing_complete", {
            "batch_id": batch_id, "total_duration_ms": duration_ms, "page_count": page_count,
        })
        await app_logger.info("processing",
                              f"Batch {batch_id} processing complete ({duration_ms}ms)",
                              source=f"batch:{batch_id}",
                              details={"duration_ms": duration_ms, "status": final_status})

        # Auto-export if configured
        if app_config.get("general", {}).get("auto_export") and final_status == "completed":
            await _export_batch(batch_id)

    except Exception as e:
        await db.execute(
            "UPDATE batches SET status='error', error=?, updated_at=? WHERE id=?",
            (str(e), _now_iso(), batch_id),
        )
        await db.commit()
        await app_logger.error("processing", f"Batch {batch_id} failed: {e}",
                               source=f"batch:{batch_id}")
    finally:
        await db.close()


@app.post("/api/scan/web-upload", status_code=201)
async def scan_web_upload(
    background_tasks: BackgroundTasks,
    files: list[UploadFile] = File(...),
    profile: str = Form("default"),
    source_type: str = Form("file_upload"),
):
    """Combined create batch + upload all pages for web clients."""
    batch_id = _short_uuid()
    now = _now_iso()
    data_dir = get_data_dir()

    db = await get_db()
    try:
        await db.execute(
            """INSERT INTO batches (id, source_type, profile, page_count, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (batch_id, source_type, profile, len(files), now, now),
        )

        scan_dir = os.path.join(data_dir, "scans", batch_id, "original")
        os.makedirs(scan_dir, exist_ok=True)

        for i, file in enumerate(files):
            file_path = os.path.join(scan_dir, f"{i}.jpg")
            relative_path = f"scans/{batch_id}/original/{i}.jpg"
            content = await file.read()
            with open(file_path, "wb") as f:
                f.write(content)

            await db.execute(
                """INSERT INTO pages (batch_id, page_index, status, original_path,
                   file_size_original, created_at) VALUES (?, ?, 'uploaded', ?, ?, ?)""",
                (batch_id, i, relative_path, len(content), now),
            )

        await db.commit()
    finally:
        await db.close()

    await manager.broadcast("batch_created", {
        "batch_id": batch_id, "source_type": source_type, "device_mac": None,
    })
    await app_logger.info("capture", f"Web upload batch {batch_id} ({len(files)} pages)",
                          source=f"batch:{batch_id}")

    # Auto-process if enabled
    if app_config.get("general", {}).get("auto_process", True):
        background_tasks.add_task(_process_batch, batch_id)

    return {"id": batch_id, "status": "pending", "source_type": source_type,
            "page_count": len(files), "profile": profile,
            "created_at": now, "updated_at": now}


@app.get("/api/scans")
async def scans_list(
    cursor: str | None = Query(None),
    limit: int = Query(25, ge=1, le=100),
    status: list[str] | None = Query(None),
    device_mac: str | None = Query(None),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    page_min: int | None = Query(None),
    page_max: int | None = Query(None),
    search: str | None = Query(None),
    sort: str = Query("created_at"),
    order: str = Query("desc"),
    format: str | None = Query(None),
):
    db = await get_db()
    try:
        conditions = []
        params = []

        if status:
            placeholders = ",".join(["?"] * len(status))
            conditions.append(f"b.status IN ({placeholders})")
            params.extend(status)
        if device_mac:
            conditions.append("b.device_mac = ?")
            params.append(device_mac)
        if date_from:
            conditions.append("b.created_at >= ?")
            params.append(date_from)
        if date_to:
            conditions.append("b.created_at <= ?")
            params.append(date_to)
        if page_min is not None:
            conditions.append("b.page_count >= ?")
            params.append(page_min)
        if page_max is not None:
            conditions.append("b.page_count <= ?")
            params.append(page_max)
        if search:
            conditions.append("(b.id LIKE ? OR b.error LIKE ? OR d.name LIKE ?)")
            params.extend([f"%{search}%"] * 3)

        # Cursor-based pagination
        parsed_cursor = _parse_cursor(cursor)
        if parsed_cursor:
            if order == "desc":
                conditions.append(f"(b.{sort}, b.id) < (?, ?)")
            else:
                conditions.append(f"(b.{sort}, b.id) > (?, ?)")
            params.extend([parsed_cursor["value"], parsed_cursor["id"]])

        where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
        order_dir = "DESC" if order == "desc" else "ASC"

        # Count total
        count_sql = f"SELECT COUNT(*) FROM batches b LEFT JOIN devices d ON b.device_mac = d.mac {where}"
        c = await db.execute(count_sql, params[:len(params) - (2 if parsed_cursor else 0)])
        total = (await c.fetchone())[0]

        # Stats
        stats_sql = f"""SELECT COUNT(*) as scans,
                        COALESCE(SUM(b.page_count), 0) as pages,
                        COALESCE(SUM(b.file_size), 0) as bytes
                        FROM batches b LEFT JOIN devices d ON b.device_mac = d.mac {where}"""
        c = await db.execute(stats_sql, params[:len(params) - (2 if parsed_cursor else 0)])
        stats_row = await c.fetchone()

        # Fetch items
        query = f"""SELECT b.*, d.name as device_name FROM batches b
                    LEFT JOIN devices d ON b.device_mac = d.mac
                    {where} ORDER BY b.{sort} {order_dir}, b.id {order_dir}
                    LIMIT ?"""
        params.append(limit + 1)  # Fetch one extra for next cursor
        c = await db.execute(query, params)
        rows = await c.fetchall()
    finally:
        await db.close()

    items = []
    for row in rows[:limit]:
        item = dict(row)
        item["export_info"] = json.loads(item.get("export_info", "{}"))
        items.append(item)

    next_cursor = None
    if len(rows) > limit:
        last = items[-1]
        next_cursor = _encode_cursor({"value": last[sort], "id": last["id"]})

    result = {
        "items": items,
        "cursor": next_cursor,
        "total": total,
        "stats": {
            "scans": stats_row["scans"],
            "pages": stats_row["pages"],
            "bytes": stats_row["bytes"],
        },
    }

    if format == "csv":
        import csv
        import io
        output = io.StringIO()
        writer = csv.DictWriter(output, fieldnames=["id", "status", "source_type", "device_mac",
                                                     "page_count", "file_size", "profile", "created_at"])
        writer.writeheader()
        for item in items:
            writer.writerow({k: item.get(k) for k in writer.fieldnames})
        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=scans.csv"},
        )

    return result


@app.get("/api/scans/{batch_id}")
async def scan_detail(batch_id: str):
    db = await get_db()
    try:
        cursor = await db.execute(
            """SELECT b.*, d.name as device_name FROM batches b
               LEFT JOIN devices d ON b.device_mac = d.mac
               WHERE b.id = ?""",
            (batch_id,),
        )
        batch = await cursor.fetchone()
        if not batch:
            raise HTTPException(404, "Batch not found")

        cursor = await db.execute(
            "SELECT * FROM pages WHERE batch_id = ? ORDER BY page_index", (batch_id,),
        )
        pages = await cursor.fetchall()
    finally:
        await db.close()

    result = dict(batch)
    result["export_info"] = json.loads(result.get("export_info", "{}"))
    result["pages"] = []
    for page in pages:
        p = dict(page)
        p["processing_details"] = json.loads(p.get("processing_details", "{}"))
        result["pages"].append(p)

    return result


@app.delete("/api/scans/{batch_id}")
async def scan_delete(batch_id: str):
    db = await get_db()
    try:
        cursor = await db.execute("SELECT * FROM batches WHERE id = ?", (batch_id,))
        batch = await cursor.fetchone()
        if not batch:
            raise HTTPException(404, "Batch not found")

        await db.execute("DELETE FROM batches WHERE id = ?", (batch_id,))
        await db.commit()
    finally:
        await db.close()

    # Delete files
    scan_dir = os.path.join(get_data_dir(), "scans", batch_id)
    if os.path.exists(scan_dir):
        shutil.rmtree(scan_dir)

    await manager.broadcast("batch_deleted", {"batch_id": batch_id})
    await app_logger.info("capture", f"Batch {batch_id} deleted", source=f"batch:{batch_id}")
    return {"status": "deleted"}


@app.post("/api/scans/{batch_id}/reprocess")
async def scan_reprocess(batch_id: str, background_tasks: BackgroundTasks,
                         body: dict = None):
    profile = (body or {}).get("profile")
    db = await get_db()
    try:
        cursor = await db.execute("SELECT * FROM batches WHERE id = ?", (batch_id,))
        if not await cursor.fetchone():
            raise HTTPException(404, "Batch not found")
    finally:
        await db.close()

    background_tasks.add_task(_process_batch, batch_id, profile)
    return {"status": "reprocessing", "batch_id": batch_id}


@app.post("/api/scans/{batch_id}/export")
async def scan_export(batch_id: str, background_tasks: BackgroundTasks,
                      body: dict = None):
    db = await get_db()
    try:
        cursor = await db.execute("SELECT * FROM batches WHERE id = ?", (batch_id,))
        if not await cursor.fetchone():
            raise HTTPException(404, "Batch not found")
    finally:
        await db.close()

    backends = (body or {}).get("backends")
    background_tasks.add_task(_export_batch, batch_id, backends)
    return {"status": "exporting", "batch_id": batch_id}


async def _export_batch(batch_id: str, backend_names: list[str] = None):
    """Export batch to configured storage backends."""
    from storage import get_storage_backends

    backends = get_storage_backends(app_config)
    if backend_names:
        backends = [b for b in backends if b.name in backend_names]

    if not backends:
        return

    await manager.broadcast("exporting", {
        "batch_id": batch_id, "backends": [b.name for b in backends],
    })

    db = await get_db()
    try:
        cursor = await db.execute("SELECT * FROM batches WHERE id = ?", (batch_id,))
        batch = await cursor.fetchone()
        if not batch:
            return

        # Find the PDF or processed files
        export_dir = os.path.join(get_data_dir(), "scans", batch_id, "processed")
        export_results = {}

        for backend in backends:
            try:
                result = await backend.upload(export_dir, batch_id, dict(batch))
                export_results[backend.name] = result
            except Exception as e:
                export_results[backend.name] = {"success": False, "error": str(e)}

        all_ok = all(r.get("success") for r in export_results.values())
        status = "completed" if all_ok else "export_failed"

        existing_info = json.loads(batch["export_info"])
        existing_info.update(export_results)

        await db.execute(
            "UPDATE batches SET status=?, export_info=?, updated_at=? WHERE id=?",
            (status, json.dumps(existing_info), _now_iso(), batch_id),
        )
        await db.commit()

        event = "export_complete" if all_ok else "export_error"
        await manager.broadcast(event, {
            "batch_id": batch_id, "results": export_results,
        })
    finally:
        await db.close()


@app.post("/api/scans/bulk")
async def scans_bulk(body: BulkActionRequest, background_tasks: BackgroundTasks):
    results = []
    for batch_id in body.ids:
        try:
            if body.action == "delete":
                await scan_delete(batch_id)
                results.append({"id": batch_id, "success": True})
            elif body.action == "reprocess":
                background_tasks.add_task(_process_batch, batch_id, body.profile)
                results.append({"id": batch_id, "success": True})
            elif body.action == "export":
                background_tasks.add_task(_export_batch, batch_id)
                results.append({"id": batch_id, "success": True})
        except Exception as e:
            results.append({"id": batch_id, "success": False, "error": str(e)})

    return {"results": results}


# ---------------------------------------------------------------------------
# Image serving endpoints
# ---------------------------------------------------------------------------

@app.get("/api/image/original/{batch_id}/{page}")
async def image_original(batch_id: str, page: int):
    file_path = os.path.join(get_data_dir(), "scans", batch_id, "original", f"{page}.jpg")
    if not os.path.exists(file_path):
        raise HTTPException(404, "Image not found")
    return FileResponse(file_path, media_type="image/jpeg")


@app.get("/api/image/processed/{batch_id}/{page}")
async def image_processed(batch_id: str, page: int):
    data_dir = get_data_dir()
    # Try jpg first, then png, then pdf
    for ext, media in [("jpg", "image/jpeg"), ("png", "image/png"), ("pdf", "application/pdf")]:
        file_path = os.path.join(data_dir, "scans", batch_id, "processed", f"{page}.{ext}")
        if os.path.exists(file_path):
            return FileResponse(file_path, media_type=media)
    raise HTTPException(404, "Processed image not found")


@app.get("/api/export/{batch_id}")
async def export_download(batch_id: str):
    data_dir = get_data_dir()
    pdf_path = os.path.join(data_dir, "scans", batch_id, "processed", "output.pdf")
    if os.path.exists(pdf_path):
        return FileResponse(pdf_path, media_type="application/pdf",
                            filename=f"{batch_id}.pdf")
    raise HTTPException(404, "Export file not found")


# ---------------------------------------------------------------------------
# Settings endpoints
# ---------------------------------------------------------------------------

@app.get("/api/settings")
async def settings_get():
    return app_config


@app.put("/api/settings")
async def settings_replace(body: dict):
    global app_config
    app_config = body
    save_config(app_config)
    app_logger.set_min_level(app_config.get("logs", {}).get("min_level", "INFO"))
    await manager.broadcast("config_changed", {"section": "all"})
    return app_config


@app.patch("/api/settings/{section}")
async def settings_update_section(section: str, body: dict):
    global app_config
    if section not in app_config:
        raise HTTPException(404, f"Unknown settings section: {section}")
    app_config[section].update(body)
    save_config(app_config)
    app_logger.set_min_level(app_config.get("logs", {}).get("min_level", "INFO"))
    await manager.broadcast("config_changed", {"section": section})
    return app_config[section]


@app.post("/api/settings/test-storage")
async def settings_test_storage(body: StorageTestRequest):
    from storage import create_backend
    try:
        backend = create_backend(body.model_dump())
        result = await backend.test_connection()
        return result
    except Exception as e:
        return {"success": False, "message": str(e)}


@app.get("/api/settings/profiles")
async def profiles_list():
    db = await get_db()
    try:
        cursor = await db.execute("SELECT * FROM profiles ORDER BY is_default DESC, name")
        rows = await cursor.fetchall()
    finally:
        await db.close()
    return [dict(r) | {"options": json.loads(r["options"])} for r in rows]


@app.post("/api/settings/profiles", status_code=201)
async def profile_create(body: ProfileCreate):
    profile_id = body.name.lower().replace(" ", "-")
    now = _now_iso()
    db = await get_db()
    try:
        if body.is_default:
            await db.execute("UPDATE profiles SET is_default = 0")
        await db.execute(
            "INSERT INTO profiles (id, name, options, is_default, created_at) VALUES (?, ?, ?, ?, ?)",
            (profile_id, body.name, json.dumps(body.options), int(body.is_default), now),
        )
        await db.commit()
    finally:
        await db.close()
    return {"id": profile_id, "name": body.name, "options": body.options,
            "is_default": body.is_default, "created_at": now}


@app.put("/api/settings/profiles/{profile_id}")
async def profile_update(profile_id: str, body: ProfileCreate):
    db = await get_db()
    try:
        cursor = await db.execute("SELECT * FROM profiles WHERE id = ?", (profile_id,))
        if not await cursor.fetchone():
            raise HTTPException(404, "Profile not found")
        if body.is_default:
            await db.execute("UPDATE profiles SET is_default = 0")
        await db.execute(
            "UPDATE profiles SET name=?, options=?, is_default=? WHERE id=?",
            (body.name, json.dumps(body.options), int(body.is_default), profile_id),
        )
        await db.commit()
    finally:
        await db.close()
    return {"id": profile_id, "name": body.name, "options": body.options,
            "is_default": body.is_default}


@app.delete("/api/settings/profiles/{profile_id}")
async def profile_delete(profile_id: str):
    if profile_id == "default":
        raise HTTPException(400, "Cannot delete the default profile")
    db = await get_db()
    try:
        await db.execute("DELETE FROM profiles WHERE id = ?", (profile_id,))
        await db.commit()
    finally:
        await db.close()
    return {"status": "deleted"}


@app.post("/api/settings/backup")
async def settings_backup():
    return JSONResponse(content=app_config,
                        headers={"Content-Disposition": "attachment; filename=espscancam-config.json"})


@app.post("/api/settings/restore")
async def settings_restore(file: UploadFile = File(...)):
    global app_config
    content = await file.read()
    try:
        new_config = json.loads(content)
    except json.JSONDecodeError:
        raise HTTPException(400, "Invalid JSON file")
    app_config = new_config
    save_config(app_config)
    await manager.broadcast("config_changed", {"section": "all"})
    return app_config


# ---------------------------------------------------------------------------
# Log endpoints
# ---------------------------------------------------------------------------

@app.get("/api/logs")
async def logs_list(
    cursor: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    level: list[str] | None = Query(None),
    category: str | None = Query(None),
    device_mac: str | None = Query(None),
    source: str | None = Query(None),
    search: str | None = Query(None),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
):
    db = await get_db()
    try:
        conditions = []
        params = []

        if level:
            placeholders = ",".join(["?"] * len(level))
            conditions.append(f"level IN ({placeholders})")
            params.extend(level)
        if category:
            conditions.append("category = ?")
            params.append(category)
        if device_mac:
            conditions.append("device_mac = ?")
            params.append(device_mac)
        if source:
            conditions.append("source LIKE ?")
            params.append(f"%{source}%")
        if search:
            conditions.append("(message LIKE ? OR details LIKE ?)")
            params.extend([f"%{search}%"] * 2)
        if date_from:
            conditions.append("timestamp >= ?")
            params.append(int(datetime.fromisoformat(date_from).timestamp() * 1000))
        if date_to:
            conditions.append("timestamp <= ?")
            params.append(int(datetime.fromisoformat(date_to).timestamp() * 1000))

        parsed_cursor = _parse_cursor(cursor)
        if parsed_cursor:
            conditions.append("(timestamp, id) < (?, ?)")
            params.extend([parsed_cursor["timestamp"], parsed_cursor["id"]])

        where = f"WHERE {' AND '.join(conditions)}" if conditions else ""

        count_sql = f"SELECT COUNT(*) FROM logs {where}"
        c = await db.execute(count_sql, params[:len(params) - (2 if parsed_cursor else 0)])
        total = (await c.fetchone())[0]

        query = f"SELECT * FROM logs {where} ORDER BY timestamp DESC, id DESC LIMIT ?"
        params.append(limit + 1)
        c = await db.execute(query, params)
        rows = await c.fetchall()
    finally:
        await db.close()

    items = []
    for row in rows[:limit]:
        item = dict(row)
        item["details"] = json.loads(item.get("details", "{}"))
        items.append(item)

    next_cursor = None
    if len(rows) > limit:
        last = items[-1]
        next_cursor = _encode_cursor({"timestamp": last["timestamp"], "id": last["id"]})

    return {"items": items, "cursor": next_cursor, "total": total}


@app.delete("/api/logs")
async def logs_purge(
    before: str | None = Query(None),
    level: str | None = Query(None),
    category: str | None = Query(None),
):
    db = await get_db()
    try:
        conditions = []
        params = []
        if before:
            conditions.append("timestamp < ?")
            params.append(int(datetime.fromisoformat(before).timestamp() * 1000))
        if level:
            conditions.append("level = ?")
            params.append(level)
        if category:
            conditions.append("category = ?")
            params.append(category)

        where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
        cursor = await db.execute(f"SELECT COUNT(*) FROM logs {where}", params)
        count = (await cursor.fetchone())[0]
        await db.execute(f"DELETE FROM logs {where}", params)
        await db.commit()
    finally:
        await db.close()

    return {"deleted": count}


@app.get("/api/logs/export")
async def logs_export(
    format: str = Query("json"),
    level: list[str] | None = Query(None),
    category: str | None = Query(None),
    search: str | None = Query(None),
):
    db = await get_db()
    try:
        conditions = []
        params = []
        if level:
            placeholders = ",".join(["?"] * len(level))
            conditions.append(f"level IN ({placeholders})")
            params.extend(level)
        if category:
            conditions.append("category = ?")
            params.append(category)
        if search:
            conditions.append("message LIKE ?")
            params.append(f"%{search}%")

        where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
        cursor = await db.execute(
            f"SELECT * FROM logs {where} ORDER BY timestamp DESC", params,
        )
        rows = await cursor.fetchall()
    finally:
        await db.close()

    if format == "log":
        from datetime import datetime as dt
        lines = []
        for row in rows:
            ts = dt.fromtimestamp(row["timestamp"] / 1000).strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
            lines.append(f"{ts} [{row['level']:8s}] [{row['category']:12s}] {row['message']}")
        content = "\n".join(lines)
        return StreamingResponse(
            iter([content]),
            media_type="text/plain",
            headers={"Content-Disposition": "attachment; filename=espscancam.log"},
        )
    else:
        items = [dict(r) | {"details": json.loads(r.get("details", "{}"))} for r in rows]
        return JSONResponse(
            content=items,
            headers={"Content-Disposition": "attachment; filename=espscancam-logs.json"},
        )


# ---------------------------------------------------------------------------
# Stats endpoint
# ---------------------------------------------------------------------------

@app.get("/api/stats")
async def stats():
    db = await get_db()
    try:
        c = await db.execute("SELECT COUNT(*) FROM batches")
        total_batches = (await c.fetchone())[0]

        c = await db.execute("SELECT COALESCE(SUM(page_count), 0) FROM batches")
        total_pages = (await c.fetchone())[0]

        c = await db.execute("SELECT COALESCE(SUM(file_size), 0) FROM batches")
        total_size = (await c.fetchone())[0]

        threshold = datetime.fromtimestamp(
            time.time() - 180, tz=timezone.utc
        ).isoformat(timespec="milliseconds")
        c = await db.execute("SELECT COUNT(*) FROM devices WHERE last_seen >= ?", (threshold,))
        devices_online = (await c.fetchone())[0]

        c = await db.execute("SELECT COUNT(*) FROM devices")
        devices_total = (await c.fetchone())[0]

        c = await db.execute(
            "SELECT * FROM batches ORDER BY created_at DESC LIMIT 5",
        )
        recent = [dict(r) for r in await c.fetchall()]

        c = await db.execute(
            "SELECT status, COUNT(*) as cnt FROM batches GROUP BY status",
        )
        status_counts = {r["status"]: r["cnt"] for r in await c.fetchall()}

        backends = app_config.get("storage", {}).get("backends", [])
    finally:
        await db.close()

    return {
        "total_batches": total_batches,
        "total_pages": total_pages,
        "total_size_bytes": total_size,
        "devices_online": devices_online,
        "devices_total": devices_total,
        "recent_batches": recent,
        "status_counts": status_counts,
        "storage_backends": backends,
    }


# ---------------------------------------------------------------------------
# Static file serving (SPA fallback)
# ---------------------------------------------------------------------------

STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")

if os.path.isdir(STATIC_DIR):
    app.mount("/assets", StaticFiles(directory=os.path.join(STATIC_DIR, "assets")), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        # Try static file first
        static_file = os.path.join(STATIC_DIR, full_path)
        if os.path.isfile(static_file):
            return FileResponse(static_file)
        # Fallback to index.html for SPA routing
        return FileResponse(os.path.join(STATIC_DIR, "index.html"))
