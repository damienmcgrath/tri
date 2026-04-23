"use client";

type Props = {
  questions: string[];
  onSelect: (question: string) => void;
};

export function SuggestedQuestions({ questions, onSelect }: Props) {
  if (!questions || questions.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 py-2">
      {questions.map((q, i) => (
        <button
          key={i}
          onClick={() => onSelect(q)}
          className="rounded-full border border-accent/30 bg-accent/5 px-3 py-1.5 text-ui-label text-accent transition hover:bg-accent/15"
        >
          {q}
        </button>
      ))}
    </div>
  );
}
