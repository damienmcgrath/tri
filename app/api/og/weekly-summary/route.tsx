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

const SPORT_COLORS: Record<string, string> = {
  swim: "#63b3ed",
  bike: "#34d399",
  run: "#ff5a28",
  strength: "#a78bfa"
};

const ACCENT = "#beff00";

function formatMinutes(mins: number): string {
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

/** Truncate text to the last complete sentence within `maxChars`, falling back to word boundary + "..." */
function smartTruncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const trimmed = text.slice(0, maxChars);
  // Try to find the last sentence boundary (. ! ?) followed by a space or end
  const sentenceEnd = trimmed.search(/[.!?][^.!?]*$/);
  if (sentenceEnd > maxChars * 0.5) {
    return trimmed.slice(0, sentenceEnd + 1);
  }
  // Fall back to last word boundary
  const lastSpace = trimmed.lastIndexOf(" ");
  if (lastSpace > maxChars * 0.5) {
    return trimmed.slice(0, lastSpace) + "…";
  }
  return trimmed + "…";
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

  // Sport minutes — includes strength
  const sportMinutes: Record<string, number> = { swim: 0, bike: 0, run: 0, strength: 0 };
  for (const s of allSessions) {
    if (s.status === "completed" && s.duration_minutes) {
      const sport = s.sport;
      if (sport in sportMinutes) sportMinutes[sport] += s.duration_minutes;
    }
  }
  const totalMinutes = Object.values(sportMinutes).reduce((a, b) => a + b, 0);
  const completionPct = plannedCount > 0 ? Math.round((completedCount / plannedCount) * 100) : 0;

  // Extract debrief data
  const facts = debrief?.facts as Record<string, unknown> | null;
  const narrative = debrief?.narrative as Record<string, unknown> | null;
  const weekHeadline = (narrative?.executiveSummary as string) ?? "";
  const highlights = (narrative?.highlights as string[]) ?? [];
  const carryForward = (narrative?.carryForward as string[]) ?? [];

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
  const isFeed = format === "feed";
  const isSquare = format === "square";
  const pad = 80;

  // Format-aware truncation
  const summaryLimit = isStory ? 280 : isFeed ? 220 : 180;
  const truncatedSummary = smartTruncate(weekHeadline, summaryLimit);

  // Format-aware content: story shows highlights + carry-forward, feed shows highlights only
  const showHighlights = (isStory || isFeed) && highlights.length > 0;
  const showCarryForward = isStory && carryForward.length > 0;

  // Sports with non-zero minutes for the bar & legend
  const activeSports = (["swim", "bike", "run", "strength"] as const).filter(
    (s) => sportMinutes[s] > 0
  );

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "stretch",
          justifyContent: "center",
          padding: `${pad}px`,
          background: "linear-gradient(180deg, #0c1220 0%, #0a0a0b 100%)",
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          color: "white"
        }}
      >
       <div style={{ display: "flex", flexDirection: "column" }}>
        {/* Brand */}
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <span style={{ fontSize: "28px", fontWeight: 700, color: ACCENT }}>TRI.AI</span>
          {athleteName && (
            <span style={{ fontSize: "20px", color: "rgba(255,255,255,0.35)" }}>{athleteName}</span>
          )}
        </div>

        {/* Week label */}
        <div style={{ marginTop: "20px", fontSize: "28px", fontWeight: 500, color: "rgba(255,255,255,0.4)" }}>
          {weekLabel}
        </div>

        {/* Completion % */}
        <div style={{ marginTop: isStory ? "48px" : "32px", display: "flex", flexDirection: "column" }}>
          <span style={{ fontSize: isStory ? "160px" : isSquare ? "110px" : "120px", fontWeight: 700, color: ACCENT, lineHeight: 1 }}>
            {completionPct}%
          </span>
          <span style={{ fontSize: "26px", fontWeight: 500, color: "rgba(255,255,255,0.35)", marginTop: "8px" }}>
            weekly completion ({completedCount}/{plannedCount} sessions)
          </span>
        </div>

        {/* Sport bars */}
        {totalMinutes > 0 && (
          <div style={{ marginTop: isStory ? "48px" : "32px", display: "flex", flexDirection: "column", gap: "14px" }}>
            <div style={{ display: "flex", height: "28px", borderRadius: "14px", overflow: "hidden", gap: "4px" }}>
              {activeSports.map((sport) => {
                const pct = (sportMinutes[sport] / totalMinutes) * 100;
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
            <div style={{ display: "flex", gap: "28px" }}>
              {activeSports.map((sport) => (
                <div key={sport} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <div style={{ width: "12px", height: "12px", borderRadius: "50%", backgroundColor: SPORT_COLORS[sport] }} />
                  <span style={{ fontSize: "22px", color: "rgba(255,255,255,0.5)" }}>
                    {sport} {formatMinutes(sportMinutes[sport])}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Total hours */}
        <div style={{ marginTop: "24px", display: "flex", alignItems: "center", gap: "32px" }}>
          <span style={{ fontSize: "22px", color: "rgba(255,255,255,0.35)" }}>
            Total: {formatMinutes(totalMinutes)}
          </span>
        </div>

        {/* Training Score — own line for prominence */}
        {scoreRow?.composite_score != null && (
          <div style={{ marginTop: "20px", display: "flex", alignItems: "baseline", gap: "12px" }}>
            <span style={{ fontSize: isSquare ? "28px" : "32px", fontWeight: 700, color: scoreRow.composite_score >= 75 ? "#2dd4bf" : scoreRow.composite_score >= 50 ? "white" : "#fbbf24" }}>
              {Math.round(scoreRow.composite_score)}
            </span>
            <span style={{ fontSize: "20px", color: "rgba(255,255,255,0.35)" }}>Training Score</span>
            {scoreRow.score_delta_7d != null && scoreRow.score_delta_7d !== 0 && (
              <span style={{ fontSize: "20px", fontWeight: 600, color: scoreRow.score_delta_7d > 0 ? "#2dd4bf" : "#f87171" }}>
                {scoreRow.score_delta_7d > 0 ? "+" : ""}{Math.round(scoreRow.score_delta_7d)}
              </span>
            )}
          </div>
        )}

        {/* Executive summary */}
        {truncatedSummary && (
          <div style={{ marginTop: "28px", fontSize: isSquare ? "24px" : "26px", color: "rgba(255,255,255,0.55)", lineHeight: 1.4, maxWidth: "920px" }}>
            {truncatedSummary}
          </div>
        )}

        {/* Highlights — story + feed only */}
        {showHighlights && (
          <div style={{ marginTop: "32px", display: "flex", flexDirection: "column", gap: "14px" }}>
            <span style={{ fontSize: "18px", fontWeight: 600, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "1px" }}>
              Highlights
            </span>
            {highlights.slice(0, 3).map((h, i) => (
              <div key={i} style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}>
                <span style={{ fontSize: "22px", color: ACCENT, flexShrink: 0, marginTop: "2px" }}>•</span>
                <span style={{ fontSize: "22px", color: "rgba(255,255,255,0.5)", lineHeight: 1.35 }}>
                  {smartTruncate(h, isStory ? 140 : 100)}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Carry forward — story only */}
        {showCarryForward && (
          <div style={{ marginTop: "32px", display: "flex", flexDirection: "column", gap: "14px" }}>
            <span style={{ fontSize: "18px", fontWeight: 600, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "1px" }}>
              Focus next week
            </span>
            {carryForward.slice(0, 2).map((c, i) => (
              <div key={i} style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}>
                <span style={{ fontSize: "22px", color: ACCENT, flexShrink: 0, marginTop: "2px" }}>→</span>
                <span style={{ fontSize: "22px", color: "rgba(255,255,255,0.5)", lineHeight: 1.35 }}>
                  {smartTruncate(c, 120)}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Race countdown */}
        {raceName && daysToRace !== null && (
          <div style={{ marginTop: "40px", fontSize: "28px", fontWeight: 700, color: ACCENT, display: "flex" }}>
            <span>{daysToRace} days to {raceName}</span>
          </div>
        )}

        {/* Footer branding */}
        <div style={{ marginTop: "24px", fontSize: "18px", color: "rgba(255,255,255,0.3)" }}>
          Built with tri.ai
        </div>
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
