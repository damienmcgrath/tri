"use client";

import { useState } from "react";

type ConversationEntry = {
  id: string;
  title: string;
  summary?: string | null;
  topicClassification?: string | null;
  createdAt: string;
};

type Props = {
  conversations: ConversationEntry[];
  activeId?: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
};

function groupByWeek(entries: ConversationEntry[]): Map<string, ConversationEntry[]> {
  const groups = new Map<string, ConversationEntry[]>();

  for (const entry of entries) {
    const date = new Date(entry.createdAt);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

    let label: string;
    if (diffDays < 1) label = "Today";
    else if (diffDays < 2) label = "Yesterday";
    else if (diffDays < 7) label = "This week";
    else if (diffDays < 14) label = "Last week";
    else label = "Older";

    const existing = groups.get(label) ?? [];
    existing.push(entry);
    groups.set(label, existing);
  }

  return groups;
}

const TOPIC_LABELS: Record<string, string> = {
  session_review: "Session",
  plan_question: "Plan",
  adaptation_request: "Adaptation",
  fatigue_concern: "Fatigue",
  race_prep: "Race",
  general_question: "General",
  performance_analysis: "Performance",
  discipline_balance: "Balance",
};

export function ConversationSidebar({ conversations, activeId, onSelect, onNew }: Props) {
  const [search, setSearch] = useState("");

  const filtered = search
    ? conversations.filter(
        (c) =>
          c.title.toLowerCase().includes(search.toLowerCase()) ||
          c.summary?.toLowerCase().includes(search.toLowerCase())
      )
    : conversations;

  const grouped = groupByWeek(filtered);

  return (
    <div className="flex h-full flex-col border-r border-white/10 bg-base">
      <div className="flex items-center gap-2 border-b border-white/10 p-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search conversations…"
          className="flex-1 rounded-md border border-white/10 bg-surface px-2 py-1 text-xs text-surface-foreground placeholder:text-muted-foreground"
        />
        <button
          onClick={onNew}
          className="shrink-0 rounded-md bg-accent/20 px-2 py-1 text-xs font-medium text-accent transition hover:bg-accent/30"
        >
          New
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {Array.from(grouped.entries()).map(([label, entries]) => (
          <div key={label}>
            <div className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {label}
            </div>
            {entries.map((entry) => (
              <button
                key={entry.id}
                onClick={() => onSelect(entry.id)}
                className={`w-full px-3 py-2 text-left transition hover:bg-surface ${
                  entry.id === activeId ? "bg-surface" : ""
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-xs text-surface-foreground">
                    {entry.title}
                  </span>
                  {entry.topicClassification && (
                    <span className="shrink-0 rounded bg-white/5 px-1 py-0.5 text-[9px] text-muted-foreground">
                      {TOPIC_LABELS[entry.topicClassification] ?? entry.topicClassification}
                    </span>
                  )}
                </div>
                {entry.summary && (
                  <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                    {entry.summary}
                  </p>
                )}
              </button>
            ))}
          </div>
        ))}

        {filtered.length === 0 && (
          <p className="p-4 text-center text-xs text-muted-foreground">
            {search ? "No matching conversations" : "No conversations yet"}
          </p>
        )}
      </div>
    </div>
  );
}
