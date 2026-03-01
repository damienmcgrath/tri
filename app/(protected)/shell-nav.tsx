"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { href: "/dashboard", label: "Dashboard", semanticLabel: "Overview", icon: "◧" },
  { href: "/plan", label: "Plan", semanticLabel: "Design", icon: "▦" },
  { href: "/calendar", label: "Calendar", semanticLabel: "Execution", icon: "◫" },
  { href: "/coach", label: "Coach", semanticLabel: "Adaptation", icon: "◎" }
];

export function ShellNavRail({ compact = false }: { compact?: boolean }) {
  const pathname = usePathname();

  return (
    <nav className={compact ? "flex flex-col gap-2" : "space-y-1"}>
      {navItems.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            title={`${item.label} · ${item.semanticLabel}`}
            className={`rounded-xl px-3 py-2 text-sm transition ${
              active
                ? "bg-primary/10 text-primary ring-1 ring-primary/35"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            } ${compact ? "flex items-center justify-center" : "block"}`}
          >
            {compact ? (
              <span aria-hidden="true" className="text-base">{item.icon}</span>
            ) : (
              <>
                <span className="block font-medium">{item.label}</span>
                <span className="block text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">{item.semanticLabel}</span>
              </>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

export function MobileBottomTabs() {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 px-2 py-2 backdrop-blur lg:hidden">
      <div className="grid grid-cols-4 gap-1">
        {navItems.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              title={`${item.label} · ${item.semanticLabel}`}
              className={`rounded-lg px-2 py-2 text-center text-xs font-medium ${active ? "bg-primary/10 text-primary" : "text-muted-foreground"}`}
            >
              <span className="block">{item.label}</span>
              <span className="block text-[10px] uppercase tracking-[0.12em]">{item.semanticLabel}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
