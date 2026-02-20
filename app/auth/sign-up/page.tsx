import { SignUpForm } from "./sign-up-form";

export default function SignUpPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-16">
      <div className="space-y-2 pb-6 text-center">
        <h1 className="text-3xl font-bold text-slate-900">Create your TriCoach AI account</h1>
        <p className="text-sm text-slate-600">Sign up with email and password to unlock protected training tools.</p>
      </div>
      <SignUpForm />
    </main>
  );
}
