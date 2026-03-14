import { StatusPill } from "@/components/training/status-pill";

type PlanSessionCue = {
  id: string;
  title: string;
};

export function PlanRationalePanel({
  block,
  objective,
  primaryEmphasis,
  progressionNote,
  coachNotes,
  protectedSessions,
  flexibleSessions,
  optionalSessions
}: {
  block: string;
  objective: string;
  primaryEmphasis: string;
  progressionNote: string;
  coachNotes: string;
  protectedSessions: PlanSessionCue[];
  flexibleSessions: PlanSessionCue[];
  optionalSessions: PlanSessionCue[];
}) {
  return (
    <section className="surface-subtle px-4 py-4">
      <div className="grid gap-3 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle)/0.55)] p-4">
            <p className="text-xs uppercase tracking-[0.14em] text-tertiary">Block</p>
            <p className="mt-2 text-sm font-medium text-[hsl(var(--text-primary))]">{block}</p>
          </div>
          <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle)/0.55)] p-4">
            <p className="text-xs uppercase tracking-[0.14em] text-tertiary">Primary emphasis</p>
            <p className="mt-2 text-sm font-medium text-[hsl(var(--text-primary))]">{primaryEmphasis}</p>
          </div>
          <div className="rounded-2xl border border-[hsl(var(--border))] bg-[linear-gradient(180deg,hsl(var(--surface-subtle)/0.7),hsl(var(--surface-subtle)/0.38))] p-4 md:col-span-2">
            <p className="text-xs uppercase tracking-[0.14em] text-tertiary">Week objective</p>
            <p className="mt-2 text-base font-semibold text-[hsl(var(--text-primary))]">{objective}</p>
            <p className="mt-3 text-xs uppercase tracking-[0.14em] text-tertiary">Progression from last week</p>
            <p className="mt-2 text-sm text-muted">{progressionNote}</p>
          </div>
        </div>

        <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle)/0.5)] p-4">
          <p className="text-xs uppercase tracking-[0.14em] text-tertiary">Coach notes</p>
          <p className="mt-2 text-sm text-muted">{coachNotes}</p>
          <div className="mt-4 space-y-3">
            <RationaleRow title="Protected sessions" tone="attention" label="Protected" sessions={protectedSessions} />
            <RationaleRow title="Flexible sessions" tone="info" label="Flexible" sessions={flexibleSessions} />
            <RationaleRow title="Optional sessions" tone="neutral" label="Optional" sessions={optionalSessions} />
          </div>
        </div>
      </div>
    </section>
  );
}

function RationaleRow({
  title,
  label,
  tone,
  sessions
}: {
  title: string;
  label: string;
  tone: "attention" | "info" | "neutral";
  sessions: PlanSessionCue[];
}) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <p className="text-xs uppercase tracking-[0.14em] text-tertiary">{title}</p>
        <StatusPill label={label} tone={tone} compact />
      </div>
      <p className="mt-2 text-sm text-[hsl(var(--text-primary))]">
        {sessions.length > 0 ? sessions.map((session) => session.title).join(", ") : "None this week."}
      </p>
    </div>
  );
}
