import { Suspense } from "react";
import { SignInForm } from "./sign-in-form";


export default function SignInPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-16">
      <div className="space-y-2 pb-6 text-center">
        <h1 className="text-3xl font-bold text-slate-900">Sign in to TriCoach AI</h1>
        <p className="text-sm text-slate-600">Access your dashboard, plan, calendar, and coach workspace.</p>
      </div>
      <Suspense fallback={null}>
        <SignInForm />
      </Suspense>
    </main>
  );
}
