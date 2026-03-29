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
    lastSyncError: (row.last_sync_error as string) ?? null
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Fetch a connection by (userId, provider). Returns null if not found. */
export async function getConnection(
  userId: string,
  provider: string
): Promise<ExternalConnection | null> {
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from("external_account_connections")
    .select("*")
    .eq("user_id", userId)
    .eq("provider", provider)
    .is("disconnected_at", null)
    .maybeSingle();

  if (error) {
    console.error("[TOKEN_SERVICE] getConnection error:", error.message);
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
  const { data, error } = await supabase
    .from("external_account_connections")
    .select("*")
    .eq("provider", provider)
    .eq("provider_athlete_id", providerAthleteId)
    .is("disconnected_at", null)
    .maybeSingle();

  if (error) {
    console.error("[TOKEN_SERVICE] getConnectionByProviderAthleteId error:", error.message);
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
  const { error } = await supabase
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

  if (error) {
    console.error("[TOKEN_SERVICE] upsertConnection error:", error.message);
    throw new Error(`Failed to save connection: ${error.message}`);
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

  console.log(`[TOKEN_SERVICE] Refreshing ${connection.provider} token for user ${connection.userId}`);

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
  const { error } = await supabase
    .from("external_account_connections")
    .update({
      access_token: newTokens.access_token,
      refresh_token: newTokens.refresh_token,
      token_expires_at: newExpiresAt.toISOString()
    })
    .eq("user_id", connection.userId)
    .eq("provider", connection.provider);

  if (error) {
    console.error("[TOKEN_SERVICE] refreshIfExpired update error:", error.message);
    throw new Error(`Failed to persist refreshed token: ${error.message}`);
  }

  console.log(`[TOKEN_SERVICE] Token refreshed for user ${connection.userId}, expires ${newExpiresAt.toISOString()}`);

  return {
    ...connection,
    accessToken: newTokens.access_token,
    refreshToken: newTokens.refresh_token,
    tokenExpiresAt: newExpiresAt
  };
}

/** Update the sync status and last_synced_at timestamp. */
export async function updateSyncStatus(
  userId: string,
  provider: string,
  status: SyncStatus,
  error?: string
): Promise<void> {
  const supabase = getAdminClient();
  const update: Record<string, unknown> = {
    last_sync_status: status,
    last_sync_error: error ?? null
  };
  if (status === "ok") {
    update.last_synced_at = new Date().toISOString();
    update.last_sync_error = null;
  }

  const { error: dbError } = await supabase
    .from("external_account_connections")
    .update(update)
    .eq("user_id", userId)
    .eq("provider", provider);

  if (dbError) {
    console.error("[TOKEN_SERVICE] updateSyncStatus error:", dbError.message);
  }
}

/** Remove a connection. The user's imported activities are preserved. */
export async function deleteConnection(
  userId: string,
  provider: string
): Promise<void> {
  const supabase = getAdminClient();
  const { error } = await supabase
    .from("external_account_connections")
    .delete()
    .eq("user_id", userId)
    .eq("provider", provider);

  if (error) {
    console.error("[TOKEN_SERVICE] deleteConnection error:", error.message);
    throw new Error(`Failed to delete connection: ${error.message}`);
  }
}
