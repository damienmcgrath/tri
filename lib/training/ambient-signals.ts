import type { SupabaseClient } from "@supabase/supabase-js";

export type SignalSeverity = "info" | "caution" | "concern";

export type AmbientSignal = {
  type: string;
  severity: SignalSeverity;
  label: string;
  detail: string;
  evidence: string[];
};

function addDays(isoDate: string, days: number) {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function getWeekStart(isoDate: string) {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  const day = d.getUTCDay();
  const offset = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

export async function detectAmbientSignals(
  supabase: SupabaseClient,
  athleteId: string
): Promise<AmbientSignal[]> {
  const signals: AmbientSignal[] = [];

  const today = new Date().toISOString().slice(0, 10);
  const fourWeeksAgo = addDays(today, -28);

  // Load recent sessions (last 4 weeks)
  const { data: sessions } = await supabase
    .from("sessions")
    .select("id,date,sport,type,duration_minutes,status,skip_reason,execution_result")
    .eq("user_id", athleteId)
    .gte("date", fourWeeksAgo)
    .lte("date", today)
    .order("date", { ascending: false })
    .limit(60);

  // Load recent session feels (RPE)
  const { data: feels } = await supabase
    .from("session_feels")
    .select("session_id,rpe,created_at")
    .eq("user_id", athleteId)
    .order("created_at", { ascending: false })
    .limit(20);

  // Load persisted observed patterns
  const { data: patterns } = await supabase
    .from("athlete_observed_patterns")
    .select("pattern_key,label,detail,confidence,last_observed_at,support_count")
    .eq("athlete_id", athleteId)
    .order("last_observed_at", { ascending: false })
    .limit(10);

  const sessionList = sessions ?? [];
  const feelList = feels ?? [];

  // --- Signal: consecutive skips ---
  const recentSkipped = sessionList.filter((s) => s.status === "skipped");
  if (recentSkipped.length >= 2) {
    const byWeek = new Map<string, number>();
    for (const s of recentSkipped) {
      const wk = getWeekStart(s.date);
      byWeek.set(wk, (byWeek.get(wk) ?? 0) + 1);
    }
    const weeksWithMultipleSkips = [...byWeek.entries()].filter(([, count]) => count >= 2);
    if (weeksWithMultipleSkips.length >= 1) {
      const skipReasons = recentSkipped
        .map((s) => (s.skip_reason as string | null) ?? null)
        .filter(Boolean)
        .slice(0, 3) as string[];
      signals.push({
        type: "consecutive_skips",
        severity: "caution",
        label: "Multiple skipped sessions",
        detail: `${recentSkipped.length} sessions skipped in the last 4 weeks across ${weeksWithMultipleSkips.length} week(s).`,
        evidence: skipReasons.length > 0
          ? skipReasons.map((r) => `Skip reason: ${r}`)
          : [`${recentSkipped.length} skipped sessions in recent weeks`]
      });
    }
  }

  // --- Signal: duration shortfall ---
  const completedWithDuration = sessionList.filter(
    (s) => s.status === "completed" && s.duration_minutes != null && s.duration_minutes > 0
  );
  if (completedWithDuration.length >= 3) {
    // Check actual durations via session_activity_links
    // As a lightweight proxy, look for execution_result shortfalls
    const withExecution = completedWithDuration.filter(
      (s) =>
        s.execution_result &&
        typeof s.execution_result === "object" &&
        "status" in (s.execution_result as object) &&
        (s.execution_result as { status?: string }).status === "missed_intent"
    );
    if (withExecution.length >= 2) {
      signals.push({
        type: "execution_decline",
        severity: "info",
        label: "Recurring intent misses",
        detail: `${withExecution.length} sessions in the last 4 weeks completed but missed the intended outcome.`,
        evidence: withExecution.slice(0, 3).map(
          (s) => `${s.sport} on ${s.date} — ${(s.execution_result as { summary?: string }).summary ?? "intent not matched"}`
        )
      });
    }
  }

  // --- Signal: high RPE trend ---
  const feelsWithRpe = feelList.filter((f) => typeof f.rpe === "number");
  if (feelsWithRpe.length >= 3) {
    const avgRpe = feelsWithRpe.reduce((sum, f) => sum + (f.rpe as number), 0) / feelsWithRpe.length;
    if (avgRpe >= 7) {
      const evidence = feelsWithRpe
        .slice(0, 4)
        .map((f) => `RPE ${f.rpe as number} (${(f.created_at as string).slice(0, 10)})`);
      signals.push({
        type: "high_rpe_trend",
        severity: avgRpe >= 8.5 ? "concern" : "caution",
        label: "Sustained high perceived effort",
        detail: `Average RPE of ${avgRpe.toFixed(1)} across the last ${feelsWithRpe.length} logged sessions — may indicate accumulated fatigue.`,
        evidence
      });
    }
  }

  // --- Signal: session gap (5+ days without any completed session) ---
  const completedDates = sessionList
    .filter((s) => s.status === "completed")
    .map((s) => s.date)
    .sort()
    .reverse();

  if (completedDates.length === 0) {
    const gapDays = 28; // haven't trained in 4 weeks
    signals.push({
      type: "session_gap",
      severity: "caution",
      label: "No completed sessions in 4 weeks",
      detail: "No completed sessions found in the last 28 days.",
      evidence: []
    });
  } else {
    const daysSinceLast = Math.floor(
      (new Date(today).getTime() - new Date(completedDates[0]).getTime()) / 86400000
    );
    if (daysSinceLast >= 6) {
      signals.push({
        type: "session_gap",
        severity: daysSinceLast >= 10 ? "concern" : "info",
        label: `${daysSinceLast}-day gap since last session`,
        detail: `Last completed session was ${daysSinceLast} days ago (${completedDates[0]}).`,
        evidence: [`Last session: ${completedDates[0]}`]
      });
    }
  }

  // --- Signal: persisted observed patterns (high/medium confidence only) ---
  for (const pattern of patterns ?? []) {
    if (pattern.confidence === "low") continue;
    signals.push({
      type: `observed_pattern:${pattern.pattern_key as string}`,
      severity: pattern.confidence === "high" ? "caution" : "info",
      label: pattern.label as string,
      detail: pattern.detail as string,
      evidence: [`Observed ${pattern.support_count as number} times, last on ${(pattern.last_observed_at as string).slice(0, 10)}`]
    });
  }

  // --- Signal: score-RPE alignment (confidence calibration) ---
  // When execution scores and RPE consistently agree, scoring confidence is high
  if (feelsWithRpe.length >= 5) {
    const feelsById = new Map(feelsWithRpe.map((f) => [f.session_id as string, f.rpe as number]));
    let aligned = 0;
    let compared = 0;

    for (const s of sessionList) {
      if (s.status !== "completed") continue;
      const rpe = feelsById.get(s.id);
      if (rpe == null) continue;

      const exec = s.execution_result as { status?: string } | null;
      if (!exec?.status) continue;

      compared++;
      // High score + low RPE = aligned for easy sessions
      // Matched intent + moderate RPE = aligned
      // Missed intent + high RPE = aligned (athlete felt it was hard and it was)
      const matched = exec.status === "matched_intent";
      const missed = exec.status === "missed_intent";

      if ((matched && rpe <= 7) || (missed && rpe >= 7) || (!matched && !missed && rpe >= 4 && rpe <= 8)) {
        aligned++;
      }
    }

    if (compared >= 5) {
      const alignmentPct = Math.round((aligned / compared) * 100);
      if (alignmentPct >= 80) {
        signals.push({
          type: "score_rpe_aligned",
          severity: "info",
          label: "High scoring confidence",
          detail: `Execution scores aligned with your RPE in ${alignmentPct}% of recent sessions (${aligned}/${compared}).`,
          evidence: [`${alignmentPct}% alignment across ${compared} sessions with RPE data`]
        });
      } else if (alignmentPct < 50 && compared >= 6) {
        signals.push({
          type: "score_rpe_misaligned",
          severity: "caution",
          label: "Score-effort mismatch",
          detail: `Execution scores diverge from your RPE in ${100 - alignmentPct}% of recent sessions — review data sources or calibration.`,
          evidence: [`${alignmentPct}% alignment across ${compared} sessions`]
        });
      }
    }
  }

  // Deduplicate: if consecutive_skips and session_gap overlap, keep the more specific one
  const hasConsecutiveSkips = signals.some((s) => s.type === "consecutive_skips");
  const finalSignals = signals.filter(
    (s) => !(s.type === "session_gap" && hasConsecutiveSkips)
  );

  return finalSignals.slice(0, 5); // cap at 5 signals
}
