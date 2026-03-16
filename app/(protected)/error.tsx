"use client";

import { useEffect } from "react";

export default function ProtectedError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log to console in development; in production this could go to an error reporting service
    console.error("Protected route error:", error);
  }, [error]);

  return (
    <section className="flex min-h-[60vh] items-center justify-center px-4">
      <article className="surface max-w-lg p-6 text-center">
        <p className="label">Something went wrong</p>
        <h1 className="mt-2 text-2xl font-semibold">
          We hit a problem loading this page
        </h1>
        <p className="mt-3 text-sm text-muted">
          {error.message || "An unexpected error occurred. Please try again."}
        </p>
        {error.digest ? (
          <p className="mt-2 text-[11px] text-tertiary">
            Error ID: {error.digest}
          </p>
        ) : null}
        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="btn-primary px-4 py-2 text-sm"
          >
            Try again
          </button>
          <a href="/dashboard" className="btn-ghost px-4 py-2 text-sm">
            Back to dashboard
          </a>
        </div>
      </article>
    </section>
  );
}
