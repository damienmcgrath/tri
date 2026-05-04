/**
 * Pure formatting primitives shared across the race-review pipeline:
 * the orchestrator (`lib/race-review.ts`) and the deterministic narrative
 * builders (`lib/race-review/deterministic.ts`).
 *
 * Kept primitive — no business logic, no Zod, no Supabase. Just
 * stringification helpers used in many places.
 */

import type { RaceFacts } from "@/lib/race-review";

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

export function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

export function capitalize(text: string): string {
  return text.length === 0 ? text : text[0].toUpperCase() + text.slice(1);
}

export function sportsList(facts: RaceFacts): string {
  return facts.segments
    .filter((s) => s.role === "swim" || s.role === "bike" || s.role === "run")
    .map((s) => s.role)
    .join("/");
}

export function signed(n: number): string {
  if (n === 0) return "0.0";
  return n > 0 ? `+${n.toFixed(1)}` : n.toFixed(1);
}

export function formatDuration(sec: number): string {
  const total = Math.max(0, Math.round(sec));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function formatPaceSecPerKm(secPerKm: number): string {
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function formatPacePer100m(secPer100: number): string {
  const m = Math.floor(secPer100 / 60);
  const s = Math.round(secPer100 % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function formatDeltaPct(deltaPct: number): string {
  const sign = deltaPct >= 0 ? "+" : "−";
  return `${sign}${Math.abs(deltaPct).toFixed(1)}% second half`;
}

export function formatDurationLabel(sec: number | null | undefined): string | null {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return null;
  const total = Math.max(0, Math.round(sec));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function formatSignedDurationLabel(sec: number | null | undefined): string | null {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return null;
  const sign = sec < 0 ? "−" : sec > 0 ? "+" : "";
  return `${sign}${formatDurationLabel(Math.abs(sec))}`;
}

export function formatDistanceLabel(m: number | null | undefined): string | null {
  if (m === null || m === undefined || !Number.isFinite(m)) return null;
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(2)} km`;
}

export function formatDeltaPctLabel(pct: number): string {
  const sign = pct > 0 ? "+" : pct < 0 ? "−" : "";
  return `${sign}${Math.abs(pct).toFixed(1)}%`;
}

export function formatHalvesUnitLabel(value: number, unit: "watts" | "sec_per_km" | "sec_per_100m"): string {
  if (unit === "watts") return `${Math.round(value)}W`;
  return formatPaceFromSeconds(value, unit);
}

export function formatPaceFromSeconds(sec: number, unit: "sec_per_km" | "sec_per_100m"): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  const suffix = unit === "sec_per_km" ? " /km" : " /100m";
  return `${m}:${String(s).padStart(2, "0")}${suffix}`;
}
