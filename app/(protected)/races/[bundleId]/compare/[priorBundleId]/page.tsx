import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  getOrGenerateRaceComparison
} from "@/lib/race-review/comparison";
import type {
  ComparisonPayload,
  LegDelta,
  ProgressionNarrative
} from "@/lib/race-review/comparison-schemas";

export const dynamic = "force-dynamic";

function formatDuration(sec: number): string {
  const total = Math.max(0, Math.round(sec));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatSignedDuration(sec: number): string {
  const sign = sec < 0 ? "−" : "+";
  return `${sign}${formatDuration(Math.abs(sec))}`;
}

function formatDate(dateStr: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC"
  }).format(new Date(`${dateStr}T00:00:00.000Z`));
}

export default async function RaceComparisonPage({
  params
}: {
  params: Promise<{ bundleId: string; priorBundleId: string }>;
}) {
  const { bundleId, priorBundleId } = await params;
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/auth/sign-in?redirectTo=${encodeURIComponent(`/races/${bundleId}/compare/${priorBundleId}`)}`);
  }

  const result = await getOrGenerateRaceComparison({
    supabase,
    userId: user.id,
    bundleId,
    priorBundleId
  });

  if (result.status !== "ok") {
    if (result.reason === "bundle_not_found") notFound();
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 p-4 md:p-6">
        <Link href={`/races/${bundleId}/compare`} className="text-xs text-tertiary underline-offset-2 hover:underline">
          ← Back to picker
        </Link>
        <article className="surface p-5">
          <p className="text-sm text-muted">
            {result.reason === "incompatible_distance"
              ? "These two races have different distance types. Comparisons require the same distance."
              : `Comparison unavailable: ${result.reason}`}
          </p>
        </article>
      </div>
    );
  }

  const { payload, narrative } = result;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 p-4 md:p-6">
      <header className="flex flex-col gap-2">
        <Link href={`/races/${bundleId}`} className="text-xs text-tertiary underline-offset-2 hover:underline">
          ← Back to race
        </Link>
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-tertiary">Race-to-Race</p>
        <h1 className="text-2xl font-semibold text-[rgba(255,255,255,0.92)]">
          {payload.thisRace.name ?? formatDate(payload.thisRace.date)}
          {" vs "}
          {payload.priorRace.name ?? formatDate(payload.priorRace.date)}
        </h1>
      </header>

      <FinishHeader payload={payload} />

      <PerLegGrid payload={payload} />

      <PreRaceStateRow payload={payload} />

      <ProgressionCard narrative={narrative} />
    </div>
  );
}

function FinishHeader({ payload }: { payload: ComparisonPayload }) {
  const improved = payload.finishDeltaSec < 0;
  const colorClass = improved
    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
    : "border-orange-500/30 bg-orange-500/10 text-orange-300";

  return (
    <article className="surface p-5">
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-tertiary">Finish time</p>
      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
        <RaceFinishCell label="This race" race={payload.thisRace} />
        <div className="flex items-center justify-center">
          <span className={`rounded-full border px-3 py-1 font-mono text-base ${colorClass}`}>
            {formatSignedDuration(payload.finishDeltaSec)}
          </span>
        </div>
        <RaceFinishCell label="Prior" race={payload.priorRace} />
      </div>
    </article>
  );
}

function RaceFinishCell({
  label,
  race
}: {
  label: string;
  race: ComparisonPayload["thisRace"];
}) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-[10px] uppercase tracking-[0.12em] text-tertiary">{label}</p>
      <p className="font-mono text-2xl font-semibold text-[rgba(255,255,255,0.96)]">
        {formatDuration(race.finishSec)}
      </p>
      <p className="text-xs text-muted">
        {race.name ?? formatDate(race.date)} · {formatDate(race.date)}
      </p>
    </div>
  );
}

function PerLegGrid({ payload }: { payload: ComparisonPayload }) {
  const rows: Array<{ key: "swim" | "bike" | "run"; label: string }> = [
    { key: "swim", label: "Swim" },
    { key: "bike", label: "Bike" },
    { key: "run", label: "Run" }
  ];

  return (
    <article className="surface p-5">
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-tertiary">Per-leg deltas</p>
      <div className="mt-3 flex flex-col gap-3">
        {rows.map((row) => (
          <LegDeltaRow key={row.key} label={row.label} discipline={row.key} delta={payload.perLeg[row.key]} />
        ))}
        <TransitionsRow payload={payload} />
      </div>
    </article>
  );
}

function LegDeltaRow({
  label,
  discipline,
  delta
}: {
  label: string;
  discipline: "swim" | "bike" | "run";
  delta: LegDelta | null;
}) {
  if (!delta) {
    return (
      <div className="flex items-center justify-between border-t border-[hsl(var(--border))] pt-3 first:border-t-0 first:pt-0">
        <span className="text-sm text-[rgba(255,255,255,0.85)]">{label}</span>
        <span className="text-xs text-tertiary">No comparable leg data</span>
      </div>
    );
  }
  const dur = delta.durationDeltaSec;
  const durColor =
    dur === 0
      ? "text-tertiary"
      : dur < 0
      ? "text-emerald-300"
      : "text-orange-300";

  return (
    <div className="grid grid-cols-2 items-center gap-2 border-t border-[hsl(var(--border))] pt-3 first:border-t-0 first:pt-0 md:grid-cols-4">
      <span className="text-sm text-[rgba(255,255,255,0.85)]">{label}</span>
      <span className="font-mono text-sm text-muted">
        {formatDuration(delta.thisDurationSec)} <span className="text-tertiary">vs</span>{" "}
        {formatDuration(delta.priorDurationSec)}
      </span>
      <span className={`font-mono text-sm ${durColor}`}>{formatSignedDuration(dur)}</span>
      <span className="font-mono text-xs text-tertiary">
        {discipline === "bike" && delta.npDelta != null
          ? `${delta.npDelta >= 0 ? "+" : ""}${delta.npDelta}W NP`
          : discipline !== "bike" && delta.paceDelta != null
          ? `${delta.paceDelta >= 0 ? "+" : ""}${Math.round(delta.paceDelta)}s ${discipline === "swim" ? "/100m" : "/km"}`
          : delta.avgHrDelta != null
          ? `${delta.avgHrDelta >= 0 ? "+" : ""}${delta.avgHrDelta}bpm`
          : "—"}
      </span>
    </div>
  );
}

function TransitionsRow({ payload }: { payload: ComparisonPayload }) {
  const t1 = payload.transitionsDelta.t1Sec;
  const t2 = payload.transitionsDelta.t2Sec;
  if (t1 == null && t2 == null) return null;
  return (
    <div className="grid grid-cols-2 items-center gap-2 border-t border-[hsl(var(--border))] pt-3 md:grid-cols-4">
      <span className="text-sm text-[rgba(255,255,255,0.85)]">Transitions</span>
      <span className="font-mono text-xs text-tertiary">
        T1 {t1 == null ? "—" : formatSignedDuration(t1)}
      </span>
      <span className="font-mono text-xs text-tertiary">
        T2 {t2 == null ? "—" : formatSignedDuration(t2)}
      </span>
      <span />
    </div>
  );
}

function PreRaceStateRow({ payload }: { payload: ComparisonPayload }) {
  const { ctl, atl, tsb, taperCompliance } = payload.preRaceStateDelta;
  if (ctl == null && atl == null && tsb == null && taperCompliance == null) return null;
  const items: Array<{ label: string; value: number | null; suffix?: string }> = [
    { label: "ΔCTL", value: ctl },
    { label: "ΔATL", value: atl },
    { label: "ΔTSB", value: tsb },
    { label: "ΔTaper", value: taperCompliance != null ? Math.round(taperCompliance * 100) : null, suffix: "pts" }
  ];

  return (
    <article className="surface p-5">
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-tertiary">Pre-race state delta</p>
      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
        {items.map((item) => (
          <div key={item.label} className="flex flex-col">
            <dt className="text-[10px] uppercase tracking-[0.12em] text-tertiary">{item.label}</dt>
            <dd className="font-mono text-base text-[rgba(255,255,255,0.92)]">
              {item.value == null
                ? "—"
                : `${item.value > 0 ? "+" : ""}${item.value}${item.suffix ?? ""}`}
            </dd>
          </div>
        ))}
      </dl>
    </article>
  );
}

function ProgressionCard({ narrative }: { narrative: ProgressionNarrative }) {
  return (
    <article className="surface p-5">
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-tertiary">Progression</p>
      <h2 className="mt-2 text-lg font-semibold text-[rgba(255,255,255,0.92)]">
        {narrative.headline}
      </h2>
      <p className="mt-2 text-sm text-muted">{narrative.netDelta}</p>
      <div className="mt-3 flex flex-col gap-2 text-sm text-[rgba(255,255,255,0.85)]">
        {(["swim", "bike", "run"] as const).map((leg) =>
          narrative.perDiscipline[leg] ? (
            <p key={leg}>{narrative.perDiscipline[leg]}</p>
          ) : null
        )}
      </div>
      {narrative.emergedThemes.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-1 text-xs text-tertiary">
          {narrative.emergedThemes.map((t) => (
            <li key={t}>· {t}</li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}
