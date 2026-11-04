"""
Stub for runtime_settings — the original SupoClip uses Redis-backed admin
settings, which LocalClips does not need.  These no-op implementations make
the import chain resolve without pulling in Redis or database dependencies.
"""
from __future__ import annotations
import os
from typing import Any, List, Optional


def get_cached_setting(name: str, default: Any = None) -> Any:
    """Read a setting from environment variables (no Redis)."""
    return os.getenv(name, default)


def get_cached_key_list(name: str, fallback: Optional[List[str]] = None) -> List[str]:
    """Read a comma-separated key list from environment variables."""
    raw = os.getenv(name, "")
    if raw:
        return [k.strip() for k in raw.split(",") if k.strip()]
    return fallback or []


def setting_prefers_admin(name: str) -> bool:
    """Always returns False — no admin override mechanism in LocalClips."""
    return False
