export default function PlanLoading() {
  return (
    <section className="space-y-4 animate-pulse">
      {/* Header */}
      <div className="surface p-4">
        <div className="h-3 w-20 rounded bg-[hsl(var(--surface-2))]" />
        <div className="mt-2 h-7 w-44 rounded bg-[hsl(var(--surface-2))]" />
        <div className="mt-2 h-4 w-72 rounded bg-[hsl(var(--surface-2))]" />
      </div>
      {/* Plan overview */}
      <div className="surface h-36" />
      {/* Week blocks */}
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="surface h-28" />
        ))}
      </div>
    </section>
  );
}
