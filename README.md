# LocalClips

**Turn your video + subtitles + AI analysis into short-form clips — no API credits, no cloud, no subscription.**

LocalClips is a self-hosted clip generator. Instead of paying API credits for transcription and AI analysis, you bring your own:

- **Video file** — any format ffmpeg supports (mp4, mkv, mov, webm…)
- **SRT subtitle file** — standard subtitle file for the video
- **AI analysis JSON** — output from any local LLM (Ollama, LM Studio, llama.cpp, etc.)

LocalClips handles the rest: face-tracked vertical cropping, caption burn-in, filler word removal, pause cutting, and per-clip download.

---

## Features

- 🎬 **Face-tracked 9:16 reframing** — MediaPipe detects faces and keeps them in frame
- 📝 **Word-synced captions** — multiple caption styles (Default, Hormozi, MrBeast, TikTok, Neon…)
- 🔤 **Custom fonts** — pick from 20+ bundled fonts or set size and colour
- ✂️ **Silence removal** — cut long pauses automatically
- 🚫 **Filler word removal** — strip ums, uhs, and any custom words
- 🏷️ **Hook title overlay** — AI-generated title burned into the top of each clip
- 💾 **Named downloads** — clips save with their hook title as the filename
- 📂 **Persistent job history** — past renders survive page reloads
- 🌙 **Dark UI** — clean, minimal interface

---

## Project structure

```
localclips/
├── backend/               FastAPI backend (this app)
│   └── localclips_app/    main.py · processing.py · config.py · job_store.py · srt_parser.py
├── frontend/              Next.js 15 frontend
│   └── src/
│       ├── app/           page · layout · globals.css
│       ├── components/    localclips-app · clip-card · file-drop-zone · ui/
│       └── lib/           api.ts · utils.ts
└── supoclip_backend/      Rendering engine (video_utils, caption_templates, fonts…)
    ├── src/               Python rendering library
    ├── fonts/             23 bundled .ttf fonts
    └── transitions/       transition clips
```

---

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Python | ≥ 3.11 | Backend |
| Node.js | ≥ 18 | Frontend |
| ffmpeg | any recent | Video encoding (must be on PATH) |
| pip | any | Python packages |

Verify ffmpeg is available:
```bash
ffmpeg -version
```

---

## Setup

### 1 — Backend

```bash
cd backend

# Copy and configure environment
cp .env.example .env
# Edit .env — set TEMP_DIR to a path where you want uploads/clips stored

# Install dependencies
pip install -r requirements.txt

# Start the API server
uvicorn localclips_app.main:app --reload --host 0.0.0.0 --port 8001
```

The backend will be available at **http://localhost:8001**.  
On first run it downloads the MediaPipe face detection model (~1 MB) automatically.

### 2 — Frontend

```bash
cd frontend

# Copy and configure environment
cp .env.example .env
# NEXT_PUBLIC_API_URL=http://localhost:8001  (default is fine for local dev)

# Install dependencies
npm install

# Start the dev server
npm run dev
```

Open **http://localhost:3200**.

---

## Usage

### Step 1 — Prepare your AI analysis JSON

Run your local LLM with the video transcript and this prompt to generate the JSON:

```
You are a short-form video clip analyst. Given the transcript below, identify the 
best segments to clip for social media (YouTube Shorts, TikTok, Reels).

For each segment return JSON in this exact format:
{
  "most_relevant_segments": [
    {
      "start_time": "MM:SS",
      "end_time": "MM:SS",
      "text": "exact transcript text for this segment",
      "relevance_score": 0.92,
      "reasoning": "why this makes a good clip",
      "hook_title": "Short Punchy Title Here",
      "virality": {
        "hook_score": 22,
        "engagement_score": 20,
        "value_score": 18,
        "shareability_score": 17,
        "total_score": 77,
        "hook_type": "question"
      }
    }
  ],
  "summary": "brief video summary",
  "key_topics": ["topic1", "topic2"]
}
```

`hook_type` can be: `question`, `statement`, `statistic`, `story`, `contrast`, `humor`, `emotional`, or `shock`.

### Step 2 — Upload and generate

1. Open http://localhost:3200
2. Upload your **video file**, **SRT file**, and **AI JSON**
3. Configure rendering options (output format, caption style, font)
4. Click **Generate clips**
5. Watch real-time progress, then download each clip by its hook title

---

## Configuration

### Backend `.env`

| Variable | Default | Description |
|----------|---------|-------------|
| `TEMP_DIR` | `/tmp/localclips` | Where uploads and clips are stored |
| `MAX_VIDEO_UPLOAD_BYTES` | `12000000000` | Max upload size (12 GB) |

### Frontend `.env`

| Variable | Default | Description |
|----------|---------|-------------|
| `NEXT_PUBLIC_API_URL` | `http://localhost:8001` | Backend URL |

---

## Caption styles

| Style | Description |
|-------|-------------|
| Default | Bold word-by-word karaoke, white on dark |
| Hormozi | Green highlight pill (Alex Hormozi style) |
| MrBeast | Large yellow text with red pop |
| Minimal | Clean subtle fade captions |
| TikTok | TikTok-style pink word highlights |
| Neon | Glowing cyan neon text |
| Podcast | Professional podcast lower-thirds |

---

## Output formats

| Format | Description |
|--------|-------------|
| Vertical 9:16 | Face-tracked crop, 1080×1920 (default) |
| Vertical pan | Smooth pan following face movement |
| Vertical split | Split-screen for content with slides/graphs |
| Original | No reframe, original aspect ratio |

---

## Tech stack

**Backend** — FastAPI · Python 3.11 · asyncio · aiofiles · sse-starlette  
**Frontend** — Next.js 15 · React 19 · TypeScript · Tailwind CSS 4 · Radix UI  
**Rendering** — ffmpeg · OpenCV · MediaPipe · libass

---

## License

MIT
