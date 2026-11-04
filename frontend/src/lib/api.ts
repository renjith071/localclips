/**
 * Thin API client that talks to the LocalClips FastAPI backend.
 */

const BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8001";

export interface ClipInfo {
  id: string;
  filename: string;
  video_url: string;
  start_time: string;
  end_time: string;
  duration: number;
  text: string;
  relevance_score: number;
  reasoning: string;
  clip_order: number;
  virality_score: number;
  hook_score: number;
  engagement_score: number;
  value_score: number;
  shareability_score: number;
  hook_type: string | null;
  hook_title: string | null;
}

export interface JobStatus {
  id: string;
  status: "pending" | "processing" | "completed" | "error";
  progress: number;
  message: string;
  clips: ClipInfo[];
  error: string | null;
}

export interface CreateJobOptions {
  video: File;
  srt: File;
  aiJson: File;
  fontFamily?: string | null;
  fontSize?: number | null;
  fontColor?: string | null;
  captionTemplate?: string;
  outputFormat?: string;
  addSubtitles?: boolean;
  cutLongPauses?: boolean;
  pauseThresholdMs?: number;
  removeFillerWords?: boolean;
  filteredWords?: string;
  onUploadProgress?: (pct: number) => void;
}

export async function createJob(opts: CreateJobOptions): Promise<{ job_id: string }> {
  const form = new FormData();
  form.append("video", opts.video);
  form.append("srt", opts.srt);
  form.append("ai_json", opts.aiJson);
  if (opts.fontFamily) form.append("font_family", opts.fontFamily);
  if (opts.fontSize != null) form.append("font_size", String(opts.fontSize));
  if (opts.fontColor) form.append("font_color", opts.fontColor);
  form.append("caption_template", opts.captionTemplate ?? "default");
  form.append("output_format", opts.outputFormat ?? "vertical");
  form.append("add_subtitles", String(opts.addSubtitles ?? true));
  form.append("cut_long_pauses", String(opts.cutLongPauses ?? false));
  form.append("pause_threshold_ms", String(opts.pauseThresholdMs ?? 900));
  form.append("remove_filler_words", String(opts.removeFillerWords ?? false));
  form.append("filtered_words", opts.filteredWords ?? "");

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${BASE}/jobs`);

    // Upload progress
    if (opts.onUploadProgress) {
      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable) {
          opts.onUploadProgress!(Math.round((e.loaded / e.total) * 100));
        }
      });
    }

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch {
          reject(new Error("Invalid response from server"));
        }
      } else {
        let detail = `Server error ${xhr.status}`;
        try {
          const body = JSON.parse(xhr.responseText);
          detail = body.detail ?? detail;
        } catch { /* ignore */ }
        reject(new Error(detail));
      }
    });

    xhr.addEventListener("error", () =>
      reject(new Error("Network error – could not reach the backend. Is it running on port 8001?"))
    );
    xhr.addEventListener("timeout", () =>
      reject(new Error("Upload timed out. Try a smaller video file."))
    );
    xhr.addEventListener("abort", () =>
      reject(new Error("Upload was cancelled."))
    );

    // 2-hour timeout for large video uploads
    xhr.timeout = 2 * 60 * 60 * 1000;
    xhr.send(form);
  });
}

export async function getJob(jobId: string): Promise<JobStatus> {
  const res = await fetch(`${BASE}/jobs/${jobId}`, { cache: "no-store" });
  if (!res.ok) throw new Error("Job not found");
  const data: JobStatus = await res.json();

  // The backend returns relative video_url paths like "/clips/{job_id}/{filename}".
  // Rewrite them to absolute URLs pointing at the backend so the browser can
  // actually fetch the video (Next.js has no /clips/ route).
  if (data.clips) {
    data.clips = data.clips.map((clip) => ({
      ...clip,
      video_url: clip.video_url.startsWith("http")
        ? clip.video_url
        : `${BASE}${clip.video_url}`,
    }));
  }

  return data;
}

export function clipVideoUrl(jobId: string, filename: string): string {
  return `${BASE}/clips/${jobId}/${filename}`;
}

export interface FontOption {
  name: string;
  display_name: string;
  format: string;
}

export async function getFonts(): Promise<FontOption[]> {
  const res = await fetch(`${BASE}/fonts`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.fonts ?? [];
}

export interface CaptionTemplate {
  id: string;
  name: string;
  description: string;
  animation: string;
  font_family?: string | null;
  font_size?: number | null;
  font_color?: string | null;
}

export async function getCaptionTemplates(): Promise<CaptionTemplate[]> {
  const res = await fetch(`${BASE}/caption-templates`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.templates ?? [];
}

export interface PastJobSummary {
  id: string;
  status: string;
  clips_count: number;
  message: string;
}

export async function listJobs(): Promise<PastJobSummary[]> {
  const res = await fetch(`${BASE}/jobs`, { cache: "no-store" });
  if (!res.ok) return [];
  const data = await res.json();
  return data.jobs ?? [];
}

export function fontFileUrl(fontName: string): string {
  return `${BASE}/fonts/${fontName}`;
}
