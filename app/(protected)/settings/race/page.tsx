import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { updateRaceSettingsAction } from "../../actions";

type Profile = {
  race_name: string | null;
  race_date: string | null;
};

function isMissingProfilesTable(error: { code?: string; message?: string } | null) {
  if (!error) {
    return false;
  }

  if (error.code === "PGRST205") {
    return true;
  }

  return /could not find the table 'public\.profiles' in the schema cache/i.test(error.message ?? "");
}

export default async function RaceSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const { data, error } = await supabase.from("profiles").select("race_name,race_date").eq("id", user.id).maybeSingle();

  if (error && !isMissingProfilesTable(error)) {
    throw new Error(error.message ?? "Failed to load race settings.");
  }

  const profile = (data ?? null) as Profile | null;
  const metadata = (user.user_metadata ?? {}) as Record<string, unknown>;
  const raceNameFromMetadata = typeof metadata.race_name === "string" ? metadata.race_name : "";
  const raceDateFromMetadata = typeof metadata.race_date === "string" ? metadata.race_date : "";

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
            <input id="raceName" name="raceName" defaultValue={profile?.race_name ?? raceNameFromMetadata} placeholder="Warsaw 70.3" className="input-base mt-1" />
          </div>

          <div>
            <label htmlFor="raceDate" className="label-base">
              Race date
            </label>
            <input id="raceDate" name="raceDate" type="date" defaultValue={profile?.race_date ?? raceDateFromMetadata} className="input-base mt-1" />
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
