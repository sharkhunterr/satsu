"""Pydantic v2 request/response models for all API endpoints."""

from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime


# --- Device Models ---

class DeviceRegister(BaseModel):
    mac: str = Field(..., pattern=r"^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$")
    ip: str
    firmware: str = ""
    resolution: str = "UXGA"
    max_pages: int = 10


class DeviceUpdate(BaseModel):
    name: Optional[str] = None
    config: Optional[dict] = None


class DeviceConfigPush(BaseModel):
    resolution: Optional[str] = None
    quality: Optional[int] = Field(None, ge=1, le=100)
    flash: Optional[bool] = None
    flash_duration_ms: Optional[int] = Field(None, ge=0, le=5000)
    auto_send: Optional[bool] = None


class DeviceResponse(BaseModel):
    mac: str
    name: Optional[str]
    ip: str
    firmware: Optional[str]
    max_pages: int
    resolution: str
    config: dict
    total_scans: int
    last_seen: str
    created_at: str
    is_online: bool = False


# --- Batch Models ---

class BatchCreate(BaseModel):
    source_type: str = Field(..., pattern=r"^(esp32cam|web_camera|file_upload)$")
    device_mac: Optional[str] = None
    profile: str = "default"


class BatchResponse(BaseModel):
    id: str
    device_mac: Optional[str]
    source_type: str
    page_count: int
    status: str
    error: Optional[str]
    profile: str
    export_info: dict
    file_size: int
    processing_duration_ms: int
    created_at: str
    updated_at: str
    device_name: Optional[str] = None
    pages: Optional[list] = None


class PageResponse(BaseModel):
    batch_id: str
    page_index: int
    status: str
    original_path: str
    processed_path: Optional[str]
    processing_details: dict
    file_size_original: int
    file_size_processed: int
    created_at: str


class BatchListResponse(BaseModel):
    items: list[BatchResponse]
    cursor: Optional[str]
    total: int
    stats: dict


class BulkActionRequest(BaseModel):
    action: str = Field(..., pattern=r"^(delete|reprocess|export)$")
    ids: list[str]
    profile: Optional[str] = None


# --- Profile Models ---

class ProfileCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    options: dict
    is_default: bool = False


class ProfileResponse(BaseModel):
    id: str
    name: str
    options: dict
    is_default: bool
    created_at: str


# --- Settings Models ---

class SettingsSectionUpdate(BaseModel):
    """Partial update for a settings section."""
    values: dict


class StorageTestRequest(BaseModel):
    type: str
    url: Optional[str] = None
    token: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None
    path: Optional[str] = None
    share: Optional[str] = None
    service_account: Optional[dict] = None
    folder_id: Optional[str] = None


# --- Log Models ---

class LogEntry(BaseModel):
    id: int
    timestamp: int
    level: str
    category: str
    source: str
    device_mac: Optional[str]
    message: str
    details: dict


class LogListResponse(BaseModel):
    items: list[LogEntry]
    cursor: Optional[str]
    total: int


# --- Stats Models ---

class StatsResponse(BaseModel):
    total_batches: int
    total_pages: int
    total_size_bytes: int
    devices_online: int
    devices_total: int
    recent_batches: list[dict]
    status_counts: dict
    storage_backends: list[dict]


# --- Error Models ---

class ErrorDetail(BaseModel):
    code: str
    message: str
    details: dict = {}


class ErrorResponse(BaseModel):
    error: ErrorDetail
