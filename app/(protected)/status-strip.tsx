export type StatusStripItem = {
  label: string;
  value: string;
  hint?: string;
};

export function StatusStrip({ items }: { items: StatusStripItem[] }) {
  return (
    <div className="surface-subtle overflow-x-auto px-2 py-1.5">
      <div className="flex min-w-max items-center gap-2">
        {items.map((item, index) => (
          <div key={item.label} className="flex items-center gap-2 rounded-lg px-2 py-1">
            <p className="text-[10px] uppercase tracking-[0.12em] text-muted">{item.label}</p>
            <p className="text-sm font-semibold">{item.value}</p>
            {item.hint ? <p className="text-[11px] text-muted">{item.hint}</p> : null}
            {index < items.length - 1 ? <span className="ml-1 text-muted">•</span> : null}
          </div>
        ))}
      </div>
    </div>
  );
}
