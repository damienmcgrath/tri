import Link from "next/link";

import { ThemePicker } from "./theme-picker";

export default function SettingsPage() {
  return (
    <section className="space-y-4">
      <header className="surface p-6">
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="mt-1 text-sm text-muted">Manage race targets, account preferences, and integrations.</p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <Link href="/settings/race" className="surface p-5 transition hover:border-[hsl(var(--accent-performance)/0.35)]">
          <p className="text-sm uppercase tracking-[0.16em] text-accent">Race</p>
          <h2 className="mt-2 text-lg font-semibold">Race settings</h2>
          <p className="mt-1 text-sm text-muted">Set your race name and date for dashboard countdown context.</p>
        </Link>

        <Link href="/settings/integrations" className="surface p-5 transition hover:border-[hsl(var(--accent-performance)/0.35)]">
          <p className="text-sm uppercase tracking-[0.16em] text-accent">Integrations</p>
          <h2 className="mt-2 text-lg font-semibold">Garmin import</h2>
          <p className="mt-1 text-sm text-muted">Upload TCX files and review recent ingestion events.</p>
        </Link>
      </div>

      <ThemePicker />
    </section>
  );
}
