import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { updateRaceSettingsAction } from "../../actions";

type Profile = {
  race_name: string | null;
  race_date: string | null;
};

export default async function RaceSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const { data } = await supabase.from("profiles").select("race_name,race_date").eq("id", user.id).maybeSingle();
  const profile = (data ?? null) as Profile | null;

  return (
    <section className="space-y-4">
      <header className="surface p-6">
        <p className="text-xs uppercase tracking-[0.16em] text-cyan-300">Settings</p>
        <h1 className="mt-2 text-2xl font-semibold">Race settings</h1>
        <p className="mt-1 text-sm text-muted">Set your target race so tri.ai can keep your countdown visible on dashboard.</p>
      </header>

      <article className="surface p-5">
        <form action={updateRaceSettingsAction} className="grid gap-3 md:max-w-lg">
          <div>
            <label htmlFor="raceName" className="label-base">
              Race name
            </label>
            <input id="raceName" name="raceName" defaultValue={profile?.race_name ?? ""} placeholder="Warsaw 70.3" className="input-base mt-1" />
          </div>

          <div>
            <label htmlFor="raceDate" className="label-base">
              Race date
            </label>
            <input id="raceDate" name="raceDate" type="date" defaultValue={profile?.race_date ?? ""} className="input-base mt-1" />
          </div>

          <div className="flex gap-2">
            <button className="btn-primary">Save race settings</button>
            <Link href="/dashboard" className="btn-secondary">
              Back to dashboard
            </Link>
          </div>
        </form>
      </article>
    </section>
  );
}
