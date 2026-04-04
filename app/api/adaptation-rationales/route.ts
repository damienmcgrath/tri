import { NextResponse } from "next/server";
import { z } from "zod";
import { checkRateLimit, rateLimitHeaders } from "@/lib/security/rate-limit";
import { getClientIp, isSameOrigin } from "@/lib/security/request";
import { createClient } from "@/lib/supabase/server";

const acknowledgeSchema = z.object({
  rationaleId: z.string().uuid(),
  action: z.enum(["acknowledge", "discuss", "override"]),
  response: z.string().max(500).nullable().optional()
});

// GET: list pending rationales for current user (optionally filtered by week)
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const status = url.searchParams.get("status") ?? "pending";
  const weekStart = url.searchParams.get("weekStart");

  let query = supabase
    .from("adaptation_rationales")
    .select("*")
    .eq("user_id", user.id)
    .eq("status", status)
    .order("created_at", { ascending: false })
    .limit(20);

  if (weekStart) {
    query = query.eq("week_number", parseInt(weekStart, 10));
  }

  const { data, error } = await query;
  if (error) {
    console.error("[ADAPTATION_RATIONALES] GET error:", error.message);
    return NextResponse.json({ error: "Could not fetch rationales." }, { status: 500 });
  }

  return NextResponse.json({ rationales: data ?? [] });
}

// PATCH: acknowledge/discuss/override a rationale
export async function PATCH(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }

  const ip = getClientIp(request);
  const ipLimit = await checkRateLimit("rationale-ip", ip, { maxRequests: 30, windowMs: 60_000 });
  if (!ipLimit.allowed) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429, headers: rateLimitHeaders(ipLimit) });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = acknowledgeSchema.parse(await request.json());

    const statusMap: Record<string, string> = {
      acknowledge: "acknowledged",
      discuss: "discussed",
      override: "overridden"
    };

    const { error } = await supabase
      .from("adaptation_rationales")
      .update({
        status: statusMap[body.action],
        athlete_response: body.response ?? null,
        acknowledged_at: new Date().toISOString()
      })
      .eq("id", body.rationaleId)
      .eq("user_id", user.id);

    if (error) {
      console.error("[ADAPTATION_RATIONALES] PATCH error:", error.message);
      return NextResponse.json({ error: "Could not update rationale." }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not update rationale." },
      { status: 400 }
    );
  }
}
