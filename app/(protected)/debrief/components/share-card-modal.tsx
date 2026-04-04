"use client";

import { useState } from "react";
import { createPortal } from "react-dom";

type Format = "story" | "feed" | "square";
type Props = {
  weekOf: string;
  onClose: () => void;
};

const FORMAT_OPTIONS: Array<{ value: Format; label: string; dimensions: string; ratio: string }> = [
  { value: "story", label: "Story", dimensions: "1080 \u00D7 1920", ratio: "9:16" },
  { value: "feed", label: "Feed", dimensions: "1080 \u00D7 1350", ratio: "4:5" },
  { value: "square", label: "Square", dimensions: "1080 \u00D7 1080", ratio: "1:1" }
];

const ASPECT_RATIOS: Record<Format, string> = {
  story: "9/16",
  feed: "4/5",
  square: "1/1"
};

export function ShareCardModal({ weekOf, onClose }: Props) {
  const [selectedFormat, setSelectedFormat] = useState<Format>("story");
  const [showName, setShowName] = useState(true);
  const [generating, setGenerating] = useState(false);

  function getImageUrl(format: Format): string {
    return `/api/og/weekly-summary?weekOf=${weekOf}&format=${format}&showName=${showName}`;
  }

  async function handleDownload() {
    setGenerating(true);
    try {
      const url = getImageUrl(selectedFormat);
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to generate image");
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `tri-ai-week-${selectedFormat}.png`;
      a.click();
      URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.error("Share download failed:", err);
    } finally {
      setGenerating(false);
    }
  }

  async function handleShare() {
    setGenerating(true);
    try {
      const url = getImageUrl(selectedFormat);
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to generate image");
      const blob = await res.blob();
      const file = new File([blob], `tri-ai-week-${selectedFormat}.png`, { type: "image/png" });

      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: "My training week"
        });
      } else {
        // Fallback to download
        await handleDownload();
      }
    } catch (err) {
      if (err instanceof Error && err.name !== "AbortError") {
        console.error("Share failed:", err);
        await handleDownload();
      }
    } finally {
      setGenerating(false);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-md rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Share your week</h2>
          <button type="button" onClick={onClose} className="text-tertiary hover:text-white" aria-label="Close">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M15 5L5 15M5 5l10 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
          </button>
        </div>

        {/* Format selector */}
        <div className="mt-5 grid grid-cols-3 gap-2">
          {FORMAT_OPTIONS.map((opt) => {
            const isSelected = selectedFormat === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setSelectedFormat(opt.value)}
                className={`flex flex-col items-center gap-2 rounded-xl border p-3 transition-colors ${
                  isSelected
                    ? "border-[rgba(190,255,0,0.4)] bg-[rgba(190,255,0,0.08)]"
                    : "border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] hover:border-[rgba(255,255,255,0.2)]"
                }`}
              >
                <div
                  className="rounded border border-[rgba(255,255,255,0.15)] bg-[rgba(255,255,255,0.05)]"
                  style={{ aspectRatio: ASPECT_RATIOS[opt.value], width: opt.value === "story" ? "32px" : opt.value === "feed" ? "40px" : "48px" }}
                />
                <span className={`text-xs font-medium ${isSelected ? "text-[var(--color-accent)]" : "text-white"}`}>
                  {opt.label}
                </span>
                <span className="text-[10px] text-tertiary">{opt.ratio}</span>
              </button>
            );
          })}
        </div>

        {/* Name toggle */}
        <label className="mt-4 flex items-center gap-2 text-sm text-muted">
          <input
            type="checkbox"
            checked={showName}
            onChange={(e) => setShowName(e.target.checked)}
            className="rounded border-[hsl(var(--border))]"
          />
          Show athlete name
        </label>

        {/* Actions */}
        <div className="mt-6 flex gap-3">
          {typeof navigator !== "undefined" && "share" in navigator && (
            <button
              type="button"
              onClick={() => void handleShare()}
              disabled={generating}
              className="btn-primary flex-1 px-4 py-2.5 text-sm disabled:opacity-40"
            >
              {generating ? "Generating\u2026" : "Share"}
            </button>
          )}
          <button
            type="button"
            onClick={() => void handleDownload()}
            disabled={generating}
            className={`${typeof navigator !== "undefined" && "share" in navigator ? "btn-secondary" : "btn-primary"} flex-1 px-4 py-2.5 text-sm disabled:opacity-40`}
          >
            {generating ? "Generating\u2026" : "Download"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
