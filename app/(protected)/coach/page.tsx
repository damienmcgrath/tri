import { CoachChat } from "./coach-chat";

export default function CoachPage() {
  return (
    <section className="space-y-6">
      <header className="rounded-2xl bg-gradient-to-r from-slate-950 via-cyan-900 to-slate-900 p-8 text-white shadow-xl">
        <p className="text-xs uppercase tracking-[0.2em] text-cyan-200">AI Coach</p>
        <h1 className="mt-2 text-3xl font-bold">Train smarter with real-time workout analysis</h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-100">
          Ask for training feedback, missed-session adjustments, and focused recommendations generated from your recent planned and completed workouts.
        </p>
      </header>

      <CoachChat />
    </section>
  );
}
