import withSerwist from "@serwist/next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n.ts");

const withSerwistConfig = withSerwist({
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development",
});

/** @type {import('next').NextConfig} */
const securityHeaders = [
  {
    key: "X-Content-Type-Options",
    value: "nosniff"
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin"
  },
  {
    key: "X-Frame-Options",
    value: "DENY"
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()"
  },
  ...(process.env.NODE_ENV === "production"
    ? [
        {
          key: "Content-Security-Policy",
          value:
            "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https://*.supabase.co https://api.openai.com; font-src 'self' data:; worker-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
        }
      ]
    : [])
];

const nextConfig = {
  reactStrictMode: true,
  experimental: {
    optimizePackageImports: ["openai", "zod", "@supabase/supabase-js"]
  },
  async headers() {
    const headers = [...securityHeaders];

    if (process.env.NODE_ENV === "production") {
      headers.push({
        key: "Strict-Transport-Security",
        value: "max-age=31536000; includeSubDomains; preload"
      });
    }

    return [
      {
        source: "/:path*",
        headers
      }
    ];
  }
};

export default withSerwistConfig(withNextIntl(nextConfig));
