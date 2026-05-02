import type { PlannedTargetBand } from "@/lib/coach/session-diagnosis";

export function parsePlannedIntervals(text: string | null | undefined) {
  if (!text) return null;
  const normalized = text.toLowerCase();
  const xMatch = normalized.match(/\b(\d{1,2})\s*x\s*\d/);
  if (xMatch) return Number(xMatch[1]);
  const repsMatch = normalized.match(/\b(\d{1,2})\s*(reps|intervals|laps)\b/);
  if (repsMatch) return Number(repsMatch[1]);
  return null;
}

export function parseTargetBands(text: string | null | undefined): PlannedTargetBand | null {
  if (!text) return null;
  const targetBands: PlannedTargetBand = {};
  const normalized = text.toLowerCase();

  const hrRange = normalized.match(/(?:hr|heart rate)?\s*(\d{2,3})\s*[-–]\s*(\d{2,3})\s*bpm?/i);
  if (hrRange) {
    targetBands.hr = { min: Number(hrRange[1]), max: Number(hrRange[2]) };
  }

  const powerRange = normalized.match(/(\d{2,4})\s*[-–]\s*(\d{2,4})\s*w\b/i);
  if (powerRange) {
    targetBands.power = { min: Number(powerRange[1]), max: Number(powerRange[2]) };
  }

  // Single power value: "at 210W", "@ 210W", "~210W"
  if (!targetBands.power) {
    const singlePower = normalized.match(/(?:[@≈~]|at|around)\s*(\d{2,4})\s*w\b/i);
    if (singlePower) {
      const value = Number(singlePower[1]);
      targetBands.power = { min: value, max: value };
    }
  }

  // Swim pace: "1:50-2:00/100m", "1:50–2:00 per 100m", "1:50-2:00 /100"
  const paceRange100m = normalized.match(/(\d):(\d{2})\s*[-–]\s*(\d):(\d{2})\s*(?:\/|\s*per\s*)100\s*m?/);
  if (paceRange100m) {
    const minSec = Number(paceRange100m[1]) * 60 + Number(paceRange100m[2]);
    const maxSec = Number(paceRange100m[3]) * 60 + Number(paceRange100m[4]);
    targetBands.pace100m = { min: minSec, max: maxSec };
  }

  // Swim pace: "≤1:55/100m" or "@ 1:55/100m" (single pace value → treat as max)
  if (!targetBands.pace100m) {
    const singlePace100m = normalized.match(/(?:[@≤<]|at|under|around)\s*(\d):(\d{2})\s*(?:\/|\s*per\s*)100\s*m?/);
    if (singlePace100m) {
      const sec = Number(singlePace100m[1]) * 60 + Number(singlePace100m[2]);
      targetBands.pace100m = { max: sec };
    }
  }

  return Object.keys(targetBands).length > 0 ? targetBands : null;
}
