# Mobile UX Audit — tri.ai

**Audited:** 2026-03-16
**Viewport tested:** 375 × 812 px (iPhone SE / standard mobile)
**Scope:** Dashboard · Coach · Plan · Calendar · Session Review · Weekly Debrief

---

## Summary

The app was reviewed live in a mobile viewport using the agent preview. A significant set of improvements were **already applied** in this session. One critical bug was also fixed that was preventing the Calendar and Session Review pages from rendering. A smaller set of **remaining improvements** are captured below for a follow-up pass.

---

## ✅ Changes Already Applied

### Global — `app/globals.css`
- **All buttons (`btn-primary`, `btn-secondary`, `btn-ghost`, `btn-header-cta`) now have `min-height: 44px`** on mobile, reducing to `min-height: 36px` on desktop (lg+). This ensures all tappable controls meet Apple HIG / Material Design minimum target size across the whole app without needing per-component overrides.
- **`.card-kicker` font size** increased from 10px → 11px for legibility at arm's length.
- **`.debrief-metric-card`** padding tightened on mobile (`14px`) and `min-height` only applied at `sm:` breakpoint.

### Dashboard — `app/(protected)/dashboard/page.tsx`
- Two-column layout activates at `md:` breakpoint instead of only `lg:`, so tablet-sized screens get the side panel sooner.
- **Completion percentage** scales responsively: `text-4xl` → `sm:text-5xl` → `lg:text-6xl`. Avoids oversized number overflowing narrow screens.
- **"Left this week" sub-label** scales: `text-lg` → `sm:text-xl`.
- **Day chips grid** changed from `grid-cols-2 sm:grid-cols-4 lg:grid-cols-7` → **`grid-cols-3`** on mobile. Shows 3 days per row (Mon/Tue/Wed visible above fold).
- Day chip cards min-height reduced: `min-h-[60px]` → `min-h-[52px] sm:min-h-[60px]`.
- Card padding: `p-5 md:p-6` → `p-4 md:p-5 lg:p-6`.
- All CTA buttons use `px-3 text-xs` (relying on global `min-height: 44px`) — removes the redundant `py-1.5` that was fighting the touch target.
- `text-[10px]` kickers upgraded to `text-[11px]`.

### Coach — `app/(protected)/coach/page.tsx`
- Card padding: `p-5` → `p-4 md:p-5`.
- Week headline: `text-2xl` → `text-xl sm:text-2xl`.
- **"Edit athlete context" link** given `min-h-[44px] inline-flex items-center` on mobile; resets to `lg:min-h-0 lg:py-1.5` on desktop.
- Brief stats grid: `lg:grid-cols-[…]` → **`md:grid-cols-2 lg:grid-cols-[…]`** so the side-by-side layout kicks in at tablet.
- Inner stats grid: `sm:grid-cols-2` → **`md:grid-cols-2`** to stay single-column on phone.
- Sessions needing attention: `md:grid-cols-3` → **`sm:grid-cols-2 lg:grid-cols-3`** for a 2-column phone layout.
- `text-[10px]` kickers → `text-[11px]`.

### Weekly Debrief — `app/(protected)/debrief/page.tsx`
- Stats card grid changed from `sm:grid-cols-3` → **`grid-cols-2 sm:grid-cols-3`** so the three stat cards appear in a 2-column layout on mobile (2 + 1 wrap), not stacked.
- Kicker text: `text-[10px]` → `text-[11px]`.
- Button: removed hardcoded `py-1.5` (global min-height handles it).

### Plan — `app/(protected)/plan/plan-editor.tsx`
- **← / → week navigation buttons** given `min-h-[44px] min-w-[44px]` on mobile; reset to icon-sized on `lg:`.
- **"Actions" button** given `min-h-[44px] inline-flex items-center`; resets on `lg:`.
- **"＋ Add" per-day button** given `min-h-[44px]` on mobile.
- Volume chart bar labels: `text-[8px]` → `text-[10px]`; day labels: `text-[9px]` → `text-[11px]`.
- CTA buttons: removed `py-1.5` (global handles it).

### Calendar — `app/(protected)/calendar/week-calendar.tsx`
- **Day grid** changed from single-column on mobile to **`grid-cols-2`**, showing the week in pairs — Mon/Tue, Wed/Thu, Fri/Sat, then Sun solo. Dramatically reduces scrolling.
- **TaskSheet** (session detail drawer) now takes **full width on mobile** (`w-full` without `max-w-xl` constraint); tablet+ gets `sm:max-w-xl`.
- TaskSheet header padding: `px-5` → `px-4 sm:px-5`.
- TaskSheet body padding: `px-5` → `px-4 sm:px-5`.
- **Close button in TaskSheet** given `min-h-[44px] min-w-[44px]` on mobile.
- **"Accept" button** given `min-h-[44px]` on mobile.
- "Today" badge font: `text-[10px]` → `text-[11px]`.
- Context note and attention reason: `text-[10px]` → `text-[11px]`.

### Session Review — `app/(protected)/sessions/[sessionId]/page.tsx`
- Score headline: `text-[22px]` → **`text-lg sm:text-[22px]`**.
- Right column divider: `border-l pl-5` (always side-by-side) → **`border-t pt-5 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0`** — stacks vertically on mobile, side-by-side on desktop.
- Same stacking fix applied to the detail section's right column.
- Card padding: `p-5` → `p-4 md:p-5`.
- Metric cards padding: `p-4` → `p-3 sm:p-4`.
- **Coach follow-up prompt chips** given `min-h-[44px] inline-flex items-center` on mobile.

### Details Accordion — `app/(protected)/details-accordion.tsx`
- **`<summary>` element** given `min-h-[44px]`; resets on `lg:`. The "How is this scored?" disclosure was previously a small tap target.

### Bug Fix — `lib/agent-preview/client.ts`
- **`getRows()` returned `undefined`** for database tables not present in the preview dataset. This caused `Cannot read properties of undefined (reading 'filter')` which crashed **Calendar** and **Session Review** pages entirely. Fixed by defaulting to `[]`:
  ```ts
  private getRows() {
    return getPreviewDatabase()[this.table] ?? [];
  }
  private applyFilters(rows: Array<Record<string, unknown>>) {
    return (rows ?? []).filter(…);
  }
  ```

---

## 🔲 Remaining Recommendations

### HIGH — Should address soon

#### 1. Global Header — Race Name Overflow
**File:** `app/(protected)/global-header.tsx`

On mobile (375px), the header contains: `tri.ai` + race countdown badge + `Ask tri.ai` CTA + account avatar. A race name like "Ironman Wales 70.3 Championship" will overflow or force the CTA off-screen.

**Recommendation:**
- Add `max-w-[140px] truncate` to the race name portion of the status badge on mobile.
- Or: on `< sm` screens, show only `◷ {days} days` without the race name. The race name is visible from the header on desktop where there's space.

```tsx
// global-header.tsx — status badge
<span className="stat">
  <span className="hidden sm:inline">{raceName} • </span>
  {daysToRace} days
</span>
```

---

#### 2. MobileBottomTabs — Add Icons for Faster Recognition
**File:** `app/(protected)/shell-nav.tsx`

The bottom tabs currently show only text labels. Adding the symbol icon above the label significantly improves scan speed, especially when switching between pages quickly.

**Recommendation:**
```tsx
// MobileBottomTabs — add icon above label
<Link …>
  <span aria-hidden="true" className="block text-base">{item.icon}</span>
  <span className="block text-[10px]">{item.label}</span>
</Link>
```
Change the tab height to `min-h-[56px]` and use `flex-col` layout.

---

#### 3. Session Review — "Back to Calendar" Link Tap Target
**File:** `app/(protected)/sessions/[sessionId]/page.tsx` (line ~422)

```tsx
<Link href="/calendar" className="text-sm text-cyan-300 underline-offset-2 hover:underline">← Back to Calendar</Link>
```

This is a bare text link with no padding — easy to miss tap on mobile.

**Recommendation:**
```tsx
<Link
  href="/calendar"
  className="inline-flex min-h-[44px] items-center gap-1 text-sm text-cyan-300 hover:underline"
>
  ← Back to Calendar
</Link>
```

---

#### 4. Feel-Capture Rating Grid — Unbalanced Layout
**File:** `app/(protected)/sessions/[sessionId]/components/feel-capture-banner.tsx`

The 1–10 rating renders as 6 buttons in row 1 and 4 in row 2 (`grid-cols-6`?). This is visually lopsided. Two balanced rows of 5 is much cleaner.

**Recommendation:** Change to `grid grid-cols-5 gap-2` — gives two even rows of 5 (1–5 / 6–10).

---

#### 5. Calendar Filter Row — Potential Overflow on Mobile
**File:** `app/(protected)/calendar/week-calendar.tsx`

The controls bar contains: `All disciplines ▼` + `All statuses ▼` + `Add session` + `0 done · 0 skipped`. With real discipline filter options selected (e.g. "Triathlon"), this text grows longer. Currently a `flex flex-wrap` but it could benefit from explicit two-row layout on mobile.

**Recommendation:** Wrap the filter dropdowns separately from the "Add session" CTA on small screens:
```tsx
<div className="flex flex-wrap items-center gap-2">
  <div className="flex flex-1 gap-2">
    {/* discipline + status dropdowns */}
  </div>
  <button className="shrink-0">Add session</button>
</div>
```

---

#### 6. Weekly Debrief — ISO Date Strings in Stat Cards
**File:** `app/(protected)/debrief/page.tsx`

The "Week" stat card shows raw ISO dates: `2026-03-16 to 2026-03-22`. On a phone this wraps to two lines and reads as a database record, not a friendly date.

**Recommendation:** Format using a compact date formatter:
```tsx
// Before:
{snapshot.weekStart} to {snapshot.weekEnd}

// After:
{new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
  .format(new Date(snapshot.weekStart + 'T00:00:00Z'))}
{' – '}
{new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
  .format(new Date(snapshot.weekEnd + 'T00:00:00Z'))}
// Result: "Mar 16 – Mar 22"
```

---

### MEDIUM — Polish pass

#### 7. Coach Chat Input — Bottom Safe Area
**File:** Coach chat input area (wherever the text input is rendered)

On iPhones with a home indicator (safe area inset), a sticky bottom input bar needs `padding-bottom: env(safe-area-inset-bottom)` to avoid the home bar overlapping the send button. Check that the chat input has `pb-[env(safe-area-inset-bottom)]` or a Tailwind equivalent.

---

#### 8. MobileBottomTabs — Safe Area Inset
**File:** `app/(protected)/shell-nav.tsx`

```tsx
// Current:
className="fixed inset-x-0 bottom-0 z-40 … px-2 py-1 …"

// Add safe area padding:
className="fixed inset-x-0 bottom-0 z-40 … px-2 pt-1 pb-[max(4px,env(safe-area-inset-bottom))] …"
```

---

#### 9. Plan Page — Week Header Wrapping
**File:** `app/(protected)/plan/plan-editor.tsx`

The week header row: `[Week range text] [← Prev] [→ Next] [Actions]` could wrap awkwardly if the week label is long (e.g. "Dec 30 – Jan 5"). Consider:
- Keeping `← →` always visible as a button pair on the same line as the week label
- Moving "Actions" to a `⋯` icon button on mobile

---

#### 10. Session Review — Status Badges Wrapping
**File:** `app/(protected)/sessions/[sessionId]/page.tsx`

The three status badges (`COMPLETED`, `PARTIAL MATCH`, `FALLBACK REVIEW`) in `flex flex-wrap` will stack properly, but on a wide-label session the "header flex-wrap justify-between" block may cause the right column (review mode badge + Regenerate button) to drop to its own line unexpectedly. Consider `flex-col` for the header on mobile:
```tsx
<div className="flex flex-wrap items-start justify-between gap-3 sm:flex-row">
```

---

## Page-by-Page Status

| Page | Mobile Status | Notes |
|------|--------------|-------|
| Dashboard | ✅ Excellent | 3-col chips, responsive % counter, large CTAs |
| Coach | ✅ Good | Headline, briefing cards, attention sessions all responsive |
| Plan | ✅ Good | Full-screen day cards, 44px nav buttons, + Add targets |
| Calendar | ✅ Good | 2-col day grid, full-width drawer, bug fixed |
| Session Review | ✅ Good | Stacked layout, 44px chips, feel banner renders |
| Weekly Debrief | ⚠️ Minor issues | ISO dates in stat cards; layout good |

---

## Design Principles Applied

1. **44px minimum tap targets** everywhere — applied globally via `btn-*` CSS and per-component for non-button interactive elements.
2. **Vertical stacking on mobile** — all side-by-side desktop layouts (`border-l` dividers, multi-column grids) have been converted to single or two-column stacking with `border-t` dividers on mobile.
3. **Legibility** — minimum useful text size raised from 10px to 11px throughout. Font scale reduces from desktop sizes on key headings.
4. **Progressive layout** — two-column layouts kick in at `sm:` or `md:` breakpoints; full desktop sidebar layout only at `lg:`.
5. **No desktop regression** — all changes use `lg:` or `xl:` overrides to restore the original desktop appearance. The desktop experience is unchanged.
