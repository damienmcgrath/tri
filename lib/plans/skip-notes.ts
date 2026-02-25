const SKIP_TAG_PATTERN = /\[skipped\s\d{4}-\d{2}-\d{2}\]/i;
const SKIP_TAG_REMOVE_PATTERN = /\n?\[skipped\s\d{4}-\d{2}-\d{2}\]/gi;

export function appendSkipTag(notes: string | null | undefined, now: Date): string {
  const currentNotes = notes ?? '';

  if (SKIP_TAG_PATTERN.test(currentNotes)) {
    return currentNotes;
  }

  const skipTag = `[Skipped ${now.toISOString().slice(0, 10)}]`;
  return `${currentNotes}\n${skipTag}`.trim();
}

export function clearSkipTag(notes: string | null | undefined): string | null {
  const nextNotes = (notes ?? '').replace(SKIP_TAG_REMOVE_PATTERN, '').trim();
  return nextNotes || null;
}

export function syncSkipTagForStatus(
  notes: string | null | undefined,
  status: 'planned' | 'completed' | 'skipped',
  now: Date
): string | null {
  if (status === 'skipped') {
    return appendSkipTag(notes, now);
  }

  return clearSkipTag(notes);
}
