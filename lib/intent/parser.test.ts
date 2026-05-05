// Unit tests for the LLM-backed intent parser.
// Spec: tri.ai Findings Pipeline Spec §3.4.

import labeledFixture from "./__fixtures__/labeled-intents.json";

import type { ResolvedIntent } from "@/lib/intent/types";

const mockCreate = jest.fn();

jest.mock("../openai", () => ({
  getOpenAIClient: () => ({
    chat: { completions: { create: (...args: unknown[]) => mockCreate(...args) } },
  }),
  extractJsonObject: (text: string) => {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  },
}));

// Import after the mock so the parser picks it up.
import { PARSER_VERSION, parseAthleteIntent, validateIntent } from "./parser";

const ORIGINAL_API_KEY = process.env.OPENAI_API_KEY;
let warnSpy: jest.SpyInstance;

beforeEach(() => {
  mockCreate.mockReset();
  process.env.OPENAI_API_KEY = "sk-test-key";
  warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
});

afterAll(() => {
  if (ORIGINAL_API_KEY === undefined) {
    delete process.env.OPENAI_API_KEY;
  } else {
    process.env.OPENAI_API_KEY = ORIGINAL_API_KEY;
  }
});

function mockOnce(content: string | null) {
  mockCreate.mockResolvedValueOnce({
    choices: [{ message: { content } }],
  });
}

const ATHLETE = { ftp: 250, threshold_pace: 240 };

describe("parseAthleteIntent — successful parse", () => {
  it("resolves a structured intervals session into ResolvedIntent", async () => {
    mockOnce(
      JSON.stringify({
        type: "threshold",
        structure: "intervals",
        confidence: 0.95,
        athlete_notes: "5x4min @ threshold",
        blocks: [
          { index: 0, duration_min: 12, type: "warmup", description: "Easy warmup" },
          {
            index: 1,
            duration_min: 4,
            type: "work",
            target_watts: [243, 258],
            description: "Threshold rep",
          },
          { index: 2, duration_min: 3, type: "easy", description: "Recovery" },
          {
            index: 3,
            duration_min: 4,
            type: "work",
            target_watts: [243, 258],
            description: "Threshold rep",
          },
          { index: 4, duration_min: 10, type: "cooldown", description: "Spin down" },
        ],
      })
    );

    const result = await parseAthleteIntent(
      "5x4min at threshold with 3 min easy between, plus warmup and cooldown.",
      { session_sport: "bike", session_duration_min: 75, athlete: ATHLETE }
    );

    expect(result.source).toBe("athlete_described");
    expect(result.type).toBe("threshold");
    expect(result.structure).toBe("intervals");
    expect(result.parser_version).toBe(PARSER_VERSION);
    expect(result.resolved_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.blocks).toHaveLength(5);
    expect(result.blocks?.[1].target_watts).toEqual([243, 258]);
    expect(result.athlete_notes).toBe("5x4min @ threshold");
  });

  it("forwards the configured model and temperature=0 to the LLM", async () => {
    process.env.OPENAI_INTENT_MODEL = "gpt-4o-mini";
    mockOnce(
      JSON.stringify({
        type: "endurance",
        structure: "steady",
        confidence: 0.9,
        blocks: [{ index: 0, duration_min: 60, type: "easy", description: "Z2" }],
      })
    );

    await parseAthleteIntent("Easy Z2 ride", {
      session_sport: "bike",
      session_duration_min: 60,
      athlete: ATHLETE,
    });

    const [params] = mockCreate.mock.calls[0];
    expect(params.model).toBe("gpt-4o-mini");
    expect(params.temperature).toBe(0);
    expect(params.response_format).toEqual({ type: "json_object" });
    expect(params.messages).toHaveLength(2);
    expect(params.messages[0].role).toBe("system");
    expect(params.messages[1].role).toBe("user");
    expect(params.messages[1].content).toContain("Athlete description:");
    expect(params.messages[1].content).toContain("Easy Z2 ride");

    delete process.env.OPENAI_INTENT_MODEL;
  });

  it("respects OPENAI_INTENT_MODEL override", async () => {
    process.env.OPENAI_INTENT_MODEL = "gpt-4.1-mini";
    mockOnce(
      JSON.stringify({ type: "endurance", structure: "steady", confidence: 0.9, blocks: [] })
    );

    await parseAthleteIntent("Easy run", {
      session_sport: "run",
      session_duration_min: 30,
      athlete: ATHLETE,
    });

    expect(mockCreate.mock.calls[0][0].model).toBe("gpt-4.1-mini");

    delete process.env.OPENAI_INTENT_MODEL;
  });
});

describe("parseAthleteIntent — fallback paths", () => {
  it("falls back when the model returns invalid JSON", async () => {
    mockOnce("not valid json at all {{{");

    const result = await parseAthleteIntent("Some workout", {
      session_sport: "bike",
      session_duration_min: 60,
      athlete: ATHLETE,
    });

    expect(result.source).toBe("inferred");
    expect(result.structure).toBe("open");
    expect(result.type).toBe("open");
    expect(result.parser_version).toBe(PARSER_VERSION);
    expect(result.blocks).toEqual([]);
  });

  it("falls back on low confidence (< 0.5)", async () => {
    mockOnce(
      JSON.stringify({
        type: "tempo",
        structure: "intervals",
        confidence: 0.2,
        athlete_notes: "vague description",
        blocks: [{ index: 0, duration_min: 60, type: "work" }],
      })
    );

    const result = await parseAthleteIntent("idk something hard maybe", {
      session_sport: "bike",
      session_duration_min: 60,
      athlete: ATHLETE,
    });

    expect(result.source).toBe("inferred");
    expect(result.structure).toBe("open");
    expect(result.type).toBe("open");
    // Notes from low-confidence parse are preserved for downstream display.
    expect(result.athlete_notes).toBe("vague description");
  });

  it("falls back when JSON parses but fails schema validation", async () => {
    mockOnce(JSON.stringify({ type: "not_a_real_type", structure: "intervals" }));

    const result = await parseAthleteIntent("workout", {
      session_sport: "bike",
      session_duration_min: 60,
      athlete: ATHLETE,
    });

    expect(result.source).toBe("inferred");
    expect(result.structure).toBe("open");
  });

  it("falls back when the OpenAI client throws", async () => {
    mockCreate.mockRejectedValueOnce(new Error("network down"));

    const result = await parseAthleteIntent("workout", {
      session_sport: "bike",
      session_duration_min: 60,
      athlete: ATHLETE,
    });

    expect(result.source).toBe("inferred");
    expect(result.structure).toBe("open");
  });

  it("falls back when the model returns empty content", async () => {
    mockOnce("");

    const result = await parseAthleteIntent("workout", {
      session_sport: "bike",
      session_duration_min: 60,
      athlete: ATHLETE,
    });

    expect(result.source).toBe("inferred");
    expect(result.structure).toBe("open");
  });

  it("falls back without calling OpenAI when OPENAI_API_KEY is missing", async () => {
    delete process.env.OPENAI_API_KEY;

    const result = await parseAthleteIntent("workout", {
      session_sport: "bike",
      session_duration_min: 60,
      athlete: ATHLETE,
    });

    expect(result.source).toBe("inferred");
    expect(result.structure).toBe("open");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("falls back on empty/whitespace input without calling OpenAI", async () => {
    const result = await parseAthleteIntent("   \n  ", {
      session_sport: "bike",
      session_duration_min: 60,
      athlete: ATHLETE,
    });

    expect(result.source).toBe("inferred");
    expect(result.structure).toBe("open");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("treats missing confidence as a confident parse", async () => {
    mockOnce(
      JSON.stringify({
        type: "endurance",
        structure: "steady",
        blocks: [{ index: 0, duration_min: 45, type: "easy" }],
      })
    );

    const result = await parseAthleteIntent("Easy run", {
      session_sport: "run",
      session_duration_min: 45,
      athlete: ATHLETE,
    });

    expect(result.source).toBe("athlete_described");
    expect(result.structure).toBe("steady");
  });
});

describe("validateIntent", () => {
  const baseIntent: ResolvedIntent = {
    source: "athlete_described",
    type: "threshold",
    structure: "intervals",
    blocks: [
      { index: 0, duration_min: 12, type: "warmup" },
      { index: 1, duration_min: 4, type: "work", target_watts: [240, 260] },
    ],
    resolved_at: new Date().toISOString(),
    parser_version: "1.0.0",
  };

  it("returns the parsed value for a valid ResolvedIntent", () => {
    const validated = validateIntent(baseIntent);
    expect(validated).toEqual(baseIntent);
  });

  it("rejects an unknown source", () => {
    expect(() =>
      validateIntent({ ...baseIntent, source: "nonsense" })
    ).toThrow(/Invalid ResolvedIntent/);
  });

  it("rejects an unknown structure", () => {
    expect(() =>
      validateIntent({ ...baseIntent, structure: "tempo_intervals" })
    ).toThrow(/Invalid ResolvedIntent/);
  });

  it("rejects an unknown intent type", () => {
    expect(() =>
      validateIntent({ ...baseIntent, type: "junk" })
    ).toThrow(/Invalid ResolvedIntent/);
  });

  it("rejects when blocks contain an invalid block_type", () => {
    expect(() =>
      validateIntent({
        ...baseIntent,
        blocks: [{ index: 0, duration_min: 5, type: "sprintzz" }],
      })
    ).toThrow(/Invalid ResolvedIntent/);
  });

  it("rejects when block.duration_min is non-positive", () => {
    expect(() =>
      validateIntent({
        ...baseIntent,
        blocks: [{ index: 0, duration_min: 0, type: "warmup" }],
      })
    ).toThrow(/Invalid ResolvedIntent/);
  });

  it("rejects target_watts that isn't a [low, high] tuple", () => {
    expect(() =>
      validateIntent({
        ...baseIntent,
        blocks: [
          { index: 0, duration_min: 4, type: "work", target_watts: [240] },
        ],
      })
    ).toThrow(/Invalid ResolvedIntent/);
  });

  it("rejects when resolved_at is missing", () => {
    const { resolved_at: _resolved_at, ...withoutTimestamp } = baseIntent;
    expect(() => validateIntent(withoutTimestamp)).toThrow(/Invalid ResolvedIntent/);
  });

  it("rejects a non-object input", () => {
    expect(() => validateIntent("intent")).toThrow(/Invalid ResolvedIntent/);
    expect(() => validateIntent(null)).toThrow(/Invalid ResolvedIntent/);
    expect(() => validateIntent(42)).toThrow(/Invalid ResolvedIntent/);
  });
});

describe("labeled fixture sanity", () => {
  it("includes ≥20 examples covering all 6 structures and run/swim/bike", () => {
    expect(labeledFixture.length).toBeGreaterThanOrEqual(20);

    const structures = new Set(labeledFixture.map((f) => f.expected.structure));
    expect(structures).toEqual(
      new Set([
        "steady",
        "progressive",
        "intervals",
        "over_under",
        "race_simulation",
        "open",
      ])
    );

    const sports = new Set(labeledFixture.map((f) => f.sport));
    expect(sports.has("run")).toBe(true);
    expect(sports.has("swim")).toBe(true);
    expect(sports.has("bike")).toBe(true);
  });
});

// ─── Live accuracy gate ───────────────────────────────────────────────────────
// Set INTENT_PARSER_LIVE=true and a real OPENAI_API_KEY to run.
// Asserts that ≥17/20 fixture examples match the labeled `structure`.
const LIVE = process.env.INTENT_PARSER_LIVE === "true";
const liveDescribe = LIVE ? describe : describe.skip;

liveDescribe("parseAthleteIntent — live labeled accuracy", () => {
  jest.setTimeout(120_000);

  beforeAll(() => {
    // Restore the real client by un-mocking; the live test calls the real API.
    // Skip if no real key is set so we don't flake locally.
    if (!process.env.OPENAI_API_KEY?.startsWith("sk-")) {
      throw new Error("Set OPENAI_API_KEY to run INTENT_PARSER_LIVE accuracy test.");
    }
  });

  it("matches labeled structure on at least 17/20 fixtures", async () => {
    // Drop the parser-level mock so the real client is used.
    jest.unmock("../openai");

    const { parseAthleteIntent: realParse } = await import("./parser");

    const results = await Promise.all(
      labeledFixture.map(async (fixture) => {
        const parsed = await realParse(fixture.text, {
          session_sport: fixture.sport,
          session_duration_min: fixture.duration_min,
          athlete: fixture.athlete,
        });
        return {
          id: fixture.id,
          expected: fixture.expected.structure,
          actual: parsed.structure,
          match: parsed.structure === fixture.expected.structure,
        };
      })
    );

    const matches = results.filter((r) => r.match).length;
    if (matches < 17) {
      console.warn(
        "[intent-parser:live] Mismatches:",
        results.filter((r) => !r.match)
      );
    }
    expect(matches).toBeGreaterThanOrEqual(17);
  });
});
