export default function DebriefLoading() {
  return (
    <section className="space-y-4 animate-pulse">
      {/* Header */}
      <div className="surface p-4">
        <div className="h-3 w-20 rounded bg-[hsl(var(--surface-2))]" />
        <div className="mt-2 h-7 w-48 rounded bg-[hsl(var(--surface-2))]" />
      </div>
      {/* Stats row */}
      <div className="grid gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="surface h-28 p-4">
            <div className="h-3 w-24 rounded bg-[hsl(var(--surface-2))]" />
            <div className="mt-3 h-10 w-16 rounded bg-[hsl(var(--surface-2))]" />
          </div>
        ))}
      </div>
      {/* Narrative block */}
      <div className="surface space-y-3 p-4">
        <div className="h-4 w-full rounded bg-[hsl(var(--surface-2))]" />
        <div className="h-4 w-5/6 rounded bg-[hsl(var(--surface-2))]" />
        <div className="h-4 w-4/6 rounded bg-[hsl(var(--surface-2))]" />
      </div>
      {/* Evidence cards */}
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="surface h-24" />
        ))}
      </div>
    </section>
  );
}
