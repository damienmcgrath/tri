export default function DashboardLoading() {
  return (
    <section className="space-y-4 animate-pulse">
      {/* Header skeleton */}
      <div className="surface p-4">
        <div className="h-3 w-24 rounded bg-[hsl(var(--surface-2))]" />
        <div className="mt-2 h-7 w-56 rounded bg-[hsl(var(--surface-2))]" />
        <div className="mt-2 h-4 w-80 rounded bg-[hsl(var(--surface-2))]" />
      </div>
      {/* Stats row */}
      <div className="grid gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="surface h-24 p-4">
            <div className="h-3 w-16 rounded bg-[hsl(var(--surface-2))]" />
            <div className="mt-3 h-8 w-20 rounded bg-[hsl(var(--surface-2))]" />
          </div>
        ))}
      </div>
      {/* Session cards */}
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="surface h-20" />
        ))}
      </div>
    </section>
  );
}
