import type { SupabaseClient } from "@supabase/supabase-js";
import {
  PROGRESS_REPORT_EMPTY_SOURCE_UPDATED_AT,
  getProgressReportReadiness,
  getProgressReportSourceUpdatedAt
} from "./persistence";

type ChainResult = { data: unknown; error: unknown; count?: number | null };

type TableHandlers = {
  /** Invoked when the chain is awaited directly (e.g. count-only queries). */
  onAwait?: () => Promise<ChainResult>;
  /** Invoked when the chain terminates with `.maybeSingle()`. */
  onMaybeSingle?: () => Promise<ChainResult>;
};

type TableBuilder = {
  select: (..._args: unknown[]) => TableBuilder;
  eq: (..._args: unknown[]) => TableBuilder;
  gte: (..._args: unknown[]) => TableBuilder;
  lte: (..._args: unknown[]) => TableBuilder;
  in: (..._args: unknown[]) => TableBuilder;
  order: (..._args: unknown[]) => TableBuilder;
  limit: (..._args: unknown[]) => TableBuilder;
  maybeSingle: () => Promise<ChainResult>;
  then: (resolve: (value: ChainResult) => void) => void;
};

function buildSupabaseMock(handlers: Record<string, TableHandlers>): SupabaseClient {
  const makeBuilder = (handler: TableHandlers): TableBuilder => {
    const missing = (label: string) =>
      Promise.reject(new Error(`Unexpected ${label} call in test fixture`));
    const builder: TableBuilder = {
      select: () => builder,
      eq: () => builder,
      gte: () => builder,
      lte: () => builder,
      in: () => builder,
      order: () => builder,
      limit: () => builder,
      maybeSingle: () =>
        handler.onMaybeSingle
          ? handler.onMaybeSingle()
          : (missing(".maybeSingle()") as Promise<ChainResult>),
      then: (resolve) =>
        (handler.onAwait
          ? handler.onAwait()
          : (missing("awaited chain") as Promise<ChainResult>)
        ).then(resolve)
    };
    return builder;
  };

  return {
    from: (table: string) => {
      const handler = handlers[table];
      if (!handler) throw new Error(`Unexpected Supabase table in test: ${table}`);
      return makeBuilder(handler);
    }
  } as unknown as SupabaseClient;
}

describe("getProgressReportSourceUpdatedAt", () => {
  it("returns the stable sentinel when no activities exist in the window", async () => {
    const supabase = buildSupabaseMock({
      completed_activities: {
        onMaybeSingle: async () => ({ data: null, error: null })
      }
    });
    const result = await getProgressReportSourceUpdatedAt({
      supabase,
      athleteId: "user-1",
      priorBlockStart: "2026-03-04",
      blockEnd: "2026-04-28"
    });
    expect(result).toBe(PROGRESS_REPORT_EMPTY_SOURCE_UPDATED_AT);
  });

  it("throws when the underlying query errors", async () => {
    const supabase = buildSupabaseMock({
      completed_activities: {
        onMaybeSingle: async () => ({
          data: null,
          error: { message: "RLS denied" }
        })
      }
    });
    await expect(
      getProgressReportSourceUpdatedAt({
        supabase,
        athleteId: "user-1",
        priorBlockStart: "2026-03-04",
        blockEnd: "2026-04-28"
      })
    ).rejects.toThrow(/RLS denied/);
  });

  it("sentinel is identical across successive empty calls (stops stale churn)", async () => {
    const supabase = buildSupabaseMock({
      completed_activities: {
        onMaybeSingle: async () => ({ data: null, error: null })
      }
    });
    const first = await getProgressReportSourceUpdatedAt({
      supabase,
      athleteId: "user-1",
      priorBlockStart: "2026-03-04",
      blockEnd: "2026-04-28"
    });
    const second = await getProgressReportSourceUpdatedAt({
      supabase,
      athleteId: "user-1",
      priorBlockStart: "2026-03-04",
      blockEnd: "2026-04-28"
    });
    expect(first).toBe(second);
  });
});

describe("getProgressReportReadiness", () => {
  it("reports insufficient data when the current block has zero activities", async () => {
    const supabase = buildSupabaseMock({
      completed_activities: {
        onAwait: async () => ({ data: null, error: null, count: 0 }),
        onMaybeSingle: async () => ({ data: null, error: null })
      }
    });
    const readiness = await getProgressReportReadiness({
      supabase,
      athleteId: "user-1",
      blockStart: "2026-04-01",
      priorBlockStart: "2026-03-04",
      blockEnd: "2026-04-28"
    });
    expect(readiness.currentBlockActivityCount).toBe(0);
    expect(readiness.hasSufficientData).toBe(false);
    expect(readiness.sourceUpdatedAt).toBe(PROGRESS_REPORT_EMPTY_SOURCE_UPDATED_AT);
  });

  it("reports sufficient data when at least one activity lands in the block", async () => {
    const supabase = buildSupabaseMock({
      completed_activities: {
        onAwait: async () => ({ data: null, error: null, count: 3 }),
        onMaybeSingle: async () => ({
          data: { updated_at: "2026-04-18T10:00:00.000Z" },
          error: null
        })
      }
    });
    const readiness = await getProgressReportReadiness({
      supabase,
      athleteId: "user-1",
      blockStart: "2026-04-01",
      priorBlockStart: "2026-03-04",
      blockEnd: "2026-04-28"
    });
    expect(readiness.currentBlockActivityCount).toBe(3);
    expect(readiness.hasSufficientData).toBe(true);
    expect(readiness.sourceUpdatedAt).toBe("2026-04-18T10:00:00.000Z");
  });

  it("propagates a count-query error instead of silently fabricating readiness", async () => {
    const supabase = buildSupabaseMock({
      completed_activities: {
        onAwait: async () => ({
          data: null,
          error: { message: "connection reset" },
          count: null
        }),
        onMaybeSingle: async () => ({ data: null, error: null })
      }
    });
    await expect(
      getProgressReportReadiness({
        supabase,
        athleteId: "user-1",
        blockStart: "2026-04-01",
        priorBlockStart: "2026-03-04",
        blockEnd: "2026-04-28"
      })
    ).rejects.toThrow(/connection reset/);
  });
});
