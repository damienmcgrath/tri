"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { ThemePicker } from "./theme-picker";

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

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const details = detailsRef.current;
      if (!details?.open) return;
      if (event.target instanceof Node && !details.contains(event.target)) {
        details.open = false;
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, []);

  return (
    <details className="group relative" ref={detailsRef}>
      <summary aria-label="Open account menu" className="list-none cursor-pointer rounded-full border border-primary/45 bg-card p-0.5 shadow-[0_0_0_1px_hsl(var(--background)),0_10px_25px_hsl(210_30%_5%_/_0.35)] transition hover:border-primary/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60">
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatarUrl} alt="User avatar" className="h-9 w-9 rounded-full object-cover" />
        ) : (
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/20 text-xs font-semibold text-primary">
            {initials}
          </span>
        )}
      </summary>

      <div className="absolute right-0 z-50 mt-2 w-64 rounded-xl border border-border bg-card p-3 shadow-2xl shadow-black/40">
        <div className="border-b border-border pb-3">
          <p className="text-xs uppercase tracking-[0.15em] text-muted">Account</p>
          <p className="mt-1 text-sm font-semibold text-foreground">{displayName}</p>
          <p className="text-xs text-muted">{email}</p>
        </div>

        <div className="mt-3 space-y-1">
          <Link href="/settings" onClick={closeMenu} className="block rounded-lg px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
            Account
          </Link>
          <Link href="/settings/race" onClick={closeMenu} className="block rounded-lg px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
            Race settings
          </Link>
          <Link href="/settings/integrations" onClick={closeMenu} className="block rounded-lg px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
            Integrations
          </Link>
        </div>

        <ThemePicker />

        <form action={signOutAction} className="mt-3 border-t border-border pt-3">
          <button onClick={closeMenu} className="w-full rounded-lg px-2 py-1.5 text-left text-sm text-muted-foreground transition hover:bg-danger/15 hover:text-danger">
            Sign out
          </button>
        </form>
      </div>
    </details>
  );
}
