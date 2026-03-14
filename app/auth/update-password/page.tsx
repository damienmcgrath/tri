import { Suspense } from "react";
import { UpdatePasswordForm } from "./update-password-form";

export default function UpdatePasswordPage() {
  return (
    <main className="app-shell auth-shell">
      <div className="auth-panel auth-stack">
        <div className="surface space-y-2 p-6 text-center">
          <p className="label">Tri.ai</p>
          <h1 className="mt-3 text-3xl">Choose a new password</h1>
          <p className="mt-2 text-sm text-muted">Set a new password for your Tri.AI account, then sign back in if needed.</p>
        </div>
        <Suspense fallback={<div className="mt-4 h-40 animate-pulse rounded-md bg-[var(--color-surface-raised)]" />}>
          <div className="surface p-6">
            <UpdatePasswordForm />
          </div>
        </Suspense>
      </div>
    </main>
  );
}
