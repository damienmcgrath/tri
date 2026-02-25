import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { signOutAction } from "./actions";
import { AccountMenu } from "./account-menu";
import { MobileBottomTabs, ShellNavRail } from "./shell-nav";

export const dynamic = "force-dynamic";

type Profile = {
  display_name: string | null;
  avatar_url: string | null;
  active_plan_id: string | null;
  race_date: string | null;
  race_name: string | null;
};

type Session = {
  date: string;
  sport: string;
  type: string | null;
  duration_minutes: number | null;
  status: "planned" | "completed" | "skipped";
};

type TrainingWeek = {
  week_index: number;
  focus: "Build" | "Recovery" | "Taper" | "Race" | "Custom";
  week_start_date: string;
  target_minutes: number | null;
};

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  if (parts.length === 0) return "A";
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("");
}

function getMonday(date = new Date()) {
  const day = date.getUTCDay();
  const distanceFromMonday = day === 0 ? 6 : day - 1;
  const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() - distanceFromMonday);
  return monday;
}

function addDays(isoDate: string, days: number) {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
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
    ? await supabase.from("profiles").select("display_name,avatar_url,active_plan_id,race_date,race_name").eq("id", user.id).maybeSingle()
    : { data: null };

  const profile = (profileData ?? null) as Profile | null;
  const displayName = profile?.display_name ?? user?.user_metadata?.full_name ?? user?.email?.split("@")[0] ?? "Athlete";
  const email = user?.email ?? "Unknown user";
  const initials = getInitials(displayName);

  const currentWeekStart = getMonday().toISOString().slice(0, 10);
  const currentWeekEnd = addDays(currentWeekStart, 7);
  const previousWeekStart = addDays(currentWeekStart, -7);

  const activePlanId = profile?.active_plan_id ?? null;

  const [{ data: weekData }, { data: sessionsData }, { data: previousWeekSessionsData }] = activePlanId
    ? await Promise.all([
        supabase
          .from("training_weeks")
          .select("week_index,focus,week_start_date,target_minutes")
          .eq("plan_id", activePlanId)
          .lte("week_start_date", currentWeekStart)
          .order("week_start_date", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("sessions")
          .select("date,sport,type,duration_minutes,status")
          .eq("plan_id", activePlanId)
          .gte("date", currentWeekStart)
          .lt("date", currentWeekEnd),
        supabase
          .from("sessions")
          .select("duration_minutes,status")
          .eq("plan_id", activePlanId)
          .gte("date", previousWeekStart)
          .lt("date", currentWeekStart)
      ])
    : [{ data: null }, { data: [] }, { data: [] }];

  const weekContext = (weekData ?? null) as TrainingWeek | null;
  const sessions = (sessionsData ?? []) as Session[];
  const previousWeekSessions = (previousWeekSessionsData ?? []) as Array<Pick<Session, "duration_minutes" | "status">>;

  const plannedMinutes = sessions.reduce((sum, session) => sum + (session.duration_minutes ?? 0), 0);
  const completedMinutes = sessions
    .filter((session) => session.status === "completed")
    .reduce((sum, session) => sum + (session.duration_minutes ?? 0), 0);
  const completionRate = plannedMinutes > 0 ? Math.round((completedMinutes / plannedMinutes) * 100) : 0;
  const previousWeekPlannedMinutes = previousWeekSessions.reduce((sum, session) => sum + (session.duration_minutes ?? 0), 0);
  const previousWeekCompletedMinutes = previousWeekSessions
    .filter((session) => session.status === "completed")
    .reduce((sum, session) => sum + (session.duration_minutes ?? 0), 0);
  const previousCompletionRate = previousWeekPlannedMinutes > 0 ? Math.round((previousWeekCompletedMinutes / previousWeekPlannedMinutes) * 100) : 0;
  const completionDelta = completionRate - previousCompletionRate;

  const trendDirection = completionDelta >= 8 ? "improving" : completionDelta <= -8 ? "declining" : "stable";
  const trendLabel = trendDirection === "improving" ? "Improving" : trendDirection === "declining" ? "Declining" : "Stable";

  const readiness = completionRate >= 70 ? "Ready" : completionRate >= 40 ? "Building" : "Needs focus";
  const readinessClass = completionRate >= 70 ? "signal-ready" : completionRate >= 40 ? "signal-load" : "signal-risk";

  const daysToRace = profile?.race_date
    ? Math.max(0, Math.ceil((new Date(`${profile.race_date}T00:00:00.000Z`).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : null;

  const todayIso = new Date().toISOString().slice(0, 10);
  const nextKeySession = sessions
    .filter((session) => session.status === "planned" && session.date >= todayIso)
    .sort((a, b) => a.date.localeCompare(b.date))[0] ?? null;

  const nextKeySessionLabel = nextKeySession
    ? `${nextKeySession.sport}${nextKeySession.type ? ` · ${nextKeySession.type}` : ""} · ${nextKeySession.duration_minutes ?? 0} min`
    : "No planned key session";

  return (
    <div className="app-shell">
      <div className={`shell-header border-b border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))/0.95] backdrop-blur shell-header--${trendDirection}`}>
        <div className="mx-auto flex w-full max-w-[1200px] flex-wrap items-center justify-between gap-3 px-4 py-3 md:px-6">
          <p className="text-sm uppercase tracking-[0.2em] text-accent">tri.ai</p>
          <div className="flex items-center gap-2">
            <span className={`signal-chip ${readinessClass}`}>Readiness: {readiness}</span>
            <span className="signal-chip signal-recovery">
              Race: {daysToRace !== null ? `${daysToRace}d` : "set date"}
            </span>
            <span className="signal-chip signal-load">Week: {completionRate}% complete</span>
          </div>
          <AccountMenu avatarUrl={profile?.avatar_url ?? null} initials={initials} displayName={displayName} email={email} signOutAction={signOutAction} />
        </div>

        <div className="mx-auto w-full max-w-[1200px] px-4 pb-3 md:px-6 lg:hidden">
          <p className="inline-flex max-w-full items-center gap-2 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))/0.9] px-3 py-1 text-xs text-muted">
            <span className="font-semibold text-[hsl(var(--fg))]">{completionRate}% complete</span>
            <span>·</span>
            <span className="truncate">{nextKeySession ? `Next ${nextKeySession.sport}` : "No next key session"}</span>
            {daysToRace !== null ? (
              <>
                <span>·</span>
                <span>Race {daysToRace}d</span>
              </>
            ) : null}
          </p>
        </div>
      </div>

      <div className="mx-auto grid w-full max-w-[1200px] gap-4 px-4 pb-24 pt-5 md:px-6 lg:grid-cols-[260px_1fr] lg:pb-8">
        <aside className="hidden lg:block">
          <div className="surface sticky top-5 space-y-5 p-4">
            <div>
              <p className="text-xs uppercase tracking-[0.16em] text-accent">Primary nav</p>
              <div className="mt-2">
                <ShellNavRail />
              </div>

              <div className="surface-subtle mt-3 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs uppercase tracking-[0.14em] text-muted">Weekly progress</p>
                  <span className={`signal-chip ${readinessClass}`}>{trendLabel}</span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[hsl(var(--bg-elevated))]">
                  <div className="h-full rounded-full bg-[hsl(var(--accent-performance))]" style={{ width: `${completionRate}%` }} />
                </div>
                <p className="mt-2 text-sm font-semibold">{completionRate}% completion</p>
                <p className="mt-1 text-xs text-muted">Next key: {nextKeySessionLabel}</p>
                {daysToRace !== null ? <p className="mt-1 text-xs text-muted">Race countdown: {daysToRace} days</p> : null}
              </div>
            </div>

            <div className="surface-subtle p-3">
              <p className="text-xs uppercase tracking-[0.14em] text-muted">Training week</p>
              {weekContext ? (
                <>
                  <p className="mt-2 text-sm font-semibold">Week {weekContext.week_index} · {weekContext.focus}</p>
                  <p className="mt-1 text-xs text-muted">Starts {weekContext.week_start_date}</p>
                  <p className="mt-1 text-xs text-muted">
                    Target: {weekContext.target_minutes ? `${weekContext.target_minutes} min` : "not set"}
                  </p>
                </>
              ) : (
                <p className="mt-2 text-sm text-muted">Create or activate a plan to see week context.</p>
              )}
              <Link href="/plan" className="mt-3 inline-flex text-xs text-accent underline">Manage plan</Link>
            </div>
          </div>
        </aside>

        <main className="min-w-0 space-y-4">{children}</main>
      </div>

      <MobileBottomTabs />
    </div>
  );
}
