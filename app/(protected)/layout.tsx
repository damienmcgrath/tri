import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { signOutAction } from "./actions";

export const dynamic = "force-dynamic";

const navItems = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/plan", label: "Plan" },
  { href: "/calendar", label: "Calendar" },
  { href: "/coach", label: "AI Coach" }
];

type Profile = {
  display_name: string | null;
  avatar_url: string | null;
};

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  if (parts.length === 0) {
    return "A";
  }
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("");
}

export default async function ProtectedLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  const { data: profileData } = user
    ? await supabase.from("profiles").select("display_name,avatar_url").eq("id", user.id).maybeSingle()
    : { data: null };

  const profile = (profileData ?? null) as Profile | null;
  const displayName = profile?.display_name ?? user?.user_metadata?.full_name ?? user?.email?.split("@")[0] ?? "Athlete";
  const email = user?.email ?? "Unknown user";
  const initials = getInitials(displayName);

  return (
    <div className="app-shell">
      <header className="border-b border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))/0.9] backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-4">
          <p className="text-lg uppercase tracking-[0.2em] text-cyan-300">tri.ai</p>
          <nav className="flex flex-wrap gap-2">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-lg px-3 py-2 text-sm font-medium text-[hsl(var(--fg-muted))] transition hover:bg-[hsl(var(--bg-card))] hover:text-[hsl(var(--fg))]"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <details className="group relative">
            <summary aria-label="Open account menu" className="list-none cursor-pointer rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] p-0.5 transition hover:border-cyan-400/50">
              {profile?.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={profile.avatar_url} alt="User avatar" className="h-9 w-9 rounded-full object-cover" />
              ) : (
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-cyan-500/15 text-xs font-semibold text-cyan-200">
                  {initials}
                </span>
              )}
            </summary>

            <div className="absolute right-0 z-20 mt-2 w-64 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))] p-3 shadow-2xl shadow-black/40">
              <div className="border-b border-[hsl(var(--border))] pb-3">
                <p className="text-xs uppercase tracking-[0.15em] text-muted">Account</p>
                <p className="mt-1 text-sm font-semibold text-[hsl(var(--fg))]">{displayName}</p>
                <p className="text-xs text-muted">{email}</p>
              </div>

              <div className="mt-3 space-y-1">
                <Link href="/settings" className="block rounded-lg px-2 py-1.5 text-sm text-[hsl(var(--fg-muted))] hover:bg-[hsl(var(--bg-card))] hover:text-[hsl(var(--fg))]">
                  Account
                </Link>
                <Link href="/settings/race" className="block rounded-lg px-2 py-1.5 text-sm text-[hsl(var(--fg-muted))] hover:bg-[hsl(var(--bg-card))] hover:text-[hsl(var(--fg))]">
                  Race settings
                </Link>
                <Link href="/settings/integrations" className="block rounded-lg px-2 py-1.5 text-sm text-[hsl(var(--fg-muted))] hover:bg-[hsl(var(--bg-card))] hover:text-[hsl(var(--fg))]">
                  Integrations
                </Link>
              </div>

              <form action={signOutAction} className="mt-3 border-t border-[hsl(var(--border))] pt-3">
                <button className="w-full rounded-lg px-2 py-1.5 text-left text-sm text-[hsl(var(--fg-muted))] transition hover:bg-rose-500/10 hover:text-rose-300">
                  Sign out
                </button>
              </form>
            </div>
          </details>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
