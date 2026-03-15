import { NextRequest, NextResponse } from "next/server";
import { isAgentPreviewEnabled } from "@/lib/agent-preview/config";
import { resetPreviewDatabase } from "@/lib/agent-preview/data";

export async function GET(request: NextRequest) {
  if (!isAgentPreviewEnabled()) {
    return NextResponse.json({ error: "Agent preview mode is disabled." }, { status: 404 });
  }

  resetPreviewDatabase();

  const next = request.nextUrl.searchParams.get("next") || "/dashboard";
  return NextResponse.redirect(new URL(next, request.url));
}

