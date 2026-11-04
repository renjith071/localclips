"""
Parse an SRT file into the word-level transcript cache format expected
by the original project's video_utils.py subtitle renderer.

SRT format does not carry word-level timing, so we spread each subtitle
block's duration evenly across its constituent words.  This gives the
word-synced caption renderer something reasonable to work with.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Dict, List

TRANSCRIPT_CACHE_SCHEMA_VERSION = 2


def _srt_time_to_ms(timestamp: str) -> int:
    """Convert 'HH:MM:SS,mmm' to milliseconds."""
    hh, mm, rest = timestamp.strip().split(":")
    ss, ms = rest.replace(".", ",").split(",")
    return (int(hh) * 3600 + int(mm) * 60 + int(ss)) * 1000 + int(ms)


def parse_srt_file(srt_path: Path) -> Dict[str, Any]:
    """
    Parse an SRT file and return a transcript cache dict compatible with
    video_utils.load_cached_transcript_data().

    Schema:
    {
        "version": 2,
        "text": "<full transcript text>",
        "words": [{"text": str, "start": int (ms), "end": int (ms), "confidence": float, "speaker": None}, ...],
        "utterances": [{"text": str, "start": int, "end": int, "speaker": None, "words": [...]}, ...],
    }
    """
    content = srt_path.read_text(encoding="utf-8", errors="replace")
    blocks = re.split(r"\n\s*\n", content.strip())

    all_words: List[Dict[str, Any]] = []
    utterances: List[Dict[str, Any]] = []
    full_text_parts: List[str] = []

    for block in blocks:
        lines = [l for l in block.strip().splitlines() if l.strip()]
        if len(lines) < 3:
            continue

        # Line 0: index (optional, we skip)
        # Line 1: timing  00:00:01,000 --> 00:00:04,000
        # Line 2+: subtitle text
        timing_line = None
        text_start_idx = 1
        for idx, line in enumerate(lines):
            if "-->" in line:
                timing_line = line
                text_start_idx = idx + 1
                break

        if timing_line is None:
            continue

        parts = timing_line.split("-->")
        if len(parts) != 2:
            continue

        block_start_ms = _srt_time_to_ms(parts[0])
        block_end_ms = _srt_time_to_ms(parts[1])
        block_text = " ".join(lines[text_start_idx:])

        # Strip HTML-like tags (e.g., <i>...</i>)
        block_text = re.sub(r"<[^>]+>", "", block_text).strip()
        if not block_text:
            continue

        full_text_parts.append(block_text)

        # Split into words and spread timing evenly
        words = block_text.split()
        n = len(words)
        if n == 0:
            continue

        duration = block_end_ms - block_start_ms
        word_duration = duration / n if n > 0 else 100

        block_words: List[Dict[str, Any]] = []
        for i, word in enumerate(words):
            w_start = int(block_start_ms + i * word_duration)
            w_end = int(block_start_ms + (i + 1) * word_duration)
            entry: Dict[str, Any] = {
                "text": word,
                "start": w_start,
                "end": w_end,
                "confidence": 1.0,
                "speaker": None,
            }
            all_words.append(entry)
            block_words.append(entry)

        utterances.append(
            {
                "text": block_text,
                "start": block_start_ms,
                "end": block_end_ms,
                "speaker": None,
                "words": block_words,
            }
        )

    return {
        "version": TRANSCRIPT_CACHE_SCHEMA_VERSION,
        "text": " ".join(full_text_parts),
        "words": all_words,
        "utterances": utterances,
    }


def srt_to_plain_text(srt_path: Path) -> str:
    """Return just the plain text from an SRT file (no timing, no indices)."""
    data = parse_srt_file(srt_path)
    return data.get("text", "")
