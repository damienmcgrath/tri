export function DashboardCardSkeleton({ lines = 2 }: { lines?: number }) {
  return (
    <article className="surface animate-pulse p-4 md:p-5" aria-hidden>
      <div className="h-3 w-24 rounded bg-[hsl(var(--surface-2))]" />
      <div className="mt-3 h-5 w-2/3 rounded bg-[hsl(var(--surface-2))]" />
      <div className="mt-3 space-y-2">
        {Array.from({ length: lines }).map((_, i) => (
          <div key={i} className="h-3 w-full rounded bg-[hsl(var(--surface-2))]" />
        ))}
      </div>
    </article>
  );
}
