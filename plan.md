# Plan: Debrief Best Efforts v1

## Context

Add auto-derived "best effort" callouts (one per sport) to the weekly debrief page, below the existing 6-week trend cards. No new pages, no schema changes, no manual input. Benchmarks are derived from `completed_activities` over a rolling 12-week window.

## Step 1: Create `lib/training/benchmarks.ts`

### Type definition

```typescript
export type BenchmarkHighlight = {
  sport: "run" | "bike" | "swim";
  label: string;               // e.g., "Best run pace"
  value: number;               // raw numeric (sec/km, watts, sec/100m)
  formattedValue: string;      // e.g., "4:32/km"
  unitLabel: string;           // e.g., "/km", "W", "/100m"
  activityId: string;          // for linking to /activities/{id}
  activityDate: string;        // ISO date string
  detail: string;              // e.g., "From 21.1km run on Mar 15"
  isThisWeek: boolean;         // true if activity falls within the debrief week
  deltaVsPriorBlock?: number;  // improvement vs prior 12-week window
  deltaLabel?: string;         // e.g., "12s faster than previous block"
};
```

### Function signature

```typescript
export async function deriveBenchmarks(
  supabase: SupabaseClient,
  athleteId: string,
  weekStart: string,           // debrief week start ISO date (for "this week" detection)
  weekEnd: string,             // debrief week end ISO date
  windowWeeks?: number         // default 12
): Promise<BenchmarkHighlight[]>
```

### Query approach

- **Single query** on `completed_activities`:
  - `user_id = athleteId`
  - `start_time_utc >= (weekEnd - windowWeeks)`
  - `sport_type in ('run', 'bike', 'swim')`
  - Select: `id, sport_type, start_time_utc, duration_sec, moving_duration_sec, distance_m, avg_power, avg_pace_per_100m_sec, metrics_v2`
- Process in JS (small dataset — typically <100 activities in 12 weeks)
- **Second query** for prior-block delta: same filters but offset window (weeks 13–24 before weekEnd). Only needed if current-block benchmark exists.

### Sport-specific benchmark logic

**CRITICAL — Sport type values:** The FIT parser in `lib/workouts/activity-parser.ts` (lines 87–107) normalizes all sport types to canonical values. The only valid values are: `"run"`, `"bike"`, `"swim"`, `"strength"`, `"functional_fitness"`, `"weightlifting"`, `"other"`. There is NO `"cycling"` or `"running"` value — never filter on those.

| Sport | Qualifying filter | Metric | Source | Best = |
|-------|-------------------|--------|--------|--------|
| Run | `distance_m >= 5000` AND has duration | pace (sec/km) | `(moving_duration_sec ?? duration_sec) / (distance_m / 1000)` | **Lowest** (faster) |
| Bike | `(moving_duration_sec ?? duration_sec) >= 1200` | normalized power (W) | Use `getNestedNumber()` from `lib/workouts/metrics-v2.ts` with paths `["power", "normalizedPower"]` and `["power", "normalized_power"]`. Fallback to `avg_power` column. | **Highest** |
| Swim | `distance_m >= 400` | pace (sec/100m) | `avg_pace_per_100m_sec` column (top-level, always populated for swims) | **Lowest** (faster) |

### Formatting helpers

- Run pace: convert sec/km → `"M:SS/km"` (e.g., 272 → "4:32/km")
- Bike power: append `"W"` (e.g., 245 → "245W")
- Swim pace: convert sec/100m → `"M:SS/100m"` (e.g., 95 → "1:35/100m")

### Detail string

Include actual distance/duration context: `"From 21.1km run on Mar 15"` or `"From 1h42m ride on Mar 12"`. Format the date as short month + day.

### `isThisWeek` detection

Check if `start_time_utc` falls between `weekStart` and `weekEnd`.

### Prior-block delta

If a prior-block best exists for the same sport:
- For pace metrics (lower is better): `delta = priorBest - currentBest` (positive = improvement)
- For power metrics (higher is better): `delta = currentBest - priorBest` (positive = improvement)
- Format: `"12s/km faster"`, `"8W higher"`, `"3s/100m faster"`
- If no prior-block data, omit `deltaVsPriorBlock` and `deltaLabel`

### Reuse existing utilities

- **`getNestedNumber()`** from `lib/workouts/metrics-v2.ts` — for extracting normalized power from `metrics_v2` JSONB (handles both camelCase and snake_case paths)
- Do NOT create a wrapper around `detectTrends()`. Keep `deriveBenchmarks()` as a standalone function. The debrief page will call both independently.

## Step 2: Add "Best efforts" section to `app/(protected)/debrief/page.tsx`

### Data loading

Add `deriveBenchmarks()` call **in parallel** with the existing `detectTrends()` call (around line 208). Both are independent and can run concurrently:

```typescript
const [trends, benchmarks] = await Promise.all([
  detectTrends(supabase, user.id, 6).catch(() => []),
  deriveBenchmarks(supabase, user.id, weekStart, weekEnd).catch(() => []),
]);
```

### Rendering

Add a new section **directly below** the existing "Trends" section (after line ~422). Only render if `benchmarks.length > 0`.

**Structure must match existing trend card styling:**
- Outer wrapper: `<article className="debrief-section-card p-5">`
- Kicker: `<p className="debrief-kicker">Best efforts</p>`
- Subtitle: `<p className="mt-2 text-sm text-muted">Training-block bests from the last 12 weeks.</p>`
- Grid: `<div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">`
- Each card: `<div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-4">`

**Card content (per benchmark):**
1. Header row: sport icon (run=runner, bike=bike, swim=waves) + label (e.g., "Best run pace")
2. Value: large text with `formattedValue` (e.g., "4:32/km")
3. If `isThisWeek`: badge `<span className="text-[11px] font-medium uppercase tracking-[0.08em] text-success">New this week</span>`
4. Detail line: `text-sm text-muted` with the detail string
5. If `deltaLabel`: `<p className="mt-1 text-[11px] text-success">{deltaLabel}</p>` (use `text-success` for improvements, `text-muted` for regressions)
6. Wrap entire card in `<Link href={'/activities/${benchmark.activityId}'}>`

**Sport icons** — use the same emoji convention from activity pages:
- Run: `🏃`
- Bike: `🚴`
- Swim: `🏊`

## Step 3: Add benchmarks to coach context (optional but recommended)

### File: `lib/athlete-context.ts`

After building the existing context snapshot, call `deriveBenchmarks()` and attach the results (max 3) to a new `recentBests` field on `AthleteContextSnapshot`. This is ~10 lines:

```typescript
// In the context builder, after existing fields:
recentBests: benchmarks.map(b => ({
  sport: b.sport,
  label: b.label,
  formattedValue: b.formattedValue,
  date: b.activityDate,
}))
```

Update the `AthleteContextSnapshot` type to include `recentBests?: Array<{sport: string; label: string; formattedValue: string; date: string}>`.

This lets the AI coach reference recent bests naturally (e.g., "Your bike power peaked at 245W this block").

## Step 4: Write tests

### File: `lib/training/benchmarks.test.ts`

Unit tests for `deriveBenchmarks()`:

1. **Run benchmark**: given activities with various distances, only considers runs >= 5km, picks lowest pace, uses `moving_duration_sec` when available
2. **Bike benchmark**: prefers normalized power from `metrics_v2` over `avg_power`, only considers rides >= 20min, picks highest
3. **Swim benchmark**: only considers swims >= 400m, uses `avg_pace_per_100m_sec`, picks lowest
4. **Empty results**: returns `[]` when no qualifying activities exist
5. **Mixed sports**: handles all three sports in one dataset without cross-contamination
6. **`isThisWeek` flag**: correctly true when activity date is within weekStart–weekEnd range
7. **Prior-block delta**: correctly computes delta when prior data exists; omits when no prior data
8. **Formatting**: pace values format correctly as M:SS, power as integer W

### File: `app/(protected)/debrief/page.test.tsx` (extend existing)

1. Best efforts section renders when benchmarks are non-empty
2. Section hidden when benchmarks are empty
3. Cards contain correct links to `/activities/{id}`
4. "New this week" badge appears conditionally

## Step 5: Visual verification

1. Set `AGENT_PREVIEW=true` in `.env.local`
2. Run `npm run dev`
3. Navigate to `/dev/agent-preview` to seed test data
4. Navigate to `/debrief` and verify:
   - Existing trend cards still render correctly (regression check)
   - New "Best efforts" section appears below trends
   - Cards match the visual style of trend cards (same border, radius, spacing, colors)
   - Activity links work
   - "New this week" badge shows when applicable
5. Test empty state: verify section is hidden when no qualifying activities

## Key files

| File | Action |
|------|--------|
| `lib/training/benchmarks.ts` | **Create** — benchmark derivation logic + `BenchmarkHighlight` type |
| `lib/training/benchmarks.test.ts` | **Create** — unit tests |
| `app/(protected)/debrief/page.tsx` | **Modify** — add `deriveBenchmarks()` call + render "Best efforts" section |
| `lib/athlete-context.ts` | **Modify** (optional) — add `recentBests` to coach context |
| `lib/workouts/metrics-v2.ts` | **No changes** — reuse `getNestedNumber()` as-is |
| `lib/training/trends.ts` | **No changes** — reuse `detectTrends()` as-is |

## Do NOT

- Create new database tables or migrations
- Add new pages or routes
- Modify the dashboard or navigation
- Create a shared wrapper function around trends + benchmarks
- Use `"cycling"` or `"running"` as sport type filters (only `"bike"` and `"run"` exist)
- Use `duration_sec` for run pace without first checking `moving_duration_sec`
- Parse lap-level data in v1 (defer to v2)
