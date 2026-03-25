import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { sortAthleteFtpHistory } from "@/lib/athlete-ftp";
import { checkRateLimit, rateLimitHeaders } from "@/lib/security/rate-limit";
import { getClientIp, isSameOrigin } from "@/lib/security/request";

const ftpInputSchema = z.object({
  value: z.number().int().min(50).max(1999),
  source: z.enum(["manual", "ramp_test", "estimated"]).default("manual"),
  notes: z.string().trim().max(400).nullish(),
  recorded_at: z.string().date().optional()
});

export async function GET(request: Request) {
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

  const { data, error } = await supabase
    .from("athlete_ftp_history")
    .select("id,value,source,notes,recorded_at,created_at")
    .eq("athlete_id", user.id)
    .order("recorded_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(10);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ history: sortAthleteFtpHistory(data ?? []) });
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }

  const ip = getClientIp(request);
  const ipLimit = checkRateLimit("ftp-ip", ip, { maxRequests: 20, windowMs: 60_000 });
  if (!ipLimit.allowed) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429, headers: rateLimitHeaders(ipLimit) });
  }

  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userLimit = checkRateLimit("ftp-user", user.id, { maxRequests: 10, windowMs: 60_000 });
  if (!userLimit.allowed) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429, headers: rateLimitHeaders(userLimit) });
  }

  try {
    const body = ftpInputSchema.parse(await request.json());

    const { data, error } = await supabase
      .from("athlete_ftp_history")
      .insert({
        athlete_id: user.id,
        value: body.value,
        source: body.source,
        notes: body.notes ?? null,
        recorded_at: body.recorded_at ?? new Date().toISOString().slice(0, 10)
      })
      .select("id,value,source,notes,recorded_at,created_at")
      .single();

    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json({ ok: true, entry: data });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save FTP." }, { status: 400 });
  }
}
