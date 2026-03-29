import { createClient } from "@/lib/supabase/server";
import { addDays } from "../../week-context";
import { getWeeklyDebriefSnapshot, refreshWeeklyDebrief } from "@/lib/weekly-debrief";
import { localIsoDate } from "@/lib/activities/completed-activities";
import { DebriefRefreshButton } from "../debrief-refresh-button";

export default async function CoachDebriefPage({
  searchParams
}: {
  searchParams?: { weekStart?: string };
}) {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const timeZone =
    (user.user_metadata && typeof user.user_metadata.timezone === "string" && user.user_metadata.timezone) ||
    Intl.DateTimeFormat().resolvedOptions().timeZone ||
    "UTC";
  const todayIso = localIsoDate(new Date().toISOString(), timeZone);
  const currentWeekStart = addDays(todayIso, 0 - ((new Date(`${todayIso}T00:00:00.000Z`).getUTCDay() + 6) % 7));
  const requestedWeekStart = searchParams?.weekStart;
  const weekStart = requestedWeekStart && /^\d{4}-\d{2}-\d{2}$/.test(requestedWeekStart) ? requestedWeekStart : currentWeekStart;

  let snapshot = await getWeeklyDebriefSnapshot({
    supabase,
    athleteId: user.id,
    weekStart,
    timeZone,
    todayIso
  });

  if (snapshot.readiness.isReady && !snapshot.artifact) {
    const refreshed = await refreshWeeklyDebrief({
      supabase,
      athleteId: user.id,
      weekStart,
      timeZone,
      todayIso
    });
    snapshot = {
      readiness: refreshed.readiness,
      artifact: refreshed.artifact,
      stale: false,
      sourceUpdatedAt: refreshed.artifact?.sourceUpdatedAt ?? snapshot.sourceUpdatedAt,
      weekStart,
      weekEnd: addDays(weekStart, 6)
    };
  }

  if (snapshot.artifact && snapshot.stale) {
    const refreshed = await refreshWeeklyDebrief({
      supabase,
      athleteId: user.id,
      weekStart,
      timeZone,
      todayIso
    });
    snapshot = {
      readiness: refreshed.readiness,
      artifact: refreshed.artifact,
      stale: false,
      sourceUpdatedAt: refreshed.artifact?.sourceUpdatedAt ?? snapshot.sourceUpdatedAt,
      weekStart,
      weekEnd: addDays(weekStart, 6)
    };
  }

  if (!snapshot.readiness.isReady || !snapshot.artifact) {
    return (
      <section className="space-y-4">
        <article className="surface p-5">
          <p className="label">Coach-share view</p>
          <h1 className="mt-1 text-2xl font-semibold">Weekly Debrief isn’t ready yet</h1>
          <p className="mt-2 text-sm text-muted">{snapshot.readiness.reason}</p>
          <div className="mt-4">
            <a href={`/debrief?weekStart=${weekStart}`} className="btn-secondary px-3 py-1.5 text-xs">
              Open full debrief
            </a>
          </div>
        </article>
      </section>
    );
  }

  const artifact = snapshot.artifact;

  return (
    <section className="space-y-4">
      <article className="surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="label">Coach-share view</p>
            <h1 className="mt-1 text-3xl font-semibold">{artifact.coachShare.headline}</h1>
            <p className="mt-2 text-sm text-muted">{artifact.facts.weekRange}</p>
            <p className="mt-3 max-w-3xl text-sm text-primary">{artifact.coachShare.summary}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a href={`/debrief?weekStart=${artifact.weekStart}`} className="btn-secondary px-3 py-1.5 text-xs">
              Full debrief
            </a>
            <DebriefRefreshButton weekStart={artifact.weekStart} label="Refresh brief" />
          </div>
        </div>
      </article>

      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <article className="surface p-5">
          <p className="text-[10px] uppercase tracking-[0.14em] text-tertiary">Core metrics</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {artifact.facts.metrics.slice(0, 4).map((metric) => (
              <div key={metric.label} className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-4">
                <p className="text-[10px] uppercase tracking-[0.14em] text-tertiary">{metric.label}</p>
                <p className="mt-2 text-base font-semibold text-primary">{metric.value}</p>
              </div>
            ))}
          </div>
        </article>

        <article className="surface p-5">
          <p className="text-[10px] uppercase tracking-[0.14em] text-tertiary">Carry-forward focus</p>
          <div className="mt-4 space-y-3">
            {artifact.coachShare.carryForward.map((item) => (
              <div key={item} className="rounded-2xl border border-[hsl(var(--accent)/0.32)] bg-[hsl(var(--accent)/0.08)] p-4">
                <p className="text-sm font-medium text-primary">{item}</p>
              </div>
            ))}
          </div>
        </article>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <article className="surface p-5">
          <p className="text-[10px] uppercase tracking-[0.14em] text-tertiary">Key wins</p>
          <div className="mt-4 space-y-3">
            {artifact.coachShare.wins.map((item) => (
              <div key={item} className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-4">
                <p className="text-sm text-primary">{item}</p>
              </div>
            ))}
          </div>
        </article>

        <article className="surface p-5">
          <p className="text-[10px] uppercase tracking-[0.14em] text-tertiary">Key concerns</p>
          <div className="mt-4 space-y-3">
            {artifact.coachShare.concerns.map((item) => (
              <div key={item} className="rounded-2xl border border-[hsl(var(--warning)/0.28)] bg-[hsl(var(--warning)/0.08)] p-4">
                <p className="text-sm text-primary">{item}</p>
              </div>
            ))}
          </div>
        </article>
      </div>

      <article className="surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.14em] text-tertiary">Relevant sessions</p>
            <p className="mt-2 text-sm text-muted">Use these links to inspect the sessions or uploaded activities behind the brief.</p>
          </div>
          {snapshot.stale ? <p className="text-xs text-tertiary">Supporting data changed after this save.</p> : null}
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {artifact.evidence.slice(0, 8).map((item) => (
            <a key={`${item.kind}-${item.id}`} href={item.href} className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-4 transition hover:border-[hsl(var(--accent)/0.42)]">
              <p className="text-sm font-semibold text-primary">{item.label}</p>
              <p className="mt-2 text-sm text-muted">{item.detail}</p>
            </a>
          ))}
        </div>
      </article>
    </section>
  );
}
