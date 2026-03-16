export default function CoachLoading() {
  return (
    <section className="flex h-[calc(100dvh-8rem)] flex-col animate-pulse">
      {/* Chat header */}
      <div className="surface border-b border-[hsl(var(--border))] p-4">
        <div className="h-4 w-32 rounded bg-[hsl(var(--surface-2))]" />
        <div className="mt-2 h-3 w-48 rounded bg-[hsl(var(--surface-2))]" />
      </div>
      {/* Message area */}
      <div className="flex-1 space-y-4 p-4">
        <div className="h-16 w-3/4 rounded-lg bg-[hsl(var(--surface-2))]" />
        <div className="ml-auto h-10 w-1/2 rounded-lg bg-[hsl(var(--surface-2))]" />
        <div className="h-20 w-2/3 rounded-lg bg-[hsl(var(--surface-2))]" />
      </div>
      {/* Input area */}
      <div className="surface border-t border-[hsl(var(--border))] p-4">
        <div className="h-10 w-full rounded-lg bg-[hsl(var(--surface-2))]" />
      </div>
    </section>
  );
}
