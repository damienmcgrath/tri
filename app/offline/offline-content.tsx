"use client";

export function OfflineContent() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[var(--color-base)] px-6 text-center">
      <div className="mb-6 text-[var(--color-accent)]" aria-hidden="true">
        <svg
          width="72"
          height="72"
          viewBox="0 0 72 72"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <polygon
            points="36,8 8,60 64,60"
            stroke="currentColor"
            strokeWidth="4"
            strokeLinejoin="round"
            fill="none"
          />
        </svg>
      </div>
      <h1 className="font-[family-name:var(--font-geist-sans)] text-page-title font-semibold text-[var(--color-text-primary)]">
        You&apos;re offline
      </h1>
      <p className="mt-3 max-w-sm font-[family-name:var(--font-geist-sans)] text-[var(--color-text-secondary)]">
        Tri.AI needs an internet connection to load your training data. Check
        your connection and try again.
      </p>
      <button
        onClick={() => window.location.reload()}
        className="mt-8 rounded-[var(--radius-md)] bg-[var(--color-accent)] px-6 py-3 font-[family-name:var(--font-geist-sans)] text-body font-medium text-[var(--color-base)] transition-opacity hover:opacity-90"
      >
        Try again
      </button>
    </div>
  );
}
