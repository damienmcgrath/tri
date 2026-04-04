import { ImageResponse } from "@vercel/og";
import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type Format = "story" | "feed" | "square";

const DIMENSIONS: Record<Format, { width: number; height: number }> = {
  story: { width: 1080, height: 1920 },
  feed: { width: 1080, height: 1350 },
  square: { width: 1080, height: 1080 }
};

const SPORT_COLORS = {
  swim: "#63b3ed",
  bike: "#34d399",
  run: "#ff5a28"
};

const ACCENT = "#beff00";

function formatMinutes(mins: number): string {
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const format = (searchParams.get("format") ?? "story") as Format;
  const weekOf = searchParams.get("weekOf");
  const showName = searchParams.get("showName") !== "false";

  if (!DIMENSIONS[format]) {
    return new Response("Invalid format. Use story, feed, or square.", { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Determine week boundaries
  const today = weekOf ?? new Date().toISOString().slice(0, 10);
  const d = new Date(`${today}T00:00:00.000Z`);
  const dayOfWeek = d.getUTCDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const weekStart = new Date(d.getTime() + mondayOffset * 86400000).toISOString().slice(0, 10);
  const weekEnd = new Date(new Date(`${weekStart}T00:00:00.000Z`).getTime() + 7 * 86400000).toISOString().slice(0, 10);
  // Sunday = last day of the week (weekStart + 6) — used for score lookup
  const weekSunday = new Date(new Date(`${weekStart}T00:00:00.000Z`).getTime() + 6 * 86400000).toISOString().slice(0, 10);

  // Fetch data
  const [{ data: sessions }, { data: profile }, { data: debrief }, { data: scoreRow }] = await Promise.all([
    supabase.from("sessions").select("sport, duration_minutes, status, is_key").eq("user_id", user.id).gte("date", weekStart).lt("date", weekEnd),
    supabase.from("profiles").select("display_name, race_name, race_date").eq("id", user.id).maybeSingle(),
    supabase.from("weekly_debriefs").select("facts, narrative").eq("athlete_id", user.id).eq("week_start", weekStart).maybeSingle(),
    supabase.from("training_scores").select("composite_score, score_delta_7d").eq("user_id", user.id).eq("score_date", weekSunday).maybeSingle()
  ]);

  type SessionRow = { sport: string; duration_minutes: number | null; status: string | null; is_key: boolean | null };
  const allSessions = (sessions ?? []) as SessionRow[];
  const completedCount = allSessions.filter((s: SessionRow) => s.status === "completed").length;
  const plannedCount = allSessions.length;

  // Sport minutes
  const sportMinutes = { swim: 0, bike: 0, run: 0 };
  for (const s of allSessions) {
    if (s.status === "completed" && s.duration_minutes) {
      const sport = s.sport as keyof typeof sportMinutes;
      if (sport in sportMinutes) sportMinutes[sport] += s.duration_minutes;
    }
  }
  const totalMinutes = sportMinutes.swim + sportMinutes.bike + sportMinutes.run;
  const completionPct = plannedCount > 0 ? Math.round((completedCount / plannedCount) * 100) : 0;

  // Extract debrief data (JSONB uses camelCase keys)
  const facts = debrief?.facts as Record<string, unknown> | null;
  const narrative = debrief?.narrative as Record<string, unknown> | null;
  const weekHeadline = (narrative?.executiveSummary as string) ?? "";

  // Race countdown
  let daysToRace: number | null = null;
  const raceName = profile?.race_name ?? null;
  if (profile?.race_date) {
    const raceDate = new Date(`${profile.race_date}T00:00:00.000Z`);
    const todayDate = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
    daysToRace = Math.ceil((raceDate.getTime() - todayDate.getTime()) / 86400000);
    if (daysToRace < 0) daysToRace = null;
  }

  // Week label
  const weekShape = (facts?.weekShape as string) ?? null;
  const weekLabel = weekShape === "recovery" ? "Recovery Week" : `Week of ${new Date(`${weekStart}T00:00:00.000Z`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;

  const athleteName = showName ? (profile?.display_name ?? user.user_metadata?.full_name ?? null) : null;

  const { width, height } = DIMENSIONS[format];
  const isStory = format === "story";
  const pad = 80;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          padding: `${isStory ? 180 : 80}px ${pad}px ${pad}px`,
          background: "linear-gradient(180deg, #0c1220 0%, #0a0a0b 100%)",
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          color: "white"
        }}
      >
        {/* Brand */}
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <span style={{ fontSize: "28px", fontWeight: 700, color: ACCENT }}>TRI.AI</span>
          {athleteName && (
            <span style={{ fontSize: "20px", color: "rgba(255,255,255,0.35)" }}>{athleteName}</span>
          )}
        </div>

        {/* Week label */}
        <div style={{ marginTop: "24px", fontSize: "28px", fontWeight: 500, color: "rgba(255,255,255,0.4)" }}>
          {weekLabel}
        </div>

        {/* Completion % */}
        <div style={{ marginTop: isStory ? "60px" : "40px", display: "flex", flexDirection: "column" }}>
          <span style={{ fontSize: isStory ? "160px" : "120px", fontWeight: 700, color: ACCENT, lineHeight: 1 }}>
            {completionPct}%
          </span>
          <span style={{ fontSize: "28px", fontWeight: 500, color: "rgba(255,255,255,0.35)", marginTop: "8px" }}>
            weekly completion ({completedCount}/{plannedCount} sessions)
          </span>
        </div>

        {/* Sport bars */}
        {totalMinutes > 0 && (
          <div style={{ marginTop: isStory ? "60px" : "40px", display: "flex", flexDirection: "column", gap: "16px" }}>
            <div style={{ display: "flex", height: "20px", borderRadius: "10px", overflow: "hidden", gap: "4px" }}>
              {(["swim", "bike", "run"] as const).map((sport) => {
                const pct = (sportMinutes[sport] / totalMinutes) * 100;
                if (pct === 0) return null;
                return (
                  <div
                    key={sport}
                    style={{
                      width: `${pct}%`,
                      height: "100%",
                      backgroundColor: SPORT_COLORS[sport],
                      borderRadius: "4px"
                    }}
                  />
                );
              })}
            </div>
            <div style={{ display: "flex", gap: "32px" }}>
              {(["swim", "bike", "run"] as const).map((sport) => {
                if (sportMinutes[sport] === 0) return null;
                return (
                  <div key={sport} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <div style={{ width: "12px", height: "12px", borderRadius: "50%", backgroundColor: SPORT_COLORS[sport] }} />
                    <span style={{ fontSize: "22px", color: "rgba(255,255,255,0.5)" }}>
                      {sport} {formatMinutes(sportMinutes[sport])}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Total hours + Training Score */}
        <div style={{ marginTop: "32px", display: "flex", alignItems: "center", gap: "32px" }}>
          <span style={{ fontSize: "22px", color: "rgba(255,255,255,0.35)" }}>
            Total: {formatMinutes(totalMinutes)}
          </span>
          {scoreRow?.composite_score != null && (
            <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontSize: "28px", fontWeight: 700, color: scoreRow.composite_score >= 75 ? "#2dd4bf" : scoreRow.composite_score >= 50 ? "white" : "#fbbf24" }}>
                {Math.round(scoreRow.composite_score)}
              </span>
              <span style={{ fontSize: "18px", color: "rgba(255,255,255,0.35)" }}>Training Score</span>
              {scoreRow.score_delta_7d != null && scoreRow.score_delta_7d !== 0 && (
                <span style={{ fontSize: "18px", fontWeight: 600, color: scoreRow.score_delta_7d > 0 ? "#2dd4bf" : "#f87171" }}>
                  {scoreRow.score_delta_7d > 0 ? "+" : ""}{Math.round(scoreRow.score_delta_7d)}
                </span>
              )}
            </span>
          )}
        </div>

        {/* Executive summary */}
        {weekHeadline && (
          <div style={{ marginTop: "32px", fontSize: "26px", color: "rgba(255,255,255,0.55)", lineHeight: 1.4, maxWidth: "920px" }}>
            {weekHeadline.slice(0, 200)}
          </div>
        )}

        {/* Race countdown — pushed toward bottom */}
        {raceName && daysToRace !== null && (
          <div style={{ marginTop: "auto", paddingTop: "40px", fontSize: "28px", fontWeight: 700, color: ACCENT }}>
            {daysToRace} days to {raceName}
          </div>
        )}

        {/* Footer branding */}
        <div style={{ marginTop: raceName ? "20px" : "auto", paddingTop: raceName ? "0" : "40px", fontSize: "16px", color: "rgba(255,255,255,0.2)" }}>
          Built with tri.ai
        </div>
      </div>
    ),
    {
      width,
      height,
      headers: {
        "Cache-Control": "private, max-age=3600"
      }
    }
  );
}
