"""Configuration management — JSON file + environment variable overrides."""

import json
import os
from pathlib import Path
from copy import deepcopy

DEFAULT_CONFIG = {
    "general": {
        "server_name": "Satsu",
        "language": "en",
        "timezone": "UTC",
        "api_key_enabled": False,
        "api_key": "",
        "auto_process": True,
        "auto_export": True,
        "default_profile": "default",
        "theme": "auto",
    },
    "capture": {
        "resolution": "1920x1080",
        "timer": 0,
        "sound": True,
        "burst_mode": False,
        "grid_overlay": True,
        "max_file_size_mb": 20,
        "allowed_formats": ["jpeg", "png", "webp", "heic"],
        "client_compression": True,
        "client_compression_quality": 85,
    },
    "processing": {
        "default_profile": "default",
    },
    "storage": {
        "backends": [],
        "filename_template": "{date}_{batch_id}",
        "retention_days": 0,
    },
    "notifications": {
        "toast_duration_ms": 5000,
        "sound_enabled": False,
    },
    "logs": {
        "retention_days": 30,
        "min_level": "INFO",
        "auto_cleanup": True,
    },
    "system": {
        "port": 8400,
        "base_path": "/",
    },
}

DATA_DIR = os.environ.get("SATSU_DATA_DIR", "/data")
CONFIG_PATH = os.path.join(DATA_DIR, "config.json")


def _deep_merge(base: dict, override: dict) -> dict:
    """Merge override into base recursively."""
    result = deepcopy(base)
    for key, value in override.items():
        if key in result and isinstance(result[key], dict) and isinstance(value, dict):
            result[key] = _deep_merge(result[key], value)
        else:
            result[key] = deepcopy(value)
    return result


def _apply_env_overrides(config: dict) -> dict:
    """Apply SATSU_* environment variables as overrides."""
    prefix = "SATSU_"
    for key, value in os.environ.items():
        if not key.startswith(prefix):
            continue
        parts = key[len(prefix):].lower().split("_", 1)
        if len(parts) == 1:
            # Top-level override (e.g., SATSU_PORT → system.port)
            if parts[0] == "port":
                config["system"]["port"] = int(value)
            elif parts[0] == "log_level":
                config["logs"]["min_level"] = value.upper()
        elif len(parts) == 2:
            section, field = parts
            if section in config and isinstance(config[section], dict):
                # Try to preserve type
                existing = config[section].get(field)
                if isinstance(existing, bool):
                    config[section][field] = value.lower() in ("true", "1", "yes")
                elif isinstance(existing, int):
                    try:
                        config[section][field] = int(value)
                    except ValueError:
                        config[section][field] = value
                else:
                    config[section][field] = value
    return config


def load_config() -> dict:
    """Load config from JSON file with defaults fallback and env overrides."""
    config = deepcopy(DEFAULT_CONFIG)

    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, "r") as f:
                file_config = json.load(f)
            config = _deep_merge(config, file_config)
        except (json.JSONDecodeError, IOError):
            # Corrupted config — use defaults, caller should log WARNING
            pass

    config = _apply_env_overrides(config)
    return config


def save_config(config: dict) -> None:
    """Save config to JSON file."""
    os.makedirs(os.path.dirname(CONFIG_PATH), exist_ok=True)
    with open(CONFIG_PATH, "w") as f:
        json.dump(config, f, indent=2)


def get_data_dir() -> str:
    """Return the data directory path, creating it if needed."""
    os.makedirs(DATA_DIR, exist_ok=True)
    for subdir in ["scans", "processed", "exports"]:
        os.makedirs(os.path.join(DATA_DIR, subdir), exist_ok=True)
    return DATA_DIR
