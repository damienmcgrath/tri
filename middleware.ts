import { createServerClient } from "@supabase/ssr";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const protectedRoutes = ["/dashboard", "/plan", "/calendar", "/coach", "/settings", "/sessions"];

function hasSupabaseAuthCookie(request: NextRequest) {
  return request.cookies
    .getAll()
    .some(({ name }) => name.startsWith("sb-") && name.includes("-auth-token"));
}

function applySecurityHeaders(response: NextResponse) {
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.headers.set(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https://*.supabase.co https://api.openai.com; font-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  );

  if (process.env.NODE_ENV === "production") {
    response.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
  }
}

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabasePublishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabasePublishableKey) {
    applySecurityHeaders(response);
    return response;
  }

  const isProtectedRoute = protectedRoutes.some((route) => request.nextUrl.pathname.startsWith(route));

  if (isProtectedRoute && !hasSupabaseAuthCookie(request)) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/auth/sign-in";
    redirectUrl.searchParams.set("next", request.nextUrl.pathname);
    const redirectResponse = NextResponse.redirect(redirectUrl);
    applySecurityHeaders(redirectResponse);
    return redirectResponse;
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
  matcher: ["/dashboard/:path*", "/plan/:path*", "/calendar/:path*", "/coach/:path*", "/settings/:path*", "/sessions/:path*", "/auth/sign-in"]
};
