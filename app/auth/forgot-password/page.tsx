import { Suspense } from "react";
import { ForgotPasswordForm } from "./reset-password-form";

export default function ForgotPasswordPage() {
  return (
    <main className="app-shell mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-16">
      <div className="surface space-y-2 p-6 text-center">
        <h1 className="text-3xl font-semibold">Reset your password</h1>
        <p className="text-sm text-muted">Enter your email and we&apos;ll send you a secure password reset link.</p>
      </div>
      <Suspense fallback={<div className="mt-4 h-40 animate-pulse rounded-2xl bg-[hsl(var(--bg-card))]" />}>
        <div className="surface mt-4 p-6">
          <ForgotPasswordForm />
        </div>
      </Suspense>
    </main>
  );
}
