# Plan Screen Rebuild Spec

## Updated IA (Information Architecture)
- **Left Sidebar (Plan Context)**
  - Plan creation form: name, start Monday, duration (weeks).
  - Plan selector list.
  - Plan summary card: start date + total weeks.
  - Week list with `Week N`, date range, focus badge, and planned minutes.
  - Week operations: duplicate forward, shift +7/-7 days, delete week.
- **Main Panel (Week Editor)**
  - Header: `Plan: {name} → Week {index} ({date range})`.
  - Week metadata editor:
    - focus dropdown (`Build/Recovery/Taper/Race/Custom`)
    - week notes
    - optional target minutes + target TSS
    - computed planned minutes + discipline mini-bars.
  - Week schedule editor:
    - Mon–Sun grid with day totals and session cards.
    - empty day CTA (`+ Add`) launches Quick Add modal.
- **Overlays**
  - **Quick Add Modal**: labeled session inputs, day-context aware.
  - **Session Drawer**: full edit form (status, notes, distance, delete).

## Schema and Data Model
- `training_plans` (existing, unchanged semantics).
- `training_weeks` (new):
  - `id`, `plan_id`, `week_index`, `week_start_date`, `focus`, `notes`, `target_minutes`, `target_tss`, timestamps.
- `sessions` (canonical planned table):
  - migrated from `planned_sessions` via rename.
  - required: `plan_id`, `week_id`, `date`, `sport`, `type`, `duration_minutes`, `status`.
  - optional: `distance_value`, `distance_unit`, `notes`.
- Data rules:
  - `sessions.week_id` FK → `training_weeks.id`.
  - trigger enforces `sessions.date` falls inside selected week (Mon–Sun).

## Migration Strategy
1. Create `training_weeks` table + indexes + RLS.
2. Rename `planned_sessions` to `sessions` (backward-safe if already renamed).
3. Normalize session columns (`duration_minutes`, `status`, distance fields).
4. Generate week rows from:
   - plan start + duration weeks, and
   - distinct ISO weeks found in existing sessions.
5. Assign each existing session to its derived `week_id` by date range.
6. Enforce FK + trigger validation.
7. Recreate policies and update `updated_at` triggers.

## Components and UX Flow
- `PlanPage` (server): fetches plans, weeks, sessions for selected plan.
- `PlanEditor` (client): stateful editor with selected week, quick-add modal, and session drawer.
- Server actions:
  - plans: create
  - weeks: update metadata, duplicate forward, shift ±7 days, delete
  - sessions: create, update, delete
- Flow:
  1. Create plan → auto-create N weeks.
  2. Select week from sidebar.
  3. Click day `+ Add` → quick-add modal.
  4. Click session card → right drawer for detailed edits.
