import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { athleteContextInputSchema, getAthleteContextSnapshot, saveAthleteContext } from "@/lib/athlete-context";
import { isSameOrigin } from "@/lib/security/request";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }

  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = athleteContextInputSchema.parse(await request.json());
    await saveAthleteContext(supabase, user.id, body);
    const snapshot = await getAthleteContextSnapshot(supabase, user.id);
    return NextResponse.json({ ok: true, snapshot });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save athlete context." }, { status: 400 });
  }
}
