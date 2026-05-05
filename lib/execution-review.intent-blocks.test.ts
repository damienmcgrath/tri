/**
 * Spec: tri.ai Findings Pipeline Spec §3 (Phase 2 — issue #396 integration).
 *
 * Verifies the integration wiring:
 *   1. Five structured-intent sessions cause `detectBlocks` → `detectedBlocks`
 *      to flow into `buildSessionVerdictPrompt`'s user payload.
 *   2. Skipping intent capture (no resolved intent OR `structure: 'steady'`)
 *      still yields a coherent verdict prompt with no `detectedBlocks` block.
 */

import { detectBlocks } from "@/lib/blocks/detector";
import type { BlockDetectorTimeseries, DetectedBlock } from "@/lib/blocks/types";
import { buildSessionVerdictPrompt } from "@/lib/execution-review-prompt";
import type { AthletePhysModel, Finding } from "@/lib/findings/types";
import type { IntendedBlock, ResolvedIntent } from "@/lib/intent/types";

function steadySamples(durationSec: number, watts: number): BlockDetectorTimeseries["samples"] {
  const samples: BlockDetectorTimeseries["samples"] = [];
  for (let t = 0; t < durationSec; t += 1) {
    samples.push({ t_sec: t, power: watts, hr: 140 });
  }
  return samples;
}

function intervalSamples(args: {
  warmupSec: number;
  workSec: number;
  easySec: number;
  reps: number;
  cooldownSec: number;
  workWatts: number;
  easyWatts: number;
}): BlockDetectorTimeseries["samples"] {
  const samples: BlockDetectorTimeseries["samples"] = [];
  let cursor = 0;
  for (let t = 0; t < args.warmupSec; t++, cursor++) {
    samples.push({ t_sec: cursor, power: args.easyWatts, hr: 130 });
  }
  for (let r = 0; r < args.reps; r++) {
    for (let t = 0; t < args.workSec; t++, cursor++) {
      samples.push({ t_sec: cursor, power: args.workWatts, hr: 165 });
    }
    if (r < args.reps - 1) {
      for (let t = 0; t < args.easySec; t++, cursor++) {
        samples.push({ t_sec: cursor, power: args.easyWatts, hr: 140 });
      }
    }
  }
  for (let t = 0; t < args.cooldownSec; t++, cursor++) {
    samples.push({ t_sec: cursor, power: args.easyWatts, hr: 130 });
  }
  return samples;
}

interface SampleSession {
  label: string;
  intent: ResolvedIntent;
  timeseries: BlockDetectorTimeseries;
}

function sampleSessions(): SampleSession[] {
  const buildIntervalIntent = (reps: number, workMin: number, easyMin: number): IntendedBlock[] => {
    const blocks: IntendedBlock[] = [
      { index: 0, duration_min: 15, type: "warmup" }
    ];
    for (let r = 0; r < reps; r++) {
      blocks.push({
        index: blocks.length,
        duration_min: workMin,
        type: "work",
        target_watts: [240, 260]
      });
      if (r < reps - 1) {
        blocks.push({
          index: blocks.length,
          duration_min: easyMin,
          type: "easy"
        });
      }
    }
    blocks.push({ index: blocks.length, duration_min: 10, type: "cooldown" });
    return blocks;
  };

  return [
    {
      label: "5x4min vo2",
      intent: {
        source: "athlete_described",
        type: "vo2",
        structure: "intervals",
        blocks: buildIntervalIntent(5, 4, 3),
        resolved_at: "2026-05-05T10:00:00.000Z",
        parser_version: "1.0.0"
      },
      timeseries: {
        sport: "bike",
        duration_sec: 15 * 60 + 5 * (4 * 60) + 4 * (3 * 60) + 10 * 60,
        samples: intervalSamples({
          warmupSec: 15 * 60,
          workSec: 4 * 60,
          easySec: 3 * 60,
          reps: 5,
          cooldownSec: 10 * 60,
          workWatts: 320,
          easyWatts: 150
        })
      }
    },
    {
      label: "4x8min threshold",
      intent: {
        source: "athlete_described",
        type: "threshold",
        structure: "intervals",
        blocks: buildIntervalIntent(4, 8, 4),
        resolved_at: "2026-05-05T11:00:00.000Z",
        parser_version: "1.0.0"
      },
      timeseries: {
        sport: "bike",
        duration_sec: 15 * 60 + 4 * (8 * 60) + 3 * (4 * 60) + 10 * 60,
        samples: intervalSamples({
          warmupSec: 15 * 60,
          workSec: 8 * 60,
          easySec: 4 * 60,
          reps: 4,
          cooldownSec: 10 * 60,
          workWatts: 250,
          easyWatts: 150
        })
      }
    },
    {
      label: "3x10min sweet-spot",
      intent: {
        source: "athlete_described",
        type: "tempo",
        structure: "intervals",
        blocks: buildIntervalIntent(3, 10, 5),
        resolved_at: "2026-05-05T12:00:00.000Z",
        parser_version: "1.0.0"
      },
      timeseries: {
        sport: "bike",
        duration_sec: 15 * 60 + 3 * (10 * 60) + 2 * (5 * 60) + 10 * 60,
        samples: intervalSamples({
          warmupSec: 15 * 60,
          workSec: 10 * 60,
          easySec: 5 * 60,
          reps: 3,
          cooldownSec: 10 * 60,
          workWatts: 230,
          easyWatts: 145
        })
      }
    },
    {
      label: "2x20min threshold",
      intent: {
        source: "athlete_described",
        type: "threshold",
        structure: "intervals",
        blocks: buildIntervalIntent(2, 20, 5),
        resolved_at: "2026-05-05T13:00:00.000Z",
        parser_version: "1.0.0"
      },
      timeseries: {
        sport: "bike",
        duration_sec: 15 * 60 + 2 * (20 * 60) + 5 * 60 + 10 * 60,
        samples: intervalSamples({
          warmupSec: 15 * 60,
          workSec: 20 * 60,
          easySec: 5 * 60,
          reps: 2,
          cooldownSec: 10 * 60,
          workWatts: 245,
          easyWatts: 150
        })
      }
    },
    {
      label: "6x3min vo2",
      intent: {
        source: "athlete_described",
        type: "vo2",
        structure: "intervals",
        blocks: buildIntervalIntent(6, 3, 3),
        resolved_at: "2026-05-05T14:00:00.000Z",
        parser_version: "1.0.0"
      },
      timeseries: {
        sport: "bike",
        duration_sec: 15 * 60 + 6 * (3 * 60) + 5 * (3 * 60) + 10 * 60,
        samples: intervalSamples({
          warmupSec: 15 * 60,
          workSec: 3 * 60,
          easySec: 3 * 60,
          reps: 6,
          cooldownSec: 10 * 60,
          workWatts: 330,
          easyWatts: 150
        })
      }
    }
  ];
}

const baseAthlete: AthletePhysModel = { ftp: 250 };
const baseFinding: Finding = {
  id: "completion_match",
  analyzer_id: "completion",
  analyzer_version: "1.0.0",
  category: "execution",
  polarity: "positive",
  severity: 1,
  headline: "Completed full session.",
  evidence: [{ metric: "duration_completion", value: 1.0, unit: "ratio" }],
  reasoning: "Session duration matched the plan.",
  scope: "session"
};

describe("issue #396 integration: structured intent → detected blocks → prompt", () => {
  test("five structured-intent sessions produce non-empty detectedBlocks that flow into the user payload", () => {
    const sessions = sampleSessions();
    expect(sessions).toHaveLength(5);

    for (const session of sessions) {
      const detected = detectBlocks(session.intent.blocks!, session.timeseries);
      expect(detected.length).toBe(session.intent.blocks!.length);

      const { user } = buildSessionVerdictPrompt({
        intent: session.intent,
        findings: [baseFinding],
        athlete: baseAthlete,
        detectedBlocks: detected
      });

      expect(user).toContain("detectedBlocks:");
      expect(user).toMatch(/block 0 \(warmup/);
      expect(user).toMatch(/block 1 \(work/);
      expect(user).toMatch(/conf=/);
    }
  });

  test("skip-flow: no resolved intent → prompt builds without detectedBlocks block, verdict still produced", () => {
    const openIntent: ResolvedIntent = {
      source: "open",
      type: "open",
      structure: "open",
      resolved_at: "2026-05-05T15:00:00.000Z",
      parser_version: "1.0.0"
    };

    const { user } = buildSessionVerdictPrompt({
      intent: openIntent,
      findings: [baseFinding],
      athlete: baseAthlete
    });

    expect(user).not.toContain("detectedBlocks:");
    expect(user).toContain("intent:");
    expect(user).toContain("type: open");
    expect(user).toContain("structure: open");
    expect(user).toContain("findings:");
  });

  test("skip-flow: passing detectedBlocks=[] still omits the block section", () => {
    const steadyIntent: ResolvedIntent = {
      source: "athlete_described",
      type: "endurance",
      structure: "steady",
      blocks: [],
      resolved_at: "2026-05-05T16:00:00.000Z",
      parser_version: "1.0.0"
    };

    const detected: DetectedBlock[] = [];
    const { user } = buildSessionVerdictPrompt({
      intent: steadyIntent,
      findings: [baseFinding],
      athlete: baseAthlete,
      detectedBlocks: detected
    });

    expect(user).not.toContain("detectedBlocks:");
  });

  test("steady-state intent: detectBlocks runs harmlessly when blocks list non-empty", () => {
    const steadySession = {
      sport: "bike",
      duration_sec: 60 * 60,
      samples: steadySamples(60 * 60, 180)
    };
    const blocks: IntendedBlock[] = [
      { index: 0, duration_min: 15, type: "warmup" },
      { index: 1, duration_min: 30, type: "work" },
      { index: 2, duration_min: 15, type: "cooldown" }
    ];
    const detected = detectBlocks(blocks, steadySession);
    expect(detected).toHaveLength(3);
    for (const block of detected) {
      expect(block.alignment_confidence).toBeGreaterThanOrEqual(0);
      expect(block.alignment_confidence).toBeLessThanOrEqual(1);
    }
  });
});
