# Activity Metrics v2 Plan (Parse + Store + Coach Usage)

## Goal
Make coaching responses rely only on explicit user-provided/uploaded activity data (never inferred values), while expanding stored metrics enough to support accurate activity analysis for swim, bike, run, weightlifting, functional fitness, and strength, while remaining vendor-agnostic so additional providers can be added cleanly.

## Current state snapshot

Today `completed_activities` persists core fields (`duration_sec`, `distance_m`, `avg_hr`, `avg_power`, `calories`) plus a flexible `parse_summary` JSON blob. FIT parsing currently includes `movingDurationSec`, `elapsedDurationSec`, and `poolLengthMeters` in `parseSummary`; TCX parsing currently stores only `lapCount` there.

## Target v2 data contract

### Activity coverage requirements (v2 baseline + future providers)

The parsing + persistence contract must explicitly support these primary activity classes for Garmin now, and map future providers into the same canonical classes:

- **Swim** (`pool_swimming`, `open_water_swimming`)
- **Bike** (`cycling`, `indoor_cycling`, `mountain_biking`, `road_biking`)
- **Run** (`running`, `trail_running`, `treadmill_running`)
- **Weightlifting** (`strength_training`, `weight_training`)
- **Functional fitness** (`functional_strength_training`, `cross_training`, `hiit`)
- **Strength** (device-recorded strength variants and manually-entered strength workouts)

Design note for extensibility:
- Canonical classes above are provider-neutral; Garmin is the first implementation target.
- Keep provider-specific raw values namespaced under `metrics_v2.activity` instead of hard-coding Garmin-only keys throughout the model.
- Parser adapters should emit a shared normalized payload so persistence and coaching layers do not branch by vendor except inside parser adapters.

For each uploaded activity, persist:
- raw source activity identifiers when available (in `metrics_v2.activity.rawType` + `metrics_v2.activity.rawSubType`)
- normalized internal activity type (existing app enum/type) in canonical columns/fields
- only source-backed metrics; missing values remain null and are marked in `metrics_v2.quality.missing`

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
- `activity_type_raw text` (provider raw sport/type)
- `activity_subtype_raw text` (provider raw sub-sport/subtype)
- `activity_vendor text` (e.g. `garmin`, future: `strava`, `coros`, etc.)

Notes:
- Keep existing columns (`duration_sec`, `distance_m`, `avg_hr`, `avg_power`, `calories`) for compatibility.
- `duration_sec` remains legacy-compatible; for v2 semantics, prefer `moving_duration_sec` when present.
- Strength-oriented activities often do not include distance/pace; null is expected and should not be treated as parse failure.

### 2) Structured JSON for rich details
Add a new JSONB field:

- `metrics_v2 jsonb not null default '{}'::jsonb`

Use this only for lower-frequency/high-cardinality fields not worth dedicated columns (e.g. lap details, stroke-type distributions, GPS-derived summaries).

Recommended shape:

```json
{
  "schemaVersion": 1,
  "sourceFormat": "fit|tcx",
  "activity": {
    "vendor": "garmin",
    "rawType": "running",
    "rawSubType": "trail_running",
    "normalizedType": "run"
  },
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
  ],
  "strength": {
    "sets": [
      {
        "index": 1,
        "exerciseName": "Barbell Back Squat",
        "reps": 5,
        "weightKg": 100,
        "durationSec": 45,
        "restSec": 120
      }
    ],
    "totalReps": 25,
    "totalVolumeKg": 2500
  }
}
```

Activity-specific guidance:
- **Swim:** prioritize pool/open-water distance, pace, stroke rate, SWOLF, pool length, laps.
- **Bike/Run:** prioritize moving/elapsed time, distance, HR (avg/max), power (avg/max where present), cadence, elevation gain/loss.
- **Weightlifting / Functional fitness / Strength:** prioritize elapsed/moving duration, HR, calories, and structured set-level details when present in FIT records. Do not force endurance metrics (pace/distance) when not recorded.

## Parser changes

### FIT parser (`parseFitFile`)

Keep existing fields and additionally attempt to extract:
- moving/elapsed duration as first-class parse outputs
- max HR / max power
- cadence and elevation where available
- swim-specific values (pool length, stroke rate, SWOLF, laps count)
- source activity type/subtype identifiers for downstream normalization and auditing
- strength/workout-set records (reps, weight, set type, rest) when present

If a metric is missing in source data, leave it null/undefined; never infer.

### TCX parser (`parseTcxFile`)

Expand from current minimal parse by reading from lap + trackpoint extensions where available:
- moving/elapsed durations (if not available, use elapsed only and set moving null)
- swim lap count, per-lap distance/time
- max HR, cadence
- elevation gain/loss from trackpoints
- activity type hints from `Activity/Sport` and extension tags

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
- Add activity-type normalization map interface so Garmin sport/sub-sport maps to app canonical types now, while allowing future provider-specific mappings (`swim`, `bike`, `run`, `weightlifting`, `functional_fitness`, `strength`).

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
- Bike/run coaching can reference cadence/elevation/max metrics only when present in source.
- Weightlifting/functional-fitness/strength coaching can reference set/rep/load metrics only when present in source.
- Existing uploads continue to work; missing metrics are reported as unavailable.
