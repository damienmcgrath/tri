const SUSPICIOUS_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above|system)\s+(instructions|prompts|rules)/i,
  /disregard\s+(all\s+)?(previous|prior|above|system)/i,
  /you\s+are\s+now\s+(a|an|in)\s+/i,
  /new\s+instructions?\s*:/i,
  /system\s*:\s*/i,
  /\bDAN\b.*\bmode\b/i,
  /jailbreak/i,
  /bypass\s+(your|the|all)\s+(rules|restrictions|safety|filters)/i,
  /pretend\s+(you\s+are|to\s+be|you're)\s+/i,
  /act\s+as\s+(if\s+)?(you\s+(are|were)|a\s+)/i,
  /forget\s+(everything|all|your)\s+(you|about|instructions|rules)/i,
];

export function detectPromptInjection(message: string): { suspicious: boolean; matchedPattern: string | null } {
  for (const pattern of SUSPICIOUS_PATTERNS) {
    if (pattern.test(message)) {
      return { suspicious: true, matchedPattern: pattern.source };
    }
  }
  return { suspicious: false, matchedPattern: null };
}
