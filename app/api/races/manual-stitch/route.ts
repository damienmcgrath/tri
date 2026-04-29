import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";
import { isSameOrigin } from "@/lib/security/request";
import { createClient } from "@/lib/supabase/server";
import { manualStitchRaceBundle } from "@/lib/race/manual-stitch";

const manualStitchSchema = z.object({
  segments: z
    .array(
      z.object({
        activityId: z.string().uuid(),
        role: z.enum(["swim", "t1", "bike", "t2", "run"]),
        index: z.number().int().min(0)
      })
    )
    .min(3)
    .max(5)
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = manualStitchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid manual-stitch payload.", issues: parsed.error.flatten() }, { status: 422 });
  }

  const result = await manualStitchRaceBundle({
    supabase,
    userId: user.id,
    segments: parsed.data.segments
  });

  if (result.status === "error") {
    const httpStatus = result.reason === "activity_ownership_mismatch" ? 403
      : result.reason === "activity_already_in_bundle" ? 409
      : 422;
    return NextResponse.json({ error: result.reason }, { status: httpStatus });
  }

  revalidatePath("/dashboard");
  if (result.plannedSessionId) {
    revalidatePath(`/sessions/${result.plannedSessionId}`);
  }
  revalidatePath(`/races/${result.bundleId}`);
  return NextResponse.json({ ok: true, bundleId: result.bundleId, plannedSessionId: result.plannedSessionId });
}
