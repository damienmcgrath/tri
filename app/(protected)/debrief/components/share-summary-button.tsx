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

/** Resolve a CSS custom property to its computed value so canvas fillStyle works. */
function resolveCSSVar(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function getSportColors(): Record<string, string> {
  return {
    swim: resolveCSSVar("--color-swim", "#63b3ed"),
    bike: resolveCSSVar("--color-bike", "#34d399"),
    run: resolveCSSVar("--color-run", "#ff5a28")
  };
}

type CanvasFontWeight = 500 | 600 | 700;

function roundedRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, radius: number) {
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, w, h, radius);
    return;
  }

  const r = Math.min(radius, w / 2, h / 2);
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
}

function fillRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
  fillStyle: string | CanvasGradient
) {
  roundedRectPath(ctx, x, y, w, h, radius);
  ctx.fillStyle = fillStyle;
  ctx.fill();
}

function strokeRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
  strokeStyle: string | CanvasGradient,
  lineWidth = 1
) {
  roundedRectPath(ctx, x, y, w, h, radius);
  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";

  for (const word of words) {
    const testLine = line ? `${line} ${word}` : word;
    if (ctx.measureText(testLine).width > maxWidth && line) {
      lines.push(line);
      line = word;
      if (lines.length === maxLines) break;
    } else {
      line = testLine;
    }
  }

  if (line && lines.length < maxLines) {
    lines.push(line);
  }

  if (words.length > 0 && lines.length === maxLines) {
    const consumedWords = lines.join(" ").split(/\s+/).length;
    if (consumedWords < words.length) {
      const lastLine = lines[maxLines - 1] ?? "";
      let truncated = lastLine;
      while (truncated.length > 0 && ctx.measureText(`${truncated}…`).width > maxWidth) {
        truncated = truncated.slice(0, -1).trimEnd();
      }
      lines[maxLines - 1] = `${truncated}…`;
    }
  }

  return lines;
}

function setFont(ctx: CanvasRenderingContext2D, size: number, weight: CanvasFontWeight, family = "var(--font-geist-sans), sans-serif") {
  ctx.font = `${weight} ${size}px ${family}`;
}

function drawTextBlock(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  maxLines: number,
  lineHeight: number
) {
  const lines = wrapText(ctx, text, maxWidth, maxLines);
  lines.forEach((line, index) => ctx.fillText(line, x, y + index * lineHeight));
  return y + lines.length * lineHeight;
}

function drawPill(
  ctx: CanvasRenderingContext2D,
  label: string,
  x: number,
  y: number,
  options?: {
    fill?: string;
    stroke?: string;
    text?: string;
    height?: number;
    fontSize?: number;
  }
) {
  const height = options?.height ?? 42;
  const fontSize = options?.fontSize ?? 20;
  const horizontalPad = 18;
  setFont(ctx, fontSize, 600);
  const width = ctx.measureText(label).width + horizontalPad * 2;
  fillRoundedRect(ctx, x, y, width, height, height / 2, options?.fill ?? "rgba(255,255,255,0.06)");
  if (options?.stroke) {
    strokeRoundedRect(ctx, x, y, width, height, height / 2, options.stroke, 1);
  }
  ctx.fillStyle = options?.text ?? "#ffffff";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x + horizontalPad, y + height / 2);
  ctx.textBaseline = "alphabetic";
  return width;
}

function drawBackground(ctx: CanvasRenderingContext2D, width: number, height: number) {
  ctx.fillStyle = "#0a0a0b";
  ctx.fillRect(0, 0, width, height);

  const limeGlow = ctx.createRadialGradient(width * 0.15, height * 0.12, 0, width * 0.15, height * 0.12, width * 0.55);
  limeGlow.addColorStop(0, "rgba(190,255,0,0.17)");
  limeGlow.addColorStop(0.45, "rgba(190,255,0,0.06)");
  limeGlow.addColorStop(1, "rgba(190,255,0,0)");
  ctx.fillStyle = limeGlow;
  ctx.fillRect(0, 0, width, height);

  const blueGlow = ctx.createRadialGradient(width * 0.82, height * 0.88, 0, width * 0.82, height * 0.88, width * 0.42);
  blueGlow.addColorStop(0, "rgba(99,179,237,0.14)");
  blueGlow.addColorStop(0.55, "rgba(99,179,237,0.04)");
  blueGlow.addColorStop(1, "rgba(99,179,237,0)");
  ctx.fillStyle = blueGlow;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "rgba(255,255,255,0.05)";
  ctx.lineWidth = 1;
  for (let i = -height; i < width; i += 96) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + height, height);
    ctx.stroke();
  }
}

function drawSummaryCanvas(canvas: HTMLCanvasElement, data: ShareData, variant: "story" | "square") {
  const SPORT_COLORS = getSportColors();
  const W = 1080;
  const H = variant === "story" ? 1920 : 1080;
  canvas.width = W;
  canvas.height = H;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  drawBackground(ctx, W, H);

  const margin = variant === "story" ? 60 : 54;
  const frameX = margin;
  const frameY = margin;
  const frameW = W - margin * 2;
  const frameH = H - margin * 2;

  const frameGradient = ctx.createLinearGradient(frameX, frameY, frameX + frameW, frameY + frameH);
  frameGradient.addColorStop(0, "rgba(255,255,255,0.055)");
  frameGradient.addColorStop(1, "rgba(255,255,255,0.025)");
  fillRoundedRect(ctx, frameX, frameY, frameW, frameH, 38, frameGradient);
  strokeRoundedRect(ctx, frameX, frameY, frameW, frameH, 38, "rgba(255,255,255,0.08)", 1.5);

  const innerX = frameX + 34;
  const innerY = frameY + 34;
  const innerW = frameW - 68;
  const innerH = frameH - 68;
  const cardGradient = ctx.createLinearGradient(innerX, innerY, innerX + innerW, innerY + innerH);
  cardGradient.addColorStop(0, "rgba(15,15,18,0.98)");
  cardGradient.addColorStop(1, "rgba(9,9,11,0.98)");
  fillRoundedRect(ctx, innerX, innerY, innerW, innerH, 30, cardGradient);
  strokeRoundedRect(ctx, innerX, innerY, innerW, innerH, 30, "rgba(190,255,0,0.12)", 1);

  const accentGradient = ctx.createLinearGradient(innerX, innerY, innerX + innerW, innerY);
  accentGradient.addColorStop(0, "rgba(190,255,0,0.85)");
  accentGradient.addColorStop(1, "rgba(190,255,0,0)");
  fillRoundedRect(ctx, innerX + 28, innerY + 26, innerW - 56, 6, 3, accentGradient);

  const pad = innerX + 46;
  const top = innerY + 64;
  const contentW = innerW - 92;
  const story = variant === "story";

  setFont(ctx, 26, 700);
  ctx.fillStyle = "#beff00";
  ctx.fillText("tri.ai", pad, top);

  const badgeY = top - 24;
  const debriefBadgeX = pad + 128;
  const debriefBadgeW = drawPill(ctx, "weekly debrief", debriefBadgeX, badgeY, {
    fill: "rgba(190,255,0,0.08)",
    stroke: "rgba(190,255,0,0.20)",
    text: "#beff00",
    height: 42,
    fontSize: 18
  });
  drawPill(ctx, data.weekRange, debriefBadgeX + debriefBadgeW + 12, badgeY, {
    fill: "rgba(255,255,255,0.055)",
    stroke: "rgba(255,255,255,0.08)",
    text: "rgba(255,255,255,0.9)",
    height: 42,
    fontSize: 18
  });

  const heroY = top + 86;
  const rightColW = story ? 286 : 300;
  const gap = 42;
  const leftColW = contentW - rightColW - gap;

  setFont(ctx, story ? 86 : 74, 700);
  ctx.fillStyle = "#f5f5f5";
  let cursorY = drawTextBlock(ctx, data.title, pad, heroY, leftColW, story ? 3 : 3, story ? 94 : 82);
  cursorY += 28;

  setFont(ctx, 22, 600);
  ctx.fillStyle = "rgba(255,255,255,0.48)";
  const weekLabelText = data.weekLabel ? data.weekLabel.toUpperCase() : "THIS WEEK";
  ctx.fillText(weekLabelText, pad, cursorY);

  const metricCardX = pad + leftColW + gap;
  const metricCardY = heroY - 8;
  const metricCardH = story ? 320 : 286;
  const metricGradient = ctx.createLinearGradient(metricCardX, metricCardY, metricCardX, metricCardY + metricCardH);
  metricGradient.addColorStop(0, "rgba(190,255,0,0.14)");
  metricGradient.addColorStop(1, "rgba(190,255,0,0.05)");
  fillRoundedRect(ctx, metricCardX, metricCardY, rightColW, metricCardH, 28, metricGradient);
  strokeRoundedRect(ctx, metricCardX, metricCardY, rightColW, metricCardH, 28, "rgba(190,255,0,0.22)", 1.5);

  setFont(ctx, story ? 150 : 134, 700);
  ctx.fillStyle = "#beff00";
  ctx.fillText(`${data.completionPct}%`, metricCardX + 24, metricCardY + (story ? 138 : 126));
  setFont(ctx, 24, 600);
  ctx.fillStyle = "rgba(255,255,255,0.72)";
  ctx.fillText("weekly completion", metricCardX + 24, metricCardY + (story ? 182 : 166));

  const executionTone = data.completionPct >= 100 ? "Executed the plan" : data.completionPct >= 85 ? "Mostly on track" : "Room to tighten";
  setFont(ctx, 20, 600);
  ctx.fillStyle = "rgba(255,255,255,0.52)";
  ctx.fillText(executionTone, metricCardX + 24, metricCardY + metricCardH - 28);

  const vizY = metricCardY + metricCardH + 28;
  const vizH = story ? 180 : 160;
  const vizGradient = ctx.createLinearGradient(metricCardX, vizY, metricCardX + rightColW, vizY + vizH);
  vizGradient.addColorStop(0, "rgba(255,255,255,0.05)");
  vizGradient.addColorStop(1, "rgba(255,255,255,0.025)");
  fillRoundedRect(ctx, metricCardX, vizY, rightColW, vizH, 26, vizGradient);
  strokeRoundedRect(ctx, metricCardX, vizY, rightColW, vizH, 26, "rgba(255,255,255,0.08)", 1);

  setFont(ctx, 18, 600);
  ctx.fillStyle = "rgba(255,255,255,0.45)";
  ctx.fillText("discipline load", metricCardX + 22, vizY + 34);
  const total = data.sportMinutes.swim + data.sportMinutes.bike + data.sportMinutes.run;
  const barX = metricCardX + 22;
  const barY = vizY + 58;
  const barW = rightColW - 44;
  const barH = story ? 26 : 22;
  fillRoundedRect(ctx, barX, barY, barW, barH, barH / 2, "rgba(255,255,255,0.06)");

  if (total > 0) {
    let segmentX = barX;
    const orderedSports = [
      { key: "swim", label: "swim", minutes: data.sportMinutes.swim },
      { key: "bike", label: "bike", minutes: data.sportMinutes.bike },
      { key: "run", label: "run", minutes: data.sportMinutes.run }
    ] as const;

    orderedSports.forEach((sport, index) => {
      if (sport.minutes <= 0) return;
      const isLast = index === orderedSports.length - 1 || orderedSports.slice(index + 1).every((item) => item.minutes <= 0);
      const rawWidth = (sport.minutes / total) * barW;
      const segmentW = isLast ? barX + barW - segmentX : Math.max(18, rawWidth - 4);
      fillRoundedRect(ctx, segmentX, barY, segmentW, barH, barH / 2, SPORT_COLORS[sport.key]);
      segmentX += rawWidth;
    });

    let labelY = barY + barH + 28;
    orderedSports
      .filter((sport) => sport.minutes > 0)
      .forEach((sport) => {
        ctx.fillStyle = SPORT_COLORS[sport.key];
        ctx.beginPath();
        ctx.arc(barX + 8, labelY - 6, 7, 0, Math.PI * 2);
        ctx.fill();
        setFont(ctx, 18, 600);
        ctx.fillStyle = "rgba(255,255,255,0.78)";
        ctx.fillText(`${sport.label} ${sport.minutes}min`, barX + 24, labelY);
        labelY += 34;
      });
  }

  const summaryCardY = story ? vizY + vizH + 44 : metricCardY;
  const summaryCardH = story ? 320 : 334;
  const summaryGradient = ctx.createLinearGradient(pad, summaryCardY, pad + leftColW, summaryCardY + summaryCardH);
  summaryGradient.addColorStop(0, "rgba(255,255,255,0.04)");
  summaryGradient.addColorStop(1, "rgba(255,255,255,0.02)");
  fillRoundedRect(ctx, pad, summaryCardY, leftColW, summaryCardH, 28, summaryGradient);
  strokeRoundedRect(ctx, pad, summaryCardY, leftColW, summaryCardH, 28, "rgba(255,255,255,0.08)", 1);

  setFont(ctx, 18, 600);
  ctx.fillStyle = "rgba(255,255,255,0.45)";
  ctx.fillText("coach read", pad + 26, summaryCardY + 36);

  setFont(ctx, story ? 38 : 34, 600);
  ctx.fillStyle = "#ffffff";
  const summaryTop = drawTextBlock(ctx, "Most planned structure held, but the week had one clear point of drift.", pad + 26, summaryCardY + 92, leftColW - 52, story ? 3 : 3, story ? 44 : 40);

  setFont(ctx, 24, 500);
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  drawTextBlock(ctx, data.executiveSummary, pad + 26, summaryTop + 18, leftColW - 52, story ? 4 : 4, 34);

  const footerY = innerY + innerH - (story ? 190 : 148);
  const footerGradient = ctx.createLinearGradient(pad, footerY, pad + contentW, footerY);
  footerGradient.addColorStop(0, "rgba(190,255,0,0.12)");
  footerGradient.addColorStop(1, "rgba(99,179,237,0.08)");
  fillRoundedRect(ctx, pad, footerY, contentW, story ? 118 : 108, 28, footerGradient);
  strokeRoundedRect(ctx, pad, footerY, contentW, story ? 118 : 108, 28, "rgba(255,255,255,0.08)", 1);

  if (data.raceName && data.daysToRace !== null) {
    setFont(ctx, 18, 600);
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.fillText("next target", pad + 28, footerY + 34);

    setFont(ctx, story ? 42 : 38, 700);
    ctx.fillStyle = "#beff00";
    ctx.fillText(`${data.daysToRace} days to ${data.raceName}`, pad + 28, footerY + (story ? 84 : 80));
  } else {
    setFont(ctx, 18, 600);
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.fillText("training arc", pad + 28, footerY + 34);
    setFont(ctx, story ? 42 : 38, 700);
    ctx.fillStyle = "#beff00";
    ctx.fillText("Keep the build moving", pad + 28, footerY + (story ? 84 : 80));
  }

  setFont(ctx, 18, 600);
  ctx.fillStyle = "rgba(255,255,255,0.58)";
  const rightFooter = story ? "Built for athletes proud to share the work" : "Share the week";
  const rightFooterWidth = ctx.measureText(rightFooter).width;
  ctx.fillText(rightFooter, pad + contentW - rightFooterWidth - 28, footerY + (story ? 84 : 80));
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
        className="btn-primary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs disabled:opacity-40"
      >
        {generating ? (
          <>
            <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
            Generating…
          </>
        ) : "Share (story)"}
      </button>
      <button
        type="button"
        onClick={() => void handleShare("square")}
        disabled={generating}
        className="btn-secondary px-3 py-1.5 text-xs disabled:opacity-40"
      >
        Square
      </button>
    </div>
  );
}
