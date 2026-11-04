"""
File-backed job store.

Each job is persisted as a JSON file at:
    <TEMP_DIR>/jobs/<job_id>.json

This survives uvicorn --reload restarts and multiple processes.
Locking is per-file using a simple rename-based atomic write.
"""

from __future__ import annotations

import asyncio
import json
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional


def _jobs_dir() -> Path:
    """Return the jobs metadata directory, creating it if needed."""
    import os
    from dotenv import load_dotenv
    load_dotenv()
    base = Path(os.getenv("TEMP_DIR", "/tmp/localclips"))
    d = base / "jobs"
    d.mkdir(parents=True, exist_ok=True)
    return d


class Job:
    def __init__(
        self,
        job_id: str,
        video_path: Path,
        clips_dir: Path,
        status: str = "pending",
        progress: int = 0,
        message: str = "Queued",
        clips: Optional[List[Dict[str, Any]]] = None,
        error: Optional[str] = None,
    ):
        self.id: str = job_id
        self.status: str = status
        self.progress: int = progress
        self.message: str = message
        self.clips: List[Dict[str, Any]] = clips or []
        self.error: Optional[str] = error
        self.video_path: Path = video_path
        self.clips_dir: Path = clips_dir

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "status": self.status,
            "progress": self.progress,
            "message": self.message,
            "clips": self.clips,
            "error": self.error,
        }

    def to_json_dict(self) -> Dict[str, Any]:
        """Full dict including paths, for persistence."""
        return {
            **self.to_dict(),
            "video_path": str(self.video_path),
            "clips_dir": str(self.clips_dir),
        }

    @classmethod
    def from_json_dict(cls, d: Dict[str, Any]) -> "Job":
        return cls(
            job_id=d["id"],
            video_path=Path(d.get("video_path", "")),
            clips_dir=Path(d.get("clips_dir", "")),
            status=d.get("status", "unknown"),
            progress=d.get("progress", 0),
            message=d.get("message", ""),
            clips=d.get("clips", []),
            error=d.get("error"),
        )


class JobStore:
    """File-backed async job store."""

    def __init__(self):
        self._lock = asyncio.Lock()

    def _path(self, job_id: str) -> Path:
        return _jobs_dir() / f"{job_id}.json"

    def _write(self, job: Job) -> None:
        p = self._path(job.id)
        tmp = p.with_suffix(".tmp")
        tmp.write_text(json.dumps(job.to_json_dict(), indent=2), encoding="utf-8")
        tmp.replace(p)

    def _read(self, job_id: str) -> Optional[Job]:
        p = self._path(job_id)
        if not p.exists():
            return None
        try:
            d = json.loads(p.read_text(encoding="utf-8"))
            return Job.from_json_dict(d)
        except Exception:
            return None

    async def create(self, video_path: Path, clips_dir: Path, job_id: Optional[str] = None) -> Job:
        job = Job(job_id or str(uuid.uuid4()), video_path, clips_dir)
        async with self._lock:
            self._write(job)
        return job

    async def get(self, job_id: str) -> Optional[Job]:
        async with self._lock:
            return self._read(job_id)

    async def update(
        self,
        job_id: str,
        *,
        status: Optional[str] = None,
        progress: Optional[int] = None,
        message: Optional[str] = None,
        clips: Optional[List[Dict[str, Any]]] = None,
        error: Optional[str] = None,
    ) -> None:
        async with self._lock:
            job = self._read(job_id)
            if not job:
                return
            if status is not None:
                job.status = status
            if progress is not None:
                job.progress = progress
            if message is not None:
                job.message = message
            if clips is not None:
                job.clips = clips
            if error is not None:
                job.error = error
            self._write(job)


_store: Optional[JobStore] = None


def get_job_store() -> JobStore:
    global _store
    if _store is None:
        _store = JobStore()
    return _store
