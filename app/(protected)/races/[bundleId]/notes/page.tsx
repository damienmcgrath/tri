import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { loadRaceBundleSummary } from "@/lib/race/bundle-helpers";
import { SubjectiveForm } from "./subjective-form";

export const dynamic = "force-dynamic";

export default async function RaceNotesPage({ params }: { params: Promise<{ bundleId: string }> }) {
  const { bundleId } = await params;
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/auth/sign-in?redirectTo=${encodeURIComponent(`/races/${bundleId}/notes`)}`);
  }

  const summary = await loadRaceBundleSummary(supabase, user.id, bundleId);
  if (!summary) notFound();

  const isEditing = Boolean(summary.bundle.subjective_captured_at);
  const title = summary.raceProfile?.name ?? `Race on ${summary.bundle.started_at.slice(0, 10)}`;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 p-4 md:p-6">
      <header className="flex flex-col gap-1">
        <Link href={`/races/${bundleId}`} className="text-xs text-tertiary underline-offset-2 hover:underline">
          ← Back to race
        </Link>
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-tertiary">Race notes</p>
        <h1 className="text-2xl font-semibold text-[rgba(255,255,255,0.92)]">{title}</h1>
        <p className="text-sm text-muted">
          {isEditing
            ? "Edit your subjective inputs from race day."
            : "Capture your subjective experience while it's still fresh."}
        </p>
      </header>

      <SubjectiveForm
        bundleId={bundleId}
        defaults={{
          athleteRating: summary.bundle.athlete_rating,
          athleteNotes: summary.bundle.athlete_notes,
          issuesFlagged: summary.bundle.issues_flagged,
          finishPosition: summary.bundle.finish_position,
          ageGroupPosition: summary.bundle.age_group_position
        }}
      />
    </div>
  );
}
