/**
 * Phase 3.2 — Training-to-Race Linking card.
 *
 * Renders for each race leg the top training sessions whose execution
 * mirrored race-day capability, plus a separate "warning signs missed"
 * section for key sessions where the athlete attempted race-pace effort
 * but fell short.
 */

import Link from "next/link";
import type {
  TrainingToRaceLinks,
  TrainingLink,
  WarningLink
} from "@/lib/race-review/training-links-schemas";

const LEG_LABELS: Record<"swim" | "bike" | "run", string> = {
  swim: "Swim",
  bike: "Bike",
  run: "Run"
};

function formatDuration(sec: number): string {
  const total = Math.max(0, Math.round(sec));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatDate(d: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC"
  }).format(new Date(`${d.slice(0, 10)}T00:00:00.000Z`));
}

export function TrainingToRaceLinksCard({ links }: { links: TrainingToRaceLinks }) {
  const total = links.perLeg.swim.length + links.perLeg.bike.length + links.perLeg.run.length;
  if (total === 0 && links.warningsMissed.length === 0) return null;

  return (
    <article className="surface p-5">
      <div className="border-b border-[hsl(var(--border))] pb-3">
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-tertiary">
          Training that produced this race
        </p>
        <p className="mt-1 text-xs text-muted">
          The build-cycle sessions ({links.windowWeeks}-week window) that most closely mirror your race-day
          capability — and the warning signs that came earlier.
        </p>
      </div>

      {links.aiNarrative ? (
        <p className="mt-3 text-sm text-[rgba(255,255,255,0.85)]">{links.aiNarrative}</p>
      ) : null}

      {(["swim", "bike", "run"] as const).map((leg) => {
        const items = links.perLeg[leg];
        if (items.length === 0) return null;
        return (
          <section key={leg} className="mt-4">
            <h3 className="text-xs font-medium uppercase tracking-[0.12em] text-tertiary">{LEG_LABELS[leg]}</h3>
            <ul className="mt-2 flex flex-col gap-2">
              {items.map((link) => (
                <TrainingLinkRow key={link.sessionId} link={link} />
              ))}
            </ul>
          </section>
        );
      })}

      {links.warningsMissed.length > 0 ? (
        <section className="mt-5 rounded-md border border-orange-500/20 bg-orange-500/5 p-3">
          <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-orange-300/80">
            Warning signs missed
          </p>
          <ul className="mt-2 flex flex-col gap-2">
            {links.warningsMissed.map((w) => (
              <WarningRow key={w.sessionId} warning={w} />
            ))}
          </ul>
        </section>
      ) : null}
    </article>
  );
}

function TrainingLinkRow({ link }: { link: TrainingLink }) {
  return (
    <li className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Link
          href={`/sessions/${link.sessionId}`}
          className="text-sm font-medium text-[rgba(255,255,255,0.92)] hover:underline"
        >
          {link.sessionName}
        </Link>
        <span className="font-mono text-[11px] text-tertiary">
          {formatDate(link.date)} · {formatDuration(link.durationSec)}
        </span>
      </div>
      <p className="mt-1 text-sm text-[rgba(255,255,255,0.78)]">{link.narrative}</p>
    </li>
  );
}

function WarningRow({ warning }: { warning: WarningLink }) {
  return (
    <li className="flex flex-col gap-1">
      <Link
        href={`/sessions/${warning.sessionId}`}
        className="text-sm font-medium text-orange-200 hover:underline"
      >
        {warning.sessionName}
      </Link>
      <p className="text-xs text-orange-200/80">
        {formatDate(warning.date)} · {warning.observation}
      </p>
    </li>
  );
}
