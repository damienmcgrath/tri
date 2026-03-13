import Link from "next/link";
import { redirect } from "next/navigation";
import { AthleteContextForm } from "./athlete-context-form";
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

  const snapshot = await getAthleteContextSnapshot(supabase, user.id);

  return (
    <section className="space-y-4">
      <Link href="/settings" className="text-sm text-cyan-300 underline-offset-2 hover:underline">← Back to Settings</Link>
      <header className="surface p-6">
        <p className="text-xs uppercase tracking-[0.14em] text-accent">Athlete context</p>
        <h1 className="mt-2 text-2xl font-semibold">Coaching context</h1>
        <p className="mt-1 text-sm text-muted">This is the durable context shared by Session Review, Coach Briefing, and Coach Chat.</p>
      </header>
      <article className="surface p-6">
        <AthleteContextForm snapshot={snapshot} />
      </article>
    </section>
  );
}
