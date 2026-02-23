"""Tests for FastAPI API endpoints."""

import os
import io
import json
import tempfile
import pytest
from fastapi.testclient import TestClient

os.environ["ESPSCANCAM_DATA_DIR"] = tempfile.mkdtemp()

from main import app

client = TestClient(app)

class TestStats:
    def test_get_stats(self):
        response = client.get("/api/stats")
        assert response.status_code == 200
        data = response.json()
        assert "total_batches" in data
        assert "total_pages" in data
        assert "devices_online" in data

class TestSettings:
    def test_get_settings(self):
        response = client.get("/api/settings")
        assert response.status_code == 200
        data = response.json()
        assert "general" in data
        assert "storage" in data

    def test_patch_settings_section(self):
        response = client.patch(
            "/api/settings/general",
            json={"server_name": "TestCam"},
        )
        assert response.status_code == 200

class TestProfiles:
    def test_list_profiles(self):
        response = client.get("/api/settings/profiles")
        assert response.status_code == 200
        data = response.json()
        assert len(data) >= 5  # 5 default profiles

    def test_create_profile(self):
        response = client.post(
            "/api/settings/profiles",
            json={
                "name": "Test Profile",
                "options": {"auto_crop": {"enabled": True}},
                "is_default": False,
            },
        )
        assert response.status_code == 201
        assert response.json()["name"] == "Test Profile"

class TestDevices:
    def test_register_device(self):
        response = client.post(
            "/api/device/register",
            json={
                "mac": "AA:BB:CC:DD:EE:FF",
                "ip": "192.168.1.100",
                "firmware": "1.0.0",
                "resolution": "UXGA",
                "max_pages": 10,
            },
        )
        assert response.status_code == 200
        assert response.json()["mac"] == "AA:BB:CC:DD:EE:FF"

    def test_list_devices(self):
        response = client.get("/api/devices")
        assert response.status_code == 200

class TestScans:
    def test_create_batch(self):
        response = client.post(
            "/api/scan/batch",
            json={"source_type": "file_upload"},
        )
        assert response.status_code == 201
        assert "id" in response.json()

    def test_list_scans(self):
        response = client.get("/api/scans")
        assert response.status_code == 200
        data = response.json()
        assert "items" in data
        assert "total" in data
        assert "stats" in data

    def test_web_upload(self):
        # Create a fake image file
        fake_image = io.BytesIO(b'\xff\xd8\xff\xe0' + b'\x00' * 100)
        response = client.post(
            "/api/scan/web-upload",
            files=[("files", ("test.jpg", fake_image, "image/jpeg"))],
            data={"profile": "default", "source_type": "file_upload"},
        )
        assert response.status_code == 201
        assert response.json()["page_count"] == 1

class TestLogs:
    def test_list_logs(self):
        response = client.get("/api/logs")
        assert response.status_code == 200
        data = response.json()
        assert "items" in data
        assert "total" in data
