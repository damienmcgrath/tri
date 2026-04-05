import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const createRaceProfileSchema = z.object({
  name: z.string().trim().min(1).max(160),
  date: z.string().date(),
  distanceType: z.enum(["sprint", "olympic", "70.3", "ironman", "custom"]),
  priority: z.enum(["A", "B", "C"]).default("A"),
  courseProfile: z.record(z.unknown()).optional(),
  idealDisciplineDistribution: z.object({
    swim: z.number().min(0).max(1),
    bike: z.number().min(0).max(1),
    run: z.number().min(0).max(1),
    strength: z.number().min(0).max(1).optional(),
  }).optional(),
  notes: z.string().trim().max(1000).optional(),
});

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("race_profiles")
    .select("*")
    .eq("user_id", user.id)
    .order("date", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const parsed = createRaceProfileSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("race_profiles")
    .insert({
      user_id: user.id,
      athlete_id: user.id,
      name: parsed.data.name,
      date: parsed.data.date,
      distance_type: parsed.data.distanceType,
      priority: parsed.data.priority,
      course_profile: parsed.data.courseProfile ?? {},
      ideal_discipline_distribution: parsed.data.idealDisciplineDistribution ?? null,
      notes: parsed.data.notes ?? null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
