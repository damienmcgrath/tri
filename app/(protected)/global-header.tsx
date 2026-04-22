"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AccountMenu } from "./account-menu";

export function GlobalHeader({
  raceName,
  daysToRace,
  account,
  previewMode = false
}: {
  raceName: string;
  daysToRace: number | null;
  previewMode?: boolean;
  account: {
    avatarUrl: string | null;
    initials: string;
    displayName: string;
    email: string;
    signOutAction: (formData: FormData) => void;
  };
}) {
  // Apr-22 audit showstopper: when the page is at the top the header reads
  // airy (mostly transparent), but once the user scrolls we need a solid
  // fill so it doesn't bleed through the hero cards. Toggle a class based
  // on window.scrollY with a low threshold so the state change kicks in
  // on the first scroll event.
  const [isScrolled, setIsScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setIsScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className={`shell-header ${isScrolled ? "is-scrolled" : ""}`}>
      <div className="mx-auto flex w-full max-w-[1280px] items-center justify-between gap-2 px-4 py-3 md:px-6">
        <span className="tracking-tight text-white" style={{ fontSize: "2rem", fontWeight: 600 }}>tri.ai</span>

        <div className="flex items-center gap-2">
          {previewMode ? <Link href="/dev/agent-preview" className="status-badge-passive"><span aria-hidden="true">⌁</span><span className="stat">Agent preview</span></Link> : null}
          {daysToRace !== null ? (
            <span role="status" aria-live="polite" className="status-badge-passive">
              <svg aria-hidden="true" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="8" cy="8" r="6.25" />
                <path d="M8 4.5v3.5l2.25 1.5" />
              </svg>
              <span className="stat">
                <span className="hidden sm:inline">{raceName} • </span>
                {daysToRace} days
              </span>
            </span>
          ) : null}
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
