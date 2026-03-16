import { NextResponse } from "next/server";
import { z } from "zod";
import { isSameOrigin } from "@/lib/security/request";
import { createClient } from "@/lib/supabase/server";

const sessionFeelSchema = z.object({
  sessionId: z.string().uuid(),
  rpe: z.number().int().min(1).max(10),
  note: z.string().max(200).nullable().optional(),
  wasPrompted: z.boolean().optional().default(true)
});

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
    const body = sessionFeelSchema.parse(await request.json());

    const { error } = await supabase.from("session_feels").upsert(
      {
        user_id: user.id,
        session_id: body.sessionId,
        rpe: body.rpe,
        note: body.note ?? null,
        was_prompted: body.wasPrompted
      },
      { onConflict: "session_id" }
    );

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save session feel." }, { status: 400 });
  }
}
