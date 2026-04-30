import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loadRaceBundleSummary } from "@/lib/race/bundle-helpers";
import { loadPriorRaceCandidates } from "@/lib/race-review/comparison";

export const dynamic = "force-dynamic";

function formatDuration(sec: number): string {
  const total = Math.max(0, Math.round(sec));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatDate(dateStr: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC"
  }).format(new Date(`${dateStr}T00:00:00.000Z`));
}

export default async function ComparePickerPage({
  params
}: {
  params: Promise<{ bundleId: string }>;
}) {
  const { bundleId } = await params;
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/auth/sign-in?redirectTo=${encodeURIComponent(`/races/${bundleId}/compare`)}`);
  }

  const summary = await loadRaceBundleSummary(supabase, user.id, bundleId);
  if (!summary) notFound();

  const candidates = await loadPriorRaceCandidates(supabase, user.id, bundleId);

  const thisFinish = summary.bundle.total_duration_sec;
  const distanceLabel = summary.raceProfile?.distance_type ?? "race";

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-4 md:p-6">
      <header className="flex flex-col gap-2">
        <Link
          href={`/races/${bundleId}`}
          className="text-xs text-tertiary underline-offset-2 hover:underline"
        >
          ← Back to race
        </Link>
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-tertiary">Compare</p>
        <h1 className="text-2xl font-semibold text-[rgba(255,255,255,0.92)]">
          Compare {summary.raceProfile?.name ?? "this race"} to a prior race
        </h1>
        <p className="text-sm text-muted">
          Showing prior races at the same distance ({distanceLabel}). Pick one to see per-leg deltas
          and a progression narrative.
        </p>
      </header>

      {candidates.length === 0 ? (
        <article className="surface p-5">
          <p className="text-sm text-muted">
            No prior races at this distance yet. Once you log another {distanceLabel}, comparisons appear here.
          </p>
        </article>
      ) : (
        <ul className="flex flex-col gap-2">
          {candidates.map((c) => {
            const finishDelta = thisFinish - c.finishSec;
            const sign = finishDelta < 0 ? "−" : "+";
            const colorClass =
              finishDelta < 0
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                : "border-orange-500/30 bg-orange-500/10 text-orange-300";
            return (
              <li key={c.bundleId}>
                <Link
                  href={`/races/${bundleId}/compare/${c.bundleId}`}
                  className="surface flex items-center justify-between gap-4 p-4 transition hover:border-[hsl(var(--border-strong))]"
                >
                  <div className="flex flex-col gap-1">
                    <span className="text-sm font-medium text-[rgba(255,255,255,0.9)]">
                      {c.name ?? `Race on ${formatDate(c.date)}`}
                    </span>
                    <span className="text-xs text-tertiary">
                      {formatDate(c.date)}
                      {c.distanceType ? <> · <span className="capitalize">{c.distanceType}</span></> : null}
                      {" · "}
                      <span className="font-mono">{formatDuration(c.finishSec)}</span>
                    </span>
                  </div>
                  <span className={`rounded-full border px-2 py-0.5 font-mono text-xs ${colorClass}`}>
                    {sign}
                    {formatDuration(Math.abs(finishDelta))}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
