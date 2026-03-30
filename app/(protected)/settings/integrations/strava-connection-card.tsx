"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { StravaConnectionRow } from "./connected-services";

function formatRelativeTime(isoString: string | null): string {
  if (!isoString) return "Never";
  const ms = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatSyncSummary(meta: { importedCount?: number; skippedCount?: number; errorCount?: number }): string {
  const parts: string[] = [];
  if (meta.importedCount) parts.push(`${meta.importedCount} imported`);
  if (meta.skippedCount) parts.push(`${meta.skippedCount} skipped`);
  if (meta.errorCount) parts.push(`${meta.errorCount} error${meta.errorCount === 1 ? "" : "s"}`);
  return parts.length > 0 ? `Last sync: ${parts.join(", ")}` : "";
}

// Simple Strava logo SVG
function StravaLogo({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169" />
    </svg>
  );
}

type Props = { connection: StravaConnectionRow };

export function StravaConnectionCard({ connection }: Props) {
  const router = useRouter();
  const [isSyncing, startSync] = useTransition();
  const [isDisconnecting, startDisconnect] = useTransition();

  const [syncWindow, setSyncWindow] = useState(connection?.sync_window_days ?? 7);
  const isConnected = connection !== null;

  async function handleSyncWindowChange(days: number) {
    setSyncWindow(days);
    try {
      await fetch("/api/integrations/strava/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ syncWindowDays: days })
      });
    } catch (err) {
      console.error("[STRAVA_CARD] Settings update error:", err);
    }
  }

  async function handleSync() {
    startSync(async () => {
      try {
        const res = await fetch("/api/integrations/strava/sync", { method: "POST" });
        if (!res.ok) throw new Error("Sync failed");
        router.refresh();
      } catch (err) {
        console.error("[STRAVA_CARD] Sync error:", err);
        router.refresh();
      }
    });
  }

  async function handleDisconnect() {
    if (!window.confirm("Disconnect Strava? Your previously imported activities will be kept.")) {
      return;
    }
    startDisconnect(async () => {
      try {
        await fetch("/api/integrations/strava/disconnect", { method: "POST" });
        router.refresh();
      } catch (err) {
        console.error("[STRAVA_CARD] Disconnect error:", err);
        router.refresh();
      }
    });
  }

  if (!isConnected) {
    return (
      <div className="raised rounded-lg border border-border p-4 flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <span className="w-8 h-8 rounded flex items-center justify-center bg-[#FC4C02] text-white shrink-0">
            <StravaLogo className="w-4 h-4" />
          </span>
          <div className="min-w-0">
            <p className="font-medium text-sm leading-tight">Strava</p>
            <p className="text-xs text-muted">Not connected</p>
          </div>
        </div>
        <p className="text-xs text-muted">
          Import completed workouts from your Strava account.
        </p>
        <a
          href="/api/integrations/strava/connect"
          className="inline-flex items-center justify-center px-3 py-1.5 text-xs font-medium rounded bg-[#FC4C02] text-white hover:bg-[#e04400] transition-colors"
        >
          Connect Strava
        </a>
      </div>
    );
  }

  const syncStatus = connection.last_sync_status;
  const hasError = syncStatus === "error";
  const isRunning = syncStatus === "running" || isSyncing;

  return (
    <div className="raised rounded-lg border border-border p-4 flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <span className="w-8 h-8 rounded flex items-center justify-center bg-[#FC4C02] text-white shrink-0">
          <StravaLogo className="w-4 h-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-sm leading-tight truncate">
            {connection.provider_display_name ?? "Strava"}
          </p>
          <p className="text-xs text-muted">
            {isRunning ? (
              <span className="text-cyan-400">Syncing…</span>
            ) : hasError ? (
              <span className="text-danger">Sync error</span>
            ) : (
              <>Last synced {formatRelativeTime(connection.last_synced_at)}</>
            )}
          </p>
        </div>
        {/* Status dot */}
        <span
          className={`w-2 h-2 rounded-full shrink-0 ${
            isRunning ? "bg-cyan-400 animate-pulse" : hasError ? "bg-danger" : "bg-success"
          }`}
          aria-label={isRunning ? "Syncing" : hasError ? "Error" : "Connected"}
        />
      </div>

      {hasError && connection.last_sync_error && (
        <p className="text-xs text-danger bg-danger/10 rounded px-2 py-1 leading-snug">
          {connection.last_sync_error}
        </p>
      )}

      {!isRunning && connection.last_sync_metadata && (
        <p className="text-xs text-muted">
          {formatSyncSummary(connection.last_sync_metadata)}
        </p>
      )}

      <div className="flex items-center gap-2">
        <label htmlFor="sync-window" className="text-xs text-muted whitespace-nowrap">Sync window</label>
        <select
          id="sync-window"
          value={syncWindow}
          onChange={(e) => handleSyncWindowChange(Number(e.target.value))}
          className="flex-1 text-xs rounded border border-border bg-[var(--color-base)] px-2 py-1 text-foreground"
        >
          <option value={7}>7 days</option>
          <option value={14}>14 days</option>
          <option value={30}>30 days</option>
          <option value={90}>90 days</option>
        </select>
      </div>

      <div className="flex gap-2">
        <button
          onClick={handleSync}
          disabled={isRunning || isDisconnecting}
          className="flex-1 btn-primary px-3 py-1.5 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isRunning ? "Syncing…" : "Sync now"}
        </button>
        <button
          onClick={handleDisconnect}
          disabled={isRunning || isDisconnecting}
          className="px-3 py-1.5 text-xs font-medium rounded border border-border text-muted hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          Disconnect
        </button>
      </div>
    </div>
  );
}
