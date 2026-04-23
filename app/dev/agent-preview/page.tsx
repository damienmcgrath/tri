import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { AGENT_PREVIEW_COOKIE, isAgentPreviewEnabled } from "@/lib/agent-preview/config";

const previewLinks = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/plan", label: "Plan" },
  { href: "/calendar", label: "Calendar" },
  { href: "/coach", label: "Coach" },
  { href: "/debrief", label: "Debrief" },
  { href: "/settings", label: "Settings" },
  { href: "/settings/race", label: "Race settings" },
  { href: "/settings/integrations", label: "Integrations" },
  { href: "/settings/athlete-context", label: "Athlete context" },
  { href: "/activities/55555555-5555-4555-8555-555555555551", label: "Activity details" },
  { href: "/sessions/77777777-7777-4777-8777-777777777772", label: "Session review" }
];

export default async function AgentPreviewPage() {
  if (!isAgentPreviewEnabled()) {
    notFound();
  }

  const hasSession = (await cookies()).get(AGENT_PREVIEW_COOKIE)?.value === "active";

  return (
    <main className="app-shell">
      <div className="mx-auto flex min-h-screen w-full max-w-[960px] flex-col gap-4 px-4 py-10 md:px-6">
        <section className="surface p-6">
          <p className="label">Agent Preview</p>
          <h1 className="mt-3 text-page-hero">Local UI preview mode</h1>
          <p className="mt-2 max-w-2xl text-body text-muted">
            Use this when agents need a stable authenticated view across the full product without real Supabase sign-in.
          </p>

          <div className="mt-5 flex flex-wrap gap-2">
            <Link href="/dev/agent-login" className="btn-primary">
              {hasSession ? "Refresh preview session" : "Enter preview mode"}
            </Link>
            <Link href="/dev/agent-reset" className="btn-secondary">
              Reset preview data
            </Link>
            <Link href="/dev/agent-logout" className="btn-secondary">
              Exit preview mode
            </Link>
          </div>
        </section>

        <section className="surface p-6">
          <p className="label">Routes</p>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {previewLinks.map((link) => (
              <Link key={link.href} href={link.href} className="rounded-xl border border-[var(--border-default)] px-4 py-3 text-body transition hover:border-[var(--border-accent)] hover:bg-[var(--color-surface-raised)]">
                {link.label}
              </Link>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
