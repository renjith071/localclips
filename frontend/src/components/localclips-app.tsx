"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  createJob,
  getJob,
  listJobs,
  type ClipInfo,
  type FontOption,
  type CaptionTemplate,
  type PastJobSummary,
  getFonts,
  getCaptionTemplates,
  fontFileUrl,
} from "@/lib/api";
import { FileDropZone } from "@/components/file-drop-zone";
import { ClipCard } from "@/components/clip-card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { cn, downloadFile } from "@/lib/utils";
import {
  Settings,
  Wand2,
  Download,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  Info,
  AlertCircle,
  Upload,
  History,
} from "lucide-react";

type OutputFormat = "vertical" | "vertical_pan" | "vertical_split" | "original";

type Phase =
  | { kind: "idle" }
  | { kind: "uploading"; pct: number }
  | { kind: "processing"; progress: number; message: string }
  | { kind: "completed"; clips: ClipInfo[] }
  | { kind: "error"; message: string; detail?: string };

export function LocalClipsApp() {
  // ── Files ────────────────────────────────────────────────────────────────
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [srtFile, setSrtFile] = useState<File | null>(null);
  const [aiJsonFile, setAiJsonFile] = useState<File | null>(null);

  // ── Options ──────────────────────────────────────────────────────────────
  const [showOptions, setShowOptions] = useState(false);
  const [fontFamily, setFontFamily] = useState<string | null>(null);
  const [fontSize, setFontSize] = useState<number | null>(null);
  const [fontColor, setFontColor] = useState<string | null>(null);
  const [captionTemplate, setCaptionTemplate] = useState("default");
  const [outputFormat, setOutputFormat] = useState<OutputFormat>("vertical");
  const [addSubtitles, setAddSubtitles] = useState(true);
  const [cutLongPauses, setCutLongPauses] = useState(false);
  const [pauseThresholdMs, setPauseThresholdMs] = useState("900");
  const [removeFillerWords, setRemoveFillerWords] = useState(false);
  const [filteredWords, setFilteredWords] = useState("");
  const [fontSearch, setFontSearch] = useState("");

  // ── Font + template data ──────────────────────────────────────────────────
  const [availableFonts, setAvailableFonts] = useState<FontOption[]>([]);
  const [availableTemplates, setAvailableTemplates] = useState<CaptionTemplate[]>([]);

  // ── Phase / status ────────────────────────────────────────────────────────
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [jobId, setJobId] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Log lines (visible in the UI) ─────────────────────────────────────────
  const [logs, setLogs] = useState<string[]>([]);
  const addLog = useCallback((msg: string) => {
    const ts = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev.slice(-99), `[${ts}] ${msg}`]);
  }, []);

  // ── Past jobs (persisted on server, survives reloads) ─────────────────────
  const [pastJobs, setPastJobs] = useState<PastJobSummary[]>([]);

  // ── Load fonts & templates ────────────────────────────────────────────────
  useEffect(() => {
    getFonts()
      .then((fonts) => {
        setAvailableFonts(fonts);
        const faceRules = fonts
          .map((f) => {
            const fmt = f.format === "otf" ? "opentype" : "truetype";
            return `@font-face { font-family: '${f.name}'; src: url('${fontFileUrl(f.name)}') format('${fmt}'); }`;
          })
          .join("\n");
        const existing = document.getElementById("lc-custom-fonts");
        if (existing) existing.remove();
        const style = document.createElement("style");
        style.id = "lc-custom-fonts";
        style.textContent = faceRules;
        document.head.appendChild(style);
      })
      .catch((e) => addLog(`Warning: could not load fonts – ${e}`));

    getCaptionTemplates()
      .then(setAvailableTemplates)
      .catch((e) => addLog(`Warning: could not load caption templates – ${e}`));

    // Load past completed jobs
    listJobs()
      .then((jobs) => setPastJobs(jobs.filter((j) => j.status === "completed" && j.clips_count > 0)))
      .catch(() => {});
  }, [addLog]);

  // ── Poll job status ────────────────────────────────────────────────────────
  const startPolling = useCallback(
    (id: string) => {
      const poll = async () => {
        try {
          const job = await getJob(id);
          addLog(`Poll → status=${job.status} progress=${job.progress}% – ${job.message}`);

          if (job.status === "completed") {
            setPhase({ kind: "completed", clips: job.clips });
            toast.success(`Done! ${job.clips.length} clips ready.`);
            return;
          }

          if (job.status === "error") {
            const msg = job.error ?? "Processing failed";
            setPhase({ kind: "error", message: "Rendering failed", detail: msg });
            toast.error(msg);
            return;
          }

          setPhase({
            kind: "processing",
            progress: job.progress,
            message: job.message,
          });
          pollRef.current = setTimeout(poll, 1500);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          addLog(`Poll error: ${msg} – retrying in 3 s`);
          pollRef.current = setTimeout(poll, 3000);
        }
      };
      poll();
    },
    [addLog]
  );

  useEffect(() => {
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, []);

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!videoFile || !srtFile || !aiJsonFile) {
      toast.error("Please upload all three files: video, SRT, and AI JSON.");
      return;
    }

    setLogs([]);
    setPhase({ kind: "uploading", pct: 0 });
    addLog(`Starting upload: ${videoFile.name} (${(videoFile.size / 1024 / 1024).toFixed(1)} MB) + SRT + JSON`);

    try {
      const { job_id } = await createJob({
        video: videoFile,
        srt: srtFile,
        aiJson: aiJsonFile,
        fontFamily,
        fontSize,
        fontColor,
        captionTemplate,
        outputFormat,
        addSubtitles,
        cutLongPauses,
        pauseThresholdMs: parseInt(pauseThresholdMs) || 900,
        removeFillerWords,
        filteredWords,
        onUploadProgress: (pct) => {
          setPhase({ kind: "uploading", pct });
          if (pct % 10 === 0) addLog(`Upload progress: ${pct}%`);
        },
      });

      addLog(`Upload complete → job_id=${job_id}`);
      setJobId(job_id);
      setPhase({ kind: "processing", progress: 0, message: "Starting…" });
      startPolling(job_id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addLog(`ERROR: ${msg}`);
      setPhase({ kind: "error", message: "Upload failed", detail: msg });
      toast.error(msg);
    }
  };

  const handleReset = () => {
    if (pollRef.current) clearTimeout(pollRef.current);
    setPhase({ kind: "idle" });
    setJobId(null);
    setLogs([]);
    setVideoFile(null);
    setSrtFile(null);
    setAiJsonFile(null);
    // Refresh past jobs list
    listJobs()
      .then((jobs) => setPastJobs(jobs.filter((j) => j.status === "completed" && j.clips_count > 0)))
      .catch(() => {});
  };

  const loadPastJob = async (id: string) => {
    try {
      const job = await getJob(id);
      if (job.status === "completed") {
        setPhase({ kind: "completed", clips: job.clips });
        setJobId(id);
      }
    } catch {
      addLog(`Could not load job ${id}`);
    }
  };

  const downloadAll = (clips: ClipInfo[]) => {
    clips.forEach((c) => {
      const safeTitle = c.hook_title
        ? c.hook_title
            .replace(/[^\w\s-]/g, "")
            .trim()
            .replace(/\s+/g, "_")
            .slice(0, 80)
        : null;
      const downloadName = safeTitle ? `${safeTitle}.mp4` : c.filename;
      void downloadFile(c.video_url, downloadName);
    });
  };

  const filteredFonts = availableFonts.filter((f) => {
    const q = fontSearch.toLowerCase();
    return !q || f.display_name.toLowerCase().includes(q) || f.name.toLowerCase().includes(q);
  });

  const selectedTemplate = availableTemplates.find((t) => t.id === captionTemplate);
  const previewFontFamily = fontFamily ?? selectedTemplate?.font_family ?? "sans-serif";
  const isActive = phase.kind !== "idle";

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      {/* Header */}
      <header className="border-b border-white/10 bg-black/40 backdrop-blur-sm sticky top-0 z-20">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-600 text-base font-black">
              LC
            </span>
            <span className="font-semibold text-white">LocalClips</span>
            <Badge variant="secondary">No API credits</Badge>
          </div>
          <p className="hidden sm:block text-xs text-white/40">
            Upload video + SRT + AI JSON → get clips
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8 flex flex-col gap-6">

        {/* ── Upload form ──────────────────────────────────────────────────── */}
        {!isActive && (
          <>
          <section className="rounded-2xl border border-white/10 bg-white/5 p-6 flex flex-col gap-5">
            <h1 className="text-xl font-bold text-white flex items-center gap-2">
              <Wand2 className="h-5 w-5 text-violet-400" aria-hidden />
              Generate clips from local files
            </h1>

            <div className="rounded-xl bg-violet-900/20 border border-violet-500/20 p-4 flex gap-3 text-sm text-violet-200">
              <Info className="h-5 w-5 shrink-0 mt-0.5 text-violet-400" aria-hidden />
              <ol className="list-decimal list-inside space-y-0.5 text-violet-200/80">
                <li>Upload your video file (mp4, mov, webm…)</li>
                <li>Upload the SRT subtitle file for that video</li>
                <li>Upload the AI output JSON (TranscriptAnalysis format)</li>
                <li>Clips are rendered locally – no API calls, no credits burned</li>
              </ol>
            </div>

            {/* File uploads */}
            <div className="grid gap-4 sm:grid-cols-3">
              <FileDropZone
                label="Video file"
                accept="video/*,.mp4,.mov,.webm,.mkv,.avi"
                file={videoFile}
                onFile={setVideoFile}
                hint="Any common video format"
              />
              <FileDropZone
                label="SRT subtitle file"
                accept=".srt"
                file={srtFile}
                onFile={setSrtFile}
                hint="Standard SRT format"
              />
              <FileDropZone
                label="AI output JSON"
                accept=".json,application/json"
                file={aiJsonFile}
                onFile={setAiJsonFile}
                hint="TranscriptAnalysis JSON from your local AI"
              />
            </div>

            {/* AI JSON format reference */}
            <details className="rounded-xl border border-white/10 bg-white/5">
              <summary className="cursor-pointer select-none px-4 py-3 text-sm text-white/60 hover:text-white/90 transition-colors">
                AI JSON format reference
              </summary>
              <pre className="overflow-x-auto p-4 text-xs text-white/70 leading-relaxed">
{`{
  "most_relevant_segments": [
    {
      "start_time": "01:23",
      "end_time":   "02:45",
      "text":       "verbatim transcript text",
      "relevance_score": 0.92,
      "reasoning": "Why this is a good clip",
      "hook_title": "Short punchy title",
      "virality": {
        "hook_score": 22, "engagement_score": 20,
        "value_score": 18, "shareability_score": 17,
        "total_score": 77, "hook_type": "question"
      }
    }
  ],
  "summary": "...", "key_topics": ["topic1"]
}`}
              </pre>
            </details>

            {/* Rendering options */}
            <div>
              <button
                type="button"
                className="flex items-center gap-2 text-sm text-white/50 hover:text-white/80 transition-colors"
                onClick={() => setShowOptions((v) => !v)}
                aria-expanded={showOptions}
              >
                <Settings className="h-4 w-4" />
                Rendering options
                {showOptions ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>

              {showOptions && (
                <div className="mt-4 grid gap-5 rounded-xl border border-white/10 bg-white/5 p-5 sm:grid-cols-2">
                  {/* Output format */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-white/60 uppercase tracking-wide">Output format</label>
                    <select
                      className="rounded-lg border border-white/20 bg-black/40 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-violet-500"
                      value={outputFormat}
                      onChange={(e) => setOutputFormat(e.target.value as OutputFormat)}
                    >
                      <option value="vertical">Vertical 9:16 (face crop)</option>
                      <option value="vertical_pan">Vertical pan</option>
                      <option value="vertical_split">Vertical split</option>
                      <option value="original">Original (no reframe)</option>
                    </select>
                  </div>

                  {/* Caption template */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-white/60 uppercase tracking-wide">Caption style</label>
                    <select
                      className="rounded-lg border border-white/20 bg-black/40 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-violet-500"
                      value={captionTemplate}
                      onChange={(e) => setCaptionTemplate(e.target.value)}
                    >
                      {availableTemplates.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                  </div>

                  {/* Burn subtitles toggle */}
                  <div className="flex items-center justify-between">
                    <label className="text-sm text-white/70">Burn subtitles</label>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={addSubtitles}
                      className={cn(
                        "relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-violet-500",
                        addSubtitles ? "bg-violet-600" : "bg-white/20"
                      )}
                      onClick={() => setAddSubtitles((v) => !v)}
                    >
                      <span className={cn("inline-block h-4 w-4 rounded-full bg-white transition-transform", addSubtitles ? "translate-x-6" : "translate-x-1")} />
                    </button>
                  </div>

                  {/* Font family */}
                  <div className="flex flex-col gap-1.5 sm:col-span-2">
                    <label className="text-xs font-medium text-white/60 uppercase tracking-wide">Font</label>
                    <input
                      type="text"
                      placeholder="Search fonts…"
                      className="rounded-lg border border-white/20 bg-black/40 px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-violet-500"
                      value={fontSearch}
                      onChange={(e) => setFontSearch(e.target.value)}
                    />
                    <div className="max-h-32 overflow-y-auto rounded-lg border border-white/10 bg-black/30">
                      <button type="button" className={cn("w-full px-3 py-2 text-left text-sm hover:bg-white/10 transition-colors", fontFamily === null ? "text-violet-300 font-medium" : "text-white/60")} onClick={() => setFontFamily(null)}>Template default</button>
                      {filteredFonts.map((f) => (
                        <button key={f.name} type="button" className={cn("w-full px-3 py-2 text-left text-sm hover:bg-white/10 transition-colors", fontFamily === f.name ? "text-violet-300 font-medium" : "text-white/60")} style={{ fontFamily: f.name }} onClick={() => setFontFamily(f.name)}>{f.display_name}</button>
                      ))}
                    </div>
                    {fontFamily && (
                      <p className="text-base text-white/70 px-1" style={{ fontFamily: previewFontFamily }}>
                        Preview: The quick brown fox
                      </p>
                    )}
                  </div>

                  {/* Font size */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-white/60 uppercase tracking-wide">Font size</label>
                    <div className="flex gap-2 items-center">
                      <input type="number" min={10} max={60} placeholder="24"
                        className="w-20 rounded-lg border border-white/20 bg-black/40 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-violet-500"
                        value={fontSize ?? ""}
                        onChange={(e) => setFontSize(e.target.value ? parseInt(e.target.value) : null)}
                      />
                      <span className="text-xs text-white/30">px (blank = template default)</span>
                    </div>
                  </div>

                  {/* Font color */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-white/60 uppercase tracking-wide">Font color</label>
                    <div className="flex gap-2 items-center">
                      <input type="color" className="h-9 w-12 cursor-pointer rounded-lg border border-white/20 bg-transparent p-1"
                        value={fontColor ?? "#ffffff"}
                        onChange={(e) => setFontColor(e.target.value)}
                      />
                      <button type="button" className="text-xs text-white/30 hover:text-white/60 transition-colors" onClick={() => setFontColor(null)}>Reset to template</button>
                    </div>
                  </div>

                  {/* Cut long pauses */}
                  <div className="flex items-center justify-between sm:col-span-2">
                    <div>
                      <label className="text-sm text-white/70">Cut long pauses</label>
                      <p className="text-xs text-white/30">Remove silence longer than threshold</p>
                    </div>
                    <button type="button" role="switch" aria-checked={cutLongPauses}
                      className={cn("relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-violet-500", cutLongPauses ? "bg-violet-600" : "bg-white/20")}
                      onClick={() => setCutLongPauses((v) => !v)}
                    >
                      <span className={cn("inline-block h-4 w-4 rounded-full bg-white transition-transform", cutLongPauses ? "translate-x-6" : "translate-x-1")} />
                    </button>
                  </div>

                  {cutLongPauses && (
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-medium text-white/60 uppercase tracking-wide">Pause threshold (ms)</label>
                      <input type="number" min={100} max={3000}
                        className="w-28 rounded-lg border border-white/20 bg-black/40 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-violet-500"
                        value={pauseThresholdMs}
                        onChange={(e) => setPauseThresholdMs(e.target.value)}
                      />
                    </div>
                  )}

                  {/* Remove filler words */}
                  <div className="flex flex-col gap-2 sm:col-span-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <label className="text-sm text-white/70">Remove filler words</label>
                        <p className="text-xs text-white/30">Cut ums, uhs, and custom words</p>
                      </div>
                      <button type="button" role="switch" aria-checked={removeFillerWords}
                        className={cn("relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-violet-500", removeFillerWords ? "bg-violet-600" : "bg-white/20")}
                        onClick={() => setRemoveFillerWords((v) => !v)}
                      >
                        <span className={cn("inline-block h-4 w-4 rounded-full bg-white transition-transform", removeFillerWords ? "translate-x-6" : "translate-x-1")} />
                      </button>
                    </div>
                    {removeFillerWords && (
                      <input type="text" placeholder="um, uh, like, you know (comma-separated)"
                        className="rounded-lg border border-white/20 bg-black/40 px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-violet-500"
                        value={filteredWords}
                        onChange={(e) => setFilteredWords(e.target.value)}
                      />
                    )}
                  </div>
                </div>
              )}
            </div>

            <Button size="lg" className="w-full" onClick={handleSubmit} disabled={!videoFile || !srtFile || !aiJsonFile}>
              <Wand2 className="h-5 w-5" />
              Generate clips
            </Button>
          </section>

          {/* ── Past jobs (persisted across reloads) ───────────────── */}
          {pastJobs.length > 0 && (
            <section className="rounded-2xl border border-white/10 bg-white/5 p-5 flex flex-col gap-3">
              <h2 className="text-sm font-semibold text-white/60 flex items-center gap-2">
                <History className="h-4 w-4" />
                Previous renders ({pastJobs.length})
              </h2>
              <div className="flex flex-col gap-2">
                {pastJobs.map((j) => (
                  <button
                    key={j.id}
                    type="button"
                    className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3 hover:bg-white/10 transition-colors text-left"
                    onClick={() => void loadPastJob(j.id)}
                  >
                    <div>
                      <p className="text-sm text-white/80 font-mono">{j.id.slice(0, 8)}…</p>
                      <p className="text-xs text-white/40">{j.clips_count} clip{j.clips_count !== 1 ? "s" : ""} · click to reload</p>
                    </div>
                    <Badge variant="success">{j.clips_count} clips</Badge>
                  </button>
                ))}
              </div>
            </section>
          )}
          </>
        )}

        {/* ── Active state: uploading / processing / error / done ─────────── */}
        {isActive && (
          <section className="rounded-2xl border border-white/10 bg-white/5 p-6 flex flex-col gap-4">
            {/* Title row */}
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold text-white">
                  {phase.kind === "uploading"   && "Uploading files…"}
                  {phase.kind === "processing"  && "Generating clips…"}
                  {phase.kind === "completed"   && "Clips ready"}
                  {phase.kind === "error"       && "Something went wrong"}
                </h2>
                <Badge
                  variant={
                    phase.kind === "completed" ? "success" :
                    phase.kind === "error"     ? "error"   :
                    "default"
                  }
                >
                  {phase.kind === "uploading"  && `${phase.pct}%`}
                  {phase.kind === "processing" && `${phase.progress}%`}
                  {phase.kind === "completed"  && `${phase.clips.length} clips`}
                  {phase.kind === "error"      && "Failed"}
                </Badge>
              </div>

              <div className="flex gap-2">
                {phase.kind === "completed" && phase.clips.length > 0 && (
                  <Button variant="outline" size="sm" onClick={() => downloadAll(phase.clips)}>
                    <Download className="h-4 w-4" /> Download all
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={handleReset}>
                  <RotateCcw className="h-4 w-4" /> Start over
                </Button>
              </div>
            </div>

            {/* Upload progress bar */}
            {phase.kind === "uploading" && (
              <>
                <div className="flex items-center gap-3">
                  <Upload className="h-4 w-4 text-violet-400 shrink-0" />
                  <div className="flex-1">
                    <Progress value={phase.pct} />
                  </div>
                  <span className="text-sm font-mono text-white/60 w-10 text-right">{phase.pct}%</span>
                </div>
                <p className="text-xs text-white/40">
                  Uploading {videoFile?.name} ({videoFile ? (videoFile.size / 1024 / 1024).toFixed(1) : "?"}  MB) — this may take a few minutes for large files
                </p>
              </>
            )}

            {/* Processing progress bar */}
            {phase.kind === "processing" && (
              <>
                <Progress value={phase.progress} />
                <p className="text-sm text-white/50">{phase.message}</p>
                {jobId && (
                  <p className="text-xs text-white/30 font-mono">Job ID: {jobId}</p>
                )}
              </>
            )}

            {/* Error panel */}
            {phase.kind === "error" && (
              <div className="rounded-xl bg-red-900/20 border border-red-500/30 p-4 flex flex-col gap-2">
                <div className="flex items-center gap-2 text-red-300 font-medium">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {phase.message}
                </div>
                {phase.detail && (
                  <pre className="text-xs text-red-300/80 whitespace-pre-wrap break-words mt-1">
                    {phase.detail}
                  </pre>
                )}
              </div>
            )}

            {/* Activity log — always visible while active */}
            {logs.length > 0 && (
              <details open={phase.kind === "error"} className="rounded-xl border border-white/10">
                <summary className="cursor-pointer select-none px-4 py-2 text-xs text-white/40 hover:text-white/70 transition-colors">
                  Activity log ({logs.length} entries)
                </summary>
                <div className="max-h-48 overflow-y-auto p-3 flex flex-col gap-0.5">
                  {logs.map((line, i) => (
                    <p key={i} className={cn("font-mono text-xs", line.includes("ERROR") ? "text-red-400" : "text-white/40")}>
                      {line}
                    </p>
                  ))}
                </div>
              </details>
            )}
          </section>
        )}

        {/* ── Clips grid ───────────────────────────────────────────────────── */}
        {phase.kind === "completed" && phase.clips.length > 0 && (
          <section>
            <h2 className="mb-4 text-base font-semibold text-white/70">
              {phase.clips.length} clip{phase.clips.length !== 1 ? "s" : ""} generated
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {phase.clips
                .slice()
                .sort((a, b) => a.clip_order - b.clip_order)
                .map((clip, i) => (
                  <ClipCard key={clip.id} clip={clip} index={i} />
                ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
