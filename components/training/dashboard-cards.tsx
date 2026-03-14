import Link from "next/link";
import { StatusPill } from "@/components/training/status-pill";
import { WEEK_RISK_META, type WeekRiskState } from "@/lib/training/semantics";

export function WeekRiskCard({
  risk,
  summary,
  detail
}: {
  risk: WeekRiskState;
  summary: string;
  detail: string;
}) {
  const meta = WEEK_RISK_META[risk];

  return (
    <div className="mt-4 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle)/0.78)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.14em] text-tertiary">Week risk</p>
          <p className="mt-2 text-base font-semibold text-[hsl(var(--text-primary))]">{summary}</p>
          <p className="mt-2 text-sm text-muted">{detail}</p>
        </div>
        <StatusPill label={meta.label} tone={meta.tone} icon={meta.icon} />
      </div>
    </div>
  );
}

export function WeeklyInterventionCard({
  title,
  statusLine,
  why,
  recommendedAction,
  impactIfIgnored,
  href
}: {
  title: string;
  statusLine: string;
  why: string;
  recommendedAction: string;
  impactIfIgnored: string;
  href?: string;
}) {
  return (
    <article className="surface p-5 md:p-6">
      <p className="text-[11px] uppercase tracking-[0.14em] text-accent">{title}</p>
      <h3 className="mt-2 text-lg font-semibold">{statusLine}</h3>
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.14em] text-tertiary">Why this matters</p>
          <p className="mt-2 text-sm text-muted">{why}</p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-[0.14em] text-tertiary">Recommended action</p>
          <p className="mt-2 text-sm text-[hsl(var(--text-primary))]">{recommendedAction}</p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-[0.14em] text-tertiary">Impact if ignored</p>
          <p className="mt-2 text-sm text-muted">{impactIfIgnored}</p>
        </div>
      </div>
      {href ? (
        <div className="mt-4">
          <Link href={href} className="btn-secondary px-3 py-1.5 text-xs">
            Open Calendar
          </Link>
        </div>
      ) : null}
    </article>
  );
}
