import { Suspense } from "react";
import { ForgotPasswordForm } from "./reset-password-form";

export default function ForgotPasswordPage() {
  return (
    <main className="app-shell auth-shell">
      <div className="auth-panel auth-stack">
        <div className="surface space-y-2 p-6 text-center">
          <p className="label">Tri.ai</p>
          <h1 className="mt-3 text-page-hero">Reset your password</h1>
          <p className="mt-2 text-body text-muted">Enter your email and we&apos;ll send you a secure password reset link.</p>
        </div>
        <Suspense fallback={<div className="mt-4 h-40 animate-pulse rounded-md bg-[var(--color-surface-raised)]" />}>
          <div className="surface p-6">
            <ForgotPasswordForm />
          </div>
        </Suspense>
      </div>
    </main>
  );
}
