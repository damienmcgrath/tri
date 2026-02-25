# Design Tokens

Semantic tokens are defined in `app/globals.css` and consumed through component-level classes.

| Token | Purpose | Example usage |
| --- | --- | --- |
| `--surface-0`, `--surface-1`, `--surface-2` | App/background elevation stack | Base page, cards, and secondary panels across dashboard/calendar/coach. |
| `--text-primary`, `--text-secondary`, `--text-tertiary` | Primary to tertiary text hierarchy | Main headings, helper copy, and conversation metadata text. |
| `--signal-ready` | Positive/complete state | Calendar `Completed` chips and coach confidence high state. |
| `--signal-load` | Load/attention state | Calendar `Pending` chips, unassigned activity hint text, and progression load overrun. |
| `--signal-risk` | Risk/negative state | Calendar `Skipped` chips and high urgency recommendation state. |
| `--signal-recovery` | Recovery/steady progress state | Week progress bar fill and medium coach confidence state. |
| `--ai-accent-core`, `--ai-accent-glow` | AI brand accent | Coach console accent text, user bubble fill, and global CTA gradients. |

## Component mapping examples

| Area | Mapping rule | Implementation example |
| --- | --- | --- |
| `app/(protected)/calendar` | Calendar status chips consume signal tokens | `calendar-status-planned/completed/skipped` map to `signal-load/ready/risk` in session cards. |
| `app/(protected)/coach` | Coach confidence and recommendation urgency consume signal tokens | `confidenceSignal` and `urgencySignal` render `signal-chip` pills using `signal-ready/load/risk/recovery`. |
| `app/(protected)/dashboard` | Plan progression bars consume load/recovery tokens | Week progress bars use `progress-fill-recovery` for normal completion and `progress-fill-load` for overrun tails. |
