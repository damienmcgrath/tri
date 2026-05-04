// Concrete preview seed data + global-cache wrappers. The actual table rows
// live in per-domain siblings (data-rows-plan.ts, data-rows-activities.ts,
// data-rows-athlete.ts, data-rows-race.ts) so each focused file stays well
// under 1000 lines. createPreviewDatabase() spreads them into a single
// PreviewDatabase shape on every call (preserving the original behaviour
// where `previewMonday()` is re-evaluated per call).

import { PREVIEW_USER_ID, type PreviewDatabase } from "./data-types";
import { buildActivityRows } from "./data-rows-activities";
import { buildAthleteRows } from "./data-rows-athlete";
import { buildPlanRows } from "./data-rows-plan";
import { buildRaceRows } from "./data-rows-race";

export function getPreviewUser() {
  return {
    id: PREVIEW_USER_ID,
    email: "preview@tri.ai",
    user_metadata: {
      full_name: "Preview Athlete",
      timezone: "Europe/Dublin",
      race_name: "Galway 70.3",
      race_date: "2026-06-21"
    }
  };
}

export function createPreviewDatabase(): PreviewDatabase {
  return {
    ...buildPlanRows(),
    ...buildActivityRows(),
    ...buildAthleteRows(),
    ...buildRaceRows()
  };
}

const globalKey = "__tri_preview_database__" as const;
const globalVersionKey = "__tri_preview_database_version__" as const;
// Bump this when the seed schema changes (new tables, new columns, etc.)
const PREVIEW_DATABASE_VERSION = 12;

function getOrCreateDatabase(): PreviewDatabase {
  const existing = (globalThis as Record<string, unknown>)[globalKey] as PreviewDatabase | undefined;
  const version = (globalThis as Record<string, unknown>)[globalVersionKey] as number | undefined;
  if (existing && version === PREVIEW_DATABASE_VERSION) return existing;
  const db = createPreviewDatabase();
  (globalThis as Record<string, unknown>)[globalKey] = db;
  (globalThis as Record<string, unknown>)[globalVersionKey] = PREVIEW_DATABASE_VERSION;
  return db;
}

export function getPreviewDatabase() {
  return getOrCreateDatabase();
}

export function resetPreviewDatabase() {
  (globalThis as Record<string, unknown>)[globalKey] = createPreviewDatabase();
}
