import { render, screen } from "@testing-library/react";
import { createServerClient } from "@supabase/ssr";
import DashboardPage from "./page";

jest.mock("@supabase/ssr", () => ({
  createServerClient: jest.fn()
}));

jest.mock("next/headers", () => ({
  cookies: jest.fn(async () => ({
    getAll: () => [],
    set: jest.fn()
  }))
}));

type QueryResult = {
  data: unknown;
  error?: { code?: string; message?: string } | null;
};

type QueryResponse = { data: unknown; error: { code?: string; message?: string } | null };

type QueryBuilder = {
  eq: (column: string, value: unknown) => QueryBuilder;
  in: (column: string, value: unknown[]) => QueryBuilder;
  or: (filters: string) => QueryBuilder;
  gte: (column: string, value: unknown) => QueryBuilder;
  lte: (column: string, value: unknown) => QueryBuilder;
  lt: (column: string, value: unknown) => QueryBuilder;
  order: (column: string, options?: { ascending?: boolean }) => QueryBuilder;
  limit: (count: number) => QueryBuilder;
  maybeSingle: () => Promise<QueryResponse>;
  then: Promise<QueryResponse>["then"];
  catch: Promise<QueryResponse>["catch"];
  finally: Promise<QueryResponse>["finally"];
};

function createQueryBuilder(result: QueryResult) {
  const resolvedResult: QueryResponse = { data: result.data, error: result.error ?? null };
  const resolvedPromise = Promise.resolve(resolvedResult);
  let builder: QueryBuilder;

  builder = {
    eq: jest.fn(() => builder),
    in: jest.fn(() => builder),
    or: jest.fn(() => builder),
    gte: jest.fn(() => builder),
    lte: jest.fn(() => builder),
    lt: jest.fn(() => builder),
    order: jest.fn(() => builder),
    limit: jest.fn(() => builder),
    maybeSingle: jest.fn(async () => ({
      data: Array.isArray(result.data) ? result.data[0] ?? null : result.data,
      error: result.error ?? null
    })),
    then: resolvedPromise.then.bind(resolvedPromise),
    catch: resolvedPromise.catch.bind(resolvedPromise),
    finally: resolvedPromise.finally.bind(resolvedPromise)
  };

  return builder;
}

function createSupabaseMock(params: { sessions: unknown[]; links?: unknown[] }) {
  const { sessions, links = [] } = params;

  return {
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: {
          user: {
            id: "user-1",
            user_metadata: { timezone: "UTC" }
          }
        }
      })
    },
    from: jest.fn((table: string) => ({
      select: jest.fn((_selectClause: string) => {
        const resultByTable: Record<string, QueryResult> = {
          profiles: {
            data: {
              active_plan_id: "plan-1",
              race_date: null,
              race_name: null
            }
          },
          athlete_context: {
            data: null
          },
          athlete_checkins: {
            data: null
          },
          athlete_observed_patterns: {
            data: []
          },
          training_plans: {
            data: [{ id: "plan-1" }]
          },
          completed_sessions: {
            data: []
          },
          completed_activities: {
            data: [
              {
                id: "a-extra",
                upload_id: "upload-1",
                sport_type: "bike",
                start_time_utc: "2026-03-13T18:26:04.000Z",
                duration_sec: 1826,
                distance_m: 15000,
                avg_hr: 135,
                avg_power: 185,
                schedule_status: "unscheduled",
                is_unplanned: true
              }
            ]
          },
          session_activity_links: {
            data: links
          },
          sessions: {
            data: sessions
          },
          training_weeks: {
            data: []
          },
          weekly_debriefs: {
            data: null
          },
          week_transition_briefings: {
            data: null
          },
          morning_briefs: {
            data: null
          },
          training_scores: {
            data: null
          }
        };

        const result = resultByTable[table];
        if (!result) {
          throw new Error(`Unexpected table in dashboard test: ${table}`);
        }

        return createQueryBuilder(result);
      })
    }))
  };
}

describe("DashboardPage", () => {
  const mockedCreateServerClient = createServerClient as unknown as jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date("2026-03-13T12:00:00.000Z"));
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY = "test-key";
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.resetAllMocks();
  });

  it("shows an extra workout in the Today card while planned work remains", async () => {
    mockedCreateServerClient.mockReturnValue(
      createSupabaseMock({
        sessions: [
          {
            id: "s-today",
            plan_id: "plan-1",
            date: "2026-03-13",
            sport: "run",
            type: "Easy",
            duration_minutes: 45,
            notes: null,
            created_at: "2026-03-10T08:00:00.000Z",
            status: "planned"
          }
        ],
        links: [
          {
            completed_activity_id: "a-extra",
            planned_session_id: null,
            confirmation_status: null
          }
        ]
      })
    );

    render(await DashboardPage({ searchParams: { weekStart: "2026-03-09" } }));

    expect(screen.getByRole("heading", { name: "What matters right now" })).toBeInTheDocument();
    expect(screen.getByText("1 remaining · 1 completed")).toBeInTheDocument();
    expect(screen.getByText("Completed today")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Bike extra workout/i })).toHaveAttribute("href", "/sessions/activity/a-extra");
    expect(screen.getByText("30 min • Done")).toBeInTheDocument();
  });

  describe("behindAlertActive — pace-based attention item suppression", () => {
    // Back-loaded week: small daily sessions Mon–Fri, big blocks on the weekend.
    // By Friday (elapsedDays = 5, expectedByTodayPct = 71%) the linear pace metric fires
    // "behind" even when every session through today is done, because the bulk of volume
    // sits on Sat (120m) and Sun (90m). The fix should suppress the alert in that case.
    function makeSession(id: string, date: string, sport: string, durationMinutes: number, status: "planned" | "completed") {
      return {
        id,
        plan_id: "plan-1",
        date,
        sport,
        type: "Endurance",
        duration_minutes: durationMinutes,
        notes: null,
        created_at: "2026-03-01T08:00:00.000Z",
        status
      };
    }

    const completedWeekdaySessions = [
      makeSession("s-mon", "2026-03-09", "run", 30, "completed"),
      makeSession("s-tue", "2026-03-10", "run", 30, "completed"),
      makeSession("s-wed", "2026-03-11", "run", 30, "completed"),
      makeSession("s-thu", "2026-03-12", "run", 30, "completed"),
    ];

    const bigWeekendSessions = [
      makeSession("s-sat", "2026-03-14", "bike", 120, "planned"),
      makeSession("s-sun", "2026-03-15", "run", 90, "planned"),
    ];

    it("suppresses the behind alert when today is done and no sessions are missed", async () => {
      // Mon–Fri all done; big Sat/Sun blocks still ahead.
      // Linear pace says "behind" but there's nothing actually overdue.
      mockedCreateServerClient.mockReturnValue(
        createSupabaseMock({
          sessions: [
            ...completedWeekdaySessions,
            makeSession("s-fri", "2026-03-13", "run", 30, "completed"), // today — done
            ...bigWeekendSessions
          ],
          links: []
        })
      );

      render(await DashboardPage({ searchParams: { weekStart: "2026-03-09" } }));

      expect(screen.queryByText("You are behind this week")).not.toBeInTheDocument();
      expect(screen.queryByText("Needs attention")).not.toBeInTheDocument();
    });

    it("shows the behind alert when today still has a remaining planned session", async () => {
      // Fri session is still planned — today has remaining work, so the alert should fire.
      mockedCreateServerClient.mockReturnValue(
        createSupabaseMock({
          sessions: [
            ...completedWeekdaySessions,
            makeSession("s-fri", "2026-03-13", "run", 30, "planned"), // today — remaining
            ...bigWeekendSessions
          ],
          links: []
        })
      );

      render(await DashboardPage({ searchParams: { weekStart: "2026-03-09" } }));

      // F12.1: attention copy tightened to "Behind schedule" for the single-
      // line status row under the progress bar.
      expect(screen.getByText("Behind schedule")).toBeInTheDocument();
    });

    it("shows an attention alert when a past session is missed even if today is done", async () => {
      // Thu session was not done (missed) — missedSessionsCount > 0 so alert must appear.
      mockedCreateServerClient.mockReturnValue(
        createSupabaseMock({
          sessions: [
            makeSession("s-mon", "2026-03-09", "run", 30, "completed"),
            makeSession("s-tue", "2026-03-10", "run", 30, "completed"),
            makeSession("s-wed", "2026-03-11", "run", 30, "completed"),
            makeSession("s-thu", "2026-03-12", "run", 30, "planned"), // missed
            makeSession("s-fri", "2026-03-13", "run", 30, "completed"), // today — done
            ...bigWeekendSessions
          ],
          links: []
        })
      );

      render(await DashboardPage({ searchParams: { weekStart: "2026-03-09" } }));

      // F12: the attention signal is now the inline status row in This Week,
      // surfaced by title rather than a "Needs attention" kicker.
      expect(screen.getByText(/1 missed session/)).toBeInTheDocument();
    });
  });

  it("shifts the completed Today card toward the next important session", async () => {
    mockedCreateServerClient.mockReturnValue(
      createSupabaseMock({
        sessions: [
          {
            id: "s-long-run",
            plan_id: "plan-1",
            date: "2026-03-15",
            sport: "run",
            type: "Long Run",
            duration_minutes: 90,
            notes: null,
            created_at: "2026-03-10T08:00:00.000Z",
            status: "planned",
            is_key: true
          }
        ],
        links: [
          {
            completed_activity_id: "a-extra",
            planned_session_id: null,
            confirmation_status: null
          }
        ]
      })
    );

    render(await DashboardPage({ searchParams: { weekStart: "2026-03-09" } }));

    expect(screen.getByRole("heading", { name: "Today is done" })).toBeInTheDocument();
    expect(screen.getByText("0 remaining · 1 completed")).toBeInTheDocument();
    expect(screen.getByText("Up next")).toBeInTheDocument();
    expect(screen.getAllByText("Long Run").length).toBeGreaterThan(0);
    expect(screen.getByText("Sunday • 90 min • Key session")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Prepare Long Run/i })).toHaveAttribute("href", "/calendar?focus=s-long-run");
    expect(screen.getByRole("link", { name: /Review today/i })).toHaveAttribute("href", "/sessions/activity/a-extra");
  });
});
