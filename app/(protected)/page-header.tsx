import Link from "next/link";

type HeaderAction = {
  href: string;
  label: string;
  variant?: "primary" | "secondary";
};

export function PageHeader({ title, objective, actions = [] }: { title: string; objective: string; actions?: HeaderAction[] }) {
  return (
    <header className="surface motif-lab p-5 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="label">{title}</p>
          <p className="mt-2 max-w-3xl text-sm text-muted">{objective}</p>
        </div>

        {actions.length > 0 ? (
          <div className="flex shrink-0 flex-wrap gap-2">
            {actions.slice(0, 2).map((action) => (
              <Link key={action.href + action.label} href={action.href} className={action.variant === "secondary" ? "btn-secondary" : "btn-primary"}>
                {action.label}
              </Link>
            ))}
          </div>
        ) : null}
      </div>
    </header>
  );
}
