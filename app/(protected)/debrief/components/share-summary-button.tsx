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

function drawSummaryCanvas(canvas: HTMLCanvasElement, data: ShareData, variant: "story" | "square") {
  const SPORT_COLORS = getSportColors();
  const W = 1080;
  const H = variant === "story" ? 1920 : 1080;
  canvas.width = W;
  canvas.height = H;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // Background
  ctx.fillStyle = "#0a0a0b";
  ctx.fillRect(0, 0, W, H);

<<<<<<< HEAD
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
=======
  // Subtle grid lines
  ctx.strokeStyle = "rgba(255,255,255,0.04)";
  ctx.lineWidth = 1;
  for (let y = 0; y < H; y += 120) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
>>>>>>> parent of f7b981a (Redesign debrief share cards for social sharing)
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
      // roundRect landed in Chrome 99 / Firefox 112 / Safari 15.4 — fall back to fillRect on older engines
      if (typeof ctx.roundRect === "function") {
        ctx.roundRect(x, y, segW - 4, barH, 4);
      } else {
        ctx.rect(x, y, segW - 4, barH);
      }
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
