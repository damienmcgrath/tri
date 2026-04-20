"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: "◧" },
  { href: "/plan", label: "Plan", icon: "▦" },
  { href: "/calendar", label: "Calendar", icon: "◫" },
  { href: "/coach", label: "Coach", icon: "◎", deemphasized: true },
  { href: "/progress-report", label: "Progress", icon: "↗", deemphasized: true }
];

export function ShellNavRail({ compact = false }: { compact?: boolean }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Main navigation" className={compact ? "flex flex-col gap-2" : "space-y-1"}>
      {navItems.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-label={item.label}
            aria-current={active ? "page" : undefined}
            prefetch
            className={`relative rounded-md border border-transparent px-3 py-2 text-[13px] transition ${
              active
                ? "nav-item-active pl-5"
                : `${item.deemphasized ? "text-[hsl(var(--fg-muted)/0.78)]" : "text-[hsl(var(--fg-muted))]"} hover:border-[var(--border-subtle)] hover:bg-[var(--color-surface-raised)] hover:text-[hsl(var(--fg))]`
            } ${compact ? "flex items-center justify-center px-2.5" : "block"}`}
          >
            {compact ? (
              <span aria-hidden="true" className="text-base">{item.icon}</span>
            ) : (
              <span className="block font-medium">{item.label}</span>
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
    <nav aria-label="Mobile navigation" className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--border-subtle)] bg-[rgba(10,10,11,0.96)] px-2 pb-[max(6px,env(safe-area-inset-bottom))] pt-1 backdrop-blur lg:hidden">
      <div className="grid grid-cols-5 gap-1">
        {navItems.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-label={item.label}
              aria-current={active ? "page" : undefined}
              prefetch
              className={`relative flex min-h-[52px] flex-col items-center justify-center gap-0.5 rounded-md border border-transparent px-2 py-2 text-center transition ${active ? "nav-item-active nav-item-active--mobile pl-3" : "text-[hsl(var(--fg-muted))]"}`}
            >
              <span aria-hidden="true" className={`text-base leading-none ${active ? "" : "opacity-60"}`}>{item.icon}</span>
              <span className={`block text-[10px] font-medium leading-none ${active ? "" : "opacity-70"}`}>{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
