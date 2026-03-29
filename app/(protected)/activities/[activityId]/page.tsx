import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loadActivityDetails } from "@/lib/workouts/activity-details";
import { getMetricsV2HrZones, getMetricsV2Laps, getMetricsV2PowerZones, getNestedNumber, getNestedString } from "@/lib/workouts/metrics-v2";
import { ActivityLinkingCard } from "./activity-linking-card";

function SourceBadge({ source, externalProvider, externalActivityId, externalTitle }: {
  source: string;
  externalProvider?: string | null;
  externalActivityId?: string | null;
  externalTitle?: string | null;
}) {
  if (externalProvider === "strava" && externalActivityId) {
    const stravaUrl = `https://www.strava.com/activities/${externalActivityId}`;
    return (
      <a
        href={stravaUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 rounded-full border border-[#FC4C02]/30 bg-[#FC4C02]/10 px-2 py-1 text-[#FC4C02] hover:bg-[#FC4C02]/20 transition-colors"
        title={externalTitle ?? "View on Strava"}
      >
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3" aria-hidden="true">
          <path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169" />
        </svg>
        Strava
      </a>
    );
  }

  if (source === "upload" || source === "fit_upload" || source === "tcx_import") {
    const label = source === "tcx_import" ? "TCX Import" : "FIT Upload";
    return <span className="rounded-full border border-[hsl(var(--border))] px-2 py-1">{label}</span>;
  }

  return <span className="rounded-full border border-[hsl(var(--border))] px-2 py-1">{source}</span>;
}

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

function formatSeconds(seconds?: number | null) {
  if (!seconds || seconds <= 0) return "—";
  const rounded = Math.round(seconds);
  const mins = Math.floor(rounded / 60);
  const secs = rounded % 60;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

function formatOptionalNumber(value?: number | null, suffix = "") {
  if (value === null || typeof value === "undefined") return "—";
  return `${value}${suffix}`;
}

function formatZoneRange(min: number | null | undefined, max: number | null | undefined, unit: string) {
  if (min === null && max === null) return `Open ${unit}`.trim();
  if (min === null || typeof min === "undefined") return `< ${max} ${unit}`.trim();
  if (max === null || typeof max === "undefined") return `>= ${min} ${unit}`.trim();
  return `${min}-${max} ${unit}`;
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

  const laps = getMetricsV2Laps(activity.metrics_v2);
  const powerZones = getMetricsV2PowerZones(activity.metrics_v2);
  const hrZones = getMetricsV2HrZones(activity.metrics_v2);
  const normalizedPower = getNestedNumber(activity.metrics_v2, [["power", "normalizedPower"], ["power", "normalized_power"]]);
  const variabilityIndex = getNestedNumber(activity.metrics_v2, [["power", "variabilityIndex"], ["power", "variability_index"]]);
  const intensityFactor = getNestedNumber(activity.metrics_v2, [["power", "intensityFactor"], ["power", "intensity_factor"]]);
  const trainingStressScore = getNestedNumber(activity.metrics_v2, [["load", "trainingStressScore"], ["load", "training_stress_score"]]);
  const totalWorkKj = getNestedNumber(activity.metrics_v2, [["power", "totalWorkKj"], ["power", "total_work_kj"]]);
  const avgCadence = getNestedNumber(activity.metrics_v2, [["cadence", "avgCadence"], ["cadence", "avg_cadence"]]) ?? activity.avg_cadence;
  const maxCadence = getNestedNumber(activity.metrics_v2, [["cadence", "maxCadence"], ["cadence", "max_cadence"]]);
  const pauseCount = getNestedNumber(activity.metrics_v2, [["pauses", "count"]]);
  const pausedDurationSec = getNestedNumber(activity.metrics_v2, [["pauses", "totalPausedSec"], ["pauses", "total_paused_sec"]]);
  const avgRespirationRate = getNestedNumber(activity.metrics_v2, [["environment", "avgRespirationRate"], ["environment", "avg_respiration_rate"]]);
  const avgTemperature = getNestedNumber(activity.metrics_v2, [["environment", "avgTemperature"], ["environment", "avg_temperature"]]);
  const sportProfileName = getNestedString(activity.metrics_v2, [["activity", "sportProfileName"], ["activity", "sport_profile_name"]]);
  const loadCards = [
    ["Moving", formatDuration(activity.duration_sec)],
    ["Elapsed", activity.elapsed_duration_sec ? formatDuration(activity.elapsed_duration_sec) : "—"],
    ["Distance", formatDistance(activity.distance_m)],
    [activity.sport_type === "bike" ? "Speed" : "Pace", derivePaceOrSpeed(activity.sport_type, activity.duration_sec, activity.distance_m)],
    ["Avg HR", activity.avg_hr ? `${activity.avg_hr} bpm` : "—"],
    ["Avg Power", activity.avg_power ? `${activity.avg_power} w` : "—"],
    ["NP", normalizedPower ? `${Math.round(normalizedPower)} w` : "—"],
    ["VI", variabilityIndex ? variabilityIndex.toFixed(2) : "—"],
    ["IF", intensityFactor ? intensityFactor.toFixed(2) : "—"],
    ["TSS", trainingStressScore ? `${Math.round(trainingStressScore)}` : "—"]
  ];

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
                <div className="mt-2 flex flex-wrap gap-2 text-xs">
                  <SourceBadge source={activity.source} externalProvider={activity.external_provider} externalActivityId={activity.external_activity_id} externalTitle={activity.external_title} />
                  <span className="rounded-full border border-[hsl(var(--border))] px-2 py-1">{linkedSession ? "Linked" : "Unassigned"}</span>
                  {!linkedSession ? <span className="rounded-full border border-[hsl(var(--signal-risk)/0.5)] bg-[hsl(var(--signal-risk)/0.12)] px-2 py-1 text-[hsl(var(--signal-risk))]">Unscheduled</span> : null}
                </div>
                {!linkedSession ? <p className="mt-2 text-xs text-muted">This uploaded activity counts as extra work even without a planned slot.</p> : null}
              </div>
            </div>
          </article>

          <article className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {loadCards.map(([label, value]) => (
              <div key={label} className="surface p-4">
                <p className="text-xs text-muted">{label}</p>
                <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
              </div>
            ))}
          </article>

          <article className="surface p-5">
            <h2 className="text-sm font-semibold">Key details</h2>
            <dl className="mt-3 grid grid-cols-2 gap-2 text-sm lg:grid-cols-3">
              <dt className="text-muted">Start time</dt><dd>{new Date(activity.start_time_utc).toLocaleString()}</dd>
              <dt className="text-muted">End time</dt><dd>{activity.end_time_utc ? new Date(activity.end_time_utc).toLocaleString() : "—"}</dd>
              <dt className="text-muted">Calories</dt><dd>{activity.calories ?? "—"}</dd>
              <dt className="text-muted">Avg cadence</dt><dd>{formatOptionalNumber(avgCadence, " rpm")}</dd>
              <dt className="text-muted">Max cadence</dt><dd>{formatOptionalNumber(maxCadence, " rpm")}</dd>
              <dt className="text-muted">Max HR</dt><dd>{formatOptionalNumber(activity.max_hr, " bpm")}</dd>
              <dt className="text-muted">Max power</dt><dd>{formatOptionalNumber(activity.max_power, " w")}</dd>
              <dt className="text-muted">Total work</dt><dd>{totalWorkKj ? `${totalWorkKj.toFixed(1)} kJ` : "—"}</dd>
              <dt className="text-muted">Pause summary</dt><dd>{pauseCount ? `${pauseCount} stop${pauseCount === 1 ? "" : "s"} · ${formatSeconds(pausedDurationSec)}` : "Continuous"}</dd>
              <dt className="text-muted">Respiration</dt><dd>{avgRespirationRate ? `${avgRespirationRate.toFixed(1)} brpm` : "—"}</dd>
              <dt className="text-muted">Temperature</dt><dd>{avgTemperature ? `${avgTemperature.toFixed(1)}°C` : "—"}</dd>
              <dt className="text-muted">Garmin profile</dt><dd>{sportProfileName ?? "—"}</dd>
            </dl>
          </article>

          {(powerZones.length > 0 || hrZones.length > 0) ? (
            <article className="surface p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">Zone distribution</h2>
                <p className="text-xs text-muted">Source-backed time in zone from Garmin FIT</p>
              </div>
              <div className={`mt-4 grid gap-4 ${powerZones.length > 0 && hrZones.length > 0 ? "lg:grid-cols-2" : ""}`}>
                {powerZones.length > 0 ? (
                  <div>
                    <p className="text-xs uppercase tracking-[0.14em] text-muted">Power</p>
                    <div className="mt-3 space-y-2">
                      {powerZones.map((zone) => (
                        <div key={`power-${zone.zone}`} className="flex items-center justify-between rounded-xl border border-white/10 px-3 py-2 text-sm">
                          <span>Z{zone.zone} · {formatZoneRange(zone.powerMin, zone.powerMax, "w")}</span>
                          <span className="tabular-nums text-muted">{formatSeconds(zone.durationSec)}{zone.pctOfSession !== null ? ` · ${Math.round(zone.pctOfSession * 100)}%` : ""}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
                {hrZones.length > 0 ? (
                  <div>
                    <p className="text-xs uppercase tracking-[0.14em] text-muted">Heart rate</p>
                    <div className="mt-3 space-y-2">
                      {hrZones.map((zone) => (
                        <div key={`hr-${zone.zone}`} className="flex items-center justify-between rounded-xl border border-white/10 px-3 py-2 text-sm">
                          <span>Z{zone.zone} · {formatZoneRange(zone.heartRateMin, zone.heartRateMax, "bpm")}</span>
                          <span className="tabular-nums text-muted">{formatSeconds(zone.durationSec)}{zone.pctOfSession !== null ? ` · ${Math.round(zone.pctOfSession * 100)}%` : ""}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </article>
          ) : null}

          <article className="surface p-5">
            <h2 className="text-sm font-semibold">Splits / intervals</h2>
            {laps.length === 0 ? (
              <p className="mt-3 text-sm text-muted">Splits coming soon.</p>
            ) : (
              <div className="mt-3 overflow-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase text-muted">
                      <th>Lap</th>
                      <th>Time</th>
                      <th>Distance</th>
                      <th>Avg HR</th>
                      <th>Avg Power</th>
                      <th>NP</th>
                      <th>Cadence</th>
                    </tr>
                  </thead>
                  <tbody>{laps.map((lap) => (
                    <tr key={lap.index} className="border-t border-white/10">
                      <td className="py-2">{lap.index}</td>
                      <td>{lap.durationSec ? formatDuration(Math.round(lap.durationSec)) : "—"}</td>
                      <td>{lap.distanceM ? `${(lap.distanceM / 1000).toFixed(2)} km` : "—"}</td>
                      <td>{lap.avgHr ?? "—"}</td>
                      <td>{lap.avgPower ?? "—"}</td>
                      <td>{lap.normalizedPower ?? "—"}</td>
                      <td>{lap.avgCadence ?? "—"}</td>
                    </tr>
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
