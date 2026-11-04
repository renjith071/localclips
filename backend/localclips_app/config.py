"""
Configuration for LocalClips backend.
No API keys needed - everything runs locally.
"""

import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()


class Config:
    def __init__(self):
        # Directory where uploaded and generated files live
        self.temp_dir = os.getenv("TEMP_DIR", "/tmp/localclips")
        self.clips_dir = os.path.join(self.temp_dir, "clips")
        self.uploads_dir = os.path.join(self.temp_dir, "uploads")

        # Processing defaults
        self.max_video_upload_bytes = int(
            os.getenv("MAX_VIDEO_UPLOAD_BYTES", str(12 * 1024 * 1024 * 1024))  # 12 GB
        )
        self.clip_duration = int(os.getenv("DEFAULT_CLIP_DURATION", "60"))

        # Ensure directories exist
        Path(self.temp_dir).mkdir(parents=True, exist_ok=True)
        Path(self.clips_dir).mkdir(parents=True, exist_ok=True)
        Path(self.uploads_dir).mkdir(parents=True, exist_ok=True)

    # Fonts dir - reuse from the original project if available, otherwise use a local one
    @property
    def fonts_dir(self) -> Path:
        here = Path(__file__).resolve()
        # Primary: self-contained layout — supoclip_backend/ inside localclips/
        new_candidate = here.parent.parent.parent / "supoclip_backend" / "fonts"
        if new_candidate.exists():
            return new_candidate
        # Fallback: legacy layout — backend/ 4 levels up from this file
        old_candidate = here.parent.parent.parent.parent / "backend" / "fonts"
        if old_candidate.exists():
            return old_candidate
        # Last resort: create a local fonts dir
        local_fonts = here.parent.parent / "fonts"
        local_fonts.mkdir(parents=True, exist_ok=True)
        return local_fonts


_config: Config | None = None


def get_config() -> Config:
    global _config
    if _config is None:
        _config = Config()
    return _config
