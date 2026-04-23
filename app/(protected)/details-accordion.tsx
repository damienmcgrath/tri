import { ReactNode } from "react";

export function DetailsAccordion({
  title = "Details",
  summaryDetail,
  children
}: {
  title?: string;
  summaryDetail?: ReactNode;
  children: ReactNode;
}) {
  return (
    <details className="surface-subtle rounded-[18px] p-3.5">
      <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between gap-3 marker:hidden lg:min-h-0">
        <span className="text-body font-medium text-accent">{title}</span>
        {summaryDetail ? <span className="flex flex-wrap items-center justify-end gap-2">{summaryDetail}</span> : null}
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}
