"""
Core processing logic for LocalClips.

Adds the original supoclip backend directory to sys.path so that
'from src.video_utils import ...' resolves to the original project's
rendering code — not to this package (which is now named localclips_app).

Pipeline:
  1. Write transcript cache JSON next to the video (word-synced captions)
  2. Normalise the AI JSON into segment dicts
  3. For each segment: compute keep_ranges, render via create_optimized_clip
  4. Return list of clip_info dicts
"""

from __future__ import annotations

import json
import logging
import sys
import uuid
from pathlib import Path
from typing import Any, Callable, Coroutine, Dict, List, Optional

logger = logging.getLogger(__name__)


# ──────────────────────────────────────────────────────────────
# Path setup
# ──────────────────────────────────────────────────────────────

def _get_original_backend_root() -> Path:
    """
    Return the 'backend' directory of the original supoclip rendering engine.
    Supports two layouts:

    New layout (backend moved inside localclips):
        localclips/
            backend/                 ← rendering engine
                src/video_utils.py
            localclips_backend/
                localclips_app/
                    processing.py   ← here (3 levels up → localclips → backend)

    Legacy layout (backend is a sibling of localclips):
        supoclips/
            backend/
            localclips/
                backend/
                    localclips_app/
                        processing.py  ← here (4 levels up → supoclips → backend)
    """
    here = Path(__file__).resolve()

    # New layout: supoclip_backend/ sits inside localclips/ alongside this app's backend/
    new_candidate = here.parent.parent.parent / "supoclip_backend"
    if new_candidate.is_dir() and (new_candidate / "src").is_dir():
        return new_candidate

    # Legacy layout: backend/ is 4 levels up
    old_candidate = here.parent.parent.parent.parent / "backend"
    if old_candidate.is_dir() and (old_candidate / "src").is_dir():
        return old_candidate

    raise RuntimeError(
        f"Rendering backend not found. Looked at:\n"
        f"  {new_candidate}\n  {old_candidate}"
    )


def _ensure_on_path() -> None:
    """Prepend the original backend directory to sys.path (idempotent)."""
    root = str(_get_original_backend_root())
    if root not in sys.path:
        sys.path.insert(0, root)
        logger.info("Added original backend to sys.path: %s", root)


def _patch_fonts_dir() -> None:
    """
    On Windows the fonts directory may be inside a path with spaces
    (e.g. 'supoclips3 (2)/...'), which can break ffmpeg's fontsdir= argument.
    Copy fonts to a stable space-free temp path and patch ALL FONTS_DIR references
    so font_family / font_size / font_color customization works correctly.
    """
    import platform, shutil, tempfile
    if platform.system() != "Windows":
        return

    try:
        import src.font_registry as fr  # type: ignore[import]
        import src.video_utils as vu   # type: ignore[import]

        fonts_path = Path(str(fr.FONTS_DIR))
        if " " not in str(fonts_path):
            return  # No spaces — nothing to do

        safe_dir = Path(tempfile.gettempdir()) / "localclips_fonts"
        if not safe_dir.exists() or not any(safe_dir.iterdir()):
            if safe_dir.exists():
                shutil.rmtree(str(safe_dir))
            shutil.copytree(str(fonts_path), str(safe_dir))
            logger.info("Copied fonts to space-free path: %s", safe_dir)

        # Patch font_registry module-level var — find_font_path() reads this
        fr.FONTS_DIR = safe_dir   # type: ignore[attr-defined]
        # Patch video_utils re-export (used by ass_fonts_dir)
        vu.FONTS_DIR = safe_dir   # type: ignore[attr-defined]
        logger.info("Patched FONTS_DIR → %s", safe_dir)

    except Exception as exc:
        logger.warning("Could not patch fonts dir: %s", exc)


# ──────────────────────────────────────────────────────────────
# Lazy import of rendering functions
# ──────────────────────────────────────────────────────────────

_rendering_imported = False
_create_optimized_clip = None
_parse_timestamp_to_seconds = None
_build_clip_keep_ranges = None
_build_keep_ranges_from_source_ranges = None
_extend_keep_ranges_to_sentence_boundary = None
_normalize_source_ranges = None
_save_clip_source_ranges = None
_run_in_thread = None


def _import_rendering() -> None:
    global _rendering_imported
    global _create_optimized_clip, _parse_timestamp_to_seconds
    global _build_clip_keep_ranges, _build_keep_ranges_from_source_ranges
    global _extend_keep_ranges_to_sentence_boundary
    global _normalize_source_ranges, _save_clip_source_ranges, _run_in_thread

    if _rendering_imported:
        return

    _ensure_on_path()

    try:
        # These imports now resolve to the original backend's src package
        # because its parent directory is first on sys.path.
        # The localclips package is named 'localclips_app' so there's no collision.
        from src.video_utils import (  # type: ignore[import]
            create_optimized_clip,
            parse_timestamp_to_seconds,
            build_clip_keep_ranges,
            build_keep_ranges_from_source_ranges,
            extend_keep_ranges_to_sentence_boundary,
        )
        from src.clip_source_map import (  # type: ignore[import]
            normalize_source_ranges,
            save_clip_source_ranges,
        )
        from src.utils.async_helpers import run_in_thread  # type: ignore[import]

    except ImportError as exc:
        raise RuntimeError(
            f"Cannot import rendering functions from original supoclip backend: {exc}\n"
            f"Backend path: {_get_original_backend_root()}\n"
            "Make sure srt, opencv-python, mediapipe, numpy, assemblyai, and httpx are "
            "installed in this Python environment."
        ) from exc

    _create_optimized_clip                   = create_optimized_clip
    _parse_timestamp_to_seconds              = parse_timestamp_to_seconds
    _build_clip_keep_ranges                  = build_clip_keep_ranges
    _build_keep_ranges_from_source_ranges    = build_keep_ranges_from_source_ranges
    _extend_keep_ranges_to_sentence_boundary = extend_keep_ranges_to_sentence_boundary
    _normalize_source_ranges                 = normalize_source_ranges
    _save_clip_source_ranges                 = save_clip_source_ranges
    _run_in_thread                           = run_in_thread
    _rendering_imported = True
    logger.info("Rendering functions loaded from: %s", _get_original_backend_root())

    # Must happen AFTER imports so the modules exist in sys.modules
    _patch_fonts_dir()


# ──────────────────────────────────────────────────────────────
# Segment normalisation
# ──────────────────────────────────────────────────────────────

def _normalise_segments(analysis: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Convert TranscriptAnalysis JSON → flat segment dicts for the renderer."""
    raw = analysis.get("most_relevant_segments", [])
    segments: List[Dict[str, Any]] = []
    for seg in raw:
        virality = seg.get("virality") or {}
        segments.append({
            "start_time":        seg.get("start_time", "00:00"),
            "end_time":          seg.get("end_time", "00:00"),
            "text":              seg.get("text", ""),
            "relevance_score":   float(seg.get("relevance_score", 0.75)),
            "reasoning":         seg.get("reasoning", ""),
            "virality_score":    int(virality.get("total_score", 0)),
            "hook_score":        int(virality.get("hook_score", 0)),
            "engagement_score":  int(virality.get("engagement_score", 0)),
            "value_score":       int(virality.get("value_score", 0)),
            "shareability_score":int(virality.get("shareability_score", 0)),
            "hook_type":         virality.get("hook_type"),
            "hook_title":        seg.get("hook_title"),
        })
    return segments


# ──────────────────────────────────────────────────────────────
# Single-clip renderer
# ──────────────────────────────────────────────────────────────

async def _render_clip(
    video_path: Path,
    segment: Dict[str, Any],
    clip_index: int,
    output_dir: Path,
    font_family: Optional[str],
    font_size: Optional[int],
    font_color: Optional[str],
    caption_template: str,
    output_format: str,
    add_subtitles: bool,
    cleanup_settings: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    """Render one clip. Returns clip_info dict or None on failure."""
    try:
        provided_keep_ranges = _normalize_source_ranges(segment.get("keep_ranges"))
        source_ranges        = _normalize_source_ranges(segment.get("source_ranges"))

        if provided_keep_ranges:
            start_s = provided_keep_ranges[0][0]
            end_s   = provided_keep_ranges[-1][1]
        elif source_ranges:
            start_s = source_ranges[0][0]
            end_s   = source_ranges[-1][1]
        else:
            start_s = _parse_timestamp_to_seconds(segment["start_time"])
            end_s   = _parse_timestamp_to_seconds(segment["end_time"])

        duration = end_s - start_s
        if duration <= 0:
            logger.warning("Clip %d: invalid duration %.1fs, skipping.", clip_index + 1, duration)
            return None

        clip_filename = (
            f"clip_{clip_index + 1}_"
            f"{segment['start_time'].replace(':', '')}-"
            f"{segment['end_time'].replace(':', '')}_"
            f"{uuid.uuid4().hex[:12]}.mp4"
        )
        clip_path = output_dir / clip_filename

        if provided_keep_ranges:
            keep_ranges = provided_keep_ranges
        elif source_ranges:
            keep_ranges = _build_keep_ranges_from_source_ranges(
                video_path, source_ranges, cleanup_settings
            )
        else:
            keep_ranges = _build_clip_keep_ranges(
                video_path, start_s, end_s, cleanup_settings
            )

        keep_ranges = _extend_keep_ranges_to_sentence_boundary(video_path, keep_ranges)

        success: bool = await _run_in_thread(
            _create_optimized_clip,
            video_path,
            start_s,
            end_s,
            clip_path,
            add_subtitles,
            font_family,
            font_size,
            font_color,
            caption_template,
            output_format,
            keep_ranges,
            segment.get("hook_title"),
        )

        if not success:
            logger.error("Clip %d: create_optimized_clip returned False.", clip_index + 1)
            return None

        _save_clip_source_ranges(clip_path, keep_ranges)
        cleaned_duration = sum(e - s for s, e in keep_ranges)

        return {
            "clip_id":           clip_index + 1,
            "filename":          clip_filename,
            "path":              str(clip_path),
            "start_time":        segment["start_time"],
            "end_time":          segment["end_time"],
            "duration":          cleaned_duration,
            "text":              segment.get("text", ""),
            "relevance_score":   segment.get("relevance_score", 0.0),
            "reasoning":         segment.get("reasoning", ""),
            "virality_score":    segment.get("virality_score", 0),
            "hook_score":        segment.get("hook_score", 0),
            "engagement_score":  segment.get("engagement_score", 0),
            "value_score":       segment.get("value_score", 0),
            "shareability_score":segment.get("shareability_score", 0),
            "hook_type":         segment.get("hook_type"),
            "hook_title":        segment.get("hook_title"),
            "keep_ranges":       keep_ranges,
        }

    except Exception as exc:
        logger.error("Clip %d failed: %s", clip_index + 1, exc, exc_info=True)
        return None


# ──────────────────────────────────────────────────────────────
# Main entry point
# ──────────────────────────────────────────────────────────────

async def process_local_job(
    job_id: str,
    video_path: Path,
    transcript_cache: Dict[str, Any],
    analysis: Dict[str, Any],
    clips_output_dir: Path,
    font_family: Optional[str] = None,
    font_size: Optional[int] = None,
    font_color: Optional[str] = None,
    caption_template: str = "default",
    output_format: str = "vertical",
    add_subtitles: bool = True,
    cut_long_pauses: bool = False,
    pause_threshold_ms: int = 900,
    remove_filler_words: bool = False,
    filtered_words: str = "",
    progress_callback: Optional[Callable[[int, str], Coroutine]] = None,
) -> List[Dict[str, Any]]:
    """Full rendering pipeline — no API calls."""

    async def _progress(pct: int, msg: str) -> None:
        logger.info("[%s] %d%% – %s", job_id, pct, msg)
        if progress_callback:
            await progress_callback(pct, msg)

    await _progress(5, "Importing rendering engine…")
    _import_rendering()

    await _progress(10, "Writing transcript cache…")
    cache_path = video_path.with_suffix(".transcript_cache.json")
    try:
        cache_path.write_text(json.dumps(transcript_cache), encoding="utf-8")
        logger.info("Transcript cache → %s (%d words)",
                    cache_path, len(transcript_cache.get("words", [])))
    except Exception as exc:
        logger.warning("Could not write transcript cache: %s", exc)

    await _progress(15, "Parsing AI analysis…")
    segments = _normalise_segments(analysis)
    if not segments:
        raise ValueError(
            "The AI JSON contains no clip segments "
            "('most_relevant_segments' is empty or missing)."
        )

    clips_output_dir.mkdir(parents=True, exist_ok=True)

    cleanup_settings: Dict[str, Any] = {
        "cut_long_pauses":    cut_long_pauses,
        "pause_threshold_ms": pause_threshold_ms,
        "remove_filler_words":remove_filler_words,
        "filtered_words":     [w.strip() for w in filtered_words.split(",") if w.strip()],
    }

    total = len(segments)
    await _progress(20, f"Found {total} segment(s), starting render…")

    clip_results: List[Dict[str, Any]] = []
    for i, segment in enumerate(segments):
        await _progress(
            20 + int((i / max(total, 1)) * 75),
            f"Rendering clip {i + 1}/{total}…",
        )
        clip_info = await _render_clip(
            video_path=video_path,
            segment=segment,
            clip_index=i,
            output_dir=clips_output_dir,
            font_family=font_family,
            font_size=font_size,
            font_color=font_color,
            caption_template=caption_template,
            output_format=output_format,
            add_subtitles=add_subtitles,
            cleanup_settings=cleanup_settings,
        )
        if clip_info:
            clip_info["clip_order"] = i + 1
            clip_results.append(clip_info)

    await _progress(100, f"Done – {len(clip_results)} clip(s) ready.")
    return clip_results
