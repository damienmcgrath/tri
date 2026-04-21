"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef } from "react";

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
      <summary aria-label="Open account menu" className="list-none cursor-pointer rounded-full border border-[var(--border-default)] bg-[var(--color-surface)] p-0.5 transition hover:border-[var(--border-accent)] focus-visible:outline-none">
        {avatarUrl ? (
          <Image
            src={avatarUrl}
            alt="User avatar"
            width={36}
            height={36}
            sizes="36px"
            className="h-9 w-9 rounded-full object-cover"
          />
        ) : (
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--color-accent-muted)] text-xs font-medium text-accent">
            {initials}
          </span>
        )}
      </summary>

      <div className="absolute right-0 z-50 mt-2 w-64 rounded-md border border-[var(--border-default)] bg-[var(--color-surface-overlay)] p-3">
        <div className="border-b border-[var(--border-subtle)] pb-3">
          <p className="label-base">Account</p>
          <p className="mt-1 text-sm font-medium text-[hsl(var(--fg))]">{displayName}</p>
          <p className="text-xs text-muted">{email}</p>
        </div>

        <div className="mt-3 space-y-1">
          <Link href="/settings" onClick={closeMenu} className="block rounded-md px-2 py-1.5 text-sm text-[hsl(var(--fg-muted))] hover:bg-[var(--color-surface-raised)] hover:text-[hsl(var(--fg))]">
            Account
          </Link>
          <Link href="/settings/race" onClick={closeMenu} className="block rounded-md px-2 py-1.5 text-sm text-[hsl(var(--fg-muted))] hover:bg-[var(--color-surface-raised)] hover:text-[hsl(var(--fg))]">
            Race settings
          </Link>
          <Link href="/settings/integrations" onClick={closeMenu} className="block rounded-md px-2 py-1.5 text-sm text-[hsl(var(--fg-muted))] hover:bg-[var(--color-surface-raised)] hover:text-[hsl(var(--fg))]">
            Integrations
          </Link>
        </div>

        <form action={signOutAction} className="mt-3 border-t border-[var(--border-subtle)] pt-3">
          <button onClick={closeMenu} className="w-full rounded-md px-2 py-1.5 text-left text-sm text-[hsl(var(--fg-muted))] transition hover:bg-[var(--color-danger-muted)] hover:text-[var(--color-danger)]">
            Sign out
          </button>
        </form>
      </div>
    </details>
  );
}
