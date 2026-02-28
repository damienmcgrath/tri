import { CoachChat } from "./coach-chat";

export default function CoachPage() {
  return (
    <section className="space-y-4">
      <article className="surface p-4">
        <p className="text-xs uppercase tracking-[0.14em] text-accent">Coach</p>
        <h1 className="mt-1 text-lg font-semibold">Adaptation workspace</h1>
        <p className="mt-1 text-sm text-muted">Review one recommendation with evidence, then apply changes in chat.</p>
      </article>
      <CoachChat />
    </section>
  );
}
