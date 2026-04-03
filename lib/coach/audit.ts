import type { CoachAuthContext } from "@/lib/coach/types";
import { log, warn, error } from "@/lib/logger";

export type CoachAuditLevel = "info" | "warn" | "error";

export function sanitizeToolArgs(args: unknown) {
  if (!args || typeof args !== "object") {
    return {};
  }

  const disallowedKeys = new Set(["userId", "user_id", "athleteId", "athlete_id", "email", "token", "apiKey", "api_key"]);
  const source = args as Record<string, unknown>;
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(source)) {
    if (disallowedKeys.has(key)) {
      sanitized[key] = "[redacted]";
      continue;
    }

    sanitized[key] = typeof value === "string" && value.length > 180
      ? `${value.slice(0, 180)}…`
      : value;
  }

  return sanitized;
}

export function logCoachAudit(level: CoachAuditLevel, event: string, details: {
  ctx?: Pick<CoachAuthContext, "userId" | "athleteId">;
  route?: string;
  toolName?: string;
  success?: boolean;
  resultCount?: number;
  proposalId?: string;
  reason?: string;
  args?: unknown;
}) {
  const payload = {
    event,
    route: details.route,
    toolName: details.toolName,
    userId: details.ctx?.userId,
    athleteId: details.ctx?.athleteId,
    success: details.success,
    resultCount: details.resultCount,
    proposalId: details.proposalId,
    reason: details.reason,
    args: details.args ? sanitizeToolArgs(details.args) : undefined
  };

  if (level === "error") {
    error("coach.audit", payload as Record<string, unknown>);
    return;
  }

  if (level === "warn") {
    warn("coach.audit", payload as Record<string, unknown>);
    return;
  }

  log("coach.audit", payload as Record<string, unknown>);
}
