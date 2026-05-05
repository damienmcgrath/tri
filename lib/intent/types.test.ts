// Compile-time exhaustiveness checks for the intent type contracts.
// These tests don't really exercise runtime behaviour — they're pinned to the
// spec so adding/removing a literal in the union without updating the
// switch/exhaust helpers below fails the typecheck (and therefore the test).

import type {
  IntendedBlock,
  IntendedBlockType,
  IntentSource,
  ResolvedIntent,
  SessionIntentType,
  SessionStructure,
} from "./types";

function assertNever(x: never): never {
  throw new Error(`unhandled variant: ${String(x)}`);
}

function exhaustIntentType(t: SessionIntentType): string {
  switch (t) {
    case "endurance":
    case "tempo":
    case "threshold":
    case "vo2":
    case "race_prep":
    case "recovery":
    case "open":
    case "race_simulation":
      return t;
    default:
      return assertNever(t);
  }
}

function exhaustStructure(s: SessionStructure): string {
  switch (s) {
    case "steady":
    case "progressive":
    case "intervals":
    case "over_under":
    case "race_simulation":
    case "open":
      return s;
    default:
      return assertNever(s);
  }
}

function exhaustBlockType(b: IntendedBlockType): string {
  switch (b) {
    case "warmup":
    case "work":
    case "easy":
    case "cooldown":
    case "tail":
      return b;
    default:
      return assertNever(b);
  }
}

function exhaustSource(src: IntentSource): string {
  switch (src) {
    case "plan":
    case "athlete_described":
    case "inferred":
    case "open":
      return src;
    default:
      return assertNever(src);
  }
}

describe("intent type contracts (spec §3.2)", () => {
  it("SessionIntentType exhaustively covers every spec literal", () => {
    const all: SessionIntentType[] = [
      "endurance",
      "tempo",
      "threshold",
      "vo2",
      "race_prep",
      "recovery",
      "open",
      "race_simulation",
    ];
    expect(all.map(exhaustIntentType)).toEqual(all);
  });

  it("SessionStructure exhaustively covers every spec literal", () => {
    const all: SessionStructure[] = [
      "steady",
      "progressive",
      "intervals",
      "over_under",
      "race_simulation",
      "open",
    ];
    expect(all.map(exhaustStructure)).toEqual(all);
  });

  it("IntendedBlock.type covers every spec literal", () => {
    const all: IntendedBlockType[] = ["warmup", "work", "easy", "cooldown", "tail"];
    expect(all.map(exhaustBlockType)).toEqual(all);
  });

  it("ResolvedIntent.source covers every spec literal", () => {
    const all: IntentSource[] = ["plan", "athlete_described", "inferred", "open"];
    expect(all.map(exhaustSource)).toEqual(all);
  });

  it("ResolvedIntent accepts a plan-sourced steady endurance ride with blocks", () => {
    const block: IntendedBlock = {
      index: 0,
      duration_min: 60,
      type: "work",
      target_watts: [180, 210],
      target_hr: [135, 150],
      description: "Steady Z2",
    };

    const intent: ResolvedIntent = {
      source: "plan",
      type: "endurance",
      structure: "steady",
      blocks: [block],
      resolved_at: "2026-05-05T12:00:00Z",
    };

    expect(intent.blocks).toHaveLength(1);
    expect(intent.blocks?.[0].target_watts).toEqual([180, 210]);
    expect(intent.parser_version).toBeUndefined();
  });

  it("ResolvedIntent accepts an athlete-described intervals session with parser_version", () => {
    const intent: ResolvedIntent = {
      source: "athlete_described",
      type: "threshold",
      structure: "intervals",
      athlete_notes: "4x8 at threshold, 4 min easy between",
      resolved_at: "2026-05-05T12:00:00Z",
      parser_version: "intent-parser@0.1.0",
      blocks: [
        { index: 0, duration_min: 15, type: "warmup" },
        { index: 1, duration_min: 8, type: "work", target_pace: ["4:30/km", "4:45/km"] },
        { index: 2, duration_min: 4, type: "easy", target_rpe: 3 },
      ],
    };

    expect(intent.parser_version).toBe("intent-parser@0.1.0");
    expect(intent.blocks?.[1].target_pace).toEqual(["4:30/km", "4:45/km"]);
  });

  it("ResolvedIntent accepts an open session with no blocks", () => {
    const intent: ResolvedIntent = {
      source: "open",
      type: "open",
      structure: "open",
      resolved_at: "2026-05-05T12:00:00Z",
    };

    expect(intent.blocks).toBeUndefined();
    expect(intent.athlete_notes).toBeUndefined();
  });
});
