"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/plan", label: "Plan" },
  { href: "/calendar", label: "Calendar" },
  { href: "/coach", label: "Coach" }
];

export function ShellNavRail() {
  const pathname = usePathname();

  return (
    <nav className="space-y-1">
      {navItems.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`block rounded-xl px-3 py-2 text-sm transition ${
              active
                ? "bg-[hsl(var(--accent-performance)/0.14)] text-[hsl(var(--accent-performance))] ring-1 ring-[hsl(var(--accent-performance)/0.45)]"
                : "text-[hsl(var(--fg-muted))] hover:bg-[hsl(var(--bg-card))] hover:text-[hsl(var(--fg))]"
            }`}
          >
            {item.label}
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
              className={`rounded-lg px-2 py-2 text-center text-xs font-medium ${active ? "bg-[hsl(var(--accent-performance)/0.14)] text-[hsl(var(--accent-performance))]" : "text-muted"}`}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
