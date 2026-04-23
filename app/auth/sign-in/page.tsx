import { Suspense } from "react";
import Link from "next/link";
import { isAgentPreviewEnabled } from "@/lib/agent-preview/config";
import { SignInForm } from "./sign-in-form";

export default function SignInPage() {
  const showAgentPreview = isAgentPreviewEnabled();

  return (
    <main className="app-shell auth-shell">
      <div className="auth-panel auth-stack">
        <div className="surface space-y-2 p-6 text-center">
          <p className="label">Tri.ai</p>
          <h1 className="mt-3 text-page-hero">Sign in to Tri.AI</h1>
          <p className="mt-2 text-body text-muted">Access your dashboard, plan, calendar, and coach workspace.</p>
        </div>
        <Suspense fallback={<div className="mt-4 h-40 animate-pulse rounded-md bg-[var(--color-surface-raised)]" />}>
          <div className="surface p-6">
            <SignInForm />
          </div>
        </Suspense>
        {showAgentPreview ? (
          <div className="surface space-y-3 p-6">
            <p className="label">Local Preview</p>
            <p className="text-body text-muted">For agent screenshots and UI inspection, skip live auth and enter the seeded preview workspace.</p>
            <div className="flex flex-wrap gap-2">
              <Link href="/dev/agent-login" className="btn-primary">
                Enter preview mode
              </Link>
              <Link href="/dev/agent-preview" className="btn-secondary">
                Open preview guide
              </Link>
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}
