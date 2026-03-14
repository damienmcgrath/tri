"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { IssueDetailPanel, IssueList, type IssueListItem } from "@/components/training/coach-issues";

export function CoachIssueWorkspace({
  issues,
  defaultPromptPrefix
}: {
  issues: IssueListItem[];
  defaultPromptPrefix: string;
}) {
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(issues[0]?.id ?? null);

  const selectedIssue = useMemo(
    () => issues.find((issue) => issue.id === selectedIssueId) ?? issues[0] ?? null,
    [issues, selectedIssueId]
  );

  const prompts = selectedIssue
    ? [
        `Why does this matter for the week?`,
        `Should I repeat this session?`,
        `How should I adjust the rest of the week?`,
        `What should I change next time?`
      ]
    : [
        "What should I protect next this week?",
        "How is the week trending?",
        "What is the biggest current risk?"
      ];

  const promptPrefix = selectedIssue ? `${selectedIssue.sessionTitle}: ` : defaultPromptPrefix;

  return (
    <section className="grid gap-4 xl:grid-cols-[0.88fr_1.12fr]">
      <div>
        <p className="mb-2 text-xs uppercase tracking-[0.14em] text-tertiary">Flagged issues</p>
        <IssueList issues={issues} selectedIssueId={selectedIssue?.id ?? null} onSelect={setSelectedIssueId} />
      </div>

      <div className="space-y-4">
        <IssueDetailPanel issue={selectedIssue} />

        <article className="surface p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.14em] text-tertiary">Ask coach follow-up</p>
              <h3 className="mt-1 text-lg font-semibold">
                {selectedIssue ? "Stay on the current issue" : "Ask about this week"}
              </h3>
              <p className="mt-2 text-sm text-muted">
                {selectedIssue
                  ? "Use the selected issue as context so the answer stays specific."
                  : "Ask about the weekly read, current risk, or what to protect next."}
              </p>
            </div>
            <Link
              href={`/coach?prompt=${encodeURIComponent(`${promptPrefix}${prompts[0] ?? "What matters most right now?"}`)}`}
              className="btn-secondary px-3 py-1.5 text-xs"
            >
              Ask coach
            </Link>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {prompts.map((prompt) => (
              <Link
                key={prompt}
                href={`/coach?prompt=${encodeURIComponent(`${promptPrefix}${prompt}`)}`}
                className="rounded-full border border-[hsl(var(--border))] px-3 py-1.5 text-xs text-muted transition hover:border-[hsl(var(--accent)/0.5)] hover:text-foreground"
              >
                {prompt}
              </Link>
            ))}
          </div>

          <form action="/coach" className="mt-4 space-y-2">
            <label className="text-xs uppercase tracking-[0.14em] text-tertiary" htmlFor="coach-follow-up">Custom follow-up</label>
            <div className="flex gap-2">
              <input
                id="coach-follow-up"
                name="prompt"
                defaultValue={promptPrefix}
                className="input-base flex-1"
                placeholder="Ask about this issue or the rest of the week"
              />
              <button className="btn-primary px-3 py-1.5 text-xs">Send</button>
            </div>
          </form>
        </article>
      </div>
    </section>
  );
}
