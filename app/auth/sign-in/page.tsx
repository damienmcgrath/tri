import { Suspense } from "react";
import { SignInForm } from "./sign-in-form";

export default function SignInPage() {
  return (
    <main className="app-shell mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-16">
      <div className="surface space-y-2 p-6 text-center">
        <h1 className="text-3xl font-semibold">Sign in to TriCoach AI</h1>
        <p className="text-sm text-muted">Access your dashboard, plan, calendar, and coach workspace.</p>
      </div>
      <Suspense fallback={<div className="mt-4 h-40 animate-pulse rounded-2xl bg-[hsl(var(--bg-card))]" />}>
        <div className="surface mt-4 p-6">
          <SignInForm />
        </div>
      </Suspense>
    </main>
  );
}
