import { getBlockMetrics, getBlockComparison } from "./block-metrics";

type Row = Record<string, unknown>;

function makeSupabase(tables: Record<string, Row[]>) {
  const apply = (rows: Row[], filters: Array<[string, string, unknown]>, modifiers: { inList?: [string, unknown[]] }) => {
    let out = rows;
    for (const [op, col, val] of filters) {
      if (op === "eq") out = out.filter((r) => r[col] === val);
      else if (op === "lt") out = out.filter((r) => (r[col] as number) < (val as number));
    }
    if (modifiers.inList) {
      const [col, values] = modifiers.inList;
      const set = new Set(values);
      out = out.filter((r) => set.has(r[col]));
    }
    return out;
  };

  const chainFor = (tableRows: Row[]) => {
    const filters: Array<[string, string, unknown]> = [];
    const modifiers: { inList?: [string, unknown[]] } = {};
    let orderBy: { col: string; ascending: boolean } | null = null;
    let limitN: number | null = null;

    const resolveArray = () => {
      let rows = apply(tableRows, filters, modifiers);
      if (orderBy) {
        const { col, ascending } = orderBy;
        rows = [...rows].sort((a, b) => {
          const av = a[col] as number;
          const bv = b[col] as number;
          return ascending ? av - bv : bv - av;
        });
      }
      if (limitN !== null) rows = rows.slice(0, limitN);
      return rows;
    };

    const chain = {
      eq(col: string, val: unknown) { filters.push(["eq", col, val]); return chain; },
      lt(col: string, val: unknown) { filters.push(["lt", col, val]); return chain; },
      in(col: string, vals: unknown[]) { modifiers.inList = [col, vals]; return chain; },
      order(col: string, opts: { ascending: boolean }) { orderBy = { col, ascending: opts.ascending }; return chain; },
      limit(n: number) { limitN = n; return chain; },
      maybeSingle() { const rows = resolveArray(); return Promise.resolve({ data: rows[0] ?? null, error: null }); },
      then<T>(onFulfilled: (result: { data: Row[] | null; error: null }) => T) {
        return Promise.resolve(onFulfilled({ data: resolveArray(), error: null }));
      },
    };
    return chain;
  };

  return {
    from: (table: string) => ({
      select: (_cols: string) => chainFor(tables[table] ?? []),
    }),
  };
}

describe("block-metrics", () => {
  const baseBlock = {
    id: "block-1",
    name: "Base 1",
    block_type: "Base",
    start_date: "2026-01-01",
    end_date: "2026-01-28",
    sort_order: 0,
    plan_id: "plan-1",
  };

  const priorBlock = {
    id: "block-0",
    name: "Prep",
    block_type: "Base",
    start_date: "2025-12-01",
    end_date: "2025-12-28",
    sort_order: -1,
    plan_id: "plan-1",
  };

  const weeks = [
    { id: "w1", block_id: "block-1" },
    { id: "w2", block_id: "block-1" },
    { id: "w-prior", block_id: "block-0" },
  ];

  const sessions = [
    { id: "s1", sport: "run", duration_minutes: 60, status: "completed", is_key: true, session_role: "key", week_id: "w1" },
    { id: "s2", sport: "bike", duration_minutes: 90, status: "completed", is_key: false, session_role: "supporting", week_id: "w1" },
    { id: "s3", sport: "swim", duration_minutes: 45, status: "planned", is_key: false, session_role: null, week_id: "w2" },
    { id: "s4", sport: "run", duration_minutes: 30, status: "completed", is_key: false, session_role: null, week_id: "w-prior" },
  ];

  function makeDb() {
    return makeSupabase({
      training_blocks: [baseBlock, priorBlock],
      training_weeks: weeks,
      sessions,
    });
  }

  it("aggregates planned + completed minutes, key sessions, and discipline mix", async () => {
    const metrics = await getBlockMetrics(makeDb() as never, "block-1");
    expect(metrics).not.toBeNull();
    expect(metrics!.weeks).toBe(2);
    expect(metrics!.plannedMinutes).toBe(60 + 90 + 45);
    expect(metrics!.completedMinutes).toBe(60 + 90);
    expect(metrics!.plannedSessions).toBe(3);
    expect(metrics!.completedSessions).toBe(2);
    expect(metrics!.keySessionsPlanned).toBe(1);
    expect(metrics!.keySessionsCompleted).toBe(1);
    expect(metrics!.disciplineMix.run.plannedMinutes).toBe(60);
    expect(metrics!.disciplineMix.bike.plannedMinutes).toBe(90);
    expect(metrics!.disciplineMix.swim.plannedMinutes).toBe(45);
    expect(metrics!.completionPct).toBe(Math.round((150 / 195) * 100));
  });

  it("returns null for unknown block", async () => {
    const metrics = await getBlockMetrics(makeDb() as never, "does-not-exist");
    expect(metrics).toBeNull();
  });

  it("compares current block to the prior block by sort_order", async () => {
    const cmp = await getBlockComparison(makeDb() as never, "block-1");
    expect(cmp).not.toBeNull();
    expect(cmp!.current.blockId).toBe("block-1");
    expect(cmp!.prior).not.toBeNull();
    expect(cmp!.prior!.blockId).toBe("block-0");
    expect(cmp!.deltas!.plannedMinutes).toBe(195 - 30);
    expect(cmp!.deltas!.completedMinutes).toBe(150 - 30);
  });

  it("returns null prior when there is no earlier block", async () => {
    const cmp = await getBlockComparison(makeDb() as never, "block-0");
    expect(cmp).not.toBeNull();
    expect(cmp!.prior).toBeNull();
    expect(cmp!.deltas).toBeNull();
  });
});
