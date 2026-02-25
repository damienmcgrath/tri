export type StatusStripItem = {
  label: string;
  value: string;
  hint?: string;
};

export function StatusStrip({ items }: { items: StatusStripItem[] }) {
  return (
    <div className="surface-subtle flex flex-wrap items-center gap-2 p-2">
      {items.map((item) => (
        <div key={item.label} className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))] px-3 py-2">
          <p className="text-[10px] uppercase tracking-[0.12em] text-muted">{item.label}</p>
          <p className="text-sm font-semibold">{item.value}</p>
          {item.hint ? <p className="text-[11px] text-muted">{item.hint}</p> : null}
        </div>
      ))}
    </div>
  );
}
