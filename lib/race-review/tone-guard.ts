/**
 * Tone guard — post-generation regex sweep enforcing the HARD tone rules
 * from the spec.
 *
 * Banned patterns:
 *   "should have", "missed", "failed", "must" (as imperative)
 *
 * The guard returns the list of violations it found across every string in
 * the structured output. If anything fires, the orchestrator gets one retry
 * with a reinforced system message; if violations persist, it falls back
 * to the deterministic narrative and records the violation set in
 * `race_reviews.tone_violations` for telemetry / spot-check audits.
 */

export type ToneViolation = {
  /** Dot-path into the structured payload, e.g. "verdict.headline". */
  path: string;
  /** The first matched substring in the offending string. */
  match: string;
  /** Which rule fired. */
  rule: ToneRule;
};

export type ToneRule = "should_have" | "missed" | "failed" | "must";

const RULES: Array<{ rule: ToneRule; pattern: RegExp }> = [
  { rule: "should_have", pattern: /\bshould have\b/i },
  { rule: "missed", pattern: /\bmissed\b/i },
  { rule: "failed", pattern: /\bfail(ed|ing|s|ure)?\b/i },
  // "must" used as an imperative verdict — exempt the academic "must have"
  // pattern that's already caught by should_have, so this catches "must do",
  // "must hold", etc. Keep it conservative — single-word match.
  { rule: "must", pattern: /\bmust\b/i }
];

/**
 * Walk every string in the structured payload looking for banned phrases.
 * Strings are visited at any depth.
 */
export function scanForToneViolations(payload: unknown): ToneViolation[] {
  const out: ToneViolation[] = [];
  visit(payload, "", out);
  return out;
}

function visit(node: unknown, path: string, out: ToneViolation[]): void {
  if (node === null || node === undefined) return;
  if (typeof node === "string") {
    for (const { rule, pattern } of RULES) {
      const match = node.match(pattern);
      if (match) {
        out.push({ path: path || "(root)", match: match[0], rule });
      }
    }
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((item, idx) => visit(item, `${path}[${idx}]`, out));
    return;
  }
  if (typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      visit(value, path ? `${path}.${key}` : key, out);
    }
  }
}

export function buildReinforcementSystemMessage(violations: ToneViolation[]): string {
  const phrases = Array.from(new Set(violations.map((v) => `"${v.match}"`))).join(", ");
  return [
    "Your previous output violated tone rules. Specifically these phrases were used: " + phrases + ".",
    "",
    "Rewrite the entire output following these strict prohibitions:",
    "- NEVER use 'should have', 'missed', 'failed', or 'must'.",
    "- Use observational alternatives: 'ended up', 'came in at', 'fell short of plan', 'held', 'eased'.",
    "- Diagnose, do not judge.",
    "",
    "Return the same structured shape with the same facts but tone-compliant phrasing."
  ].join("\n");
}
