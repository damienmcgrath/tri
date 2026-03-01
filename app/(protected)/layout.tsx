import { createClient } from "@/lib/supabase/server";
import { signOutAction } from "./actions";
import { GlobalHeader } from "./global-header";
import { MobileBottomTabs, ShellNavRail } from "./shell-nav";

export const dynamic = "force-dynamic";

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

  return (
    <div className="app-shell">
      <GlobalHeader
        raceName={raceName}
        daysToRace={daysToRace}
        account={{
          avatarUrl: profile?.avatar_url ?? null,
          initials,
          displayName,
          email,
          signOutAction
        }}
      />

      <div className="mx-auto grid w-full max-w-[1280px] gap-4 px-4 pb-24 pt-4 md:px-6 lg:grid-cols-[84px_1fr] xl:grid-cols-[250px_1fr] lg:pb-8">
        <aside className="hidden lg:block">
          <div className="surface sticky top-4 space-y-4 p-3 xl:p-4">
            <div className="xl:hidden">
              <ShellNavRail compact />
            </div>
            <div className="hidden xl:block">
              <ShellNavRail />
            </div>
          </div>
        </aside>

        <main className="min-w-0 space-y-4">
          {children}
        </main>
      </div>

      <MobileBottomTabs />
    </div>
  );
}
