import type { SessionLifecycleState } from "@/lib/training/semantics";

const SKIP_TAG_PATTERN = /\[skipped\s\d{4}-\d{2}-\d{2}\]/i;
const SKIP_TAG_REMOVE_PATTERN = /\n?\[skipped\s\d{4}-\d{2}-\d{2}\]/gi;
const SKIP_CONFIRMED_TAG_PATTERN = /\[skip\sconfirmed(?:\s\d{4}-\d{2}-\d{2})?\]/i;
const SKIP_CONFIRMED_TAG_REMOVE_PATTERN = /\n?\[skip\sconfirmed(?:\s\d{4}-\d{2}-\d{2})?\]/gi;

export function appendSkipTag(notes: string | null | undefined, now: Date): string {
  const currentNotes = notes ?? "";

  if (SKIP_TAG_PATTERN.test(currentNotes)) {
    return currentNotes;
  }

  const skipTag = `[Skipped ${now.toISOString().slice(0, 10)}]`;
  return `${currentNotes}\n${skipTag}`.trim();
}

export function clearSkipTag(notes: string | null | undefined): string | null {
  const nextNotes = (notes ?? "")
    .replace(SKIP_TAG_REMOVE_PATTERN, "")
    .replace(SKIP_CONFIRMED_TAG_REMOVE_PATTERN, "")
    .trim();
  return nextNotes || null;
}

export function hasConfirmedSkipTag(notes: string | null | undefined): boolean {
  return SKIP_CONFIRMED_TAG_PATTERN.test(notes ?? "");
}

export function appendConfirmedSkipTag(notes: string | null | undefined, now: Date): string {
  const currentNotes = notes ?? "";

  if (SKIP_CONFIRMED_TAG_PATTERN.test(currentNotes)) {
    return currentNotes;
  }

  const confirmationTag = `[Skip confirmed ${now.toISOString().slice(0, 10)}]`;
  return `${currentNotes}\n${confirmationTag}`.trim();
}

export function syncSkipTagForStatus(
  notes: string | null | undefined,
  status: SessionLifecycleState,
  now: Date
): string | null {
  if (status === "skipped") {
    return appendSkipTag(notes, now);
  }

  return clearSkipTag(notes);
}
