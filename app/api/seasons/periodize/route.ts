import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getRaceProfiles } from "@/lib/training/race-profile";
import { generateSeasonPeriodization } from "@/lib/training/season-engine";

const periodizeSchema = z.object({
  seasonId: z.string().uuid(),
});

/**
 * POST /api/seasons/periodize
 *
 * Generate training blocks for a season based on its linked races.
 * Returns the proposed blocks for user confirmation before persisting.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const parsed = periodizeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // Load season
  const { data: season, error: seasonError } = await supabase
    .from("seasons")
    .select("*")
    .eq("id", parsed.data.seasonId)
    .eq("user_id", user.id)
    .single();

  if (seasonError || !season) {
    return NextResponse.json({ error: "Season not found" }, { status: 404 });
  }

  // Load linked races via season_races junction
  const { data: links } = await supabase
    .from("season_races")
    .select("race_profile_id")
    .eq("season_id", season.id);

  const raceIds = (links ?? []).map((l: { race_profile_id: string }) => l.race_profile_id);

  // Load all race profiles
  const allRaces = await getRaceProfiles(supabase, user.id);
  const seasonRaces = allRaces.filter((r) => raceIds.includes(r.id));

  if (seasonRaces.length === 0) {
    return NextResponse.json({ error: "No races linked to this season" }, { status: 400 });
  }

  // Generate blocks
  const blocks = generateSeasonPeriodization(seasonRaces, {
    seasonStartDate: season.start_date,
    seasonEndDate: season.end_date,
  });

  return NextResponse.json({ blocks, season });
}
