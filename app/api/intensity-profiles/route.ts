import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import {
  computeSessionIntensityProfile,
  computeWeeklyIntensitySummary,
  getVisualWeight,
  type SessionIntensityProfile
} from "@/lib/training/intensity-profile";

const requestSchema = z.object({
  planId: z.string().uuid()
});

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    // Fetch all sessions for the plan
    const { data: sessions } = await supabase
      .from("sessions")
      .select("id,sport,type,target,notes,duration_minutes,intent_category,date")
      .eq("plan_id", parsed.data.planId)
      .eq("user_id", user.id)
      .order("date", { ascending: true });

    if (!sessions || sessions.length === 0) {
      return NextResponse.json({ profiles: [], summaries: [] });
    }

    // Compute profiles
    const rawProfiles = (sessions as Array<Record<string, unknown>>).map((s) =>
      computeSessionIntensityProfile({
        id: s.id as string,
        sport: s.sport as string,
        type: s.type as string,
        target: (s.target as string | null) ?? null,
        notes: (s.notes as string | null) ?? null,
        durationMinutes: (s.duration_minutes as number) ?? 0,
        intentCategory: (s.intent_category as string | null) ?? null
      })
    );

    // Compute max stress for visual weight
    const maxStress = Math.max(...rawProfiles.map((p) => p.rawStress), 1);
    const profiles: SessionIntensityProfile[] = rawProfiles.map((p) => ({
      ...p,
      visualWeight: getVisualWeight(p.rawStress, maxStress)
    }));

    // Upsert profiles
    for (const profile of profiles) {
      await supabase
        .from("session_intensity_profiles")
        .upsert(
          {
            session_id: profile.sessionId,
            user_id: user.id,
            primary_zone: profile.primaryZone,
            zone_distribution: profile.zoneDistribution,
            planned_stress_score: profile.plannedStressScore,
            planned_duration_minutes: profile.plannedDurationMinutes,
            stress_per_minute: profile.stressPerMinute,
            intensity_colour: profile.intensityColour,
            visual_weight: profile.visualWeight,
            discipline: profile.discipline
          },
          { onConflict: "session_id" }
        );
    }

    // Group by week and compute weekly summaries
    const weekGroups = new Map<string, SessionIntensityProfile[]>();
    for (let i = 0; i < sessions.length; i++) {
      const session = sessions[i] as Record<string, unknown>;
      const date = session.date as string;
      // Find the Monday of this date's week
      const d = new Date(`${date}T00:00:00.000Z`);
      const day = d.getUTCDay();
      const offset = day === 0 ? -6 : 1 - day;
      d.setUTCDate(d.getUTCDate() + offset);
      const weekStart = d.toISOString().slice(0, 10);

      if (!weekGroups.has(weekStart)) weekGroups.set(weekStart, []);
      weekGroups.get(weekStart)!.push(profiles[i]);
    }

    const sortedWeeks = Array.from(weekGroups.keys()).sort();
    const summaries = [];
    let previousSummary: { totalPlannedHours: number; totalStressScore: number } | null = null;

    for (const weekStart of sortedWeeks) {
      const weekProfiles = weekGroups.get(weekStart)!;
      const summary = computeWeeklyIntensitySummary(weekProfiles, weekStart, previousSummary);
      summaries.push(summary);
      previousSummary = { totalPlannedHours: summary.totalPlannedHours, totalStressScore: summary.totalStressScore };

      // Upsert weekly summary
      await supabase
        .from("weekly_intensity_summaries")
        .upsert(
          {
            user_id: user.id,
            week_start_date: weekStart,
            zone_distribution: summary.zoneDistribution,
            total_planned_hours: summary.totalPlannedHours,
            total_stress_score: summary.totalStressScore,
            session_count: summary.sessionCount,
            hours_delta_pct: summary.hoursDeltaPct,
            stress_delta_pct: summary.stressDeltaPct,
            discipline_hours: summary.disciplineHours
          },
          { onConflict: "user_id,week_start_date" }
        );
    }

    return NextResponse.json({
      profiles: profiles.length,
      summaries: summaries.length
    });
  } catch (error) {
    console.error("[INTENSITY_PROFILES] Error:", error);
    return NextResponse.json({ error: "Failed to compute profiles" }, { status: 500 });
  }
}
