"use client";

import { useState } from "react";
import type { ClipInfo } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn, formatDuration, downloadFile } from "@/lib/utils";
import {
  Download,
  Play,
  Pause,
  TrendingUp,
  Clock,
  Sparkles,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

interface ClipCardProps {
  clip: ClipInfo;
  index: number;
}

export function ClipCard({ clip, index }: ClipCardProps) {
  const [playing, setPlaying] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const videoRef = (el: HTMLVideoElement | null) => {
    if (!el) return;
    // Store ref for play/pause
    (window as unknown as Record<string, HTMLVideoElement>)[`clip_${clip.id}`] = el;
  };

  const togglePlay = () => {
    const vid = (window as unknown as Record<string, HTMLVideoElement>)[`clip_${clip.id}`];
    if (!vid) return;
    if (playing) {
      vid.pause();
      setPlaying(false);
    } else {
      vid.play();
      setPlaying(true);
    }
  };

  const hookTypeBadge = () => {
    if (!clip.hook_type || clip.hook_type === "none") return null;
    return (
      <Badge variant="secondary" className="capitalize">
        {clip.hook_type}
      </Badge>
    );
  };

  const viralityColor = () => {
    const s = clip.virality_score;
    if (s >= 80) return "text-green-400";
    if (s >= 60) return "text-yellow-400";
    return "text-orange-400";
  };

  return (
    <article className="rounded-2xl border border-white/10 bg-white/5 overflow-hidden flex flex-col">
      {/* Video */}
      <div className="relative bg-black aspect-[9/16] max-h-72 overflow-hidden flex items-center justify-center">
        <video
          ref={videoRef}
          src={clip.video_url}
          className="h-full w-full object-contain"
          onEnded={() => setPlaying(false)}
          playsInline
          preload="metadata"
        />
        <button
          type="button"
          className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 hover:opacity-100 transition-opacity"
          onClick={togglePlay}
          aria-label={playing ? "Pause" : "Play"}
        >
          <span className="rounded-full bg-white/20 p-3 backdrop-blur-sm">
            {playing ? (
              <Pause className="h-6 w-6 text-white" />
            ) : (
              <Play className="h-6 w-6 text-white" />
            )}
          </span>
        </button>
        <span className="absolute top-2 left-2 rounded-full bg-black/60 px-2 py-0.5 text-xs font-bold text-white">
          #{index + 1}
        </span>
      </div>

      {/* Info */}
      <div className="flex flex-col gap-3 p-4">
        {/* Hook title */}
        {clip.hook_title && (
          <p className="text-sm font-semibold text-white leading-snug">
            {clip.hook_title}
          </p>
        )}

        {/* Meta row */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1 text-xs text-white/50">
            <Clock className="h-3 w-3" />
            {formatDuration(clip.duration)}
          </span>
          <span className="text-white/20">·</span>
          <span className="text-xs text-white/50">
            {clip.start_time} → {clip.end_time}
          </span>
          <span className="text-white/20">·</span>
          <span className={cn("flex items-center gap-1 text-xs font-semibold", viralityColor())}>
            <TrendingUp className="h-3 w-3" />
            {clip.virality_score}/100
          </span>
          {hookTypeBadge()}
        </div>

        {/* Score breakdown */}
        <div className="grid grid-cols-4 gap-1 text-center">
          {[
            { label: "Hook", value: clip.hook_score, max: 25 },
            { label: "Engage", value: clip.engagement_score, max: 25 },
            { label: "Value", value: clip.value_score, max: 25 },
            { label: "Share", value: clip.shareability_score, max: 25 },
          ].map(({ label, value, max }) => (
            <div key={label} className="rounded-lg bg-white/5 px-1 py-1.5">
              <div className="text-xs font-bold text-white">
                {value}/{max}
              </div>
              <div className="text-[10px] text-white/40">{label}</div>
            </div>
          ))}
        </div>

        {/* Collapsible details */}
        <button
          type="button"
          className="flex items-center gap-1 text-xs text-white/40 hover:text-white/70 transition-colors"
          onClick={() => setShowDetails((v) => !v)}
          aria-expanded={showDetails}
        >
          <Sparkles className="h-3 w-3" />
          {showDetails ? "Hide" : "Show"} reasoning
          {showDetails ? (
            <ChevronUp className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )}
        </button>

        {showDetails && (
          <div className="rounded-lg bg-white/5 p-3 text-xs text-white/60 leading-relaxed">
            {clip.reasoning || "No reasoning provided."}
            {clip.text && (
              <p className="mt-2 border-t border-white/10 pt-2 italic">
                &ldquo;{clip.text.slice(0, 200)}
                {clip.text.length > 200 ? "…" : ""}&rdquo;
              </p>
            )}
          </div>
        )}

        {/* Download */}
        <Button
          variant="outline"
          size="sm"
          className="w-full mt-1"
          onClick={() => {
            // Use the hook title as the download filename, falling back to the raw filename
            const safeTitle = clip.hook_title
              ? clip.hook_title
                  .replace(/[^\w\s-]/g, "")   // strip special chars
                  .trim()
                  .replace(/\s+/g, "_")         // spaces → underscores
                  .slice(0, 80)                  // cap length
              : null;
            const downloadName = safeTitle
              ? `${safeTitle}.mp4`
              : clip.filename;
            void downloadFile(clip.video_url, downloadName);
          }}
        >
          <Download className="h-4 w-4" />
          Download clip
        </Button>
      </div>
    </article>
  );
}
