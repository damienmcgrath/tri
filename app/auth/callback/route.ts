import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type OtpType = "signup" | "invite" | "magiclink" | "recovery" | "email_change";

const ALLOWED_REDIRECT_PREFIXES = [
  "/dashboard",
  "/plan",
  "/calendar",
  "/coach",
  "/settings",
  "/sessions",
  "/activities",
  "/debrief"
];

function getSafeRedirectPath(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) {
    return "/dashboard";
  }

  try {
    const decoded = decodeURIComponent(next);
    if (decoded.includes("\\") || decoded.startsWith("//")) {
      return "/dashboard";
    }
    if (!ALLOWED_REDIRECT_PREFIXES.some((p) => decoded.startsWith(p))) {
      return "/dashboard";
    }
  } catch {
    return "/dashboard";
  }

  return next;
}

function getSafeOtpType(type: string | null): OtpType | null {
  if (type === "signup" || type === "invite" || type === "magiclink" || type === "recovery" || type === "email_change") {
    return type;
  }

  return null;
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const tokenHash = requestUrl.searchParams.get("token_hash");
  const otpType = getSafeOtpType(requestUrl.searchParams.get("type"));
  const nextPath = getSafeRedirectPath(requestUrl.searchParams.get("next"));
  const redirectUrl = new URL(nextPath, requestUrl.origin);
  const supabase = await createClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      console.error("[AUTH_CALLBACK] Code exchange failed:", error.message);
      const signInUrl = new URL("/auth/sign-in", requestUrl.origin);
      signInUrl.searchParams.set("error", "Authentication failed. Please try again.");
      return NextResponse.redirect(signInUrl);
    }

    return NextResponse.redirect(redirectUrl);
  }

  if (tokenHash && otpType) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: otpType
    });

    if (error) {
      console.error("[AUTH_CALLBACK] OTP verification failed:", error.message);
      const signInUrl = new URL("/auth/sign-in", requestUrl.origin);
      signInUrl.searchParams.set("error", "Authentication failed. Please try again.");
      return NextResponse.redirect(signInUrl);
    }

    return NextResponse.redirect(redirectUrl);
  }

  if (!code && !(tokenHash && otpType)) {
    redirectUrl.pathname = "/auth/sign-in";
    redirectUrl.searchParams.set("error", "Missing sign-in code.");
    redirectUrl.searchParams.delete("next");
    return NextResponse.redirect(redirectUrl);
  }

  return NextResponse.redirect(redirectUrl);
}
