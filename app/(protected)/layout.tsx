import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const navItems = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/plan", label: "Plan" },
  { href: "/calendar", label: "Calendar" },
  { href: "/coach", label: "AI Coach" }
];

export default async function ProtectedLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  return (
    <div className="app-shell">
      <header className="border-b border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))/0.9] backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-4">
          <div>
            <p className="text-lg uppercase tracking-[0.2em] text-cyan-300">tri.ai</p>
          </div>
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
          <div className="text-right text-xs text-[hsl(var(--fg-muted))]">
            <p className="font-medium text-[hsl(var(--fg))]">Signed in</p>
            <p>{user?.email ?? "Unknown user"}</p>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
