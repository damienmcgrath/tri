# Activity Metrics v2 Plan (Parse + Store + Coach Usage)

## Goal
Make coaching responses rely only on explicit user-provided/uploaded activity data (never inferred values), while expanding stored metrics enough to support accurate swim/bike/run analysis.

## Current state snapshot

Today `completed_activities` persists core fields (`duration_sec`, `distance_m`, `avg_hr`, `avg_power`, `calories`) plus a flexible `parse_summary` JSON blob. FIT parsing currently includes `movingDurationSec`, `elapsedDurationSec`, and `poolLengthMeters` in `parseSummary`; TCX parsing currently stores only `lapCount` there.

## Target v2 data contract

### 1) Canonical columns on `completed_activities`
Add explicit first-class columns for high-frequency coaching/UX usage:

- `moving_duration_sec integer`
- `elapsed_duration_sec integer`
- `pool_length_m numeric(6,2)`
- `laps_count integer`
- `avg_pace_per_100m_sec integer`
- `best_pace_per_100m_sec integer`
- `avg_stroke_rate_spm integer`
- `avg_swolf integer`
- `avg_cadence integer`
- `max_hr integer`
- `max_power integer`
- `elevation_gain_m integer`
- `elevation_loss_m integer`

Notes:
- Keep existing columns (`duration_sec`, `distance_m`, `avg_hr`, `avg_power`, `calories`) for compatibility.
- `duration_sec` remains legacy-compatible; for v2 semantics, prefer `moving_duration_sec` when present.

### 2) Structured JSON for rich details
Add a new JSONB field:

- `metrics_v2 jsonb not null default '{}'::jsonb`

Use this only for lower-frequency/high-cardinality fields not worth dedicated columns (e.g. lap details, stroke-type distributions, GPS-derived summaries).

Recommended shape:

```json
{
  "schemaVersion": 1,
  "sourceFormat": "fit|tcx",
  "quality": { "missing": ["avg_swolf"], "warnings": [] },
  "swim": {
    "poolLengthM": 20,
    "lapsCount": 142,
    "avgPacePer100mSec": 116,
    "bestPacePer100mSec": 104,
    "avgStrokeRateSpm": 27,
    "avgSwolf": 35
  },
  "laps": [
    { "index": 1, "durationSec": 85, "distanceM": 100, "avgHr": 132 }
  ]
}
```

## Parser changes

### FIT parser (`parseFitFile`)

Keep existing fields and additionally attempt to extract:
- moving/elapsed duration as first-class parse outputs
- max HR / max power
- cadence and elevation where available
- swim-specific values (pool length, stroke rate, SWOLF, laps count)

If a metric is missing in source data, leave it null/undefined; never infer.

### TCX parser (`parseTcxFile`)

Expand from current minimal parse by reading from lap + trackpoint extensions where available:
- moving/elapsed durations (if not available, use elapsed only and set moving null)
- swim lap count, per-lap distance/time
- max HR, cadence
- elevation gain/loss from trackpoints

Do not synthesize unsupported values.

## Upload persistence changes (`POST /api/uploads/activities`)

Write parsed v2 metrics into both:
1. canonical v2 columns
2. `metrics_v2`

Continue writing legacy columns to avoid breaking old readers.

## Coach tool contract updates

### `get_recent_sessions`
Return only explicit source-backed fields and include provenance per item:

- `source`: `uploaded_activity` | `legacy_completed_session`
- `movingDurationMinutes` (nullable)
- `elapsedDurationMinutes` (nullable)
- `distanceMeters` (nullable)
- `poolLengthMeters` (nullable)
- `lapsCount` (nullable)
- `avgPacePer100mSec` (nullable)

No fallback estimation, no deduced pool/lap values.

### New tool (recommended): `get_activity_details`
Add a dedicated tool for single-activity deep analysis:

Input:
- `activityId` (required)

Output:
- canonical activity metrics (columns)
- `metrics_v2`
- linked session metadata

This avoids relying on short recent-session summaries for detailed user questions.

## Migration and rollout plan

### Phase 1: schema
- Add new nullable v2 columns + `metrics_v2` JSONB.
- Add check constraints where appropriate (non-negative durations/distances).

### Phase 2: write path
- Update parsers and upload route to populate v2 columns and `metrics_v2` for all new uploads.

### Phase 3: read path
- Update coach tool handlers and activity-details UI to prefer v2 explicit columns.
- Keep legacy fallback reads only for backward compatibility (without inference).

### Phase 4: backfill
- Backfill existing uploaded activities from available raw file payloads (`raw_file_base64`) where still retained.
- Mark rows with backfill status in `metrics_v2.quality.warnings` when full v2 extraction is impossible.

### Phase 5: tighten behavior
- Make coach prompts/instructions explicitly prefer v2 fields and say "unavailable" for missing metrics.

## Non-goals
- No browser-side parsing or model calls.
- No inference/model-generated synthetic metrics.
- No destructive rewrite of legacy `completed_sessions.metrics`.

## Acceptance criteria

- Coach responses cite only stored explicit metrics.
- Swim responses stop guessing pool length/laps/SWOLF unless present.
- Moving vs elapsed time is clearly separated and used correctly.
- Existing uploads continue to work; missing metrics are reported as unavailable.
