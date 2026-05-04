"use client";

import { Fragment } from "react";

export type Conversation = {
  id: string;
  title: string;
  updated_at: string;
};

export type ConversationGroups = {
  thisWeek: Conversation[];
  lastWeek: Conversation[];
  older: Conversation[];
};

function getMondayOf(date: Date): Date {
  const d = new Date(date);
  const day = d.getUTCDay();
  const offset = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + offset);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function getWeekGroup(updatedAt: string): "this_week" | "last_week" | "older" {
  const date = new Date(updatedAt);
  const thisMonday = getMondayOf(new Date());
  const lastMonday = new Date(thisMonday);
  lastMonday.setUTCDate(lastMonday.getUTCDate() - 7);

  if (date >= thisMonday) return "this_week";
  if (date >= lastMonday) return "last_week";
  return "older";
}

export function groupConversations(conversations: Conversation[]): ConversationGroups {
  const thisWeek: Conversation[] = [];
  const lastWeek: Conversation[] = [];
  const older: Conversation[] = [];

  for (const conv of conversations) {
    const group = getWeekGroup(conv.updated_at);
    if (group === "this_week") thisWeek.push(conv);
    else if (group === "last_week") lastWeek.push(conv);
    else older.push(conv);
  }

  return { thisWeek, lastWeek, older };
}

export function formatRecencyLabel(updatedAt?: string): string {
  if (!updatedAt) {
    return "Ready to start";
  }

  const diffMs = Date.now() - new Date(updatedAt).getTime();
  const diffMinutes = Math.max(Math.round(diffMs / 60000), 0);

  if (diffMinutes < 1) {
    return "Updated just now";
  }

  if (diffMinutes < 60) {
    return `Updated ${diffMinutes}m ago`;
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) {
    return `Updated ${diffHours}h ago`;
  }

  const diffDays = Math.round(diffHours / 24);
  return `Updated ${diffDays}d ago`;
}

export function conversationTitle(conversation: Conversation, index: number, totalCount: number) {
  const trimmed = conversation.title.trim();
  if (trimmed.length > 0) {
    return trimmed;
  }
  return `Conversation ${totalCount - index}`;
}

type ConversationItemProps = {
  conversation: Conversation;
  index: number;
  totalCount: number;
  isActive: boolean;
  onSelect: (id: string) => void;
  onRename: (conversation: Conversation, index: number) => void;
  onDelete: (id: string) => void;
};

export function CoachConversationItem({
  conversation,
  index,
  totalCount,
  isActive,
  onSelect,
  onRename,
  onDelete
}: ConversationItemProps) {
  return (
    <div className={`rounded-md border px-2 py-1.5 ${isActive ? "border-transparent bg-[rgba(255,255,255,0.06)]" : "border-transparent hover:border-[hsl(var(--border))]"}`}>
      <div className="flex items-start justify-between gap-1">
        <button type="button" onClick={() => onSelect(conversation.id)} className="min-w-0 flex-1 text-left leading-tight">
          <p className={`truncate pr-1 text-[13px] font-medium ${isActive ? "text-white" : "text-[rgba(255,255,255,0.55)]"}`}>
            {conversationTitle(conversation, index, totalCount)}
          </p>
          <p className="mt-1 text-[11px] text-[rgba(255,255,255,0.25)]">{formatRecencyLabel(conversation.updated_at)}</p>
        </button>
        <details className="relative">
          <summary className="cursor-pointer list-none px-1 text-sm text-tertiary hover:text-white">⋯</summary>
          <div className="absolute right-0 z-10 mt-1 w-28 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] p-1 text-xs shadow-md">
            <button type="button" onClick={() => onRename(conversation, index)} className="block w-full rounded px-2 py-1 text-left hover:bg-[hsl(var(--surface-2))]">Rename</button>
            <button type="button" onClick={() => onDelete(conversation.id)} className="block w-full rounded px-2 py-1 text-left text-rose-300 hover:bg-[hsl(var(--surface-2))]">Delete</button>
          </div>
        </details>
      </div>
    </div>
  );
}

type ConversationHistoryProps = {
  conversations: Conversation[];
  groups: ConversationGroups;
  activeId: string | null;
  showOlder: boolean;
  onToggleOlder: () => void;
  onSelect: (id: string) => void;
  onRename: (conversation: Conversation, index: number) => void;
  onDelete: (id: string) => void;
};

export function CoachConversationHistory({
  conversations,
  groups,
  activeId,
  showOlder,
  onToggleOlder,
  onSelect,
  onRename,
  onDelete
}: ConversationHistoryProps) {
  const renderItem = (conversation: Conversation) => {
    const idx = conversations.indexOf(conversation);
    return (
      <CoachConversationItem
        key={conversation.id}
        conversation={conversation}
        index={idx}
        totalCount={conversations.length}
        isActive={conversation.id === activeId}
        onSelect={onSelect}
        onRename={onRename}
        onDelete={onDelete}
      />
    );
  };

  return (
    <Fragment>
      {groups.thisWeek.length > 0 ? (
        <div>
          <p className="mb-1 px-2 text-[10px] font-medium uppercase tracking-[0.12em] text-[rgba(255,255,255,0.28)]">This week</p>
          <div className="space-y-1">{groups.thisWeek.slice(0, 5).map(renderItem)}</div>
        </div>
      ) : null}
      {groups.lastWeek.length > 0 ? (
        <div>
          <p className="mb-1 px-2 text-[10px] font-medium uppercase tracking-[0.12em] text-[rgba(255,255,255,0.28)]">Last week</p>
          <div className="space-y-1">{groups.lastWeek.slice(0, 3).map(renderItem)}</div>
        </div>
      ) : null}
      {groups.older.length > 0 ? (
        <div>
          <button
            type="button"
            onClick={onToggleOlder}
            className="mb-1 flex w-full items-center justify-between px-2 text-[10px] font-medium uppercase tracking-[0.12em] text-[rgba(255,255,255,0.28)] hover:text-[rgba(255,255,255,0.45)]"
          >
            <span>Older</span>
            <span className="rounded-full border border-[rgba(255,255,255,0.12)] px-1.5 py-0.5 text-[9px]">{groups.older.length}</span>
          </button>
          {showOlder ? (
            <div className="space-y-1">{groups.older.map(renderItem)}</div>
          ) : null}
        </div>
      ) : null}
    </Fragment>
  );
}
