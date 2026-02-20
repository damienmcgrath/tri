import { AppShell } from "@/components/app-shell";

export default function DashboardPage() {
  return (
    <AppShell>
      <div className="space-y-6">
        <section>
          <h2 className="text-2xl font-semibold text-slate-900">Dashboard</h2>
          <p className="mt-1 text-slate-600">
            Current-week overview for planned vs completed sessions.
          </p>
        </section>
        <section className="grid gap-4 md:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-cloud p-4">
            <p className="text-sm text-slate-600">Planned Sessions</p>
            <p className="mt-2 text-3xl font-semibold">0</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-cloud p-4">
            <p className="text-sm text-slate-600">Completed</p>
            <p className="mt-2 text-3xl font-semibold text-mint">0</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-cloud p-4">
            <p className="text-sm text-slate-600">Missed</p>
            <p className="mt-2 text-3xl font-semibold text-ember">0</p>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
