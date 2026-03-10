import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loadActivityDetails } from "@/lib/workouts/activity-details";
import { ActivityLinkingCard } from "./activity-linking-card";

function sportIcon(sport: string) {
  if (sport === "run") return "🏃";
  if (sport === "bike") return "🚴";
  if (sport === "swim") return "🏊";
  if (sport === "strength") return "🏋️";
  return "🏅";
}

function formatDuration(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s}s`;
}

function formatDistance(distanceM?: number | null) {
  if (!distanceM) return "—";
  return `${(distanceM / 1000).toFixed(2)} km`;
}

function derivePaceOrSpeed(sport: string, durationSec: number, distanceM: number | null) {
  if (!distanceM || distanceM <= 0) return "—";
  const km = distanceM / 1000;
  const speedKmh = (distanceM / durationSec) * 3.6;
  if (sport === "bike") return `${speedKmh.toFixed(1)} km/h`;
  if (sport === "swim") return `${Math.round((durationSec / distanceM) * 100)}s /100m`;
  return `${Math.floor((durationSec / km) / 60)}:${String(Math.round((durationSec / km) % 60)).padStart(2, "0")} /km`;
}

export default async function ActivityDetailsPage({ params }: { params: { activityId: string } }) {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/sign-in");

  const payload = await loadActivityDetails(params.activityId);
  if (!payload) notFound();

  const { activity, linkedSession, candidates } = payload;
  const dateLabel = new Date(activity.start_time_utc).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });

  const laps = Array.isArray(activity.parse_summary?.laps) ? activity.parse_summary?.laps : [];

  return (
    <section className="space-y-4">
      <Link href="/dashboard" className="text-sm text-cyan-300 underline-offset-2 hover:underline">← Back to Dashboard</Link>

      <div className="grid gap-4 lg:grid-cols-[1.3fr_0.8fr]">
        <div className="space-y-4">
          <article className="surface p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h1 className="text-2xl font-semibold">{sportIcon(activity.sport_type)} Activity</h1>
                <p className="mt-1 text-sm text-muted">{dateLabel}</p>
                <div className="mt-2 flex gap-2 text-xs">
                  <span className="rounded-full border border-[hsl(var(--border))] px-2 py-1">{activity.source === "upload" ? "Garmin upload" : "Synced"}</span>
                  <span className="rounded-full border border-[hsl(var(--border))] px-2 py-1">{linkedSession ? "Linked" : "Unassigned"}</span>
                  {!linkedSession ? <span className="rounded-full border border-[hsl(var(--signal-risk)/0.5)] bg-[hsl(var(--signal-risk)/0.12)] px-2 py-1 text-[hsl(var(--signal-risk))]">Unscheduled</span> : null}
                </div>
                {!linkedSession ? <p className="mt-2 text-xs text-muted">This uploaded activity counts as extra work even without a planned slot.</p> : null}
              </div>
            </div>
          </article>

          <article className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {[
              ["Duration", formatDuration(activity.duration_sec)],
              ["Distance", formatDistance(activity.distance_m)],
              [activity.sport_type === "bike" ? "Speed" : "Pace", derivePaceOrSpeed(activity.sport_type, activity.duration_sec, activity.distance_m)],
              ["Avg HR", activity.avg_hr ? `${activity.avg_hr} bpm` : "—"],
              ["Avg Power", activity.avg_power ? `${activity.avg_power} w` : "—"]
            ].map(([label, value]) => (
              <div key={label} className="surface p-4">
                <p className="text-xs text-muted">{label}</p>
                <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
              </div>
            ))}
          </article>

          <article className="surface p-5">
            <h2 className="text-sm font-semibold">Key details</h2>
            <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <dt className="text-muted">Start time</dt><dd>{new Date(activity.start_time_utc).toLocaleString()}</dd>
              <dt className="text-muted">End time</dt><dd>{activity.end_time_utc ? new Date(activity.end_time_utc).toLocaleString() : "—"}</dd>
              <dt className="text-muted">Calories</dt><dd>{activity.calories ?? "—"}</dd>
            </dl>
          </article>

          <article className="surface p-5">
            <h2 className="text-sm font-semibold">Splits / intervals</h2>
            {laps.length === 0 ? (
              <p className="mt-3 text-sm text-muted">Splits coming soon.</p>
            ) : (
              <div className="mt-3 overflow-auto">
                <table className="min-w-full text-sm">
                  <thead><tr className="text-left text-xs uppercase text-muted"><th>Lap</th><th>Split time</th><th>Distance</th><th>Avg HR</th><th>Avg Power</th></tr></thead>
                  <tbody>{laps.map((lap: any, index: number) => (
                    <tr key={index} className="border-t border-white/10"><td className="py-2">{index + 1}</td><td>{String(lap.duration_sec ?? "—")}</td><td>{lap.distance_m ? `${(Number(lap.distance_m) / 1000).toFixed(2)} km` : "—"}</td><td>{lap.avg_hr ?? "—"}</td><td>{lap.avg_power ?? "—"}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </article>
        </div>

        <ActivityLinkingCard
          activityId={activity.id}
          linkedSession={linkedSession}
          candidates={candidates}
          isRace={activity.is_race}
          initialNotes={activity.notes}
          isUnplanned={activity.is_unplanned}
        />
      </div>
    </section>
  );
}
