"use client";

import Link from "next/link";
import { useRef } from "react";

type AccountMenuProps = {
  avatarUrl: string | null;
  initials: string;
  displayName: string;
  email: string;
  signOutAction: (formData: FormData) => void;
};

export function AccountMenu({ avatarUrl, initials, displayName, email, signOutAction }: AccountMenuProps) {
  const detailsRef = useRef<HTMLDetailsElement | null>(null);

  const closeMenu = () => {
    if (detailsRef.current) {
      detailsRef.current.open = false;
    }
  };

  return (
    <details className="group relative" ref={detailsRef}>
      <summary aria-label="Open account menu" className="list-none cursor-pointer rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] p-0.5 transition hover:border-cyan-400/50">
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatarUrl} alt="User avatar" className="h-9 w-9 rounded-full object-cover" />
        ) : (
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-cyan-500/15 text-xs font-semibold text-cyan-200">
            {initials}
          </span>
        )}
      </summary>

      <div className="absolute right-0 z-50 mt-2 w-64 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))] p-3 shadow-2xl shadow-black/40">
        <div className="border-b border-[hsl(var(--border))] pb-3">
          <p className="text-xs uppercase tracking-[0.15em] text-muted">Account</p>
          <p className="mt-1 text-sm font-semibold text-[hsl(var(--fg))]">{displayName}</p>
          <p className="text-xs text-muted">{email}</p>
        </div>

        <div className="mt-3 space-y-1">
          <Link href="/settings" onClick={closeMenu} className="block rounded-lg px-2 py-1.5 text-sm text-[hsl(var(--fg-muted))] hover:bg-[hsl(var(--bg-card))] hover:text-[hsl(var(--fg))]">
            Account
          </Link>
          <Link href="/settings/race" onClick={closeMenu} className="block rounded-lg px-2 py-1.5 text-sm text-[hsl(var(--fg-muted))] hover:bg-[hsl(var(--bg-card))] hover:text-[hsl(var(--fg))]">
            Race settings
          </Link>
          <Link href="/settings/integrations" onClick={closeMenu} className="block rounded-lg px-2 py-1.5 text-sm text-[hsl(var(--fg-muted))] hover:bg-[hsl(var(--bg-card))] hover:text-[hsl(var(--fg))]">
            Integrations
          </Link>
        </div>

        <form action={signOutAction} className="mt-3 border-t border-[hsl(var(--border))] pt-3">
          <button onClick={closeMenu} className="w-full rounded-lg px-2 py-1.5 text-left text-sm text-[hsl(var(--fg-muted))] transition hover:bg-rose-500/10 hover:text-rose-300">
            Sign out
          </button>
        </form>
      </div>
    </details>
  );
}
