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
                ? "nav-item-active pl-5"
                : "text-[hsl(var(--fg-muted))] hover:bg-[hsl(var(--surface-2))] hover:text-[hsl(var(--fg))]"
            } ${compact ? "flex items-center justify-center" : "block"}`}
          >
            {compact ? (
              <span aria-hidden="true" className="text-base">{item.icon}</span>
            ) : (
              <>
                <span className="block font-medium">{item.label}</span>
                <span className="block text-[11px] uppercase tracking-[0.12em] text-[hsl(var(--fg-muted))]">{item.semanticLabel}</span>
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
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))/0.96] px-2 py-2 backdrop-blur lg:hidden">
      <div className="grid grid-cols-4 gap-1">
        {navItems.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              title={`${item.label} · ${item.semanticLabel}`}
              className={`rounded-lg px-2 py-2 text-center text-xs font-medium ${active ? "nav-item-active nav-item-active--mobile pl-4" : "text-[hsl(var(--fg-muted))]"}`}
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
