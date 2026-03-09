export default function ProtectedLoading() {
  return (
    <div className="space-y-4">
      <div className="surface animate-pulse p-4">
        <div className="h-3 w-20 rounded bg-[hsl(var(--surface-2))]" />
        <div className="mt-3 h-6 w-64 rounded bg-[hsl(var(--surface-2))]" />
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <div className="surface h-40 animate-pulse" key={index} />
        ))}
      </div>
    </div>
  );
}
