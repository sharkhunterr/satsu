"""Tests for config.py — defaults, env overrides, corruption recovery."""

import os
import json
import tempfile
import pytest
from config import load_config, save_config, DEFAULT_CONFIG, _deep_merge

class TestDefaults:
    def test_load_returns_defaults_when_no_file(self):
        os.environ["ESPSCANCAM_DATA_DIR"] = tempfile.mkdtemp()
        config = load_config()
        assert config["general"]["server_name"] == "ESPScanCam"
        assert config["system"]["port"] == 8400
        assert config["logs"]["min_level"] == "INFO"

    def test_all_sections_present(self):
        config = load_config()
        for section in ["general", "capture", "processing", "storage", "notifications", "logs", "system"]:
            assert section in config

class TestDeepMerge:
    def test_simple_override(self):
        base = {"a": 1, "b": 2}
        override = {"b": 3}
        result = _deep_merge(base, override)
        assert result == {"a": 1, "b": 3}

    def test_nested_merge(self):
        base = {"a": {"x": 1, "y": 2}}
        override = {"a": {"y": 3, "z": 4}}
        result = _deep_merge(base, override)
        assert result == {"a": {"x": 1, "y": 3, "z": 4}}

    def test_does_not_mutate_base(self):
        base = {"a": {"x": 1}}
        override = {"a": {"y": 2}}
        _deep_merge(base, override)
        assert base == {"a": {"x": 1}}

class TestEnvOverrides:
    def test_port_override(self):
        os.environ["ESPSCANCAM_PORT"] = "9999"
        try:
            config = load_config()
            assert config["system"]["port"] == 9999
        finally:
            del os.environ["ESPSCANCAM_PORT"]

class TestCorruptConfig:
    def test_corrupted_json_falls_back_to_defaults(self, data_dir):
        config_path = os.path.join(data_dir, "config.json")
        with open(config_path, "w") as f:
            f.write("{invalid json!!!")
        config = load_config()
        assert config["general"]["server_name"] == "ESPScanCam"

class TestSaveConfig:
    def test_save_and_reload(self, data_dir):
        config = load_config()
        config["general"]["server_name"] = "MyScanCam"
        save_config(config)
        reloaded = load_config()
        assert reloaded["general"]["server_name"] == "MyScanCam"
