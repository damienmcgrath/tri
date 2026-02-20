import { SignUpForm } from "./sign-up-form";

export default function SignUpPage() {
  return (
    <main className="app-shell mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-16">
      <div className="surface space-y-2 p-6 text-center">
        <h1 className="text-3xl font-semibold">Create your TriCoach AI account</h1>
        <p className="text-sm text-muted">Sign up with email and password to unlock protected training tools.</p>
      </div>
      <div className="surface mt-4 p-6">
        <SignUpForm />
      </div>
    </main>
  );
}
