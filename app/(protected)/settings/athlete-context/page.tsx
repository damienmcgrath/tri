import Link from "next/link";
import { redirect } from "next/navigation";
import { AthleteContextForm, FtpSection } from "./athlete-context-form";
import { getAthleteContextSnapshot } from "@/lib/athlete-context";
import { createClient } from "@/lib/supabase/server";

export default async function AthleteContextSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  const [snapshot, { data: profileData }] = await Promise.all([
    getAthleteContextSnapshot(supabase, user.id),
    supabase.from("profiles").select("race_name,race_date").eq("id", user.id).maybeSingle()
  ]);

  return (
    <section className="space-y-4">
      <Link href="/settings" className="text-sm text-cyan-300 underline-offset-2 hover:underline">
        ← Back to Settings
      </Link>
      <header className="surface p-6">
        <p className="text-xs uppercase tracking-[0.14em] text-accent">Athlete context</p>
        <h1 className="mt-2 text-2xl font-semibold">Coaching context</h1>
        <p className="mt-1 text-sm text-muted">
          This context feeds every AI coaching response — the more complete, the better.
        </p>
      </header>
      <article className="surface p-6">
        <AthleteContextForm snapshot={snapshot} raceName={profileData?.race_name ?? null} raceDate={profileData?.race_date ?? null} />
      </article>
      <article className="surface p-6">
        <FtpSection initialFtp={snapshot.ftp} />
      </article>
    </section>
  );
}
