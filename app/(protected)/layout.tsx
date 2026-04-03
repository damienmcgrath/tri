import { createClient } from "@/lib/supabase/server";
import { isAgentPreviewEnabled } from "@/lib/agent-preview/config";
import { signOutAction } from "./actions";
import { GlobalHeader } from "./global-header";
import { MobileBottomTabs, ShellNavRail } from "./shell-nav";

export const revalidate = 0;

type Profile = {
  display_name: string | null;
  avatar_url: string | null;
  active_plan_id: string | null;
  race_date: string | null;
  race_name: string | null;
};

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  if (parts.length === 0) return "A";
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("");
}

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  const { data: profileData } = user
    ? await supabase.from("profiles").select("display_name,avatar_url,active_plan_id,race_date,race_name").eq("id", user.id).maybeSingle()
    : { data: null };

  const profile = (profileData ?? null) as Profile | null;
  const displayName = profile?.display_name ?? user?.user_metadata?.full_name ?? user?.email?.split("@")[0] ?? "Athlete";
  const email = user?.email ?? "Unknown user";
  const initials = getInitials(displayName);

  const raceName = profile?.race_name?.trim() || "Target race";
  const daysToRace = profile?.race_date
    ? Math.max(0, Math.ceil((new Date(`${profile.race_date}T00:00:00.000Z`).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : null;
  const previewMode = isAgentPreviewEnabled() && user?.email === "preview@tri.ai";

  return (
    <div className="app-shell">
      <GlobalHeader
        raceName={raceName}
        daysToRace={daysToRace}
        previewMode={previewMode}
        account={{
          avatarUrl: profile?.avatar_url ?? null,
          initials,
          displayName,
          email,
          signOutAction
        }}
      />

      <div className="shell-content-grid mx-auto grid min-h-[calc(100vh-61px)] w-full max-w-[1280px] gap-4 px-4 pt-6 md:px-6 lg:grid-cols-[72px_1fr] lg:gap-6 xl:grid-cols-[220px_1fr]">
        <aside className="hidden lg:block">
          <div className="sticky top-[84px] border-r border-[var(--border-subtle)] bg-transparent pr-4 xl:pr-6">
            <div className="xl:hidden">
              <ShellNavRail compact />
            </div>
            <div className="hidden xl:block">
              <ShellNavRail />
            </div>
          </div>
        </aside>

        <main className="min-w-0 space-y-4">
          {previewMode ? (
            <div className="surface flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div>
                <p className="label">Agent Preview</p>
                <p className="mt-1 text-sm text-muted">You are browsing seeded local data. Reset the workspace whenever you want a clean UI state.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <a href="/dev/agent-reset" className="btn-secondary px-3 py-1.5 text-xs">Reset data</a>
                <a href="/dev/agent-preview" className="btn-secondary px-3 py-1.5 text-xs">Preview guide</a>
              </div>
            </div>
          ) : null}
          {children}
        </main>
      </div>

      <MobileBottomTabs />
    </div>
  );
}
