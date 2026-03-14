import Link from "next/link";

export default function HomePage() {
  return (
    <main className="app-shell motif-lab mx-auto flex min-h-screen w-full max-w-5xl flex-col justify-center gap-8 px-6 py-20">
      <div className="space-y-4">
        <p className="label">tri.ai</p>
        <h1 className="text-4xl tracking-tight">Your AI training companion for triathlon</h1>
        <p className="max-w-2xl text-lg text-muted">
          Build your weekly plan, track execution, and get coach-style insights without a noisy interface.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <Link className="btn-primary" href="/auth/sign-in">
          Sign in
        </Link>
        <Link className="btn-secondary" href="/auth/sign-up">
          Create account
        </Link>
      </div>
    </main>
  );
}
