"use client";

import Link from "next/link";
import { AccountMenu } from "./account-menu";

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
  return (
    <div className="shell-header">
      <div className="mx-auto flex w-full max-w-[1280px] items-center justify-between gap-2 px-4 py-3 md:px-6">
        <span className="label">tri.ai</span>

        <div className="flex items-center gap-2">
          {daysToRace !== null ? <span role="status" aria-live="polite" className="status-badge-passive"><span aria-hidden="true">◷</span><span className="stat">{raceName} • {daysToRace} days</span></span> : null}
          <Link href="/coach" className="btn-header-cta px-2.5 py-1 text-xs">Ask tri.ai</Link>
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
