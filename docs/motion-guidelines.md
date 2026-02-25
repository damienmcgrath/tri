# Motion guidelines

## Principles

- Motion should support state clarity, not decoration.
- Keep transitions short and predictable with no bounce/easing overshoot.
- Respect user preference with `prefers-reduced-motion: reduce` by minimizing animation and transition time.

## Pattern library

### 1. Ambient shell motion

- `.app-shell` uses a very low-contrast pseudo-element gradient drift.
- Drift is slow (`~22s`) and subtle enough to avoid visual dominance.
- The animation is disabled in high-focus workflows with `.plan-editor-motion-lock`.

### 2. Status cards (planned/completed/skipped)

- Apply `.status-card-transition` to status cards.
- State classes are limited to opacity + vertical offset:
  - `.status-card-planned`
  - `.status-card-completed`
  - `.status-card-skipped`
- Do not introduce scaling, rotation, bounce, or looping effects for status-state changes.

### 3. Coach stream insertion

- New assistant responses use `.coach-response-insert`.
- Animation budget is under 200ms.
- Use opacity + upward y-shift only (no bounce).

### 4. Shared interaction transitions

- `.btn-primary`, `.btn-secondary`, `.input-base`, and `.surface` share timing/easing tokens:
  - `--motion-fast: 180ms`
  - `--motion-standard: 240ms`
  - `--motion-ease: cubic-bezier(0.2, 0, 0, 1)`
- Focus treatment is standardized with border + shadow ring states.
- Hover is subtle (`translateY(-1px)` on buttons, border emphasis on inputs/surfaces).

## Guardrails

- Keep looping/decorative motion out of high-focus editing contexts (plan editing, data entry, dense forms).
- In reduced-motion mode, avoid non-essential movement and rely on static visual affordances (color, contrast, hierarchy).
