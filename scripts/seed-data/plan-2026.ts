/**
 * Historical training plan for D McG — Half IM 2026.
 *
 * Transcribed from the "Tri Training Programme Overview" spreadsheet screenshot.
 * Dates are ISO (YYYY-MM-DD); week start = Monday. The DATE WE column in the
 * sheet is the Sunday week-ending date; weekStartDate below is that Sunday − 6.
 *
 * Splitting rules applied to composite labels:
 *   - "Swim + X | D"     → swim=60, X=D-60 (D includes swim)
 *   - "Gym + X | D"      → gym=45 separate, X=D (coach excluded gym from total)
 *   - "Gym + Swim | D"   → gym=45, swim=60 (both canonical, D ignored)
 *   - "GYM + EZ Spin + OW Swim | D" → gym=45, OW swim=45, spin=D-45
 *   - "Long Brick (X x Y)" → bike + run pair (bike ≈ 2/3 of D, run = remainder)
 *
 * Reconstructed weeks (Blocks 1 & 2, pre 2026-02-23) are marked
 * `reconstructed: true` so you can trace them in source_metadata.
 */

import type { SeedPlan } from "./types";

export const PLAN_2026: SeedPlan = {
  seasonName: "2026 Half Ironman",
  raceName: "Half IM",
  raceDate: "2026-06-07",
  planName: "D McG Tri Training Programme 2026",
  planStartDate: "2025-11-03",
  durationWeeks: 31,
  blocks: [
    // ======================================================================
    // BLOCK 1 — PHASE 1: Strength + Bike power (weeks 1–8)
    // Reconstructed retrospectively; planning began ~2026-02-23.
    // ======================================================================
    {
      name: "Block 1 — Strength + Bike Power",
      blockType: "Base",
      startDate: "2025-11-03",
      endDate: "2025-12-28",
      emphasis: ["strength", "bike-power"],
      weeks: [
        {
          weekIndex: 1,
          weekStartDate: "2025-11-03",
          focus: "Build",
          sessions: [
            { date: "2025-11-03", sport: "strength", sessionName: "Gym", durationMinutes: 45, notes: "Gym + EZ Run" },
            { date: "2025-11-03", sport: "run", sessionName: "EZ Run", durationMinutes: 30, notes: "Gym + EZ Run" },
            { date: "2025-11-04", sport: "strength", sessionName: "Gym", durationMinutes: 45, notes: "Gym + Swim" },
            { date: "2025-11-04", sport: "swim", sessionName: "Swim", durationMinutes: 60, notes: "Gym + Swim" },
            { date: "2025-11-06", sport: "bike", sessionName: "FTP", durationMinutes: 30 },
            { date: "2025-11-07", sport: "strength", sessionName: "Gym", durationMinutes: 40 },
            { date: "2025-11-08", sport: "bike", sessionName: "Long Bike", durationMinutes: 60 },
            { date: "2025-11-09", sport: "run", sessionName: "Long Run", durationMinutes: 60 },
          ],
        },
        {
          weekIndex: 2,
          weekStartDate: "2025-11-10",
          focus: "Build",
          sessions: [
            { date: "2025-11-10", sport: "strength", sessionName: "Gym", durationMinutes: 45, notes: "Gym + EZ Run" },
            { date: "2025-11-10", sport: "run", sessionName: "EZ Run", durationMinutes: 30, notes: "Gym + EZ Run" },
            { date: "2025-11-11", sport: "bike", sessionName: "EZ Bike", durationMinutes: 90 },
            { date: "2025-11-13", sport: "bike", sessionName: "Power Bike", durationMinutes: 60 },
            { date: "2025-11-14", sport: "strength", sessionName: "Gym", durationMinutes: 40 },
            { date: "2025-11-15", sport: "bike", sessionName: "Long Bike", durationMinutes: 60 },
            { date: "2025-11-16", sport: "run", sessionName: "Long Run", durationMinutes: 60 },
          ],
        },
        {
          weekIndex: 3,
          weekStartDate: "2025-11-17",
          focus: "Build",
          sessions: [
            { date: "2025-11-17", sport: "strength", sessionName: "Gym", durationMinutes: 45, notes: "Gym + EZ Run" },
            { date: "2025-11-17", sport: "run", sessionName: "EZ Run", durationMinutes: 30, notes: "Gym + EZ Run" },
            { date: "2025-11-18", sport: "bike", sessionName: "EZ Bike", durationMinutes: 45 },
            { date: "2025-11-20", sport: "bike", sessionName: "Power Bike", durationMinutes: 60 },
            { date: "2025-11-21", sport: "strength", sessionName: "Gym", durationMinutes: 40 },
            { date: "2025-11-22", sport: "bike", sessionName: "Long Bike", durationMinutes: 75 },
            { date: "2025-11-23", sport: "run", sessionName: "Long Run", durationMinutes: 75 },
          ],
        },
        {
          weekIndex: 4,
          weekStartDate: "2025-11-24",
          focus: "Build",
          sessions: [
            { date: "2025-11-24", sport: "strength", sessionName: "Gym", durationMinutes: 45, notes: "Gym + EZ Run" },
            { date: "2025-11-24", sport: "run", sessionName: "EZ Run", durationMinutes: 30, notes: "Gym + EZ Run" },
            { date: "2025-11-25", sport: "bike", sessionName: "EZ Bike", durationMinutes: 45 },
            { date: "2025-11-27", sport: "bike", sessionName: "Power Bike", durationMinutes: 60 },
            { date: "2025-11-28", sport: "strength", sessionName: "Gym", durationMinutes: 40 },
            { date: "2025-11-29", sport: "bike", sessionName: "Long Bike", durationMinutes: 75 },
            { date: "2025-11-30", sport: "run", sessionName: "Long Run", durationMinutes: 75 },
          ],
        },
        {
          weekIndex: 5,
          weekStartDate: "2025-12-01",
          focus: "Build",
          sessions: [
            { date: "2025-12-01", sport: "strength", sessionName: "Gym", durationMinutes: 45, notes: "Gym + EZ Run" },
            { date: "2025-12-01", sport: "run", sessionName: "EZ Run", durationMinutes: 45, notes: "Gym + EZ Run" },
            { date: "2025-12-02", sport: "bike", sessionName: "EZ Bike", durationMinutes: 45 },
            { date: "2025-12-04", sport: "bike", sessionName: "Power Bike", durationMinutes: 60 },
            { date: "2025-12-05", sport: "strength", sessionName: "Gym", durationMinutes: 40 },
            { date: "2025-12-06", sport: "bike", sessionName: "Long Bike", durationMinutes: 90 },
            { date: "2025-12-07", sport: "run", sessionName: "Long Run", durationMinutes: 75 },
          ],
        },
        {
          weekIndex: 6,
          weekStartDate: "2025-12-08",
          focus: "Build",
          sessions: [
            { date: "2025-12-08", sport: "strength", sessionName: "Gym", durationMinutes: 45, notes: "Gym + EZ Run" },
            { date: "2025-12-08", sport: "run", sessionName: "EZ Run", durationMinutes: 45, notes: "Gym + EZ Run" },
            { date: "2025-12-09", sport: "bike", sessionName: "EZ Bike", durationMinutes: 45 },
            { date: "2025-12-11", sport: "bike", sessionName: "Power Bike", durationMinutes: 60 },
            { date: "2025-12-12", sport: "strength", sessionName: "Gym", durationMinutes: 40 },
            { date: "2025-12-13", sport: "bike", sessionName: "Long Bike", durationMinutes: 90 },
            { date: "2025-12-14", sport: "run", sessionName: "Long Run", durationMinutes: 75 },
          ],
        },
        {
          weekIndex: 7,
          weekStartDate: "2025-12-15",
          focus: "Build",
          sessions: [
            { date: "2025-12-15", sport: "strength", sessionName: "Gym", durationMinutes: 45, notes: "Gym + EZ Run" },
            { date: "2025-12-15", sport: "run", sessionName: "EZ Run", durationMinutes: 45, notes: "Gym + EZ Run" },
            { date: "2025-12-16", sport: "bike", sessionName: "EZ Bike", durationMinutes: 45 },
            { date: "2025-12-18", sport: "bike", sessionName: "FTP", durationMinutes: 30 },
            { date: "2025-12-19", sport: "strength", sessionName: "Gym", durationMinutes: 40 },
            { date: "2025-12-20", sport: "bike", sessionName: "Long Bike", durationMinutes: 60 },
            { date: "2025-12-21", sport: "run", sessionName: "Long Run", durationMinutes: 75 },
          ],
        },
        {
          weekIndex: 8,
          weekStartDate: "2025-12-22",
          focus: "Recovery",
          notes: "Rest / sick week — Christmas holiday. Only Friday gym.",
          sessions: [
            { date: "2025-12-26", sport: "strength", sessionName: "Gym", durationMinutes: 50 },
          ],
        },
      ],
    },

    // ======================================================================
    // BLOCK 2 — PHASE 2: Base + Swim (weeks 9–16)
    // Still pre 2026-02-23 — reconstructed.
    // ======================================================================
    {
      name: "Block 2 — Base + Swim",
      blockType: "Base",
      startDate: "2025-12-29",
      endDate: "2026-02-22",
      emphasis: ["base-endurance", "swim-volume"],
      weeks: [
        {
          weekIndex: 9,
          weekStartDate: "2025-12-29",
          focus: "Recovery",
          notes: "Rest / sick week — New Year.",
          sessions: [],
        },
        {
          weekIndex: 10,
          weekStartDate: "2026-01-05",
          focus: "Build",
          sessions: [
            { date: "2026-01-05", sport: "strength", sessionName: "Gym", durationMinutes: 45, notes: "Gym + EZ Run" },
            { date: "2026-01-05", sport: "run", sessionName: "EZ Run", durationMinutes: 70, notes: "Gym + EZ Run" },
            { date: "2026-01-06", sport: "swim", sessionName: "Swim", durationMinutes: 60, notes: "Swim + EZ Bike (90)" },
            { date: "2026-01-06", sport: "bike", sessionName: "EZ Bike", durationMinutes: 30, notes: "Swim + EZ Bike (90)" },
            { date: "2026-01-07", sport: "bike", sessionName: "Power Bike", durationMinutes: 60 },
            { date: "2026-01-08", sport: "swim", sessionName: "Swim TT", durationMinutes: 60 },
            { date: "2026-01-09", sport: "strength", sessionName: "Gym", durationMinutes: 45, notes: "Gym + EZ Bike" },
            { date: "2026-01-09", sport: "bike", sessionName: "EZ Bike", durationMinutes: 85, notes: "Gym + EZ Bike" },
            { date: "2026-01-10", sport: "bike", sessionName: "Long Bike", durationMinutes: 90 },
            { date: "2026-01-11", sport: "run", sessionName: "Long Run", durationMinutes: 60 },
          ],
        },
        {
          weekIndex: 11,
          weekStartDate: "2026-01-12",
          focus: "Build",
          sessions: [
            { date: "2026-01-12", sport: "strength", sessionName: "Gym", durationMinutes: 45, notes: "Gym + EZ Run" },
            { date: "2026-01-12", sport: "run", sessionName: "EZ Run", durationMinutes: 70, notes: "Gym + EZ Run" },
            { date: "2026-01-13", sport: "swim", sessionName: "Swim", durationMinutes: 60, notes: "Swim + EZ Bike (90)" },
            { date: "2026-01-13", sport: "bike", sessionName: "EZ Bike", durationMinutes: 30, notes: "Swim + EZ Bike (90)" },
            { date: "2026-01-14", sport: "bike", sessionName: "Power Bike", durationMinutes: 60 },
            { date: "2026-01-15", sport: "swim", sessionName: "Swim", durationMinutes: 60, notes: "Swim + EZ Run (90)" },
            { date: "2026-01-15", sport: "run", sessionName: "EZ Run", durationMinutes: 30, notes: "Swim + EZ Run (90)" },
            { date: "2026-01-16", sport: "strength", sessionName: "Gym", durationMinutes: 45, notes: "Gym + EZ Bike" },
            { date: "2026-01-16", sport: "bike", sessionName: "EZ Bike", durationMinutes: 85, notes: "Gym + EZ Bike" },
            { date: "2026-01-17", sport: "bike", sessionName: "Long Bike", durationMinutes: 105 },
            { date: "2026-01-18", sport: "run", sessionName: "Long Run", durationMinutes: 75 },
          ],
        },
        {
          weekIndex: 12,
          weekStartDate: "2026-01-19",
          focus: "Build",
          sessions: [
            { date: "2026-01-19", sport: "strength", sessionName: "Gym", durationMinutes: 45, notes: "Gym + EZ Run" },
            { date: "2026-01-19", sport: "run", sessionName: "EZ Run", durationMinutes: 85, notes: "Gym + EZ Run" },
            { date: "2026-01-20", sport: "swim", sessionName: "Swim", durationMinutes: 60, notes: "Swim + EZ Bike (90)" },
            { date: "2026-01-20", sport: "bike", sessionName: "EZ Bike", durationMinutes: 30, notes: "Swim + EZ Bike (90)" },
            { date: "2026-01-21", sport: "bike", sessionName: "Power Bike", durationMinutes: 60 },
            { date: "2026-01-22", sport: "swim", sessionName: "Swim", durationMinutes: 60, notes: "Swim + EZ Run (90)" },
            { date: "2026-01-22", sport: "run", sessionName: "EZ Run", durationMinutes: 30, notes: "Swim + EZ Run (90)" },
            { date: "2026-01-23", sport: "strength", sessionName: "Gym", durationMinutes: 45, notes: "Gym + EZ Bike" },
            { date: "2026-01-23", sport: "bike", sessionName: "EZ Bike", durationMinutes: 85, notes: "Gym + EZ Bike" },
            { date: "2026-01-24", sport: "bike", sessionName: "Long Bike (3 x 10)", durationMinutes: 105, target: "3 x 10" },
            { date: "2026-01-25", sport: "run", sessionName: "Long Run", durationMinutes: 75 },
          ],
        },
        {
          weekIndex: 13,
          weekStartDate: "2026-01-26",
          focus: "Recovery",
          notes: "Sick week — most sessions missed.",
          sessions: [
            { date: "2026-01-26", sport: "strength", sessionName: "Gym", durationMinutes: 45, notes: "Gym + EZ Run (planned)" },
            { date: "2026-01-26", sport: "run", sessionName: "EZ Run", durationMinutes: 85, notes: "Gym + EZ Run (planned)" },
            { date: "2026-01-27", sport: "swim", sessionName: "Swim", durationMinutes: 60, notes: "Swim + EZ Bike (90) (planned)" },
            { date: "2026-01-27", sport: "bike", sessionName: "EZ Bike", durationMinutes: 30, notes: "Swim + EZ Bike (90) (planned)" },
            { date: "2026-01-28", sport: "bike", sessionName: "Power Bike", durationMinutes: 30, notes: "Sick — reduced" },
            { date: "2026-01-31", sport: "bike", sessionName: "Long Bike (3 x 10)", durationMinutes: 120, target: "3 x 10" },
            { date: "2026-02-01", sport: "run", sessionName: "Long Run", durationMinutes: 75 },
          ],
        },
        {
          weekIndex: 14,
          weekStartDate: "2026-02-02",
          focus: "Build",
          sessions: [
            { date: "2026-02-02", sport: "strength", sessionName: "Gym", durationMinutes: 45, notes: "Gym + EZ Run" },
            { date: "2026-02-02", sport: "run", sessionName: "EZ Run", durationMinutes: 85, notes: "Gym + EZ Run" },
            { date: "2026-02-03", sport: "swim", sessionName: "Swim", durationMinutes: 60, notes: "Swim + EZ Bike (90)" },
            { date: "2026-02-03", sport: "bike", sessionName: "EZ Bike", durationMinutes: 30, notes: "Swim + EZ Bike (90)" },
            { date: "2026-02-04", sport: "bike", sessionName: "FTP", durationMinutes: 60 },
            { date: "2026-02-05", sport: "swim", sessionName: "Swim", durationMinutes: 60, notes: "Swim + EZ Run (90)" },
            { date: "2026-02-05", sport: "run", sessionName: "EZ Run", durationMinutes: 30, notes: "Swim + EZ Run (90)" },
            { date: "2026-02-06", sport: "strength", sessionName: "Gym", durationMinutes: 45, notes: "Gym + EZ Bike" },
            { date: "2026-02-06", sport: "bike", sessionName: "EZ Bike", durationMinutes: 85, notes: "Gym + EZ Bike" },
            { date: "2026-02-07", sport: "bike", sessionName: "Long Bike (3 x 15)", durationMinutes: 120, target: "3 x 15" },
            { date: "2026-02-08", sport: "run", sessionName: "Long Run", durationMinutes: 90 },
          ],
        },
        {
          weekIndex: 15,
          weekStartDate: "2026-02-09",
          focus: "Recovery",
          notes: "Skiing trip Thu–Sun.",
          sessions: [
            { date: "2026-02-09", sport: "strength", sessionName: "Gym", durationMinutes: 45, notes: "Gym + EZ Run" },
            { date: "2026-02-09", sport: "run", sessionName: "EZ Run", durationMinutes: 100, notes: "Gym + EZ Run" },
            { date: "2026-02-10", sport: "swim", sessionName: "Swim", durationMinutes: 60, notes: "Swim + EZ Bike (90)" },
            { date: "2026-02-10", sport: "bike", sessionName: "EZ Bike", durationMinutes: 30, notes: "Swim + EZ Bike (90)" },
            { date: "2026-02-11", sport: "bike", sessionName: "EZ Bike", durationMinutes: 60 },
            { date: "2026-02-12", sport: "other", sessionName: "Skiing", durationMinutes: 240 },
            { date: "2026-02-13", sport: "other", sessionName: "Skiing", durationMinutes: 240 },
            { date: "2026-02-14", sport: "other", sessionName: "Skiing", durationMinutes: 240 },
            { date: "2026-02-15", sport: "other", sessionName: "Skiing", durationMinutes: 240 },
          ],
        },
        {
          weekIndex: 16,
          weekStartDate: "2026-02-16",
          focus: "Build",
          notes: "Returning from ski trip — Mon & Tue still skiing.",
          sessions: [
            { date: "2026-02-16", sport: "other", sessionName: "Skiing", durationMinutes: 240 },
            { date: "2026-02-17", sport: "other", sessionName: "Skiing", durationMinutes: 240 },
            { date: "2026-02-18", sport: "bike", sessionName: "Power Bike (60/60)", durationMinutes: 60, target: "60/60" },
            { date: "2026-02-19", sport: "swim", sessionName: "Swim", durationMinutes: 60, notes: "Swim + EZ Run (90)" },
            { date: "2026-02-19", sport: "run", sessionName: "EZ Run", durationMinutes: 30, notes: "Swim + EZ Run (90)" },
            { date: "2026-02-20", sport: "strength", sessionName: "Gym", durationMinutes: 45, notes: "Gym + EZ Bike" },
            { date: "2026-02-20", sport: "bike", sessionName: "EZ Bike", durationMinutes: 85, notes: "Gym + EZ Bike" },
            { date: "2026-02-21", sport: "bike", sessionName: "Long Bike (3 x 15)", durationMinutes: 135, target: "3 x 15" },
            { date: "2026-02-22", sport: "run", sessionName: "Long Run (3 x 5)", durationMinutes: 90, target: "3 x 5" },
          ],
        },
      ],
    },
  ],
};
