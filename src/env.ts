import { z } from "zod";

function optionalNonEmptyString() {
  return z.preprocess((value) => {
    if (typeof value !== "string") {
      return value;
    }

    const trimmed = value.trim();
    return trimmed.length === 0 ? undefined : trimmed;
  }, z.string().min(1).optional());
}

const envSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY: optionalNonEmptyString(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: optionalNonEmptyString(),
  OPENAI_API_KEY: optionalNonEmptyString(),
  WEATHER_API_KEY: optionalNonEmptyString(),
  UPSTASH_REDIS_REST_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_TOKEN: optionalNonEmptyString()
}).superRefine((data, ctx) => {
  if (!data.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY && !data.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "Missing Supabase public key. Set NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY (preferred) or NEXT_PUBLIC_SUPABASE_ANON_KEY (legacy).",
      path: ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY"]
    });
  }
});

export const env = envSchema.safeParse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY:
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  WEATHER_API_KEY: process.env.WEATHER_API_KEY,
  UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
  UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN
});

export function assertEnv() {
  if (env.success) return;
  throw new Error(`Invalid environment variables: ${env.error.message}`);
}
