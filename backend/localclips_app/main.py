"""
LocalClips FastAPI backend.

Endpoints:
  POST /jobs            – Upload video + SRT + AI JSON → starts async job, returns job_id
  GET  /jobs/{id}       – Poll job status + clip list
  GET  /jobs/{id}/sse   – SSE stream of progress events
  GET  /clips/{id}/{filename} – Serve a rendered clip file
  GET  /fonts           – List available fonts (proxied from original fonts dir)
  GET  /fonts/{name}    – Serve a font file
  GET  /caption-templates – List caption templates
  GET  /health          – Health check
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from pathlib import Path
from typing import Any, AsyncGenerator, Dict, List, Optional

import aiofiles
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from sse_starlette.sse import EventSourceResponse

from .config import get_config
from .job_store import get_job_store, _jobs_dir
from .processing import process_local_job
from .srt_parser import parse_srt_file

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="LocalClips API",
    description="Clip generation from local video + SRT + AI JSON – no API credits needed",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ──────────────────────────────────────────────────────────────────────────────
# Health
# ──────────────────────────────────────────────────────────────────────────────


@app.get("/health")
async def health():
    return {"status": "ok"}


# ──────────────────────────────────────────────────────────────────────────────
# Fonts  (reuse original project's fonts)
# ──────────────────────────────────────────────────────────────────────────────


def _list_fonts() -> List[Dict[str, Any]]:
    fonts_dir = get_config().fonts_dir
    fonts = []
    for path in sorted(fonts_dir.glob("*.ttf")):
        stem = path.stem
        fonts.append(
            {
                "name": stem,
                "display_name": stem.replace("-", " ").replace("_", " "),
                "format": "ttf",
            }
        )
    for path in sorted(fonts_dir.glob("*.otf")):
        stem = path.stem
        fonts.append(
            {
                "name": stem,
                "display_name": stem.replace("-", " ").replace("_", " "),
                "format": "otf",
            }
        )
    return fonts


@app.get("/fonts")
async def get_fonts():
    return {"fonts": _list_fonts()}


@app.get("/fonts/{font_name}")
async def get_font_file(font_name: str):
    fonts_dir = get_config().fonts_dir
    for ext in (".ttf", ".otf"):
        path = fonts_dir / f"{font_name}{ext}"
        if path.exists():
            media_type = "font/ttf" if ext == ".ttf" else "font/otf"
            return FileResponse(str(path), media_type=media_type)
    raise HTTPException(status_code=404, detail="Font not found")


# ──────────────────────────────────────────────────────────────────────────────
# Caption templates  (proxy from original project)
# ──────────────────────────────────────────────────────────────────────────────


def _get_caption_templates() -> List[Dict[str, Any]]:
    """Import caption_templates from the original backend."""
    try:
        from .processing import _ensure_on_path
        _ensure_on_path()
        from src.caption_templates import get_template_info  # type: ignore[import]
        return [
            {
                "id": t["id"],
                "name": t["name"],
                "description": t.get("description", ""),
                "animation": t.get("animation", "none"),
                "font_family": t.get("font_family"),
                "font_size": t.get("font_size"),
                "font_color": t.get("font_color"),
            }
            for t in get_template_info()
        ]
    except Exception as exc:
        logger.warning("Could not load caption templates from original project: %s", exc)
        return [
            {"id": "default",    "name": "Default",  "description": "Punchy word-by-word captions",  "animation": "karaoke", "font_family": "THEBOLDFONT",        "font_size": 32, "font_color": "#FFFFFF"},
            {"id": "hormozi",    "name": "Hormozi",  "description": "Bold green highlight pill",      "animation": "karaoke", "font_family": "THEBOLDFONT",        "font_size": 38, "font_color": "#FFFFFF"},
            {"id": "mrbeast",    "name": "MrBeast",  "description": "Large yellow text, red pop",     "animation": "karaoke", "font_family": "THEBOLDFONT",        "font_size": 42, "font_color": "#FFFF00"},
            {"id": "minimal",    "name": "Minimal",  "description": "Clean subtle captions",          "animation": "fade",    "font_family": "TikTokSans-Regular", "font_size": 26, "font_color": "#FFFFFF"},
            {"id": "tiktok",     "name": "TikTok",   "description": "TikTok-style pink highlights",   "animation": "karaoke", "font_family": "TikTokSans-Regular", "font_size": 34, "font_color": "#FFFFFF"},
            {"id": "neon",       "name": "Neon",     "description": "Glowing neon text",              "animation": "karaoke", "font_family": "THEBOLDFONT",        "font_size": 36, "font_color": "#00FFFF"},
            {"id": "podcast",    "name": "Podcast",  "description": "Professional podcast captions",  "animation": "karaoke", "font_family": "TikTokSans-Regular", "font_size": 28, "font_color": "#FFFFFF"},
        ]


@app.get("/caption-templates")
async def get_caption_templates():
    return {"templates": _get_caption_templates()}


# ──────────────────────────────────────────────────────────────────────────────
# Jobs
# ──────────────────────────────────────────────────────────────────────────────


@app.post("/jobs")
async def create_job(
    video: UploadFile = File(..., description="Video file (mp4, mov, etc.)"),
    srt: UploadFile = File(..., description="SRT subtitle file"),
    ai_json: UploadFile = File(..., description="AI analysis JSON (TranscriptAnalysis format)"),
    font_family: Optional[str] = Form(None),
    font_size: Optional[int] = Form(None),
    font_color: Optional[str] = Form(None),
    caption_template: str = Form("default"),
    output_format: str = Form("vertical"),
    add_subtitles: bool = Form(True),
    cut_long_pauses: bool = Form(False),
    pause_threshold_ms: int = Form(900),
    remove_filler_words: bool = Form(False),
    filtered_words: str = Form(""),
):
    """
    Upload video + SRT + AI JSON and start async clip generation.

    The ai_json must be a JSON object matching TranscriptAnalysis:
    {
      "most_relevant_segments": [
        {
          "start_time": "MM:SS",
          "end_time": "MM:SS",
          "text": "...",
          "relevance_score": 0.9,
          "reasoning": "...",
          "hook_title": "...",
          "virality": {
            "hook_score": 20, "engagement_score": 20,
            "value_score": 20, "shareability_score": 20,
            "total_score": 80, "hook_type": "question"
          }
        }
      ],
      "summary": "...",
      "key_topics": ["topic1", "topic2"]
    }
    """
    config = get_config()
    store = get_job_store()

    # Use a single UUID for BOTH the directory names AND the job ID so
    # video_url = /clips/{job_id}/{filename} always resolves correctly.
    job_uid = str(uuid.uuid4())
    uploads_dir = Path(config.uploads_dir) / job_uid
    clips_dir = Path(config.clips_dir) / job_uid
    uploads_dir.mkdir(parents=True, exist_ok=True)
    clips_dir.mkdir(parents=True, exist_ok=True)

    # ── Save video ───────────────────────────────────────────────────────────
    video_ext = Path(video.filename or "video.mp4").suffix or ".mp4"
    video_path = uploads_dir / f"video{video_ext}"
    max_bytes = config.max_video_upload_bytes
    written = 0
    async with aiofiles.open(video_path, "wb") as f:
        while True:
            chunk = await video.read(1024 * 1024)
            if not chunk:
                break
            written += len(chunk)
            if written > max_bytes:
                raise HTTPException(status_code=413, detail="Video file too large")
            await f.write(chunk)

    # ── Save SRT ─────────────────────────────────────────────────────────────
    srt_path = uploads_dir / "subtitles.srt"
    srt_bytes = await srt.read()
    srt_path.write_bytes(srt_bytes)

    # ── Save + parse AI JSON ─────────────────────────────────────────────────
    ai_json_bytes = await ai_json.read()
    try:
        analysis: Dict[str, Any] = json.loads(ai_json_bytes)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid AI JSON: {exc}")

    if "most_relevant_segments" not in analysis:
        raise HTTPException(
            status_code=400,
            detail="AI JSON must have a 'most_relevant_segments' key.",
        )

    # ── Parse SRT → transcript cache ─────────────────────────────────────────
    transcript_cache = parse_srt_file(srt_path)

    # ── Create job record using the SAME uuid as the directories ─────────────
    job = await store.create(video_path=video_path, clips_dir=clips_dir, job_id=job_uid)

    # ── Fire off background processing ───────────────────────────────────────
    asyncio.create_task(
        _run_job(
            job_id=job.id,
            video_path=video_path,
            transcript_cache=transcript_cache,
            analysis=analysis,
            clips_dir=clips_dir,
            font_family=font_family,
            font_size=font_size,
            font_color=font_color,
            caption_template=caption_template,
            output_format=output_format,
            add_subtitles=add_subtitles,
            cut_long_pauses=cut_long_pauses,
            pause_threshold_ms=pause_threshold_ms,
            remove_filler_words=remove_filler_words,
            filtered_words=filtered_words,
        )
    )

    return {"job_id": job.id, "message": "Job started"}


async def _run_job(
    job_id: str,
    video_path: Path,
    transcript_cache: Dict[str, Any],
    analysis: Dict[str, Any],
    clips_dir: Path,
    **kwargs,
) -> None:
    store = get_job_store()
    await store.update(job_id, status="processing", progress=0, message="Starting…")

    async def on_progress(pct: int, msg: str) -> None:
        await store.update(job_id, progress=pct, message=msg)

    try:
        clip_results = await process_local_job(
            job_id=job_id,
            video_path=video_path,
            transcript_cache=transcript_cache,
            analysis=analysis,
            clips_output_dir=clips_dir,
            progress_callback=on_progress,
            **kwargs,
        )

        # Build the clip list for the API response
        clips_out = []
        for c in clip_results:
            clips_out.append(
                {
                    "id": str(uuid.uuid4()),
                    "filename": c["filename"],
                    "video_url": f"/clips/{job_id}/{c['filename']}",
                    "start_time": c["start_time"],
                    "end_time": c["end_time"],
                    "duration": c["duration"],
                    "text": c.get("text", ""),
                    "relevance_score": c.get("relevance_score", 0.0),
                    "reasoning": c.get("reasoning", ""),
                    "clip_order": c.get("clip_order", 1),
                    "virality_score": c.get("virality_score", 0),
                    "hook_score": c.get("hook_score", 0),
                    "engagement_score": c.get("engagement_score", 0),
                    "value_score": c.get("value_score", 0),
                    "shareability_score": c.get("shareability_score", 0),
                    "hook_type": c.get("hook_type"),
                    "hook_title": c.get("hook_title"),
                }
            )

        await store.update(
            job_id,
            status="completed",
            progress=100,
            message=f"Done – {len(clips_out)} clips ready",
            clips=clips_out,
        )

    except Exception as exc:
        logger.exception("Job %s failed: %s", job_id, exc)
        await store.update(
            job_id,
            status="error",
            progress=0,
            message=str(exc),
            error=str(exc),
        )


@app.get("/jobs/{job_id}")
async def get_job(job_id: str):
    store = get_job_store()
    job = await store.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job.to_dict()


@app.get("/jobs")
async def list_jobs():
    """List all known jobs (reads from disk)."""
    jobs_dir = _jobs_dir()
    results = []
    for p in sorted(jobs_dir.glob("*.json"), key=lambda f: f.stat().st_mtime, reverse=True):
        try:
            d = json.loads(p.read_text(encoding="utf-8"))
            results.append({
                "id": d["id"],
                "status": d.get("status"),
                "progress": d.get("progress", 0),
                "message": d.get("message", ""),
                "clips_count": len(d.get("clips", [])),
            })
        except Exception:
            pass
    return {"jobs": results}


# ──────────────────────────────────────────────────────────────────────────────
# SSE progress stream
# ──────────────────────────────────────────────────────────────────────────────


@app.get("/jobs/{job_id}/sse")
async def job_sse(job_id: str):
    store = get_job_store()

    async def event_generator() -> AsyncGenerator[Dict[str, Any], None]:
        while True:
            job = await store.get(job_id)
            if not job:
                yield {"event": "error", "data": json.dumps({"message": "Job not found"})}
                return

            data = {
                "status": job.status,
                "progress": job.progress,
                "message": job.message,
            }

            if job.status == "completed":
                data["clips"] = job.clips
                yield {"event": "completed", "data": json.dumps(data)}
                return
            elif job.status == "error":
                data["error"] = job.error
                yield {"event": "error", "data": json.dumps(data)}
                return
            else:
                yield {"event": "progress", "data": json.dumps(data)}
                await asyncio.sleep(1)

    return EventSourceResponse(event_generator())


# ──────────────────────────────────────────────────────────────────────────────
# Serve clip files
# ──────────────────────────────────────────────────────────────────────────────


@app.get("/clips/{job_id}/{filename}")
async def serve_clip(job_id: str, filename: str):
    config = get_config()

    # Sanitise inputs – no path traversal
    if "/" in filename or "\\" in filename or ".." in job_id or ".." in filename:
        raise HTTPException(status_code=400, detail="Invalid path")

    clip_path = Path(config.clips_dir) / job_id / filename

    # Resolve and verify still under clips_dir
    try:
        resolved = clip_path.resolve()
        base = Path(config.clips_dir).resolve()
        resolved.relative_to(base)
    except ValueError:
        raise HTTPException(status_code=403, detail="Forbidden")

    if not resolved.exists():
        raise HTTPException(status_code=404, detail="Clip not found")

    # Serve with proper range-request support for video seeking
    return FileResponse(
        str(resolved),
        media_type="video/mp4",
        headers={
            "Accept-Ranges": "bytes",
            "Cache-Control": "no-cache",
            "Access-Control-Allow-Origin": "*",
        },
    )
