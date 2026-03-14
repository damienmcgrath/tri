import { Suspense } from "react";
import { SignInForm } from "./sign-in-form";

export default function SignInPage() {
  return (
    <main className="app-shell auth-shell">
      <div className="auth-panel auth-stack">
        <div className="surface space-y-2 p-6 text-center">
          <p className="label">Tri.ai</p>
          <h1 className="mt-3 text-3xl">Sign in to Tri.AI</h1>
          <p className="mt-2 text-sm text-muted">Access your dashboard, plan, calendar, and coach workspace.</p>
        </div>
        <Suspense fallback={<div className="mt-4 h-40 animate-pulse rounded-md bg-[var(--color-surface-raised)]" />}>
          <div className="surface p-6">
            <SignInForm />
          </div>
        </Suspense>
      </div>
    </main>
  );
}
