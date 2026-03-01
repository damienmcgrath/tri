"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { AccountMenu } from "./account-menu";
import { addDays, getMonday, weekRangeLabel } from "./week-context";

type HeaderConfig = {
  showWeekControls: boolean;
  showWeekRangeLabel: boolean;
  logoSizeVariant: "default" | "large";
};

const DEFAULT_HEADER_CONFIG: HeaderConfig = {
  showWeekControls: false,
  showWeekRangeLabel: false,
  logoSizeVariant: "large"
};

const HEADER_CONFIG_BY_ROUTE: Record<string, HeaderConfig> = {
  "/plan": {
    showWeekControls: true,
    showWeekRangeLabel: true,
    logoSizeVariant: "default"
  },
  "/calendar": {
    showWeekControls: true,
    showWeekRangeLabel: true,
    logoSizeVariant: "default"
  }
};

function getHeaderConfig(pathname: string): HeaderConfig {
  if (pathname.startsWith("/plan") || pathname.startsWith("/calendar")) {
    const key = pathname.startsWith("/plan") ? "/plan" : "/calendar";
    return HEADER_CONFIG_BY_ROUTE[key];
  }

  return DEFAULT_HEADER_CONFIG;
}

export function GlobalHeader({
  raceName,
  daysToRace,
  account
}: {
  raceName: string;
  daysToRace: number | null;
  account: {
    avatarUrl: string | null;
    initials: string;
    displayName: string;
    email: string;
    signOutAction: (formData: FormData) => void;
  };
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const headerConfig = getHeaderConfig(pathname);
  const currentWeekStart = getMonday().toISOString().slice(0, 10);
  const weekStart = searchParams.get("weekStart") ?? currentWeekStart;

  const withWeek = (targetWeekStart: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (targetWeekStart === currentWeekStart) {
      params.delete("weekStart");
    } else {
      params.set("weekStart", targetWeekStart);
    }
    const query = params.toString();
    return `${pathname}${query ? `?${query}` : ""}`;
  };

  return (
    <div className="shell-header border-b border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))/0.95] backdrop-blur">
      <div className="mx-auto flex w-full max-w-[1280px] flex-wrap items-center justify-between gap-3 px-4 py-3 md:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`uppercase tracking-[0.2em] text-accent ${headerConfig.logoSizeVariant === "large" ? "text-base md:text-lg" : "text-sm"}`}>tri.ai</span>
          {headerConfig.showWeekRangeLabel ? <span className="hidden text-xs text-muted sm:inline">{weekRangeLabel(weekStart)}</span> : null}
          {headerConfig.showWeekControls ? (
            <>
              <Link href={withWeek(addDays(weekStart, -7))} className="btn-secondary px-2.5 py-1 text-xs">Prev</Link>
              <Link href={withWeek(currentWeekStart)} className={`btn-secondary px-2.5 py-1 text-xs ${weekStart === currentWeekStart ? "border-[hsl(var(--accent-performance)/0.55)] text-accent" : ""}`}>Current</Link>
              <Link href={withWeek(addDays(weekStart, 7))} className="btn-secondary px-2.5 py-1 text-xs">Next</Link>
            </>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {daysToRace !== null ? <span className="rounded-full border pill-accent px-3 py-1 text-xs font-medium">{raceName} • {daysToRace} days</span> : null}
          <Link href="/coach" className="btn-primary px-3 py-1.5 text-xs">Ask tri.ai</Link>
          <AccountMenu
            avatarUrl={account.avatarUrl}
            initials={account.initials}
            displayName={account.displayName}
            email={account.email}
            signOutAction={account.signOutAction}
          />
        </div>
      </div>
    </div>
  );
}
