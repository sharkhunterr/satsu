"""Shared test fixtures for ESPScanCam backend tests."""

import os
import sys
import json
import asyncio
import tempfile
import pytest

# Add backend to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# Override data dir for tests
os.environ["ESPSCANCAM_DATA_DIR"] = tempfile.mkdtemp()


@pytest.fixture
def data_dir():
    """Return a fresh temporary data directory."""
    d = tempfile.mkdtemp()
    os.environ["ESPSCANCAM_DATA_DIR"] = d
    for sub in ["scans", "processed", "exports"]:
        os.makedirs(os.path.join(d, sub), exist_ok=True)
    return d


@pytest.fixture
def sample_config():
    """Return a minimal test config dict."""
    return {
        "general": {
            "server_name": "TestScanCam",
            "auto_process": True,
            "auto_export": False,
            "default_profile": "default",
            "api_key_enabled": False,
            "api_key": "",
        },
        "storage": {"backends": [], "filename_template": "{date}_{batch_id}", "retention_days": 0},
        "logs": {"retention_days": 30, "min_level": "DEBUG", "auto_cleanup": True},
        "system": {"port": 8400},
    }
