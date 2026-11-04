"use client";

import { useRef, useState, DragEvent, ChangeEvent } from "react";
import { cn } from "@/lib/utils";
import { Upload, File as FileIcon, X } from "lucide-react";

interface FileDropZoneProps {
  label: string;
  accept: string;
  file: File | null;
  onFile: (file: File | null) => void;
  hint?: string;
  className?: string;
}

export function FileDropZone({
  label,
  accept,
  file,
  onFile,
  hint,
  className,
}: FileDropZoneProps) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) onFile(dropped);
  };

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0] ?? null;
    onFile(picked);
    // Reset so re-selecting same file triggers onChange
    e.target.value = "";
  };

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label className="text-sm font-medium text-white/80">{label}</label>

      <div
        className={cn(
          "relative flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-5 transition-colors cursor-pointer",
          dragging
            ? "border-violet-500 bg-violet-500/10"
            : file
            ? "border-violet-500/50 bg-violet-500/5"
            : "border-white/20 bg-white/5 hover:border-white/40 hover:bg-white/8"
        )}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") inputRef.current?.click(); }}
        aria-label={`Upload ${label}`}
      >
        {file ? (
          <>
            <FileIcon className="h-6 w-6 text-violet-400" aria-hidden />
            <span className="max-w-full truncate text-sm text-white/90 px-4 text-center">
              {file.name}
            </span>
            <span className="text-xs text-white/40">
              {(file.size / 1024 / 1024).toFixed(1)} MB
            </span>
            <button
              type="button"
              className="absolute top-2 right-2 rounded-full p-0.5 text-white/40 hover:text-red-400 transition-colors"
              onClick={(e) => { e.stopPropagation(); onFile(null); }}
              aria-label="Remove file"
            >
              <X className="h-4 w-4" />
            </button>
          </>
        ) : (
          <>
            <Upload className="h-6 w-6 text-white/40" aria-hidden />
            <span className="text-sm text-white/50">
              Drop file here or <span className="text-violet-400 underline">browse</span>
            </span>
          </>
        )}
      </div>

      {hint && <p className="text-xs text-white/30">{hint}</p>}

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="sr-only"
        onChange={handleChange}
        aria-hidden
      />
    </div>
  );
}
