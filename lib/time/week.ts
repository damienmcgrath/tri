const dublinFormatter = new Intl.DateTimeFormat('en-IE', {
  timeZone: 'Europe/Dublin',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  weekday: 'short'
});

function dublinDateParts(value: Date) {
  const parts = dublinFormatter.formatToParts(value);
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  const day = Number(parts.find((part) => part.type === 'day')?.value);
  const weekday = parts.find((part) => part.type === 'weekday')?.value ?? 'Mon';
  return { year, month, day, weekday };
}

const weekdayToOffset: Record<string, number> = {
  Mon: 0,
  Tue: 1,
  Wed: 2,
  Thu: 3,
  Fri: 4,
  Sat: 5,
  Sun: 6
};

export function getDublinWeekKey(value: Date): string {
  const { year, month, day, weekday } = dublinDateParts(value);
  const offset = weekdayToOffset[weekday] ?? 0;
  const weekStart = new Date(Date.UTC(year, month - 1, day - offset));
  return weekStart.toISOString().slice(0, 10);
}
