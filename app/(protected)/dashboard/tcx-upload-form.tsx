"use client";

import { useFormState, useFormStatus } from "react-dom";
import { ingestTcxAction, type IngestResult } from "./actions";

const initialResult: IngestResult = {
  status: "idle",
  message: ""
};

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button type="submit" disabled={pending} className="btn-primary disabled:opacity-70">
      {pending ? "Importing..." : "Import TCX"}
    </button>
  );
}

export function TcxUploadForm() {
  const [state, formAction] = useFormState(ingestTcxAction, initialResult);

  return (
    <form action={formAction} className="space-y-3">
      <div>
        <label htmlFor="tcxFile" className="label-base">
          Garmin export (.tcx)
        </label>
        <input id="tcxFile" name="tcxFile" type="file" accept=".tcx" required aria-label="Upload TCX file" className="input-base mt-1" />
      </div>
      <SubmitButton />
      {state.status !== "idle" ? (
        <p className={`text-sm ${state.status === "success" ? "text-emerald-300" : "text-rose-400"}`}>{state.message}</p>
      ) : null}
    </form>
  );
}
