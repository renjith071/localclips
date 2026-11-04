import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export async function downloadFile(url: string, filename: string): Promise<void> {
  try {
    // Fetch the file as a blob so it always downloads (works cross-origin too)
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Give the browser a moment before revoking
    setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
  } catch (err) {
    console.error("Download failed:", err);
    // Fallback: open in new tab so the user can save manually
    window.open(url, "_blank");
  }
}
