import { AnalyzerRegistry, type Analyzer, type AnalyzerContext } from "./analyzer";
import type { Finding } from "./types";

function makeCtx(overrides: Partial<AnalyzerContext> = {}): AnalyzerContext {
  return {
    session_id: "session-1",
    intent: { source: "open", type: "endurance", structure: "open", resolved_at: "2026-05-05T00:00:00.000Z" },
    timeseries: { sport: "cycling", duration_sec: 3600, has_power: true },
    physModel: { ftp: 250 },
    ...overrides
  };
}

function makeFinding(id: string, overrides: Partial<Finding> = {}): Finding {
  return {
    id,
    analyzer_id: "test",
    analyzer_version: "1.0.0",
    category: "execution",
    polarity: "observation",
    severity: 1,
    headline: `finding ${id}`,
    evidence: [],
    reasoning: "test reasoning",
    scope: "session",
    ...overrides
  };
}

describe("AnalyzerRegistry", () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("returns [] when no analyzers are registered", () => {
    const reg = new AnalyzerRegistry();
    expect(reg.run(makeCtx())).toEqual([]);
  });

  it("runs a single analyzer that applies and returns its findings", () => {
    const reg = new AnalyzerRegistry();
    const analyzer: Analyzer = {
      id: "Happy",
      version: "1.0.0",
      description: "always fires",
      applies_to: () => true,
      analyze: () => [makeFinding("a")]
    };
    reg.register(analyzer);

    const out = reg.run(makeCtx());
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("a");
  });

  it("filters out analyzers whose applies_to returns false", () => {
    const reg = new AnalyzerRegistry();
    const skipped: Analyzer = {
      id: "Skipped",
      version: "1.0.0",
      description: "never applies",
      applies_to: () => false,
      analyze: () => [makeFinding("should-not-appear")]
    };
    const fires: Analyzer = {
      id: "Fires",
      version: "1.0.0",
      description: "applies",
      applies_to: () => true,
      analyze: () => [makeFinding("ok")]
    };
    reg.register(skipped);
    reg.register(fires);

    const out = reg.run(makeCtx());
    expect(out.map((f) => f.id)).toEqual(["ok"]);
  });

  it("isolates exceptions — one throwing analyzer doesn't break others", () => {
    const reg = new AnalyzerRegistry();
    const boom: Analyzer = {
      id: "Boom",
      version: "1.0.0",
      description: "throws",
      applies_to: () => true,
      analyze: () => {
        throw new Error("kaboom");
      }
    };
    const good: Analyzer = {
      id: "Good",
      version: "1.0.0",
      description: "fine",
      applies_to: () => true,
      analyze: () => [makeFinding("good")]
    };
    reg.register(boom);
    reg.register(good);

    const out = reg.run(makeCtx());
    expect(out.map((f) => f.id)).toEqual(["good"]);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("[Boom]"),
      expect.any(Error)
    );
  });

  it("concatenates findings from multiple analyzers in registration order", () => {
    const reg = new AnalyzerRegistry();
    reg.register({
      id: "A",
      version: "1.0.0",
      description: "",
      applies_to: () => true,
      analyze: () => [makeFinding("a1"), makeFinding("a2")]
    });
    reg.register({
      id: "B",
      version: "1.0.0",
      description: "",
      applies_to: () => true,
      analyze: () => [makeFinding("b1")]
    });

    const out = reg.run(makeCtx());
    expect(out.map((f) => f.id)).toEqual(["a1", "a2", "b1"]);
  });

  it("plumbs prior_findings through to every analyzer", () => {
    const reg = new AnalyzerRegistry();
    const prior = [makeFinding("seed", { analyzer_id: "Seed" })];
    const captured: AnalyzerContext[] = [];

    const recorder: Analyzer = {
      id: "Recorder",
      version: "1.0.0",
      description: "captures ctx",
      applies_to: (ctx) => {
        captured.push(ctx);
        return true;
      },
      analyze: (ctx) => [
        makeFinding("derived", {
          reasoning: `saw ${ctx.prior_findings?.length ?? 0} prior`
        })
      ]
    };
    reg.register(recorder);

    const out = reg.run(makeCtx({ prior_findings: prior }));
    expect(captured[0].prior_findings).toBe(prior);
    expect(out[0].reasoning).toBe("saw 1 prior");
  });

  it("evaluates applies_to against the live context (sport gating)", () => {
    const reg = new AnalyzerRegistry();
    const cyclingOnly: Analyzer = {
      id: "CyclingOnly",
      version: "1.0.0",
      description: "",
      applies_to: (ctx) => ctx.timeseries.sport === "cycling",
      analyze: () => [makeFinding("ride")]
    };
    reg.register(cyclingOnly);

    expect(reg.run(makeCtx({ timeseries: { sport: "cycling", duration_sec: 60 } }))).toHaveLength(1);
    expect(reg.run(makeCtx({ timeseries: { sport: "swim", duration_sec: 60 } }))).toHaveLength(0);
  });
});
