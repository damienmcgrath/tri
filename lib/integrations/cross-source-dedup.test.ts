// ─── Mocks ─────────────────────────────────────────────────────────────────────

function makeChain(resolvedValue: unknown) {
  const chain: Record<string, unknown> = {};
  const methods = ["select", "eq", "gte", "lte", "insert", "update", "delete", "is"];
  methods.forEach((m) => { chain[m] = jest.fn().mockReturnValue(chain); });
  (chain as { then: (resolve: (v: unknown) => void) => Promise<unknown> }).then = (resolve) =>
    Promise.resolve(resolvedValue).then(resolve);
  (chain as { maybeSingle: () => Promise<unknown> }).maybeSingle = jest.fn().mockResolvedValue(resolvedValue);
  (chain as { single: () => Promise<unknown> }).single = jest.fn().mockResolvedValue(resolvedValue);
  return chain;
}

const mockFrom = jest.fn();
jest.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ from: mockFrom })
}));

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";

import { findCrossSourceDuplicate, mergeStravaIntoExisting } from "./cross-source-dedup";

beforeEach(() => {
  jest.clearAllMocks();
});

describe("findCrossSourceDuplicate", () => {
  it("returns null when no candidates found", async () => {
    mockFrom.mockReturnValue(makeChain({ data: [], error: null }));

    const result = await findCrossSourceDuplicate(
      "user-1", "run", "2026-03-15T08:00:00Z", 3600
    );
    expect(result).toBeNull();
  });

  it("returns match when duration is within 10%", async () => {
    mockFrom.mockReturnValue(makeChain({
      data: [{ id: "existing-1", source: "fit_upload", duration_sec: 3500 }],
      error: null
    }));

    const result = await findCrossSourceDuplicate(
      "user-1", "run", "2026-03-15T08:00:00Z", 3600
    );
    expect(result).toEqual({ existingId: "existing-1", existingSource: "fit_upload" });
  });

  it("returns null when duration differs by more than 10%", async () => {
    mockFrom.mockReturnValue(makeChain({
      data: [{ id: "existing-1", source: "fit_upload", duration_sec: 2000 }],
      error: null
    }));

    const result = await findCrossSourceDuplicate(
      "user-1", "run", "2026-03-15T08:00:00Z", 3600
    );
    expect(result).toBeNull();
  });

  it("returns null on database error", async () => {
    mockFrom.mockReturnValue(makeChain({
      data: null,
      error: { message: "db error" }
    }));

    const result = await findCrossSourceDuplicate(
      "user-1", "run", "2026-03-15T08:00:00Z", 3600
    );
    expect(result).toBeNull();
  });
});

describe("mergeStravaIntoExisting", () => {
  it("updates the existing row with Strava metadata", async () => {
    const chain = makeChain({ data: null, error: null });
    mockFrom.mockReturnValue(chain);

    await mergeStravaIntoExisting("existing-1", "strava-999", "Morning Run");

    expect(mockFrom).toHaveBeenCalledWith("completed_activities");
    expect(chain.update).toHaveBeenCalledWith({
      external_provider: "strava",
      external_activity_id: "strava-999",
      external_title: "Morning Run"
    });
  });

  it("throws on database error", async () => {
    const chain = makeChain({ data: null, error: null });
    // Override the then to simulate an error after update chain resolves
    mockFrom.mockImplementation(() => {
      const errChain = makeChain({ data: null, error: { message: "update failed" } });
      return errChain;
    });

    await expect(mergeStravaIntoExisting("existing-1", "strava-999", "Run"))
      .rejects.toThrow("Failed to merge Strava data");
  });
});
