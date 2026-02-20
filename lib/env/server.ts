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

const serverSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY: optionalNonEmptyString(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: optionalNonEmptyString(),
  SUPABASE_SERVICE_ROLE_KEY: optionalNonEmptyString(),
  OPENAI_API_KEY: optionalNonEmptyString()
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

export const env = serverSchema.parse({
  NODE_ENV: process.env.NODE_ENV,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY:
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY
});
