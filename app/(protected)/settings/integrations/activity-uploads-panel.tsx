"use client";

import { useMemo, useState, useTransition } from "react";

type UploadRow = {
  id: string;
  filename: string;
  file_type: "fit" | "tcx";
  created_at: string;
  status: "uploaded" | "parsed" | "matched" | "error";
  error_message: string | null;
  completed_activities: { id: string; sport_type: string; duration_sec: number; distance_m: number | null }[];
  session_activity_links: { planned_session_id: string }[];
};

type PlannedSession = { id: string; date: string; sport: string; type: string; duration: number };

function fmtDuration(sec?: number) {
  if (!sec) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

export function ActivityUploadsPanel({ initialUploads, plannedSessions }: { initialUploads: UploadRow[]; plannedSessions: PlannedSession[] }) {
  const [uploads, setUploads] = useState(initialUploads);
  const [message, setMessage] = useState<string>("");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [attachFor, setAttachFor] = useState<UploadRow | null>(null);
  const [isPending, startTransition] = useTransition();

  const detail = uploads.find((item) => item.id === detailId) ?? null;

  const sortedCandidates = useMemo(() => {
    if (!attachFor) return [];
    const activity = attachFor.completed_activities[0];
    const day = attachFor.created_at.slice(0, 10);
    return [...plannedSessions].sort((a, b) => {
      const aSame = a.date === day ? 0 : 1;
      const bSame = b.date === day ? 0 : 1;
      const aSport = activity?.sport_type === a.sport ? 0 : 1;
      const bSport = activity?.sport_type === b.sport ? 0 : 1;
      return aSame - bSame || aSport - bSport;
    });
  }, [attachFor, plannedSessions]);

  async function upload(file: File) {
    const data = new FormData();
    data.append("file", file);
    const response = await fetch("/api/uploads/activities", { method: "POST", body: data });
    const payload = await response.json();
    if (!response.ok) {
      setMessage(payload.error ?? "Upload failed");
      return;
    }
    setMessage(payload.duplicate ? "Duplicate file already uploaded." : "Upload successful.");
    window.location.reload();
  }

  return (
    <div className="space-y-4">
      <div
        className="surface-subtle rounded-xl border border-dashed border-white/20 p-5 text-sm"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          const file = event.dataTransfer.files?.[0];
          if (!file) return;
          if (!file.name.toLowerCase().endsWith(".fit") && !file.name.toLowerCase().endsWith(".tcx")) {
            setMessage("Unsupported file type. Upload .fit or .tcx");
            return;
          }
          void upload(file);
        }}
      >
        <p className="font-medium">Drop Garmin files here</p>
        <p className="mt-1 text-xs text-muted">Accepted formats: .fit (preferred), .tcx. Max 20MB.</p>
        <label className="btn-secondary mt-3 inline-flex cursor-pointer">
          Pick file
          <input
            type="file"
            className="hidden"
            accept=".fit,.tcx"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
            }}
          />
        </label>
        {message ? <p className="mt-2 text-xs text-cyan-200">{message}</p> : null}
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase text-muted">
              <th className="py-2">Date</th><th>Sport</th><th>Duration</th><th>Distance</th><th>Status</th><th></th>
            </tr>
          </thead>
          <tbody>
            {uploads.map((upload) => {
              const activity = upload.completed_activities[0];
              const linked = upload.status === "matched" || upload.session_activity_links.length > 0;
              return (
                <tr key={upload.id} className="border-t border-white/10">
                  <td className="py-2">{new Date(upload.created_at).toLocaleString()}</td>
                  <td>{activity?.sport_type ?? "—"}</td>
                  <td>{fmtDuration(activity?.duration_sec)}</td>
                  <td>{activity?.distance_m ? `${(Number(activity.distance_m) / 1000).toFixed(2)} km` : "—"}</td>
                  <td>{upload.status === "error" ? "Error" : linked ? "Linked" : "Unassigned"}</td>
                  <td className="space-x-2 text-xs">
                    <button className="text-cyan-300 underline" onClick={() => setDetailId(upload.id)}>View details</button>
                    {!linked && upload.status !== "error" ? (
                      <button className="text-cyan-300 underline" onClick={() => setAttachFor(upload)}>Attach to planned session</button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {detail ? <div className="surface-subtle p-3 text-xs">{detail.filename} • {detail.file_type.toUpperCase()} • {detail.error_message ?? "No errors"}</div> : null}

      {attachFor ? (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/60 p-4">
          <div className="surface w-full max-w-xl p-4">
            <h3 className="text-lg font-semibold">Attach to planned session</h3>
            <ul className="mt-3 max-h-72 space-y-2 overflow-auto">
              {sortedCandidates.map((candidate) => (
                <li key={candidate.id} className="surface-subtle flex items-center justify-between p-2 text-sm">
                  <span>{candidate.date} · {candidate.sport} · {candidate.type}</span>
                  <button
                    className="btn-secondary"
                    disabled={isPending}
                    onClick={() => {
                      startTransition(async () => {
                        await fetch(`/api/uploads/activities/${attachFor.id}/attach`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ plannedSessionId: candidate.id })
                        });
                        setAttachFor(null);
                        window.location.reload();
                      });
                    }}
                  >
                    Attach
                  </button>
                </li>
              ))}
            </ul>
            <button className="mt-3 text-xs underline" onClick={() => setAttachFor(null)}>Close</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
