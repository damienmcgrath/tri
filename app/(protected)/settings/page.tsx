import Link from "next/link";

export default function SettingsPage() {
  return (
    <section className="space-y-4">
      <header className="surface p-6">
        <p className="label">Settings</p>
        <h1 className="mt-3 text-2xl">Settings</h1>
        <p className="mt-2 text-sm text-muted">Manage race targets, athlete context, and integration workflows.</p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <Link href="/settings/race" className="surface p-5 transition hover:border-[var(--border-default)]">
          <p className="label">Race</p>
          <h2 className="mt-3 text-lg">Race settings</h2>
          <p className="mt-1 text-sm text-muted">Set your race name and date for dashboard countdown context.</p>
        </Link>

        <Link href="/settings/integrations" className="surface p-5 transition hover:border-[var(--border-default)]">
          <p className="label">Integrations</p>
          <h2 className="mt-3 text-lg">Integrations &amp; uploads</h2>
          <p className="mt-1 text-sm text-muted">Connect Strava, upload FIT/TCX files, and manage activity data.</p>
        </Link>

        <Link href="/settings/athlete-context" className="surface p-5 transition hover:border-[var(--border-default)]">
          <p className="label">Coach</p>
          <h2 className="mt-3 text-lg">Athlete context</h2>
          <p className="mt-1 text-sm text-muted">Set the durable context Coach should use across reviews, briefs, and chat.</p>
        </Link>
      </div>
    </section>
  );
}
