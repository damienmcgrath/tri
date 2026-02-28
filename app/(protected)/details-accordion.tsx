import { ReactNode } from "react";

export function DetailsAccordion({ title = "Details", children }: { title?: string; children: ReactNode }) {
  return (
    <details className="surface-subtle p-3">
      <summary className="cursor-pointer text-sm font-medium text-accent">{title}</summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}
