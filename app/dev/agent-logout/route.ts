import { NextRequest, NextResponse } from "next/server";
import { AGENT_PREVIEW_COOKIE, isAgentPreviewEnabled } from "@/lib/agent-preview/config";

export async function GET(request: NextRequest) {
  if (!isAgentPreviewEnabled()) {
    return NextResponse.json({ error: "Agent preview mode is disabled." }, { status: 404 });
  }

  const response = NextResponse.redirect(new URL("/auth/sign-in", request.url));
  response.cookies.set(AGENT_PREVIEW_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    path: "/",
    expires: new Date(0)
  });
  return response;
}

