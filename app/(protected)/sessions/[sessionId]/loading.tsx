export default function SessionDetailLoading() {
  return (
    <section className="space-y-4 animate-pulse">
      {/* Back link + header */}
      <div className="flex items-center gap-2">
        <div className="h-4 w-4 rounded bg-[hsl(var(--surface-2))]" />
        <div className="h-3 w-16 rounded bg-[hsl(var(--surface-2))]" />
      </div>
      <div className="surface p-4">
        <div className="h-3 w-16 rounded bg-[hsl(var(--surface-2))]" />
        <div className="mt-2 h-7 w-64 rounded bg-[hsl(var(--surface-2))]" />
        <div className="mt-2 h-4 w-40 rounded bg-[hsl(var(--surface-2))]" />
      </div>
      {/* Metrics row */}
      <div className="grid gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="surface h-20 p-4">
            <div className="h-3 w-12 rounded bg-[hsl(var(--surface-2))]" />
            <div className="mt-2 h-6 w-16 rounded bg-[hsl(var(--surface-2))]" />
          </div>
        ))}
      </div>
      {/* Content blocks */}
      <div className="surface h-48" />
      <div className="surface h-32" />
    </section>
  );
}
