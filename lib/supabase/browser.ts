import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabasePublishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabasePublishableKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or Supabase public key. Set NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY (preferred) or NEXT_PUBLIC_SUPABASE_ANON_KEY (legacy)."
    );
  }

  return createBrowserClient(supabaseUrl, supabasePublishableKey);
}
