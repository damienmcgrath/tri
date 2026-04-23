import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { updateRaceSettingsAction } from "../../actions";
import { RaceProfileList } from "./race-profile-list";

type Profile = {
  race_name: string | null;
  race_date: string | null;
};

type RaceProfileRow = {
  id: string;
  name: string;
  date: string;
  distance_type: string;
  priority: string;
  notes: string | null;
};

function isMissingProfilesTable(error: { code?: string; message?: string } | null) {
  if (!error) return false;
  if (error.code === "PGRST205") return true;
  return /could not find the table 'public\.profiles' in the schema cache/i.test(error.message ?? "");
}

function isMissingTable(error: { code?: string; message?: string } | null) {
  if (!error) return false;
  if (error.code === "PGRST205") return true;
  return /could not find the table/i.test(error.message ?? "");
}

export default async function RaceSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data, error } = await supabase.from("profiles").select("race_name,race_date").eq("id", user.id).maybeSingle();
  if (error && !isMissingProfilesTable(error)) throw new Error(error.message ?? "Failed to load race settings.");

  const profile = (data ?? null) as Profile | null;
  const metadata = (user.user_metadata ?? {}) as Record<string, unknown>;
  const raceNameFromMetadata = typeof metadata.race_name === "string" ? metadata.race_name : "";
  const raceDateFromMetadata = typeof metadata.race_date === "string" ? metadata.race_date : "";

  // Load race profiles (may not exist yet)
  const { data: raceProfiles, error: rpError } = await supabase
    .from("race_profiles")
    .select("id,name,date,distance_type,priority,notes")
    .eq("user_id", user.id)
    .order("date", { ascending: true });

  const races = (!rpError ? (raceProfiles as RaceProfileRow[]) : []) ?? [];

  return (
    <section className="space-y-4">
      <header className="surface p-6">
        <p className="label">Settings</p>
        <h1 className="mt-3 text-page-title">Race settings</h1>
        <p className="mt-2 text-body text-muted">Manage your race calendar. Set your A-race and tune-up events.</p>
      </header>

      {/* Race Profiles */}
      {!isMissingTable(rpError) && (
        <article className="surface p-5">
          <h2 className="text-section-title font-semibold">Race Calendar</h2>
          <p className="mt-1 text-body text-muted">Add races with priority: A (peak for), B (mini-taper), C (train through).</p>
          <RaceProfileList races={races} />
        </article>
      )}

      {/* Legacy single-race fallback */}
      <article className="surface p-5">
        <h2 className="text-section-title font-semibold">Dashboard Countdown</h2>
        <p className="mt-1 text-body text-muted">Primary race shown on your dashboard countdown.</p>
        <form action={updateRaceSettingsAction} className="mt-3 grid gap-3 md:max-w-lg">
          <div>
            <label htmlFor="raceName" className="label-base">Race name</label>
            <input id="raceName" name="raceName" defaultValue={profile?.race_name ?? raceNameFromMetadata} placeholder="Warsaw 70.3" className="input-base mt-1" />
          </div>
          <div>
            <label htmlFor="raceDate" className="label-base">Race date</label>
            <input id="raceDate" name="raceDate" type="date" defaultValue={profile?.race_date ?? raceDateFromMetadata} className="input-base mt-1" />
          </div>
          <div className="flex gap-2">
            <button className="btn-primary">Save</button>
            <Link href="/dashboard" className="btn-secondary">Back to dashboard</Link>
          </div>
        </form>
      </article>
    </section>
  );
}
