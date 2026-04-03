import { getSessionComparison } from "./session-comparison";
import type { SessionComparison } from "./session-comparison";

// ---------------------------------------------------------------------------
// Supabase mock infrastructure
// ---------------------------------------------------------------------------
//
// The function under test calls supabase in this order:
//   1. sessions.maybeSingle()           → target session row
//   2. sessions (awaited as promise)    → primary candidate list
//   3. sessions (awaited as promise)    → fallback candidate list (only when #2 empty)
//   4. session_activity_links.maybeSingle()  ─┐ run in Promise.all
//      completed_activities.maybeSingle()     │  for CURRENT session
//   5. session_activity_links.maybeSingle()  ─┤ run in Promise.all
//      completed_activities.maybeSingle()     │  for PREVIOUS session
//                                             ┘
// Because steps 4+5 run in parallel we can NOT rely on a single global call
// counter.  Instead we maintain per-table queues so each table always gets
// its own responses regardless of interleaving.

type Row = Record<string, unknown>;
type QR = { data: unknown; error: null };

function q(data: unknown): QR {
  return { data, error: null };
}

interface TableQueues {
  sessions?: QR[];
  session_activity_links?: QR[];
  completed_activities?: QR[];
}

function makeSupabase(queues: TableQueues) {
  // Per-table response counters
  const counters: Record<string, number> = {};

  function nextFor(table: string): QR {
    const q = queues[table as keyof TableQueues] ?? [];
    const idx = counters[table] ?? 0;
    counters[table] = idx + 1;
    return q[idx] ?? { data: null, error: null };
  }

  return {
    from(table: string) {
      // Build a chainable object that resolves lazily
      let resolved = false;

      const chain: Record<string, unknown> = {};
      const passthrough = () => chain;

      for (const m of ["select", "eq", "lt", "gte", "lte", "order", "neq", "in"]) {
        chain[m] = passthrough;
      }

      // limit() is a passthrough too, but the awaitable must fire AFTER it
      chain["limit"] = passthrough;

      // maybeSingle resolves the next response for this table
      chain["maybeSingle"] = () => {
        resolved = true;
        return Promise.resolve(nextFor(table));
      };

      // Support `await supabase.from(...).select(...).eq(...).limit(5)` —
      // the promise is awaited directly (no .maybeSingle())
      chain["then"] = (
        resolve: (v: QR) => unknown,
        reject?: (e: unknown) => unknown
      ) => {
        if (!resolved) {
          resolved = true;
          return Promise.resolve(nextFor(table)).then(resolve, reject);
        }
        return Promise.resolve({ data: null, error: null }).then(resolve, reject);
      };

      return chain;
    },
  };
}

// ---------------------------------------------------------------------------
// Shorthand row builders
// ---------------------------------------------------------------------------

function sessRow(
  overrides: Partial<{
    id: string;
    date: string;
    sport: string;
    type: string;
    duration_minutes: number | null;
    status: string | null;
  }> = {}
): Row {
  return {
    id: "sess-1",
    date: "2026-03-15",
    sport: "run",
    type: "Easy",
    duration_minutes: 60,
    status: "completed",
    ...overrides,
  };
}

function prevRow(overrides: Partial<Row> = {}): Row {
  return sessRow({ id: "prev-1", date: "2026-03-01", ...overrides });
}

function linkRow(actId: string): Row {
  return { completed_activity_id: actId };
}

function actRow(metricsV2: Record<string, unknown> | null, extra: Partial<Row> = {}): Row {
  return {
    avg_hr: null,
    avg_power: null,
    avg_pace_per_100m_sec: null,
    duration_sec: null,
    metrics_v2: metricsV2,
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Convenience: build queues for the happy-path (primary candidates found,
// both activities linked and populated from metrics_v2)
// ---------------------------------------------------------------------------

function happyQueues(opts: {
  sport?: string;
  type?: string;
  durationMinutes?: number | null;
  prevSport?: string;
  prevId?: string;
  prevDate?: string;
  currentMetrics: Record<string, unknown>;
  prevMetrics: Record<string, unknown>;
  currentActTopLevel?: Partial<Row>;
  prevActTopLevel?: Partial<Row>;
  currentLinkId?: string;
  prevLinkId?: string;
}): TableQueues {
  const sport = opts.sport ?? "run";
  const prevId = opts.prevId ?? "prev-1";
  const prevDate = opts.prevDate ?? "2026-03-01";
  const currentLinkId = opts.currentLinkId ?? "act-c";
  const prevLinkId = opts.prevLinkId ?? "act-p";

  return {
    sessions: [
      // 1. target session
      q(sessRow({ sport, type: opts.type, duration_minutes: opts.durationMinutes ?? 60 })),
      // 2. primary candidates
      q([prevRow({ id: prevId, date: prevDate, sport: opts.prevSport ?? sport })]),
      // fallback never reached because primary has results
    ],
    session_activity_links: [
      // current session link (consumed first by Promise.all — order matches getActivityMetrics calls)
      q(linkRow(currentLinkId)),
      // previous session link
      q(linkRow(prevLinkId)),
    ],
    completed_activities: [
      q(actRow(opts.currentMetrics, opts.currentActTopLevel ?? {})),
      q(actRow(opts.prevMetrics, opts.prevActTopLevel ?? {})),
    ],
  };
}

// ---------------------------------------------------------------------------
// Early-exit tests
// ---------------------------------------------------------------------------

describe("getSessionComparison – early exits", () => {
  it("returns null when target session is not found", async () => {
    const sb = makeSupabase({ sessions: [q(null)] });
    expect(await getSessionComparison(sb as never, "x", "u1")).toBeNull();
  });

  it("returns null when target session has status 'scheduled'", async () => {
    const sb = makeSupabase({
      sessions: [q(sessRow({ status: "scheduled" }))],
    });
    expect(await getSessionComparison(sb as never, "sess-1", "u1")).toBeNull();
  });

  it("returns null when target session status is null", async () => {
    const sb = makeSupabase({
      sessions: [q(sessRow({ status: null }))],
    });
    expect(await getSessionComparison(sb as never, "sess-1", "u1")).toBeNull();
  });

  it("returns null when no previous sessions found (primary + fallback both empty)", async () => {
    const sb = makeSupabase({
      sessions: [
        q(sessRow()),   // target
        q([]),          // primary candidates: empty
        q([]),          // fallback candidates: empty
      ],
    });
    expect(await getSessionComparison(sb as never, "sess-1", "u1")).toBeNull();
  });

  it("returns null when fallback candidates is null", async () => {
    const sb = makeSupabase({
      sessions: [
        q(sessRow()),
        q(null),   // primary null
        q(null),   // fallback null
      ],
    });
    expect(await getSessionComparison(sb as never, "sess-1", "u1")).toBeNull();
  });

  it("returns null when neither activity link is found", async () => {
    const sb = makeSupabase({
      sessions: [
        q(sessRow()),
        q([prevRow()]),
      ],
      session_activity_links: [q(null), q(null)],
    });
    expect(await getSessionComparison(sb as never, "sess-1", "u1")).toBeNull();
  });

  it("returns null when activity rows are missing", async () => {
    const sb = makeSupabase({
      sessions: [q(sessRow()), q([prevRow()])],
      session_activity_links: [q(linkRow("act-c")), q(linkRow("act-p"))],
      completed_activities: [q(null), q(null)],
    });
    expect(await getSessionComparison(sb as never, "sess-1", "u1")).toBeNull();
  });

  it("returns null when all metric fields are null (no deltas built)", async () => {
    const sb = makeSupabase({
      sessions: [q(sessRow({ sport: "run" })), q([prevRow({ sport: "run" })])],
      session_activity_links: [q(linkRow("act-c")), q(linkRow("act-p"))],
      completed_activities: [q(actRow(null)), q(actRow(null))],
    });
    expect(await getSessionComparison(sb as never, "sess-1", "u1")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Run sport metrics
// ---------------------------------------------------------------------------

describe("getSessionComparison – run sport", () => {
  async function run(
    currentMetrics: Record<string, unknown>,
    prevMetrics: Record<string, unknown>
  ): Promise<SessionComparison> {
    const sb = makeSupabase(
      happyQueues({ sport: "run", currentMetrics, prevMetrics })
    );
    const result = await getSessionComparison(sb as never, "sess-1", "u1");
    expect(result).not.toBeNull();
    return result!;
  }

  it("HR delta: 'better' when current HR is lower by ≥3 bpm", async () => {
    const r = await run({ avg_hr: 140 }, { avg_hr: 148 });
    const hr = r.metrics.find((m) => m.metric === "Avg HR")!;
    expect(hr.current).toBe("140 bpm");
    expect(hr.previous).toBe("148 bpm");
    expect(hr.delta).toBe("-8 bpm");
    expect(hr.direction).toBe("better");
    expect(hr.previousDate).toBe("2026-03-01");
  });

  it("HR delta: 'worse' when current HR is higher by ≥3 bpm", async () => {
    const r = await run({ avg_hr: 158 }, { avg_hr: 148 });
    const hr = r.metrics.find((m) => m.metric === "Avg HR")!;
    expect(hr.direction).toBe("worse");
    expect(hr.delta).toBe("+10 bpm");
  });

  it("HR delta: 'neutral' when difference is < 3 bpm", async () => {
    const r = await run({ avg_hr: 150 }, { avg_hr: 148 });
    expect(r.metrics.find((m) => m.metric === "Avg HR")!.direction).toBe("neutral");
  });

  it("pace delta: 'better' when current pace is faster (lower sec/km)", async () => {
    const r = await run({ avg_pace_sec_per_km: 270 }, { avg_pace_sec_per_km: 300 });
    const pace = r.metrics.find((m) => m.metric === "Avg Pace")!;
    expect(pace.current).toBe("4:30/km");
    expect(pace.previous).toBe("5:00/km");
    expect(pace.direction).toBe("better");
    expect(pace.delta).toMatch(/^-/);
  });

  it("pace delta: 'worse' when current pace is slower", async () => {
    const r = await run({ avg_pace_sec_per_km: 330 }, { avg_pace_sec_per_km: 300 });
    expect(r.metrics.find((m) => m.metric === "Avg Pace")!.direction).toBe("worse");
  });

  it("pace delta: 'neutral' when difference is < 5 sec/km", async () => {
    const r = await run({ avg_pace_sec_per_km: 300 }, { avg_pace_sec_per_km: 302 });
    expect(r.metrics.find((m) => m.metric === "Avg Pace")!.direction).toBe("neutral");
  });

  it("pace format pads single-digit seconds (e.g. 4:05/km)", async () => {
    const r = await run({ avg_pace_sec_per_km: 245 }, { avg_pace_sec_per_km: 250 });
    expect(r.metrics.find((m) => m.metric === "Avg Pace")!.current).toBe("4:05/km");
  });

  it("duration delta is always neutral", async () => {
    const r = await run({ duration_sec: 3600 }, { duration_sec: 3000 });
    const dur = r.metrics.find((m) => m.metric === "Duration")!;
    expect(dur.current).toBe("60 min");
    expect(dur.previous).toBe("50 min");
    expect(dur.delta).toBe("+10 min");
    expect(dur.direction).toBe("neutral");
  });

  it("omits pace metric when only one side has pace data", async () => {
    const r = await run({ avg_hr: 145, avg_pace_sec_per_km: 300 }, { avg_hr: 150 });
    expect(r.metrics.find((m) => m.metric === "Avg Pace")).toBeUndefined();
    expect(r.metrics.find((m) => m.metric === "Avg HR")).toBeDefined();
  });

  it("includes all three run metrics when all fields are populated", async () => {
    const r = await run(
      { avg_hr: 140, avg_pace_sec_per_km: 270, duration_sec: 3600 },
      { avg_hr: 150, avg_pace_sec_per_km: 300, duration_sec: 3000 }
    );
    expect(r.metrics).toHaveLength(3);
    const names = r.metrics.map((m) => m.metric);
    expect(names).toContain("Avg HR");
    expect(names).toContain("Avg Pace");
    expect(names).toContain("Duration");
  });

  it("sets correct previousSessionId and previousDate on the result", async () => {
    const r = await run({ avg_hr: 140 }, { avg_hr: 148 });
    expect(r.previousSessionId).toBe("prev-1");
    expect(r.previousDate).toBe("2026-03-01");
  });

  it("negative duration delta when current session is shorter", async () => {
    const r = await run({ duration_sec: 1800 }, { duration_sec: 2400 });
    expect(r.metrics.find((m) => m.metric === "Duration")!.delta).toBe("-10 min");
  });

  it("shows +0 min when durations are equal", async () => {
    const r = await run({ duration_sec: 3600 }, { duration_sec: 3600 });
    // diffMin === 0 → no "+" prefix because the ternary is `diff > 0 ? "+" : ""`
    expect(r.metrics.find((m) => m.metric === "Duration")!.delta).toBe("0 min");
  });
});

// ---------------------------------------------------------------------------
// Bike sport metrics
// ---------------------------------------------------------------------------

describe("getSessionComparison – bike sport", () => {
  async function bike(
    currentMetrics: Record<string, unknown>,
    prevMetrics: Record<string, unknown>,
    sport = "bike"
  ): Promise<SessionComparison> {
    const sb = makeSupabase(
      happyQueues({ sport, prevSport: sport, currentMetrics, prevMetrics })
    );
    const result = await getSessionComparison(sb as never, "sess-1", "u1");
    expect(result).not.toBeNull();
    return result!;
  }

  it("Avg Power: 'better' when current power is higher by ≥5 W", async () => {
    const r = await bike({ avg_power: 220 }, { avg_power: 210 });
    const p = r.metrics.find((m) => m.metric === "Avg Power")!;
    expect(p.current).toBe("220 W");
    expect(p.previous).toBe("210 W");
    expect(p.delta).toBe("+10 W");
    expect(p.direction).toBe("better");
  });

  it("Avg Power: 'worse' when current power is lower by ≥5 W", async () => {
    const r = await bike({ avg_power: 195 }, { avg_power: 210 });
    expect(r.metrics.find((m) => m.metric === "Avg Power")!.direction).toBe("worse");
  });

  it("Avg Power: 'neutral' when difference is < 5 W", async () => {
    const r = await bike({ avg_power: 212 }, { avg_power: 210 });
    expect(r.metrics.find((m) => m.metric === "Avg Power")!.direction).toBe("neutral");
  });

  it("Normalized Power: 'better' when current NP is higher by ≥5 W", async () => {
    const r = await bike({ normalized_power: 235 }, { normalized_power: 220 });
    const np = r.metrics.find((m) => m.metric === "Normalized Power")!;
    expect(np.current).toBe("235 W");
    expect(np.direction).toBe("better");
  });

  it("Normalized Power: 'worse' when current NP is lower by ≥5 W", async () => {
    const r = await bike({ normalized_power: 200 }, { normalized_power: 220 });
    expect(r.metrics.find((m) => m.metric === "Normalized Power")!.direction).toBe("worse");
  });

  it("Normalized Power: 'neutral' when difference is < 5 W", async () => {
    const r = await bike({ normalized_power: 222 }, { normalized_power: 220 });
    expect(r.metrics.find((m) => m.metric === "Normalized Power")!.direction).toBe("neutral");
  });

  it("includes HR delta for bike sessions (lower HR = better)", async () => {
    const r = await bike({ avg_hr: 155, avg_power: 230 }, { avg_hr: 160, avg_power: 220 });
    expect(r.metrics.find((m) => m.metric === "Avg HR")!.direction).toBe("better");
    expect(r.metrics.find((m) => m.metric === "Avg Power")!.direction).toBe("better");
  });

  it("'cycling' sport alias is treated the same as 'bike'", async () => {
    const r = await bike({ avg_power: 225 }, { avg_power: 210 }, "cycling");
    expect(r.metrics.find((m) => m.metric === "Avg Power")!.direction).toBe("better");
  });

  it("returns null when bike metrics produce no deltas", async () => {
    const sb = makeSupabase(happyQueues({ sport: "bike", currentMetrics: {}, prevMetrics: {} }));
    expect(await getSessionComparison(sb as never, "sess-1", "u1")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Swim sport metrics
// ---------------------------------------------------------------------------

describe("getSessionComparison – swim sport", () => {
  async function swim(
    currentMetrics: Record<string, unknown>,
    prevMetrics: Record<string, unknown>
  ): Promise<SessionComparison> {
    const sb = makeSupabase(
      happyQueues({ sport: "swim", prevSport: "swim", currentMetrics, prevMetrics })
    );
    const result = await getSessionComparison(sb as never, "sess-1", "u1");
    expect(result).not.toBeNull();
    return result!;
  }

  it("Avg Pace: 'better' when current swim pace is faster (lower sec/100m)", async () => {
    const r = await swim({ avg_pace_per_100m_sec: 95 }, { avg_pace_per_100m_sec: 102 });
    const pace = r.metrics.find((m) => m.metric === "Avg Pace")!;
    expect(pace.current).toBe("1:35/100m");
    expect(pace.previous).toBe("1:42/100m");
    expect(pace.direction).toBe("better");
    expect(pace.delta).toMatch(/^-/);
  });

  it("Avg Pace: 'worse' when current swim pace is slower", async () => {
    const r = await swim({ avg_pace_per_100m_sec: 108 }, { avg_pace_per_100m_sec: 100 });
    expect(r.metrics.find((m) => m.metric === "Avg Pace")!.direction).toBe("worse");
  });

  it("Avg Pace: 'neutral' when difference is < 2 sec/100m", async () => {
    const r = await swim({ avg_pace_per_100m_sec: 100 }, { avg_pace_per_100m_sec: 101 });
    expect(r.metrics.find((m) => m.metric === "Avg Pace")!.direction).toBe("neutral");
  });

  it("swim pace format pads single-digit seconds (e.g. 1:05/100m)", async () => {
    const r = await swim({ avg_pace_per_100m_sec: 65 }, { avg_pace_per_100m_sec: 70 });
    expect(r.metrics.find((m) => m.metric === "Avg Pace")!.current).toBe("1:05/100m");
  });

  it("Avg SWOLF: 'better' when score decreases by ≥2", async () => {
    const r = await swim({ avg_swolf: 38 }, { avg_swolf: 42 });
    const sw = r.metrics.find((m) => m.metric === "Avg SWOLF")!;
    expect(sw.current).toBe("38");
    expect(sw.previous).toBe("42");
    expect(sw.direction).toBe("better");
    expect(sw.delta).toBe("-4");
  });

  it("Avg SWOLF: 'worse' when score increases by ≥2", async () => {
    const r = await swim({ avg_swolf: 44 }, { avg_swolf: 40 });
    const sw = r.metrics.find((m) => m.metric === "Avg SWOLF")!;
    expect(sw.direction).toBe("worse");
    expect(sw.delta).toBe("+4");
  });

  it("Avg SWOLF: 'neutral' when change is < 2", async () => {
    const r = await swim({ avg_swolf: 40 }, { avg_swolf: 41 });
    expect(r.metrics.find((m) => m.metric === "Avg SWOLF")!.direction).toBe("neutral");
  });

  it("returns null when swim metrics produce no deltas", async () => {
    const sb = makeSupabase(happyQueues({ sport: "swim", prevSport: "swim", currentMetrics: {}, prevMetrics: {} }));
    expect(await getSessionComparison(sb as never, "sess-1", "u1")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Strength sport metrics
// ---------------------------------------------------------------------------

describe("getSessionComparison – strength sport", () => {
  async function strength(
    currentMetrics: Record<string, unknown>,
    prevMetrics: Record<string, unknown>
  ): Promise<SessionComparison> {
    const sb = makeSupabase(
      happyQueues({ sport: "strength", prevSport: "strength", currentMetrics, prevMetrics })
    );
    const result = await getSessionComparison(sb as never, "sess-1", "u1");
    expect(result).not.toBeNull();
    return result!;
  }

  it("Duration is neutral for strength sessions", async () => {
    const r = await strength({ duration_sec: 3600 }, { duration_sec: 2700 });
    const dur = r.metrics.find((m) => m.metric === "Duration")!;
    expect(dur.current).toBe("60 min");
    expect(dur.previous).toBe("45 min");
    expect(dur.delta).toBe("+15 min");
    expect(dur.direction).toBe("neutral");
  });

  it("HR delta: 'better' when current HR is lower for strength", async () => {
    const r = await strength({ avg_hr: 125 }, { avg_hr: 132 });
    expect(r.metrics.find((m) => m.metric === "Avg HR")!.direction).toBe("better");
  });

  it("HR delta: 'worse' when current HR is higher for strength", async () => {
    const r = await strength({ avg_hr: 138 }, { avg_hr: 130 });
    expect(r.metrics.find((m) => m.metric === "Avg HR")!.direction).toBe("worse");
  });

  it("returns null when no strength metrics available", async () => {
    const sb = makeSupabase(
      happyQueues({ sport: "strength", prevSport: "strength", currentMetrics: {}, prevMetrics: {} })
    );
    expect(await getSessionComparison(sb as never, "sess-1", "u1")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Unknown sport returns null
// ---------------------------------------------------------------------------

describe("getSessionComparison – unknown sport", () => {
  it("returns null for an unrecognised sport even when metrics exist", async () => {
    const sb = makeSupabase(
      happyQueues({
        sport: "yoga",
        prevSport: "yoga",
        currentMetrics: { avg_hr: 80, duration_sec: 3600 },
        prevMetrics: { avg_hr: 82, duration_sec: 3000 },
      })
    );
    expect(await getSessionComparison(sb as never, "sess-1", "u1")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Fallback candidate selection
// ---------------------------------------------------------------------------

describe("getSessionComparison – fallback candidate selection", () => {
  it("uses fallback duration-range query when primary type+sport returns empty array", async () => {
    const sb = makeSupabase({
      sessions: [
        q(sessRow({ sport: "bike", type: "Tempo", duration_minutes: 60 })),
        q([]),    // primary (type+sport) empty → trigger fallback
        q([prevRow({ id: "fallback-1", date: "2026-02-15", sport: "bike" })]),
      ],
      session_activity_links: [q(linkRow("act-c")), q(linkRow("act-p"))],
      completed_activities: [
        q(actRow({ avg_power: 240 })),
        q(actRow({ avg_power: 225 })),
      ],
    });
    const result = await getSessionComparison(sb as never, "sess-1", "u1");
    expect(result).not.toBeNull();
    expect(result!.previousSessionId).toBe("fallback-1");
    expect(result!.previousDate).toBe("2026-02-15");
    expect(result!.metrics.find((m) => m.metric === "Avg Power")).toBeDefined();
  });

  it("returns null when both primary and fallback are empty arrays", async () => {
    const sb = makeSupabase({
      sessions: [q(sessRow({ sport: "bike" })), q([]), q([])],
    });
    expect(await getSessionComparison(sb as never, "sess-1", "u1")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Top-level activity columns vs metrics_v2 priority
// ---------------------------------------------------------------------------

describe("getSessionComparison – metrics_v2 vs top-level column fallback", () => {
  it("uses top-level avg_hr column when metrics_v2 is null", async () => {
    const sb = makeSupabase({
      sessions: [q(sessRow({ sport: "run" })), q([prevRow({ sport: "run" })])],
      session_activity_links: [q(linkRow("act-c")), q(linkRow("act-p"))],
      completed_activities: [
        q(actRow(null, { avg_hr: 145 })),
        q(actRow(null, { avg_hr: 152 })),
      ],
    });
    const result = await getSessionComparison(sb as never, "sess-1", "u1");
    expect(result).not.toBeNull();
    const hr = result!.metrics.find((m) => m.metric === "Avg HR")!;
    expect(hr.current).toBe("145 bpm");
    expect(hr.previous).toBe("152 bpm");
  });

  it("prefers metrics_v2 avg_hr over top-level column when both present", async () => {
    const sb = makeSupabase({
      sessions: [q(sessRow({ sport: "run" })), q([prevRow({ sport: "run" })])],
      session_activity_links: [q(linkRow("act-c")), q(linkRow("act-p"))],
      completed_activities: [
        q(actRow({ avg_hr: 143 }, { avg_hr: 999 })),  // top-level 999 should be ignored
        q(actRow({ avg_hr: 150 }, { avg_hr: 888 })),  // top-level 888 should be ignored
      ],
    });
    const result = await getSessionComparison(sb as never, "sess-1", "u1");
    expect(result).not.toBeNull();
    expect(result!.metrics.find((m) => m.metric === "Avg HR")!.current).toBe("143 bpm");
  });

  it("uses top-level avg_power column when metrics_v2 has no avg_power", async () => {
    const sb = makeSupabase({
      sessions: [q(sessRow({ sport: "bike" })), q([prevRow({ sport: "bike" })])],
      session_activity_links: [q(linkRow("act-c")), q(linkRow("act-p"))],
      completed_activities: [
        q(actRow(null, { avg_power: 230 })),
        q(actRow(null, { avg_power: 215 })),
      ],
    });
    const result = await getSessionComparison(sb as never, "sess-1", "u1");
    expect(result).not.toBeNull();
    expect(result!.metrics.find((m) => m.metric === "Avg Power")!.current).toBe("230 W");
  });

  it("uses top-level avg_pace_per_100m_sec column for swim when metrics_v2 is null", async () => {
    const sb = makeSupabase({
      sessions: [q(sessRow({ sport: "swim" })), q([prevRow({ sport: "swim" })])],
      session_activity_links: [q(linkRow("act-c")), q(linkRow("act-p"))],
      completed_activities: [
        q(actRow(null, { avg_pace_per_100m_sec: 95 })),
        q(actRow(null, { avg_pace_per_100m_sec: 102 })),
      ],
    });
    const result = await getSessionComparison(sb as never, "sess-1", "u1");
    expect(result).not.toBeNull();
    expect(result!.metrics.find((m) => m.metric === "Avg Pace")!.current).toBe("1:35/100m");
  });

  it("handles null link (no completed_activity_id) for current session gracefully", async () => {
    const sb = makeSupabase({
      sessions: [q(sessRow({ sport: "run" })), q([prevRow({ sport: "run" })])],
      session_activity_links: [q(null), q(linkRow("act-p"))],
      completed_activities: [q(actRow({ avg_hr: 150 }))],
    });
    // current has no metrics → HR delta can't be built → null
    expect(await getSessionComparison(sb as never, "sess-1", "u1")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// null duration_minutes on target session
// ---------------------------------------------------------------------------

describe("getSessionComparison – null duration_minutes in target session", () => {
  it("handles null duration_minutes without throwing (uses 0/99999 fallback range)", async () => {
    const sb = makeSupabase({
      sessions: [
        q(sessRow({ sport: "bike", duration_minutes: null })),
        q([]),  // primary empty
        q([prevRow({ id: "prev-null-dur", sport: "bike" })]),
      ],
      session_activity_links: [q(linkRow("act-c")), q(linkRow("act-p"))],
      completed_activities: [
        q(actRow({ avg_power: 200 })),
        q(actRow({ avg_power: 190 })),
      ],
    });
    const result = await getSessionComparison(sb as never, "sess-1", "u1");
    expect(result).not.toBeNull();
    expect(result!.previousSessionId).toBe("prev-null-dur");
    expect(result!.metrics.find((m) => m.metric === "Avg Power")).toBeDefined();
  });
});
