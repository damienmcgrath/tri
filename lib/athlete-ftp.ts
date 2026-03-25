export type AthleteFtpHistoryEntry = {
  id: string;
  value: number;
  source: string;
  notes: string | null;
  recorded_at: string;
  created_at?: string | null;
};

function compareDescendingIsoDate(a: string | null | undefined, b: string | null | undefined) {
  if (a === b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return b.localeCompare(a);
}

export function sortAthleteFtpHistory<T extends Pick<AthleteFtpHistoryEntry, "recorded_at"> & Partial<Pick<AthleteFtpHistoryEntry, "created_at" | "id">>>(entries: T[]) {
  return [...entries].sort((left, right) => {
    const recordedAtComparison = compareDescendingIsoDate(left.recorded_at, right.recorded_at);
    if (recordedAtComparison !== 0) {
      return recordedAtComparison;
    }

    const createdAtComparison = compareDescendingIsoDate(left.created_at, right.created_at);
    if (createdAtComparison !== 0) {
      return createdAtComparison;
    }

    return (right.id ?? "").localeCompare(left.id ?? "");
  });
}
