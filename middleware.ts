import { createServerClient } from "@supabase/ssr";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { AGENT_PREVIEW_COOKIE, isAgentPreviewEnabled } from "@/lib/agent-preview/config";

const protectedRoutes = ["/dashboard", "/plan", "/calendar", "/coach", "/settings", "/sessions", "/activities", "/debrief"];

function hasSupabaseAuthCookie(request: NextRequest) {
  return request.cookies
    .getAll()
    .some(({ name }) => name.startsWith("sb-") && name.includes("-auth-token"));
}

function hasAgentPreviewCookie(request: NextRequest) {
  return isAgentPreviewEnabled() && request.cookies.get(AGENT_PREVIEW_COOKIE)?.value === "active";
}

function applySecurityHeaders(response: NextResponse) {
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  const scriptSrc = process.env.NODE_ENV === "production"
    ? "'self' 'unsafe-inline'"
    : "'self' 'unsafe-inline' 'unsafe-eval'";
  response.headers.set(
    "Content-Security-Policy",
    `default-src 'self'; script-src ${scriptSrc}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https://*.supabase.co https://api.openai.com; font-src 'self' data:; worker-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`
  );

  if (process.env.NODE_ENV === "production") {
    response.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
  }
}

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const hasPreviewSession = hasAgentPreviewCookie(request);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabasePublishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (request.nextUrl.pathname.startsWith("/dev/agent-") && !isAgentPreviewEnabled()) {
    const notFoundResponse = new NextResponse("Not found", { status: 404 });
    applySecurityHeaders(notFoundResponse);
    return notFoundResponse;
  }

  if (!supabaseUrl || !supabasePublishableKey) {
    applySecurityHeaders(response);
    return response;
  }

  const isProtectedRoute = protectedRoutes.some((route) => request.nextUrl.pathname.startsWith(route));

  if (isProtectedRoute && !hasPreviewSession && !hasSupabaseAuthCookie(request)) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/auth/sign-in";
    redirectUrl.searchParams.set("next", request.nextUrl.pathname);
    const redirectResponse = NextResponse.redirect(redirectUrl);
    applySecurityHeaders(redirectResponse);
    return redirectResponse;
  }

  if (hasPreviewSession && request.nextUrl.pathname.startsWith("/auth/sign-in")) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/dashboard";
    redirectUrl.search = "";
    const redirectResponse = NextResponse.redirect(redirectUrl);
    applySecurityHeaders(redirectResponse);
    return redirectResponse;
  }

  if (hasPreviewSession) {
    applySecurityHeaders(response);
    return response;
  }

  const supabase = createServerClient(supabaseUrl, supabasePublishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      }
    }
  });

  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user && isProtectedRoute) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/auth/sign-in";
    redirectUrl.searchParams.set("next", request.nextUrl.pathname);
    const redirectResponse = NextResponse.redirect(redirectUrl);
    applySecurityHeaders(redirectResponse);
    return redirectResponse;
  }

  if (user && request.nextUrl.pathname.startsWith("/auth/sign-in")) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/dashboard";
    redirectUrl.search = "";
    const redirectResponse = NextResponse.redirect(redirectUrl);
    applySecurityHeaders(redirectResponse);
    return redirectResponse;
  }

  applySecurityHeaders(response);
  return response;
}

export const config = {
  matcher: ["/dashboard/:path*", "/plan/:path*", "/calendar/:path*", "/coach/:path*", "/settings/:path*", "/sessions/:path*", "/activities/:path*", "/debrief/:path*", "/auth/sign-in", "/dev/agent-:path*"]
};
