"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AccountMenu } from "./account-menu";

type HeaderConfig = {
  logoSizeVariant: "default" | "large";
};

const DEFAULT_HEADER_CONFIG: HeaderConfig = {
  logoSizeVariant: "large"
};

const HEADER_CONFIG_BY_ROUTE: Record<string, HeaderConfig> = {
  "/plan": {
    logoSizeVariant: "default"
  },
  "/calendar": {
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
  const headerConfig = getHeaderConfig(pathname);

  return (
    <div className="shell-header border-b border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))/0.95] backdrop-blur">
      <div className="mx-auto flex w-full max-w-[1280px] flex-wrap items-center justify-between gap-3 px-4 py-3 md:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`uppercase tracking-[0.2em] text-accent ${headerConfig.logoSizeVariant === "large" ? "text-base md:text-lg" : "text-sm"}`}>tri.ai</span>
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
