import { PageHeader } from "../page-header";
import { CoachChat } from "./coach-chat";

export default function CoachPage() {
  return (
    <section className="space-y-4">
      <PageHeader
        title="Coach"
        objective="Get concise, evidence-linked guidance from your plan and workout data so your next decision is clear and actionable."
        actions={[
          { href: "/dashboard", label: "Review dashboard" },
          { href: "/calendar", label: "Open calendar", variant: "secondary" }
        ]}
      />

      <div className="surface-subtle flex flex-wrap items-center gap-2 px-4 py-3 text-xs">
        <span className="font-semibold uppercase tracking-[0.14em] text-muted">Context strip</span>
        <span className="rounded-full border border-[hsl(var(--border))] px-2 py-1">Week goal: keep key sessions on plan</span>
        <span className="rounded-full border border-[hsl(var(--border))] px-2 py-1">Fatigue: balanced</span>
        <span className="rounded-full border border-[hsl(var(--border))] px-2 py-1">Confidence: building</span>
      </div>

      <CoachChat />
    </section>
  );
}
