import { z } from "zod";

export const coachChatRequestSchema = z.object({
  message: z.string().trim().min(3).max(2000),
  conversationId: z.preprocess((value) => (value === null ? undefined : value), z.string().uuid().optional()),
  /**
   * Optional race scope. When provided on a brand-new conversation, the
   * chat-flow loads the full race object into context and exposes
   * race-scoped tools. Mid-conversation scope changes are rejected upstream;
   * the value is persisted on ai_conversations.race_bundle_id at creation
   * and re-read on subsequent turns.
   */
  raceBundleId: z.preprocess((value) => (value === null ? undefined : value), z.string().uuid().optional())
});

export type CoachAuthContext = {
  userId: string;
  athleteId: string;
  email: string | null;
};

export const CITATION_TYPES = [
  "segment",
  "reference_frame",
  "lesson",
  "pre_race",
  "subjective",
  "prior_race",
  "best_comparable_training"
] as const;

export const coachCitationSchema = z.object({
  type: z.enum(CITATION_TYPES),
  /**
   * Stable identifier for the cited entity. Shape varies by type:
   *   segment            → "swim" | "bike" | "run"
   *   reference_frame    → "<discipline>:<frame>"  e.g. "bike:vsThreshold"
   *   lesson             → "takeaway:<idx>" | "implication:<idx>" | "carry_forward"
   *   pre_race           → "ctl" | "atl" | "tsb" | "taper" | "snapshot"
   *   subjective         → "rating" | "issue:<key>" | "notes"
   *   prior_race         → race_bundle_id (uuid)
   *   best_comparable_training → completed_activity id (uuid)
   */
  refId: z.string().min(1).max(120),
  label: z.string().min(1).max(160)
});

export type CoachCitation = z.infer<typeof coachCitationSchema>;

export const coachStructuredResponseSchema = z.object({
  headline: z.string().min(1).max(160),
  answer: z.string().min(1),
  insights: z.array(z.string().min(1)).max(6).default([]),
  actions: z.array(z.object({
    type: z.enum(["proposal", "focus", "follow_up"]),
    label: z.string().min(1).max(160),
    payload: z.record(z.unknown()).optional()
  })).max(5).default([]),
  warnings: z.array(z.string().min(1)).max(5).default([]),
  /**
   * Source-data citations. Empty for general-coach replies. In race-coach
   * mode every claim that depends on race data must produce one.
   */
  citations: z.array(coachCitationSchema).max(8).default([]),
  proposal: z.object({
    id: z.string().uuid(),
    title: z.string().min(1).max(160),
    rationale: z.string().min(1),
    status: z.literal("pending"),
    proposedDate: z.string().optional(),
    proposedDurationMinutes: z.number().int().positive().optional()
  }).optional()
});

export type CoachStructuredResponse = z.infer<typeof coachStructuredResponseSchema>;
