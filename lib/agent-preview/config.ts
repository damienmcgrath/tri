export const AGENT_PREVIEW_COOKIE = "tri_agent_preview";

export function isAgentPreviewEnabled() {
  return process.env.AGENT_PREVIEW === "true" && process.env.NODE_ENV !== "production";
}

// Startup safety check: warn loudly if preview mode is enabled outside development
if (process.env.AGENT_PREVIEW === "true" && process.env.NODE_ENV !== "development") {
  console.error(
    "SECURITY CRITICAL: AGENT_PREVIEW is enabled in a non-development environment " +
    `(NODE_ENV=${process.env.NODE_ENV}). This can bypass authentication. ` +
    "Set AGENT_PREVIEW=false immediately."
  );
}

