import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";

export function createSupabaseBrowserClient() {
  return createClientComponentClient();
}
