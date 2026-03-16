import { NextResponse } from "next/server";
import { z } from "zod";
import { isSameOrigin } from "@/lib/security/request";
import { createClient } from "@/lib/supabase/server";
import { getMacroContext, formatMacroContextSummary } from "@/lib/training/macro-context";
import { generateWeekPreview } from "@/lib/training/week-preview";
import { getOpenAIClient, getCoachModel } from "@/lib/openai";

const weekAheadSchema = z.object({
  weekStart: z.string().date()
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
    const body = weekAheadSchema.parse(await request.json());

    const macroCtx = await getMacroContext(supabase, user.id);
    const preview = await generateWeekPreview(supabase, user.id, body.weekStart, macroCtx);

    // Optional short AI narrative
    let aiNarrative: string | null = null;
    try {
      const client = getOpenAIClient();
      const macroSummary = formatMacroContextSummary(macroCtx);
      const sportLines = Object.entries(preview.sportDistribution)
        .map(([sport, mins]) => `${sport}: ${mins} min`)
        .join(", ");

      const prompt = `You are a triathlon coach. Write 1-2 sentences previewing the athlete's upcoming week. Keep it practical and motivating. No preamble, just the preview.

Context: ${macroSummary}
Planned volume: ${preview.totalPlannedMinutes} min total (${sportLines})
Key sessions: ${preview.keySessionCount}
${preview.carryForwardNote ? `Carry-forward: ${preview.carryForwardNote}` : ""}`;

      const response = await client.responses.create({
        model: getCoachModel(),
        input: [{ role: "user", content: prompt }]
      });

      aiNarrative = typeof response.output_text === "string" ? response.output_text.trim() : null;
    } catch {
      // AI enrichment is optional — return preview without narrative
    }

    return NextResponse.json({ ok: true, preview: { ...preview, aiNarrative } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not generate week preview." }, { status: 400 });
  }
}
