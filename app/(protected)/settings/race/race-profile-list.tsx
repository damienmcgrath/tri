"use client";

import { useState } from "react";

type RaceProfileRow = {
  id: string;
  name: string;
  date: string;
  distance_type: string;
  priority: string;
  notes: string | null;
};

const PRIORITY_BADGE: Record<string, string> = {
  A: "bg-red-500/20 text-red-400 border-red-500/30",
  B: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  C: "bg-neutral-500/20 text-neutral-400 border-neutral-500/30",
};

const DISTANCE_LABELS: Record<string, string> = {
  sprint: "Sprint",
  olympic: "Olympic",
  "70.3": "70.3",
  ironman: "Ironman",
  custom: "Custom",
};

export function RaceProfileList({ races }: { races: RaceProfileRow[] }) {
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);

    const form = e.currentTarget;
    const data = new FormData(form);

    try {
      const res = await fetch("/api/race-profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: data.get("name"),
          date: data.get("date"),
          distanceType: data.get("distanceType"),
          priority: data.get("priority"),
          notes: data.get("notes") || undefined,
        }),
      });

      if (res.ok) {
        window.location.reload();
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-4 space-y-3">
      {races.length === 0 && !showForm && (
        <p className="text-body text-muted">No races added yet.</p>
      )}

      {races.map((race) => (
        <div key={race.id} className="flex items-center gap-3 rounded-md border border-[var(--border-subtle)] p-3">
          <span className={`inline-flex h-6 w-6 items-center justify-center rounded border text-ui-label font-semibold ${PRIORITY_BADGE[race.priority] ?? ""}`}>
            {race.priority}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-body font-medium">{race.name}</p>
            <p className="text-ui-label text-muted">
              {DISTANCE_LABELS[race.distance_type] ?? race.distance_type} &middot; {race.date}
            </p>
          </div>
          {race.notes && <p className="hidden text-ui-label text-muted md:block">{race.notes}</p>}
        </div>
      ))}

      {showForm ? (
        <form onSubmit={handleSubmit} className="grid gap-3 rounded-md border border-[var(--border-subtle)] p-4 md:max-w-lg">
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label htmlFor="rp-name" className="label-base">Race name</label>
              <input id="rp-name" name="name" required className="input-base mt-1" placeholder="Hamburg 70.3" />
            </div>
            <div>
              <label htmlFor="rp-date" className="label-base">Date</label>
              <input id="rp-date" name="date" type="date" required className="input-base mt-1" />
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label htmlFor="rp-distance" className="label-base">Distance</label>
              <select id="rp-distance" name="distanceType" className="input-base mt-1" defaultValue="70.3">
                <option value="sprint">Sprint</option>
                <option value="olympic">Olympic</option>
                <option value="70.3">70.3</option>
                <option value="ironman">Ironman</option>
                <option value="custom">Custom</option>
              </select>
            </div>
            <div>
              <label htmlFor="rp-priority" className="label-base">Priority</label>
              <select id="rp-priority" name="priority" className="input-base mt-1" defaultValue="A">
                <option value="A">A — Peak race</option>
                <option value="B">B — Mini-taper</option>
                <option value="C">C — Train through</option>
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="rp-notes" className="label-base">Notes (optional)</label>
            <input id="rp-notes" name="notes" className="input-base mt-1" placeholder="Hilly bike course, expected hot conditions" />
          </div>
          <div className="flex gap-2">
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? "Saving\u2026" : "Add race"}
            </button>
            <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </form>
      ) : (
        <button className="btn-secondary text-body" onClick={() => setShowForm(true)}>
          + Add race
        </button>
      )}
    </div>
  );
}
