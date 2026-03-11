import { z } from "zod";

export const coachChatRequestSchema = z.object({
  message: z.string().trim().min(3).max(2000),
  conversationId: z.preprocess((value) => (value === null ? undefined : value), z.string().uuid().optional()),
  previousResponseId: z.preprocess((value) => (value === null ? undefined : value), z.string().min(1).max(200).optional())
});

export type CoachChatRequest = z.infer<typeof coachChatRequestSchema>;

export type CoachAuthContext = {
  userId: string;
  athleteId: string;
  email: string | null;
};

export type CoachAction = {
  type: "proposal" | "focus" | "follow_up";
  label: string;
  payload?: Record<string, unknown>;
};

export type CoachProposal = {
  id: string;
  title: string;
  rationale: string;
  status: "pending";
  proposedDate?: string;
  proposedDurationMinutes?: number;
};

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
