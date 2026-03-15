"use client";

import { useState } from "react";

type ShareData = {
  weekLabel: string;
  weekRange: string;
  completionPct: number;
  title: string;
  executiveSummary: string;
  raceName: string | null;
  daysToRace: number | null;
  sportMinutes: {
    swim: number;
    bike: number;
    run: number;
  };
};

type Props = {
  data: ShareData;
};

const SPORT_COLORS: Record<string, string> = {
  swim: "#63b3ed",
  bike: "#34d399",
  run: "#ff5a28"
};

function drawSummaryCanvas(canvas: HTMLCanvasElement, data: ShareData, variant: "story" | "square") {
  const W = 1080;
  const H = variant === "story" ? 1920 : 1080;
  canvas.width = W;
  canvas.height = H;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // Background
  ctx.fillStyle = "#0a0a0b";
  ctx.fillRect(0, 0, W, H);

  // Subtle grid lines
  ctx.strokeStyle = "rgba(255,255,255,0.04)";
  ctx.lineWidth = 1;
  for (let y = 0; y < H; y += 120) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }

  const pad = 80;
  let y = variant === "story" ? 220 : 140;

  // Brand wordmark
  ctx.font = "bold 28px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  ctx.fillStyle = "#beff00";
  ctx.fillText("TRI.AI", pad, y);
  y += 60;

  // Week label
  ctx.font = "500 32px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  ctx.fillStyle = "rgba(255,255,255,0.45)";
  ctx.fillText(data.weekRange, pad, y);
  y += 80;

  // Headline
  const titleFontSize = variant === "story" ? 84 : 72;
  ctx.font = `bold ${titleFontSize}px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
  ctx.fillStyle = "#ffffff";

  // Word-wrap the title
  const maxWidth = W - pad * 2;
  const words = data.title.split(" ");
  let line = "";
  const titleLines: string[] = [];
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      titleLines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) titleLines.push(line);

  for (const tl of titleLines.slice(0, 3)) {
    ctx.fillText(tl, pad, y);
    y += titleFontSize * 1.2;
  }
  y += 40;

  // Completion percentage — big number
  ctx.font = `bold ${variant === "story" ? 180 : 150}px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
  ctx.fillStyle = "#beff00";
  ctx.fillText(`${data.completionPct}%`, pad, y);
  y += variant === "story" ? 60 : 40;

  ctx.font = "500 36px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  ctx.fillStyle = "rgba(255,255,255,0.4)";
  ctx.fillText("weekly completion", pad, y);
  y += 100;

  // Sport bar chart
  const total = data.sportMinutes.swim + data.sportMinutes.bike + data.sportMinutes.run;
  if (total > 0) {
    const barH = 20;
    const barW = W - pad * 2;
    let x = pad;

    for (const [sport, color] of Object.entries(SPORT_COLORS)) {
      const mins = data.sportMinutes[sport as keyof typeof data.sportMinutes] ?? 0;
      const segW = Math.round((mins / total) * barW);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(x, y, segW - 4, barH, 4);
      ctx.fill();
      x += segW;
    }
    y += barH + 40;

    // Sport labels
    ctx.font = "500 28px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    let lx = pad;
    for (const [sport, color] of Object.entries(SPORT_COLORS)) {
      const mins = data.sportMinutes[sport as keyof typeof data.sportMinutes] ?? 0;
      if (mins === 0) continue;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(lx + 10, y + 2, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.fillText(`${sport} ${mins}min`, lx + 26, y + 10);
      lx += Math.max(200, ctx.measureText(`${sport} ${mins}min`).width + 50);
    }
    y += 80;
  }

  // Executive summary (truncated)
  if (data.executiveSummary) {
    ctx.font = "400 34px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    const summaryWords = data.executiveSummary.split(" ");
    let sl = "";
    const summaryLines: string[] = [];
    for (const word of summaryWords) {
      const test = sl ? `${sl} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && sl) {
        summaryLines.push(sl);
        sl = word;
        if (summaryLines.length >= 3) break;
      } else {
        sl = test;
      }
    }
    if (sl && summaryLines.length < 3) summaryLines.push(sl);

    for (const sl2 of summaryLines) {
      ctx.fillText(sl2, pad, y);
      y += 48;
    }
    y += 40;
  }

  // Race countdown
  if (data.raceName && data.daysToRace !== null) {
    y = variant === "story" ? H - 240 : H - 200;
    ctx.font = "bold 36px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    ctx.fillStyle = "#beff00";
    ctx.fillText(`${data.daysToRace} days to ${data.raceName}`, pad, y);
  }
}

export function ShareSummaryButton({ data }: Props) {
  const [generating, setGenerating] = useState(false);

  async function handleShare(variant: "story" | "square") {
    setGenerating(true);
    try {
      const canvas = document.createElement("canvas");
      drawSummaryCanvas(canvas, data, variant);

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) return;

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `tri-ai-week-${variant}.png`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => void handleShare("story")}
        disabled={generating}
        className="rounded-lg border border-[rgba(190,255,0,0.25)] bg-[rgba(190,255,0,0.08)] px-3 py-1.5 text-xs font-medium text-[var(--color-accent)] hover:bg-[rgba(190,255,0,0.14)] disabled:opacity-40"
      >
        {generating ? "Generating…" : "Share (story)"}
      </button>
      <button
        type="button"
        onClick={() => void handleShare("square")}
        disabled={generating}
        className="rounded-lg border border-[hsl(var(--border))] px-3 py-1.5 text-xs font-medium text-muted hover:text-[hsl(var(--text-primary))] disabled:opacity-40"
      >
        Square
      </button>
    </div>
  );
}
