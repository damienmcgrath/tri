import { CoachChat } from "./coach-chat";

export default function CoachPage() {
  return (
    <section className="space-y-6">
      <header className="surface p-8">
        <p className="text-xs uppercase tracking-[0.2em] text-cyan-300">AI Coach</p>
        <h1 className="mt-2 text-3xl font-semibold">Train smarter with real-time workout analysis</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          Ask for training feedback, missed-session adjustments, and focused recommendations generated from your recent
          planned and completed workouts.
        </p>
      </header>

      <CoachChat />
    </section>
  );
}
