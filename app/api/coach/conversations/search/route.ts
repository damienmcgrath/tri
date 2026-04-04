import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/coach/conversations/search?q=keyword&topic=session_review
 *
 * Search past conversations by keyword or topic via conversation_summaries.
 */
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const query = url.searchParams.get("q")?.trim() ?? "";
  const topic = url.searchParams.get("topic")?.trim() ?? "";
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "20", 10), 50);

  let dbQuery = supabase
    .from("conversation_summaries")
    .select(
      `
      id,
      conversation_id,
      summary,
      key_topics,
      key_decisions,
      created_at
    `
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(limit);

  // Filter by keyword in summary
  if (query) {
    dbQuery = dbQuery.ilike("summary", `%${query}%`);
  }

  // Filter by topic overlap
  if (topic) {
    dbQuery = dbQuery.contains("key_topics", [topic]);
  }

  const { data, error } = await dbQuery;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ results: data ?? [] });
}
