/**
 * Token service — provider-agnostic CRUD for external_account_connections.
 *
 * Uses the Supabase service-role client for all DB operations so this module
 * can be called from webhook routes (no user session) as well as authenticated
 * API routes. All public functions take an explicit userId and enforce it in
 * every query — the service-role client is never exposed outside this module.
 */

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { refreshToken as stravaRefreshToken } from "./providers/strava/client";
import { log, warn, error } from "@/lib/logger";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ExternalConnection = {
  id: string;
  userId: string;
  provider: string;
  providerAthleteId: string;
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: Date;
  scope: string | null;
  providerDisplayName: string | null;
  providerProfile: Record<string, unknown>;
  lastSyncedAt: Date | null;
  lastSyncStatus: "ok" | "error" | "running" | null;
  lastSyncError: string | null;
  syncWindowDays: number;
};

export type ConnectionInput = {
  provider: string;
  providerAthleteId: string;
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: Date;
  scope: string;
  providerDisplayName: string;
  providerProfile: Record<string, unknown>;
};

export type SyncStatus = "ok" | "error" | "running";

// ─── Internal helpers ─────────────────────────────────────────────────────────

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Supabase service role credentials not configured");
  }
  return createSupabaseClient(url, key);
}

function toExternalConnection(row: Record<string, unknown>): ExternalConnection {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    provider: row.provider as string,
    providerAthleteId: row.provider_athlete_id as string,
    accessToken: row.access_token as string,
    refreshToken: row.refresh_token as string,
    tokenExpiresAt: new Date(row.token_expires_at as string),
    scope: (row.scope as string) ?? null,
    providerDisplayName: (row.provider_display_name as string) ?? null,
    providerProfile: (row.provider_profile as Record<string, unknown>) ?? {},
    lastSyncedAt: row.last_synced_at ? new Date(row.last_synced_at as string) : null,
    lastSyncStatus: (row.last_sync_status as SyncStatus) ?? null,
    lastSyncError: (row.last_sync_error as string) ?? null,
    syncWindowDays: (row.sync_window_days as number) ?? 7
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Fetch a connection by (userId, provider). Returns null if not found. */
export async function getConnection(
  userId: string,
  provider: string
): Promise<ExternalConnection | null> {
  const supabase = getAdminClient();
  const { data, error: dbError } = await supabase
    .from("external_account_connections")
    .select("*")
    .eq("user_id", userId)
    .eq("provider", provider)
    .is("disconnected_at", null)
    .maybeSingle();

  if (dbError) {
    error("token-service.get-connection.error", { message: dbError.message });
    return null;
  }
  if (!data) return null;
  return toExternalConnection(data);
}

/**
 * Fetch a connection by Strava athlete ID (used in webhook lookup where we
 * only know the provider's athlete ID, not our user ID).
 */
export async function getConnectionByProviderAthleteId(
  provider: string,
  providerAthleteId: string
): Promise<ExternalConnection | null> {
  const supabase = getAdminClient();
  const { data, error: dbError } = await supabase
    .from("external_account_connections")
    .select("*")
    .eq("provider", provider)
    .eq("provider_athlete_id", providerAthleteId)
    .is("disconnected_at", null)
    .maybeSingle();

  if (dbError) {
    error("token-service.get-connection-by-athlete-id.error", { message: dbError.message });
    return null;
  }
  if (!data) return null;
  return toExternalConnection(data);
}

/** Upsert a connection (insert on first connect, update on reconnect). */
export async function upsertConnection(
  userId: string,
  data: ConnectionInput
): Promise<void> {
  const supabase = getAdminClient();
  const { error: dbError } = await supabase
    .from("external_account_connections")
    .upsert(
      {
        user_id: userId,
        provider: data.provider,
        provider_athlete_id: data.providerAthleteId,
        access_token: data.accessToken,
        refresh_token: data.refreshToken,
        token_expires_at: data.tokenExpiresAt.toISOString(),
        scope: data.scope,
        provider_display_name: data.providerDisplayName,
        provider_profile: data.providerProfile,
        connected_at: new Date().toISOString(),
        disconnected_at: null
      },
      { onConflict: "user_id,provider" }
    );

  if (dbError) {
    error("token-service.upsert-connection.error", { message: dbError.message });
    throw new Error(`Failed to save connection: ${dbError.message}`);
  }
}

/**
 * Refresh the access token if it expires within 5 minutes.
 * Returns the (possibly updated) connection.
 */
export async function refreshIfExpired(
  connection: ExternalConnection
): Promise<ExternalConnection> {
  const fiveMinutes = 5 * 60 * 1000;
  const expiresInMs = connection.tokenExpiresAt.getTime() - Date.now();

  if (expiresInMs > fiveMinutes) {
    return connection;
  }

  log("token-service.token-refresh.start", { provider: connection.provider, userId: connection.userId });

  let newTokens: { access_token: string; refresh_token: string; expires_at: number };
  try {
    newTokens = await stravaRefreshToken(connection.refreshToken);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Token refresh failed";
    await updateSyncStatus(connection.userId, connection.provider, "error", `Token refresh failed: ${msg}`);
    throw err;
  }

  const newExpiresAt = new Date(newTokens.expires_at * 1000);

  const supabase = getAdminClient();
  const { error: dbError } = await supabase
    .from("external_account_connections")
    .update({
      access_token: newTokens.access_token,
      refresh_token: newTokens.refresh_token,
      token_expires_at: newExpiresAt.toISOString()
    })
    .eq("user_id", connection.userId)
    .eq("provider", connection.provider);

  if (dbError) {
    error("token-service.token-refresh.persist-error", { message: dbError.message, userId: connection.userId, provider: connection.provider });
    throw new Error(`Failed to persist refreshed token: ${dbError.message}`);
  }

  log("token-service.token-refresh.done", { userId: connection.userId, provider: connection.provider, expiresAt: newExpiresAt.toISOString() });

  return {
    ...connection,
    accessToken: newTokens.access_token,
    refreshToken: newTokens.refresh_token,
    tokenExpiresAt: newExpiresAt
  };
}

export type SyncMetadata = {
  importedCount?: number;
  skippedCount?: number;
  errorCount?: number;
};

/** Update the sync status and last_synced_at timestamp. */
export async function updateSyncStatus(
  userId: string,
  provider: string,
  status: SyncStatus,
  syncError?: string,
  metadata?: SyncMetadata
): Promise<void> {
  const supabase = getAdminClient();
  const update: Record<string, unknown> = {
    last_sync_status: status,
    last_sync_error: syncError ?? null
  };
  if (status === "ok") {
    update.last_synced_at = new Date().toISOString();
    update.last_sync_error = null;
  }
  if (metadata) {
    update.last_sync_metadata = metadata;
  }

  const { error: dbError } = await supabase
    .from("external_account_connections")
    .update(update)
    .eq("user_id", userId)
    .eq("provider", provider);

  if (dbError) {
    error("token-service.update-sync-status.error", { message: dbError.message });
  }
}

/** Remove a connection. The user's imported activities are preserved. */
export async function deleteConnection(
  userId: string,
  provider: string
): Promise<void> {
  const supabase = getAdminClient();
  const { error: dbError } = await supabase
    .from("external_account_connections")
    .delete()
    .eq("user_id", userId)
    .eq("provider", provider);

  if (dbError) {
    error("token-service.delete-connection.error", { message: dbError.message, userId, provider });
    throw new Error(`Failed to delete connection: ${dbError.message}`);
  }
}

/**
 * Soft-disconnect a connection by provider athlete ID.
 * Used by Strava's deauthorization webhook where we only know the athlete ID.
 * Sets disconnected_at without deleting the row so history is preserved.
 */
export async function softDisconnect(
  provider: string,
  providerAthleteId: string
): Promise<void> {
  const supabase = getAdminClient();
  const { error: dbError } = await supabase
    .from("external_account_connections")
    .update({ disconnected_at: new Date().toISOString() })
    .eq("provider", provider)
    .eq("provider_athlete_id", providerAthleteId)
    .is("disconnected_at", null);

  if (dbError) {
    error("token-service.soft-disconnect.error", { message: dbError.message, provider, providerAthleteId });
  } else {
    log("token-service.soft-disconnect.done", { provider, providerAthleteId });
  }
}
