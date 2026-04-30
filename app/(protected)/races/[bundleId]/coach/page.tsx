import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loadRaceBundleSummary } from "@/lib/race/bundle-helpers";
import {
  generateRaceSeededPrompts,
  type PriorRaceLite,
  type NextRaceLite
} from "@/lib/race-review/seeded-prompts";
import { RaceCoachChat } from "./race-coach-chat";

export const dynamic = "force-dynamic";

const FOCUS_TO_PROMPT: Record<string, string> = {
  "segment:swim": "Talk me through the swim.",
  "segment:bike": "Why did the bike go the way it did?",
  "segment:run": "Why did the run go the way it did?",
  "pre-race": "Was my pre-race state right?",
  "lessons": "What are the most important training implications from this race?"
};

async function loadPriorRacesLite(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  thisBundleId: string,
  thisDate: string
): Promise<PriorRaceLite[]> {
  const { data: bundles } = await supabase
    .from("race_bundles")
    .select("id,started_at,race_profile_id")
    .eq("user_id", userId)
    .neq("id", thisBundleId)
    .lt("started_at", thisDate)
    .order("started_at", { ascending: false })
    .limit(8);

  const rows = (bundles ?? []) as Array<{ id: string; started_at: string; race_profile_id: string | null }>;
  if (rows.length === 0) return [];

  const profileIds = Array.from(new Set(rows.map((r) => r.race_profile_id).filter((id): id is string => Boolean(id))));
  const profileMap = new Map<string, { name: string | null; distanceType: string | null }>();
  if (profileIds.length > 0) {
    const { data: profiles } = await supabase
      .from("race_profiles")
      .select("id,name,distance_type")
      .eq("user_id", userId)
      .in("id", profileIds);
    for (const p of profiles ?? []) {
      const row = p as { id: string; name: string | null; distance_type: string | null };
      profileMap.set(row.id, { name: row.name, distanceType: row.distance_type });
    }
  }

  return rows.map((r) => {
    const profile = r.race_profile_id ? profileMap.get(r.race_profile_id) : undefined;
    return {
      bundleId: r.id,
      date: r.started_at.slice(0, 10),
      name: profile?.name ?? null,
      distanceType: profile?.distanceType ?? null
    };
  });
}

async function loadNextRaceLite(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  thisDate: string
): Promise<NextRaceLite | null> {
  const { data: profiles } = await supabase
    .from("race_profiles")
    .select("id,name,date,distance_type")
    .eq("user_id", userId)
    .gt("date", thisDate.slice(0, 10))
    .order("date", { ascending: true })
    .limit(1);

  const row = (profiles ?? [])[0] as
    | { id: string; name: string | null; date: string; distance_type: string | null }
    | undefined;
  if (!row || !row.name) return null;

  const today = new Date();
  const future = new Date(`${row.date}T00:00:00.000Z`);
  const daysUntil = Math.max(1, Math.round((future.getTime() - today.getTime()) / 86_400_000));

  return {
    raceProfileId: row.id,
    name: row.name,
    date: row.date,
    distanceType: row.distance_type ?? null,
    daysUntil
  };
}

function buildOpeningMessage(name: string, hasReview: boolean): string {
  if (!hasReview) {
    return `I've loaded the race object for ${name}. The review hasn't been generated yet, so my answers will be limited until the verdict and segment diagnostics complete.`;
  }
  return `I've loaded ${name} — verdict, story, segment diagnostics, transitions, lessons, and pre-race state are all in context. Ask anything.`;
}

export default async function RaceCoachPage({
  params,
  searchParams
}: {
  params: Promise<{ bundleId: string }>;
  searchParams?: Promise<{ focus?: string; prompt?: string }>;
}) {
  const { bundleId } = await params;
  const focus = searchParams ? (await searchParams).focus : undefined;
  const requestedPrompt = searchParams ? (await searchParams).prompt : undefined;

  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/auth/sign-in?redirectTo=${encodeURIComponent(`/races/${bundleId}/coach`)}`);
  }

  const summary = await loadRaceBundleSummary(supabase, user.id, bundleId);
  if (!summary) notFound();

  const [priorRaces, nextRace] = await Promise.all([
    loadPriorRacesLite(supabase, user.id, bundleId, summary.bundle.started_at),
    loadNextRaceLite(supabase, user.id, summary.bundle.started_at)
  ]);

  const seededPromptsRaw = generateRaceSeededPrompts({ summary, priorRaces, nextRace });
  const seededPrompts = seededPromptsRaw.map((p) => p.prompt);

  const initialPrompt =
    requestedPrompt && requestedPrompt.length > 0
      ? requestedPrompt
      : focus && FOCUS_TO_PROMPT[focus]
        ? FOCUS_TO_PROMPT[focus]
        : undefined;

  const raceName = summary.raceProfile?.name ?? `your ${summary.raceProfile?.distance_type ?? "race"}`;
  const openingMessage = buildOpeningMessage(raceName, Boolean(summary.review?.verdict));

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4 md:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-tertiary">
            Race coach · interrogation
          </p>
          <h1 className="mt-1 text-xl font-semibold text-[rgba(255,255,255,0.92)]">{raceName}</h1>
        </div>
        <Link
          href={`/races/${bundleId}`}
          className="inline-flex items-center gap-1 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] px-3 py-1.5 text-xs text-[rgba(255,255,255,0.86)] hover:border-[rgba(255,255,255,0.18)]"
        >
          ← Back to race
        </Link>
      </header>

      <RaceCoachChat
        bundleId={bundleId}
        summary={summary}
        seededPrompts={seededPrompts}
        initialPrompt={initialPrompt}
        openingMessage={openingMessage}
      />
    </div>
  );
}
