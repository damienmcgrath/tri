export const AGENT_PREVIEW_COOKIE = "tri_agent_preview";

export function isAgentPreviewEnabled() {
  return process.env.AGENT_PREVIEW === "true" && process.env.NODE_ENV !== "production";
}

