import { SignUpForm } from "./sign-up-form";

export default function SignUpPage() {
  return (
    <main className="app-shell auth-shell">
      <div className="auth-panel auth-stack">
        <div className="surface space-y-2 p-6 text-center">
          <p className="label">Tri.ai</p>
          <h1 className="mt-3 text-page-hero">Create your Tri.AI account</h1>
          <p className="mt-2 text-body text-muted">Sign up with email and password to unlock protected training tools.</p>
        </div>
        <div className="surface p-6">
          <SignUpForm />
        </div>
      </div>
    </main>
  );
}
