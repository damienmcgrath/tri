"use client";

import { useFormState, useFormStatus } from "react-dom";
import { ingestTcxAction, initialResult } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded bg-cyan-600 px-3 py-2 text-sm font-medium text-white hover:bg-cyan-700 disabled:cursor-not-allowed disabled:bg-cyan-300"
    >
      {pending ? "Importing..." : "Import TCX"}
    </button>
  );
}

export function TcxUploadForm() {
  const [state, formAction] = useFormState(ingestTcxAction, initialResult);

  return (
    <form action={formAction} className="space-y-3">
      <div>
        <label htmlFor="tcxFile" className="block text-sm font-medium text-slate-700">
          Garmin export (.tcx)
        </label>
        <input id="tcxFile" name="tcxFile" type="file" accept=".tcx" required className="mt-1 block w-full text-sm" />
      </div>
      <SubmitButton />
      {state.status !== "idle" ? (
        <p className={`text-sm ${state.status === "success" ? "text-emerald-700" : "text-rose-700"}`}>{state.message}</p>
      ) : null}
    </form>
  );
}
