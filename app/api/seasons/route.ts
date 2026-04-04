import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const createSeasonSchema = z.object({
  name: z.string().trim().min(1).max(160),
  startDate: z.string().date(),
  endDate: z.string().date(),
  primaryGoal: z.string().trim().max(500).optional(),
  raceProfileIds: z.array(z.string().uuid()).optional(),
});

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("seasons")
    .select("*, season_races(race_profile_id)")
    .eq("user_id", user.id)
    .order("start_date", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const parsed = createSeasonSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { data: season, error: seasonError } = await supabase
    .from("seasons")
    .insert({
      user_id: user.id,
      athlete_id: user.id,
      name: parsed.data.name,
      start_date: parsed.data.startDate,
      end_date: parsed.data.endDate,
      primary_goal: parsed.data.primaryGoal ?? null,
    })
    .select()
    .single();

  if (seasonError) return NextResponse.json({ error: seasonError.message }, { status: 500 });

  // Link races to season
  if (parsed.data.raceProfileIds?.length) {
    const links = parsed.data.raceProfileIds.map((raceProfileId) => ({
      season_id: season.id,
      race_profile_id: raceProfileId,
    }));
    await supabase.from("season_races").insert(links);
  }

  return NextResponse.json(season, { status: 201 });
}
