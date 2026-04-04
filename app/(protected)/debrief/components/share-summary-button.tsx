"use client";

import { useState } from "react";
import { ShareCardModal } from "./share-card-modal";

type Props = {
  weekOf: string;
  displayName: string | null;
};

export function ShareSummaryButton({ weekOf, displayName }: Props) {
  const [showModal, setShowModal] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setShowModal(true)}
        className="btn-primary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
          <polyline points="16 6 12 2 8 6" />
          <line x1="12" y1="2" x2="12" y2="15" />
        </svg>
        Share
      </button>
      {showModal && <ShareCardModal weekOf={weekOf} displayName={displayName} onClose={() => setShowModal(false)} />}
    </>
  );
}
