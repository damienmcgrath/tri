import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { updateLocaleSettingsAction } from "../../actions";

type LocaleProfile = {
  locale: string;
  units: string;
  timezone: string;
  week_start_day: number;
};

export default async function LocaleSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data } = await supabase
    .from("profiles")
    .select("locale,units,timezone,week_start_day")
    .eq("id", user.id)
    .maybeSingle();

  const profile = (data ?? null) as LocaleProfile | null;

  return (
    <section className="space-y-4">
      <header className="surface p-6">
        <p className="label">Settings</p>
        <h1 className="mt-3 text-page-title">Language &amp; units</h1>
        <p className="mt-2 text-body text-muted">Set your language, units, timezone, and week start day.</p>
      </header>

      <article className="surface p-5">
        <form action={updateLocaleSettingsAction} className="grid gap-4 md:max-w-lg">
          <div>
            <label htmlFor="locale" className="label-base">Language</label>
            <select id="locale" name="locale" defaultValue={profile?.locale ?? "en"} className="input-base mt-1">
              <option value="en">English</option>
              <option value="de" disabled>Deutsch (coming soon)</option>
              <option value="fr" disabled>Fran&ccedil;ais (coming soon)</option>
            </select>
          </div>

          <div>
            <label htmlFor="units" className="label-base">Units</label>
            <select id="units" name="units" defaultValue={profile?.units ?? "metric"} className="input-base mt-1">
              <option value="metric">Metric (km, kg, &deg;C)</option>
              <option value="imperial">Imperial (mi, lb, &deg;F)</option>
            </select>
          </div>

          <div>
            <label htmlFor="timezone" className="label-base">Timezone</label>
            <input
              id="timezone"
              name="timezone"
              defaultValue={profile?.timezone ?? "UTC"}
              placeholder="Europe/Dublin"
              className="input-base mt-1"
            />
            <p className="mt-1 text-ui-label text-muted">IANA timezone identifier (e.g. Europe/Berlin, America/New_York)</p>
          </div>

          <div>
            <label htmlFor="weekStartDay" className="label-base">Week starts on</label>
            <select id="weekStartDay" name="weekStartDay" defaultValue={profile?.week_start_day ?? 1} className="input-base mt-1">
              <option value="1">Monday</option>
              <option value="0">Sunday</option>
            </select>
          </div>

          <div className="flex gap-2">
            <button className="btn-primary">Save preferences</button>
            <Link href="/settings" className="btn-secondary">Back</Link>
          </div>
        </form>
      </article>
    </section>
  );
}
