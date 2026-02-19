import Link from "next/link";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col justify-center gap-8 px-6 py-20">
      <div className="space-y-4">
        <p className="text-sm font-semibold uppercase tracking-wide text-cyan-700">TriCoach AI 2.0</p>
        <h1 className="text-4xl font-bold tracking-tight text-slate-900">Your AI training companion for triathlon</h1>
        <p className="max-w-2xl text-lg text-slate-600">
          Day 1 scaffold is ready. Start by creating your athlete profile, then build your training plan and compare it with completed Garmin sessions.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <Link className="rounded-md bg-cyan-600 px-4 py-2 font-medium text-white hover:bg-cyan-700" href="/auth/sign-in">
          Sign in
        </Link>
        <Link className="rounded-md border border-slate-300 bg-white px-4 py-2 font-medium text-slate-700 hover:bg-slate-100" href="/auth/sign-up">
          Create account
        </Link>
      </div>
    </main>
  );
}
