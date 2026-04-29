import {
  persistSubjectiveInput,
  subjectiveInputSchema
} from "./subjective-input";

describe("subjectiveInputSchema", () => {
  it("accepts a complete payload", () => {
    const result = subjectiveInputSchema.safeParse({
      athleteRating: 4,
      athleteNotes: "Felt strong off the bike.",
      issuesFlagged: ["nutrition", "pacing"],
      finishPosition: 18,
      ageGroupPosition: 4
    });
    expect(result.success).toBe(true);
  });

  it("rejects ratings outside 1-5", () => {
    expect(subjectiveInputSchema.safeParse({ athleteRating: 0 }).success).toBe(false);
    expect(subjectiveInputSchema.safeParse({ athleteRating: 6 }).success).toBe(false);
  });

  it("rejects unknown issue tags", () => {
    const result = subjectiveInputSchema.safeParse({
      athleteRating: 3,
      issuesFlagged: ["nutrition", "rocketship"]
    });
    expect(result.success).toBe(false);
  });

  it("caps notes at 4000 chars", () => {
    const longNotes = "x".repeat(4001);
    const result = subjectiveInputSchema.safeParse({
      athleteRating: 3,
      athleteNotes: longNotes
    });
    expect(result.success).toBe(false);
  });
});

describe("persistSubjectiveInput", () => {
  function buildSupabase(opts: { existing: Record<string, unknown> | null }) {
    const updates: Record<string, unknown>[] = [];
    const supabase: any = {
      from: (_table: string) => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: opts.existing, error: null })
            })
          })
        }),
        update: (patch: Record<string, unknown>) => {
          updates.push(patch);
          return {
            eq: () => ({
              eq: async () => ({ error: null })
            })
          };
        }
      })
    };
    return { supabase, updates };
  }

  it("flips status from imported to reviewed on first save", async () => {
    const { supabase, updates } = buildSupabase({
      existing: { id: "b1", status: "imported" }
    });
    const result = await persistSubjectiveInput({
      supabase,
      userId: "user-1",
      bundleId: "b1",
      input: {
        athleteRating: 4,
        athleteNotes: "Solid race.",
        issuesFlagged: ["nutrition", "nutrition"],
        finishPosition: 18,
        ageGroupPosition: 4
      }
    });
    expect(result).toEqual({ status: "ok", bundleId: "b1" });
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      athlete_rating: 4,
      athlete_notes: "Solid race.",
      finish_position: 18,
      age_group_position: 4,
      status: "reviewed"
    });
    // Issues are deduped.
    expect(updates[0].issues_flagged).toEqual(["nutrition"]);
    expect(updates[0].subjective_captured_at).toBeTruthy();
  });

  it("does not flip status on subsequent edits", async () => {
    const { supabase, updates } = buildSupabase({
      existing: { id: "b1", status: "reviewed" }
    });
    await persistSubjectiveInput({
      supabase,
      userId: "user-1",
      bundleId: "b1",
      input: { athleteRating: 5, issuesFlagged: [] }
    });
    expect(updates[0]).not.toHaveProperty("status");
  });

  it("returns bundle_not_found when bundle is missing", async () => {
    const { supabase } = buildSupabase({ existing: null });
    const result = await persistSubjectiveInput({
      supabase,
      userId: "user-1",
      bundleId: "missing",
      input: { athleteRating: 3, issuesFlagged: [] }
    });
    expect(result).toEqual({ status: "error", reason: "bundle_not_found" });
  });
});
