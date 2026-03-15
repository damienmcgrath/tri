"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";
import { AGENT_PREVIEW_COOKIE, isAgentPreviewEnabled } from "@/lib/agent-preview/config";
import { createClient } from "@/lib/supabase/server";

function isMissingProfilesTable(error: { code?: string; message?: string } | null) {
  if (!error) {
    return false;
  }

  if (error.code === "PGRST205") {
    return true;
  }

  return /could not find the table 'public\.profiles' in the schema cache/i.test(error.message ?? "");
}

const raceSettingsSchema = z.object({
  raceName: z.string().trim().max(120).optional(),
  raceDate: z.string().date().optional()
});

export async function signOutAction() {
  if (isAgentPreviewEnabled()) {
    const cookieStore = await cookies();
    if (cookieStore.get(AGENT_PREVIEW_COOKIE)?.value === "active") {
      cookieStore.set(AGENT_PREVIEW_COOKIE, "", {
        httpOnly: true,
        sameSite: "lax",
        secure: false,
        path: "/",
        expires: new Date(0)
      });
      redirect("/auth/sign-in");
    }
  }

  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/auth/sign-in");
}

export async function updateRaceSettingsAction(formData: FormData) {
  const parsed = raceSettingsSchema.parse({
    raceName: (formData.get("raceName") as string | null) ?? "",
    raceDate: (formData.get("raceDate") as string | null) ?? ""
  });

  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("You must be signed in.");
  }

  const raceName = parsed.raceName?.trim() ? parsed.raceName.trim() : null;
  const raceDate = parsed.raceDate?.trim() ? parsed.raceDate.trim() : null;

  const { error } = await supabase.from("profiles").upsert(
    {
      id: user.id,
      race_name: raceName,
      race_date: raceDate
    },
    { onConflict: "id" }
  );

  if (error && !isMissingProfilesTable(error)) {
    throw new Error(error.message ?? "Could not save race settings.");
  }

  if (error && isMissingProfilesTable(error)) {
    const currentMetadata = (user.user_metadata ?? {}) as Record<string, unknown>;
    const { error: updateMetadataError } = await supabase.auth.updateUser({
      data: {
        ...currentMetadata,
        race_name: raceName,
        race_date: raceDate
      }
    });

    if (updateMetadataError) {
      throw new Error(updateMetadataError.message ?? "Could not save race settings.");
    }
  }

  revalidatePath("/dashboard");
  revalidatePath("/settings/race");
  revalidatePath("/settings");
}
