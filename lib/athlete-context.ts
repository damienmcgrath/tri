import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

const experienceLevelSchema = z.enum(["beginner", "intermediate", "advanced"]);
const goalTypeSchema = z.enum(["finish", "perform", "qualify", "build"]);
const coachingPreferenceSchema = z.enum(["direct", "balanced", "supportive"]);

export const athleteContextInputSchema = z.object({
  experienceLevel: experienceLevelSchema.nullish(),
  goalType: goalTypeSchema.nullish(),
  priorityEventName: z.string().trim().max(160).nullish(),
  priorityEventDate: z.string().date().nullish(),
  limiters: z.array(z.string().trim().min(1).max(80)).max(8).default([]),
  strongestDisciplines: z.array(z.string().trim().min(1).max(32)).max(4).default([]),
  weakestDisciplines: z.array(z.string().trim().min(1).max(32)).max(4).default([]),
  weeklyConstraints: z.array(z.string().trim().min(1).max(120)).max(8).default([]),
  injuryNotes: z.string().trim().max(600).nullish(),
  coachingPreference: coachingPreferenceSchema.nullish()
});

export const athleteCheckinInputSchema = z.object({
  weekStart: z.string().date(),
  fatigue: z.number().int().min(1).max(5).nullish(),
  sleepQuality: z.number().int().min(1).max(5).nullish(),
  soreness: z.number().int().min(1).max(5).nullish(),
  stress: z.number().int().min(1).max(5).nullish(),
  confidence: z.number().int().min(1).max(5).nullish(),
  note: z.string().trim().max(400).nullish()
});

export type AthleteContextInput = z.infer<typeof athleteContextInputSchema>;
export type AthleteCheckinInput = z.infer<typeof athleteCheckinInputSchema>;

export type AthleteContextSnapshot = {
  identity: {
    athleteId: string;
    displayName: string | null;
  };
  goals: {
    priorityEventName: string | null;
    priorityEventDate: string | null;
    goalType: "finish" | "perform" | "qualify" | "build" | null;
  };
  declared: {
    experienceLevel: {
      value: "beginner" | "intermediate" | "advanced" | null;
      source: "athlete_declared" | "profile_fallback" | "unknown";
      updatedAt: string | null;
    };
    limiters: Array<{
      value: string;
      source: "athlete_declared";
      updatedAt: string | null;
    }>;
    strongestDisciplines: string[];
    weakestDisciplines: string[];
    weeklyConstraints: string[];
    injuryNotes: string | null;
    coachingPreference: "direct" | "balanced" | "supportive" | null;
  };
  derived: {
    activePlanId: string | null;
    phase: string | null;
    daysToRace: number | null;
    upcomingKeySessions: string[];
  };
  observed: {
    recurringPatterns: Array<{
      key: string;
      label: string;
      detail: string;
      confidence: "low" | "medium" | "high";
      sourceSessionIds: string[];
    }>;
  };
  weeklyState: {
    fatigue: number | null;
    sleepQuality: number | null;
    soreness: number | null;
    stress: number | null;
    confidence: number | null;
    note: string | null;
    updatedAt: string | null;
  };
  recentBests?: Array<{
    sport: string;
    label: string;
    formattedValue: string;
    date: string;
  }>;
};

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function getTodayUtc() {
  return new Date().toISOString().slice(0, 10);
}

function getWeekStartUtc(date = new Date()) {
  const clone = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = clone.getUTCDay();
  const offset = day === 0 ? -6 : 1 - day;
  clone.setUTCDate(clone.getUTCDate() + offset);
  return clone.toISOString().slice(0, 10);
}

function inferPhase(startDate: string | null, durationWeeks: number | null, todayIso: string) {
  if (!startDate || !durationWeeks) return null;
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const today = new Date(`${todayIso}T00:00:00.000Z`);
  const diffDays = Math.floor((today.getTime() - start.getTime()) / 86400000);
  if (diffDays < 0) return "pre_plan";
  const weekIndex = Math.floor(diffDays / 7) + 1;
  if (weekIndex <= 2) return "base";
  if (weekIndex >= durationWeeks - 1) return "taper";
  if (weekIndex >= Math.max(3, durationWeeks - 3)) return "peak";
  return "build";
}

function daysUntil(date: string | null) {
  if (!date) return null;
  const target = new Date(`${date}T00:00:00.000Z`);
  const today = new Date(`${getTodayUtc()}T00:00:00.000Z`);
  return Math.ceil((target.getTime() - today.getTime()) / 86400000);
}

export async function getAthleteContextSnapshot(supabase: SupabaseClient, athleteId: string): Promise<AthleteContextSnapshot> {
  const weekStart = getWeekStartUtc();
  const weekEnd = new Date(new Date(`${weekStart}T00:00:00.000Z`).getTime() + 6 * 86400000).toISOString().slice(0, 10);
  const todayIso = getTodayUtc();

  const [{ data: profile }, { data: context }, { data: activePlan }, { data: checkin }, { data: patterns }, { data: upcomingSessions }] = await Promise.all([
    supabase.from("profiles").select("id,display_name,race_name,race_date,active_plan_id").eq("id", athleteId).maybeSingle(),
    supabase.from("athlete_context").select("*").eq("athlete_id", athleteId).maybeSingle(),
    supabase
      .from("training_plans")
      .select("id,name,start_date,duration_weeks")
      .eq("athlete_id", athleteId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("athlete_checkins")
      .select("fatigue,sleep_quality,soreness,stress,confidence,note,updated_at")
      .eq("athlete_id", athleteId)
      .eq("week_start", weekStart)
      .maybeSingle(),
    supabase
      .from("athlete_observed_patterns")
      .select("pattern_key,label,detail,confidence,source_session_ids")
      .eq("athlete_id", athleteId)
      .order("support_count", { ascending: false })
      .limit(6),
    supabase
      .from("sessions")
      .select("session_name,type")
      .eq("athlete_id", athleteId)
      .gte("date", todayIso)
      .in("session_role", ["key", "supporting"])
      .order("date", { ascending: true })
      .limit(4)
  ]);

  const priorityEventName = context?.priority_event_name ?? profile?.race_name ?? null;
  const priorityEventDate = context?.priority_event_date ?? profile?.race_date ?? null;
  const updatedAt = context?.updated_at ?? null;

  return {
    identity: {
      athleteId,
      displayName: profile?.display_name ?? null
    },
    goals: {
      priorityEventName,
      priorityEventDate,
      goalType: context?.goal_type ?? null
    },
    declared: {
      experienceLevel: {
        value: context?.experience_level ?? null,
        source: context?.experience_level ? "athlete_declared" : "unknown",
        updatedAt
      },
      limiters: asStringArray(context?.limiters).map((value) => ({
        value,
        source: "athlete_declared" as const,
        updatedAt
      })),
      strongestDisciplines: asStringArray(context?.strongest_disciplines),
      weakestDisciplines: asStringArray(context?.weakest_disciplines),
      weeklyConstraints: asStringArray(context?.weekly_constraints),
      injuryNotes: context?.injury_notes ?? null,
      coachingPreference: context?.coaching_preference ?? null
    },
    derived: {
      activePlanId: profile?.active_plan_id ?? activePlan?.id ?? null,
      phase: inferPhase(activePlan?.start_date ?? null, activePlan?.duration_weeks ?? null, todayIso),
      daysToRace: daysUntil(priorityEventDate),
      upcomingKeySessions: (upcomingSessions ?? []).map((session) => (session.session_name ?? session.type ?? "Upcoming session").trim())
    },
    observed: {
      recurringPatterns: (patterns ?? []).map((pattern) => ({
        key: pattern.pattern_key,
        label: pattern.label,
        detail: pattern.detail,
        confidence: pattern.confidence,
        sourceSessionIds: asStringArray(pattern.source_session_ids)
      }))
    },
    weeklyState: {
      fatigue: checkin?.fatigue ?? null,
      sleepQuality: checkin?.sleep_quality ?? null,
      soreness: checkin?.soreness ?? null,
      stress: checkin?.stress ?? null,
      confidence: checkin?.confidence ?? null,
      note: checkin?.note ?? null,
      updatedAt: checkin?.updated_at ?? null
    },
    recentBests: await import("@/lib/training/benchmarks")
      .then(({ deriveBenchmarks }) => deriveBenchmarks(supabase, athleteId, weekStart, weekEnd))
      .then((bests) => bests.slice(0, 3).map((b) => ({ sport: b.sport, label: b.label, formattedValue: b.formattedValue, date: b.activityDate })))
      .catch(() => [])
  };
}

export async function saveAthleteContext(supabase: SupabaseClient, athleteId: string, input: AthleteContextInput) {
  const parsed = athleteContextInputSchema.parse(input);
  const { error } = await supabase.from("athlete_context").upsert({
    athlete_id: athleteId,
    experience_level: parsed.experienceLevel ?? null,
    goal_type: parsed.goalType ?? null,
    priority_event_name: parsed.priorityEventName ?? null,
    priority_event_date: parsed.priorityEventDate ?? null,
    limiters: parsed.limiters,
    strongest_disciplines: parsed.strongestDisciplines,
    weakest_disciplines: parsed.weakestDisciplines,
    weekly_constraints: parsed.weeklyConstraints,
    injury_notes: parsed.injuryNotes ?? null,
    coaching_preference: parsed.coachingPreference ?? null
  });

  if (error) {
    throw new Error(error.message);
  }
}

export async function saveWeeklyCheckin(supabase: SupabaseClient, athleteId: string, input: AthleteCheckinInput) {
  const parsed = athleteCheckinInputSchema.parse(input);
  const { error } = await supabase.from("athlete_checkins").upsert({
    athlete_id: athleteId,
    week_start: parsed.weekStart,
    fatigue: parsed.fatigue ?? null,
    sleep_quality: parsed.sleepQuality ?? null,
    soreness: parsed.soreness ?? null,
    stress: parsed.stress ?? null,
    confidence: parsed.confidence ?? null,
    note: parsed.note ?? null
  }, {
    onConflict: "athlete_id,week_start"
  });

  if (error) {
    throw new Error(error.message);
  }
}

export function getCurrentWeekStart() {
  return getWeekStartUtc();
}
