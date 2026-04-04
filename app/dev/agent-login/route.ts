import { NextRequest, NextResponse } from "next/server";
import { AGENT_PREVIEW_COOKIE, isAgentPreviewEnabled } from "@/lib/agent-preview/config";
import { resetPreviewDatabase } from "@/lib/agent-preview/data";

export async function GET(request: NextRequest) {
  if (!isAgentPreviewEnabled()) {
    return NextResponse.json({ error: "Agent preview mode is disabled." }, { status: 404 });
  }

  resetPreviewDatabase();

  const next = request.nextUrl.searchParams.get("next") || "/dashboard";
  const response = NextResponse.redirect(new URL(next, request.url));
  response.cookies.set(AGENT_PREVIEW_COOKIE, "active", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 3600
  });
  return response;
}

